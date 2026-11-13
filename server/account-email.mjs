/**
 * Email features on top of the commerce core: self-service password reset and the
 * order emails ("ยืนยันคำสั่งซื้อ", "สินค้าพรีออเดอร์พร้อมแล้ว"). All of it is off unless an
 * email provider is configured (server/email.mjs); then features.email is true.
 *
 * Rules:
 * - Sending is queued in the background; the user action never waits for or fails on it.
 * - email_log keeps time, kind, masked recipient, ok and the provider id or error.
 * - Forgot-password answers the same thing whether or not the account exists.
 * - Reset tokens are single-use, 30 minutes, stored as a keyed hash only.
 * - Emails never contain passwords or delivered credentials.
 * Schema: ensureEmailAndReset() in ensure-admin-fr.mjs.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { isRealEmail, maskEmail } from "./email.mjs";
import { renderTemplate } from "./email-templates.mjs";

export const RESET_TOKEN_MS = 30 * 60000;
export const RESET_PER_ACCOUNT_PER_HOUR = 3;
export const FORGOT_RESPONSE =
  "หากอีเมลนี้ตรงกับบัญชีในร้าน ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว กรุณาตรวจกล่องจดหมาย (รวมถึงอีเมลขยะ) ลิงก์ใช้ได้ 30 นาที";
const RESET_INVALID = "ลิงก์ตั้งรหัสผ่านใหม่ไม่ถูกต้อง ถูกใช้ไปแล้ว หรือหมดอายุ กรุณาขอลิงก์ใหม่";
const RESET_OFF = "ระบบตั้งรหัสผ่านใหม่ทางอีเมลยังไม่เปิดใช้งาน กรุณาติดต่อร้าน";

export function createAccountEmail({
  one,
  all,
  run,
  fail,
  key,
  clock = () => Date.now(),
  passwordHash,
  settings,
  requireAdmin,
  clearLockout,
  mailer,
  turnstile,
  publicBaseUrl,
  waitUntil,
  // (key, args) → message: email-templates.mjs createEmailTemplateApis().render (admin edits win).
  renderEmail = null,
}) {
  const enabled = !!mailer?.enabled;
  const render = (k, args) => (renderEmail ? renderEmail(k, args) : renderTemplate(k, args));
  const pending = new Set();
  const tokenHash = (token) => createHmac("sha256", key).update("password-reset:" + token).digest("hex");
  const shopName = () => {
    const name = String(settings()?.shopName ?? "").trim();
    return name && name !== "ร้านค้า" ? name : "ASIA EXTRA";
  };
  const auditDetail = (userId, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      userId ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );
  /** Links point at PUBLIC_BASE_URL when set (recommended), else the request's own origin. */
  function baseUrl(ctx = {}) {
    for (const candidate of [publicBaseUrl, ctx.origin]) {
      if (typeof candidate !== "string" || !candidate) continue;
      try {
        const url = new URL(candidate);
        if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
      } catch {
        // try the next one
      }
    }
    return "";
  }

  /**
   * Queue one email. Returns true when queued. Never throws: a broken provider, a missing
   * table or a duplicate `ref` must not affect the action that triggered it.
   */
  function queue({ kind, to, ref = null, message }) {
    try {
      if (!enabled || !isRealEmail(to)) return false;
      const id = randomUUID();
      const inserted = run(
        "INSERT OR IGNORE INTO email_log(id,kind,recipient,ref,provider) VALUES(?,?,?,?,?)",
        id,
        kind,
        maskEmail(to),
        ref,
        mailer.provider ?? null,
      );
      if (!inserted?.changes) return false;
      const job = (async () => {
        try {
          const result = await mailer.send({ to: String(to).trim(), ...message });
          run(
            "UPDATE email_log SET ok=1, provider_id=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",
            result?.id == null ? null : String(result.id).slice(0, 200),
            id,
          );
        } catch (error) {
          console.error("Email send failed:", kind, error?.message);
          try {
            run(
              "UPDATE email_log SET ok=0, error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",
              String(error?.message ?? error).slice(0, 300),
              id,
            );
          } catch {
            // database gone (shutdown); nothing else to do
          }
        }
      })();
      pending.add(job);
      job.finally(() => pending.delete(job));
      try {
        waitUntil?.(job);
      } catch {
        // waitUntil is best effort
      }
      return true;
    } catch (error) {
      console.error("Email queue failed:", kind, error?.message);
      return false;
    }
  }

  // ------------------------------------------------ password reset

  function requestPasswordReset(input = {}, ctx = {}) {
    if (!enabled) fail(404, RESET_OFF);
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (email.length < 5 || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, "กรุณากรอกอีเมลให้ถูกต้อง");
    const user = isRealEmail(email) ? one("SELECT * FROM users WHERE lower(email)=?", email) : null;
    const t = clock();
    const detail = { email: maskEmail(email), ip: ctx.ip ?? null };
    let sent = false;
    if (user && (user.status ?? "ACTIVE") === "ACTIVE") {
      const recent = one(
        "SELECT COUNT(*) AS n FROM password_resets WHERE user_id=? AND created_at>?",
        user.id,
        t - 3600000,
      ).n;
      if (recent < RESET_PER_ACCOUNT_PER_HOUR) {
        const token = randomBytes(32).toString("hex");
        // One live link per account: older unused links stop working.
        run("UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL", t, user.id);
        run(
          "INSERT INTO password_resets(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
          tokenHash(token),
          user.id,
          t + RESET_TOKEN_MS,
          t,
        );
        const link = baseUrl(ctx) + "/reset-password?token=" + token;
        sent = queue({
          kind: "password_reset",
          to: user.email,
          message: render("password_reset", {
            shopName: shopName(),
            customerName: user.name,
            link,
            minutes: RESET_TOKEN_MS / 60000,
          }),
        });
      } else detail.throttled = true;
    }
    // Same audit action either way; only admins can read it.
    auditDetail(user?.id ?? null, "PASSWORD_RESET_REQUEST", user?.id ?? null, {
      ...detail,
      account: !!user,
      sent,
    });
    return { ok: true, message: FORGOT_RESPONSE };
  }

  function resetPassword(input = {}, ctx = {}) {
    if (!enabled) fail(404, RESET_OFF);
    const token = typeof input.token === "string" ? input.token.trim() : "";
    if (!/^[a-f0-9]{64}$/.test(token)) fail(400, RESET_INVALID);
    const raw = typeof input.newPassword === "string" ? input.newPassword.trim() : "";
    if (raw.length < 10 || raw.length > 128) fail(400, "รหัสผ่านใหม่ (อย่างน้อย 10 ตัวอักษร)ไม่ถูกต้อง");
    if (input.confirmPassword !== undefined && String(input.confirmPassword).trim() !== raw)
      fail(400, "รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
    const t = clock();
    const hash = tokenHash(token);
    const row = one("SELECT * FROM password_resets WHERE token_hash=?", hash);
    if (!row || row.used_at != null || row.expires_at <= t) fail(400, RESET_INVALID);
    const user = one("SELECT * FROM users WHERE id=?", row.user_id);
    if (!user || (user.status ?? "ACTIVE") !== "ACTIVE") fail(400, RESET_INVALID);
    // Claim the token first; a second request racing with the same link loses here.
    const claimed = run(
      "UPDATE password_resets SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
      t,
      hash,
      t,
    );
    if (claimed.changes !== 1) fail(400, RESET_INVALID);
    run("UPDATE users SET password_hash=? WHERE id=?", passwordHash(raw), user.id);
    run("UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL", t, user.id);
    // Every device signs in again; pending 2FA challenges from the old password die too.
    run("DELETE FROM sessions WHERE user_id=?", user.id);
    run("DELETE FROM login_challenges WHERE user_id=?", user.id);
    clearLockout(user.id);
    auditDetail(user.id, "PASSWORD_RESET_DONE", user.id, { ip: ctx.ip ?? null });
    // ADMIN / STAFF with 2FA keep it: the next login still asks for the code.
    return { ok: true };
  }

  // ------------------------------------------------ order emails

  function orderInfo(id) {
    for (const [table, preorder] of [
      ["orders", false],
      ["reservations", true],
    ]) {
      const row = one(
        `SELECT o.id, o.status, o.total, o.quantity, ${preorder ? "o.queue_number" : "NULL"} AS queue_number,
           p.name AS product, v.label, u.email, u.name AS customer_name
         FROM ${table} o JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id
         JOIN users u ON u.id=o.user_id WHERE o.id=?`,
        id,
      );
      if (row) return { ...row, preorder };
    }
    return null;
  }
  const productName = (info) => (info.label ? info.product + " · " + info.label : info.product);
  const orderNumber = (id) => String(id).slice(0, 8).toUpperCase();

  /** "ยืนยันคำสั่งซื้อ" once per order, after payment succeeded (delivered or queued preorder). */
  function sendOrderConfirmation(orderId, ctx = {}) {
    if (!enabled) return false;
    try {
      const info = orderInfo(orderId);
      if (!info || info.status !== (info.preorder ? "PREORDER" : "DELIVERED")) return false;
      return queue({
        kind: "order_confirmed",
        to: info.email,
        ref: "order-confirmed:" + info.id,
        message: render(info.preorder ? "preorder_confirmed" : "order_confirmed", {
          shopName: shopName(),
          customerName: info.customer_name,
          orderNumber: orderNumber(info.id),
          product: productName(info),
          quantity: info.quantity,
          total: info.total,
          preorder: info.preorder,
          queueNumber: info.queue_number,
          link: baseUrl(ctx) + "/orders/" + encodeURIComponent(info.id),
        }),
      });
    } catch (error) {
      console.error("Order email skipped:", error?.message);
      return false;
    }
  }
  /** "สินค้าพรีออเดอร์พร้อมแล้ว" once per preorder, after staff delivered it. */
  function sendPreorderReady(reservationId, ctx = {}) {
    if (!enabled) return false;
    try {
      const info = orderInfo(reservationId);
      if (!info?.preorder || info.status !== "DELIVERED") return false;
      return queue({
        kind: "preorder_ready",
        to: info.email,
        ref: "preorder-ready:" + info.id,
        message: render("preorder_ready", {
          shopName: shopName(),
          customerName: info.customer_name,
          orderNumber: orderNumber(info.id),
          product: productName(info),
          quantity: info.quantity,
          link: baseUrl(ctx) + "/orders/" + encodeURIComponent(info.id),
        }),
      });
    } catch (error) {
      console.error("Preorder email skipped:", error?.message);
      return false;
    }
  }

  /**
   * Wrap pay / deliverReservation without touching their money or order logic: the
   * original runs (and commits) first, the email is queued after it returned.
   */
  function hookOrderEmails(service) {
    const pay = service.pay;
    const deliver = service.deliverReservation;
    service.pay = (user, id, input, ctx) => {
      const result = pay(user, id, input);
      if (enabled && input?.outcome === "success") {
        // Deposit / free preorder paid in full when called → delivered: "พร้อมแล้ว" email.
        if (result?.preorder && result.status === "DELIVERED") sendPreorderReady(result.id ?? id, ctx);
        else sendOrderConfirmation(result?.id ?? id, ctx);
      }
      return result;
    };
    service.deliverReservation = (user, id, ctx) => {
      const result = deliver(user, id);
      if (enabled && result?.delivered) sendPreorderReady(result.id ?? id, ctx);
      return result;
    };
  }

  // ------------------------------------------------ admin › ตั้งค่า

  function integrationsStatus(user) {
    requireAdmin(user);
    let log = [];
    try {
      log = all(
        "SELECT id, created_at, kind, recipient, ok, provider, provider_id, error FROM email_log ORDER BY created_at DESC, rowid DESC LIMIT 20",
      );
    } catch {
      log = [];
    }
    return {
      email: {
        enabled,
        provider: enabled ? mailer.provider : null,
        from: mailer?.from ?? null,
      },
      turnstile: {
        enabled: !!turnstile?.enabled,
        siteKey: turnstile?.enabled ? turnstile.siteKey : null,
      },
      publicBaseUrl: publicBaseUrl || null,
      log,
    };
  }

  return {
    enabled,
    queue,
    requestPasswordReset,
    resetPassword,
    sendOrderConfirmation,
    sendPreorderReady,
    hookOrderEmails,
    integrationsStatus,
    /** Tests / shutdown: wait for queued sends to settle. */
    idle: () => Promise.allSettled([...pending]),
  };
}
