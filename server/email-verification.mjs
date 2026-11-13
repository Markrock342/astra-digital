/**
 * Email verification at sign-up ("ยืนยันอีเมล").
 *
 * - register() creates the account unverified and, while verification is on, sends a link
 *   `${PUBLIC_BASE_URL}/verify-email?token=…` (24 hours, single use). Sending runs through
 *   account-email.mjs queue(): never blocks or fails the sign-up; with no email provider the
 *   link is simply not sent (logged once). While the gate is on, sign-up needs a real address.
 * - POST /api/verify-email {token}: public (the link may be opened on another device).
 *   Idempotent: opening the same link again after it worked answers ok.
 * - POST /api/verify-email/resend and /change (signed in): a new link; older unused links stop
 *   working. Resend: at least 60 s apart and at most 3 per hour (the sign-up email does not
 *   count). Change email needs the current password and sends the link to the new address.
 * - Gate (shop setting requireEmailVerification, default on): an unverified customer cannot
 *   create orders / preorders or pay. Login, browsing, chat and the account page stay open.
 *   The gate is off whenever no email provider is configured, so a mail outage never stops
 *   sales. ADMIN / STAFF and demo visitor accounts always count as verified.
 * - Tokens: 32 random bytes; only an HMAC (server key) is stored; compared in constant time.
 * - The admin can mark a customer verified (ลูกค้าที่รับอีเมลไม่ได้); audited as
 *   CUSTOMER_EMAIL_VERIFIED so it shows in the customer's history.
 * Schema: ensureEmailVerification() in ensure-admin-fr.mjs.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isRealEmail, maskEmail } from "./email.mjs";

export const VERIFY_TOKEN_MS = 24 * 3600000;
export const VERIFY_RESEND_PER_HOUR = 3;
export const VERIFY_RESEND_COOLDOWN_MS = 60000;
export const EMAIL_NOT_VERIFIED = "กรุณายืนยันอีเมลก่อนสั่งซื้อ";
export const EMAIL_NOT_VERIFIED_PAY = "กรุณายืนยันอีเมลก่อนชำระเงิน";
const LINK_INVALID = "ลิงก์ยืนยันอีเมลไม่ถูกต้อง กรุณาเปิดลิงก์จากอีเมลอีกครั้ง";
const LINK_EXPIRED = "ลิงก์ยืนยันอีเมลหมดอายุแล้ว กรุณาเข้าสู่ระบบแล้วกด “ส่งลิงก์อีกครั้ง”";
const LINK_USED = "ลิงก์นี้ใช้ไม่ได้แล้ว เพราะมีลิงก์ใหม่กว่าส่งไปแทน กรุณาเปิดลิงก์ในอีเมลฉบับล่าสุด";
const EMAIL_OFF = "ร้านยังไม่เปิดระบบส่งอีเมล จึงยังส่งลิงก์ยืนยันไม่ได้";

export function createEmailVerification({
  one,
  run,
  tx,
  fail,
  key,
  clock = () => Date.now(),
  settings,
  mailerEnabled = false,
  // account-email.mjs queue() / email-templates render(), passed lazily (built later).
  queue,
  render,
  requireUser,
  requireAdmin,
  confirmPassword,
  // fraud.mjs blocklist (temporary email domains) for a changed address.
  assertEmailAllowed = () => {},
  publicBaseUrl = "",
}) {
  const enabled = !!mailerEnabled;
  let offLogged = false;
  const tokenHash = (token) => createHmac("sha256", key).update("email-verify:" + token).digest("hex");
  const sqlNow = () => new Date(clock()).toISOString().slice(0, 19).replace("T", " ");
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
  function baseUrl(ctx = {}) {
    for (const candidate of [publicBaseUrl, ctx.origin]) {
      if (typeof candidate !== "string" || !candidate) continue;
      try {
        const url = new URL(candidate);
        if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
      } catch {
        // next
      }
    }
    return "";
  }

  /** Shop setting on and an email provider configured. */
  const gateActive = () => enabled && settings()?.requireEmailVerification !== false;
  /** Staff and demo visitors never need to verify. */
  const isVerifiedRow = (row) =>
    !!row && (row.role !== "CUSTOMER" || !!row.is_demo || row.email_verified_at != null);
  const userRow = (id) =>
    one("SELECT id, email, name, role, is_demo, email_verified_at FROM users WHERE id=?", id);

  function lastSentAt(userId) {
    try {
      return one("SELECT MAX(created_at) AS t FROM email_verifications WHERE user_id=?", userId)?.t ?? null;
    } catch {
      return null;
    }
  }

  /** Fields added to publicUser(): what the storefront needs for the notice. */
  function view(row) {
    if (!row) return {};
    const verified = isVerifiedRow(row);
    if (verified) return { emailVerified: true };
    const last = lastSentAt(row.id);
    return {
      emailVerified: false,
      emailVerification: {
        // true = orders / payment are blocked until the email is verified.
        required: gateActive(),
        // A link can be sent (provider configured and the address can receive mail).
        canSend: enabled && isRealEmail(row.email),
        hasEmail: isRealEmail(row.email),
        // Seconds until "ส่งลิงก์อีกครั้ง" works again (0 = now).
        resendInSeconds: last == null ? 0 : Math.max(0, Math.ceil((last + VERIFY_RESEND_COOLDOWN_MS - clock()) / 1000)),
      },
    };
  }

  /** createOrder / pay: one small check at the top. */
  function assertCanBuy(user, pay = false) {
    if (!user || !gateActive()) return;
    const row = userRow(user.id);
    if (!row || isVerifiedRow(row)) return;
    fail(403, pay ? EMAIL_NOT_VERIFIED_PAY : EMAIL_NOT_VERIFIED);
  }

  /** New link (older unused ones die). Returns true when the email was queued. */
  function issueLink(row, kind, ctx) {
    if (!enabled || !isRealEmail(row.email)) return false;
    const t = clock();
    const token = randomBytes(32).toString("hex");
    run("UPDATE email_verifications SET used_at=? WHERE user_id=? AND used_at IS NULL", t, row.id);
    run(
      "INSERT INTO email_verifications(token_hash,user_id,email,kind,expires_at,created_at) VALUES(?,?,?,?,?,?)",
      tokenHash(token),
      row.id,
      String(row.email).toLowerCase(),
      kind,
      t + VERIFY_TOKEN_MS,
      t,
    );
    return queue({
      kind: "verify_email",
      to: row.email,
      message: render("verify_email", {
        shopName: shopName(),
        customerName: row.name,
        link: baseUrl(ctx) + "/verify-email?token=" + token,
        hours: VERIFY_TOKEN_MS / 3600000,
      }),
    });
  }

  /** register(): after the account exists. Never throws (sign-up must not fail on mail). */
  function afterRegister(userId, ctx = {}) {
    try {
      const row = userRow(userId);
      if (!row || isVerifiedRow(row) || !isRealEmail(row.email)) return false;
      if (!enabled) {
        if (!offLogged) console.info("Email verification: no email provider configured, sign-up links are not sent");
        offLogged = true;
        return false;
      }
      // Shop switched verification off (ตั้งค่า › ร้าน): no link, no notice, no gate.
      if (!gateActive()) return false;
      return issueLink(row, "signup", ctx);
    } catch (error) {
      console.error("Verification email skipped:", error?.message);
      return false;
    }
  }

  /** Sign-up with the gate on needs an address that can receive the link. */
  function assertRegisterEmail(email) {
    if (gateActive() && !isRealEmail(email))
      fail(400, "กรุณากรอกอีเมลที่ใช้งานได้ ร้านจะส่งลิงก์ยืนยันไปที่อีเมลนี้");
  }

  function checkSendLimit(userId) {
    const t = clock();
    const last = lastSentAt(userId);
    if (last != null && t - last < VERIFY_RESEND_COOLDOWN_MS) {
      const seconds = Math.ceil((last + VERIFY_RESEND_COOLDOWN_MS - t) / 1000);
      fail(429, "เพิ่งส่งลิงก์ไป กรุณารอ " + seconds + " วินาทีแล้วลองอีกครั้ง");
    }
    const recent = one(
      "SELECT COUNT(*) AS n FROM email_verifications WHERE user_id=? AND kind<>'signup' AND created_at>?",
      userId,
      t - 3600000,
    ).n;
    if (recent >= VERIFY_RESEND_PER_HOUR)
      fail(429, "ส่งลิงก์ครบ " + VERIFY_RESEND_PER_HOUR + " ครั้งในชั่วโมงนี้แล้ว กรุณาลองใหม่ภายหลัง");
  }

  function result(row) {
    const fresh = userRow(row.id);
    return { ok: true, email: fresh.email, ...view(fresh) };
  }

  function resend(user, ctx = {}) {
    requireUser(user);
    const row = userRow(user.id);
    if (!row) fail(404, "ไม่พบผู้ใช้");
    if (isVerifiedRow(row)) fail(409, "อีเมลนี้ยืนยันแล้ว");
    if (!enabled) fail(409, EMAIL_OFF);
    if (!isRealEmail(row.email)) fail(400, "บัญชีนี้ยังไม่มีอีเมลที่รับจดหมายได้ กรุณาเพิ่มอีเมลก่อน");
    return tx(() => {
      checkSendLimit(row.id);
      const sent = issueLink(row, "resend", ctx);
      if (!sent) fail(503, "ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      auditDetail(row.id, "EMAIL_VERIFY_RESEND", row.id, { email: maskEmail(row.email) });
      return result(row);
    });
  }

  /** Account page "เปลี่ยนอีเมล": password again; the new address starts unverified. */
  function changeEmail(user, input = {}, ctx = {}) {
    requireUser(user);
    if (!enabled) fail(409, EMAIL_OFF);
    const row = userRow(user.id);
    if (!row) fail(404, "ไม่พบผู้ใช้");
    if (row.role !== "CUSTOMER") fail(403, "บัญชีทีมงานเปลี่ยนอีเมลที่หน้านี้ไม่ได้");
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (email.length < 5 || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, "กรุณากรอกอีเมลให้ถูกต้อง");
    if (!isRealEmail(email)) fail(400, "อีเมลนี้รับจดหมายไม่ได้ กรุณาใช้อีเมลจริงของคุณ");
    confirmPassword(user, input.currentPassword);
    assertEmailAllowed(email);
    return tx(() => {
      if (email === String(row.email).toLowerCase() && isVerifiedRow(row)) fail(409, "อีเมลนี้ยืนยันแล้ว");
      if (one("SELECT id FROM users WHERE lower(email)=? AND id<>?", email, row.id)) fail(409, "อีเมลนี้ถูกใช้งานแล้ว");
      checkSendLimit(row.id);
      run("UPDATE users SET email=?, email_verified_at=NULL WHERE id=?", email, row.id);
      const sent = issueLink({ ...row, email }, "change", ctx);
      auditDetail(row.id, "EMAIL_CHANGE", row.id, {
        from: maskEmail(row.email),
        to: maskEmail(email),
        sent,
      });
      return result(row);
    });
  }

  /** The link from the email. No session needed. */
  function verify(input = {}, ctx = {}) {
    const token = typeof input.token === "string" ? input.token.trim() : "";
    if (!/^[a-f0-9]{64}$/.test(token)) fail(400, LINK_INVALID);
    const t = clock();
    const hash = tokenHash(token);
    const found = one("SELECT * FROM email_verifications WHERE token_hash=?", hash);
    if (!found || !timingSafeEqual(Buffer.from(found.token_hash, "hex"), Buffer.from(hash, "hex")))
      fail(400, LINK_INVALID);
    return tx(() => {
      const row = one("SELECT * FROM email_verifications WHERE token_hash=?", hash);
      const user = userRow(row.user_id);
      if (!user) fail(400, LINK_INVALID);
      const sameEmail = String(user.email).toLowerCase() === row.email;
      // Same link opened again (or the admin already verified): nothing to do, say so.
      if (sameEmail && user.email_verified_at != null) {
        if (row.used_at == null) run("UPDATE email_verifications SET used_at=? WHERE token_hash=?", t, hash);
        return { ok: true, alreadyVerified: true, email: maskEmail(user.email) };
      }
      if (row.used_at != null || !sameEmail) fail(410, LINK_USED);
      if (row.expires_at <= t) fail(410, LINK_EXPIRED);
      const claimed = run(
        "UPDATE email_verifications SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
        t,
        hash,
        t,
      );
      if (claimed.changes !== 1) fail(410, LINK_USED);
      run("UPDATE users SET email_verified_at=? WHERE id=?", sqlNow(), user.id);
      run("UPDATE email_verifications SET used_at=? WHERE user_id=? AND used_at IS NULL", t, user.id);
      auditDetail(user.id, "EMAIL_VERIFIED", user.id, { email: maskEmail(user.email), ip: ctx.ip ?? null });
      return { ok: true, alreadyVerified: false, email: maskEmail(user.email) };
    });
  }

  /** Admin › ลูกค้า › "ยืนยันให้" for a customer who cannot receive the email. */
  function adminVerify(admin, customerId) {
    requireAdmin(admin);
    const id = typeof customerId === "string" ? customerId.trim().slice(0, 80) : "";
    return tx(() => {
      const row = id ? userRow(id) : null;
      if (!row || row.role !== "CUSTOMER") fail(404, "ไม่พบลูกค้า");
      if (row.email_verified_at != null) fail(409, "อีเมลของลูกค้าคนนี้ยืนยันแล้ว");
      const at = sqlNow();
      run("UPDATE users SET email_verified_at=? WHERE id=?", at, row.id);
      run("UPDATE email_verifications SET used_at=? WHERE user_id=? AND used_at IS NULL", clock(), row.id);
      auditDetail(admin.id, "CUSTOMER_EMAIL_VERIFIED", row.id, { email: maskEmail(row.email), manual: true });
      return { ok: true, emailVerifiedAt: at };
    });
  }

  /** Admin changed the customer's address: the new one is not verified. */
  function afterAdminEmailChange(userId) {
    run("UPDATE users SET email_verified_at=NULL WHERE id=? AND role='CUSTOMER'", userId);
    run("UPDATE email_verifications SET used_at=? WHERE user_id=? AND used_at IS NULL", clock(), userId);
  }

  return {
    enabled,
    gateActive,
    view,
    isVerifiedRow,
    assertCanBuy,
    assertRegisterEmail,
    afterRegister,
    resend,
    changeEmail,
    verify,
    adminVerify,
    afterAdminEmailChange,
  };
}
