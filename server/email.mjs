/**
 * Outgoing email (transactional only). Providers, in order of preference:
 *   1. Cloudflare Email Sending: a `send_email` binding named EMAIL (env.EMAIL.send()).
 *   2. Resend HTTP API: RESEND_API_KEY (+ EMAIL_API_BASE, tests only).
 *   3. Off: nothing is sent and features.email is false.
 * Both providers need EMAIL_FROM (an address on a domain verified with that provider).
 *
 * Sending never blocks or fails the user action: callers queue a message, the send runs
 * in the background with a ~5s timeout and the outcome lands in email_log.
 * Emails never carry passwords or delivered credentials.
 */

export const EMAIL_TIMEOUT_MS = 5000;
const RESEND_BASE = "https://api.resend.com";

/** Accounts made without an email get <username>@no-email.asiax.local; demo and owner
 *  accounts use other *.local domains. None of those can receive mail. Plain format
 *  check only (the shop has no email verification step). */
export function isRealEmail(value) {
  if (typeof value !== "string") return false;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  // *.local (placeholders, demo, owner) and reserved test TLDs never get mail.
  return !/\.(local|localhost|invalid|test|example)$/.test(email);
}

/** "somchai@gmail.com" → "so***@gmail.com" (enough for the admin log, never the full address). */
export function maskEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  const [local = "", domain = ""] = email.split("@");
  const head = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return head + "***" + (domain ? "@" + domain : "");
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " timed out after " + ms + "ms")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const text = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Build the sender from Worker env / process.env. `fetchImpl` is injectable for tests.
 * Returns { enabled, provider, from, send(message) → Promise<{ id }> (throws on failure) }.
 */
export function createEmailSender(env = {}, { fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = EMAIL_TIMEOUT_MS } = {}) {
  const from = text(env.EMAIL_FROM);
  const fromName = text(env.EMAIL_FROM_NAME);
  const binding = env.EMAIL && typeof env.EMAIL.send === "function" ? env.EMAIL : null;
  const resendKey = text(env.RESEND_API_KEY);
  const base = (text(env.EMAIL_API_BASE) || RESEND_BASE).replace(/\/+$/, "");
  const off = { enabled: false, provider: null, from: from || null, send: async () => fail("email is not configured") };
  if (!from || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) return off;
  if (binding)
    return {
      enabled: true,
      provider: "cloudflare",
      from,
      async send({ to, subject, text: body, html }) {
        const result = await withTimeout(
          binding.send({
            to,
            from: fromName ? { email: from, name: fromName } : from,
            subject,
            text: body,
            html,
          }),
          timeoutMs,
          "Cloudflare Email",
        );
        return { id: result?.messageId ?? null };
      },
    };
  if (resendKey && typeof fetchImpl === "function")
    return {
      enabled: true,
      provider: "resend",
      from,
      async send({ to, subject, text: body, html }) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(base + "/emails", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + resendKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: fromName ? `${fromName} <${from}>` : from,
              to: [to],
              subject,
              text: body,
              html,
            }),
            signal: controller.signal,
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok)
            fail("Resend " + response.status + ": " + String(data?.message ?? data?.name ?? "error").slice(0, 160));
          return { id: data?.id ?? null };
        } catch (error) {
          if (error?.name === "AbortError") fail("Resend timed out after " + timeoutMs + "ms");
          throw error;
        } finally {
          clearTimeout(timer);
        }
      },
    };
  return off;
}
function fail(message) {
  throw new Error(message);
}

// ---------------------------------------------------------------- templates (Thai)

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const baht = (satang) =>
  (Number(satang ?? 0) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " บาท";

/** Simple, client-safe HTML: one white card on a cool grey background, one button. */
function layout({ shopName, heading, intro, rows = [], button, footer }) {
  const rowsHtml = rows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">${rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:8px 0;color:#5f6066;border-bottom:1px solid #eceef2">${escapeHtml(label)}</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#0b0b0c;border-bottom:1px solid #eceef2">${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const buttonHtml = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#1534ff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(button.label)}</a></p><p style="font-size:12px;color:#5f6066;word-break:break-all">หากปุ่มกดไม่ได้ ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:<br>${escapeHtml(button.href)}</p>`
    : "";
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head><body style="margin:0;background:#f1f3f6;font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;color:#0b0b0c"><div style="max-width:520px;margin:0 auto;padding:24px 16px"><p style="font-weight:700;font-size:15px;margin:0 0 12px">${escapeHtml(shopName)}</p><div style="background:#ffffff;border:1px solid #e3e6eb;border-radius:14px;padding:24px;box-shadow:0 1px 2px rgba(16,24,40,.06)"><h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(heading)}</h1><p style="font-size:14px;line-height:1.7;margin:0">${escapeHtml(intro)}</p>${rowsHtml}${buttonHtml}</div><p style="font-size:12px;color:#5f6066;line-height:1.6;margin:16px 4px">${escapeHtml(footer)}</p></div></body></html>`;
}
function plain({ shopName, heading, intro, rows = [], button, footer }) {
  return [
    shopName,
    "",
    heading,
    "",
    intro,
    ...(rows.length ? ["", ...rows.map(([l, v]) => l + ": " + v)] : []),
    ...(button ? ["", button.label + ":", button.href] : []),
    "",
    footer,
  ].join("\n");
}
function render(content) {
  return { subject: content.subject, text: plain(content), html: layout(content) };
}
const AUTOMATED = "อีเมลนี้ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับ หากมีคำถามติดต่อร้านผ่านช่องทางบนหน้าร้าน";

export const templates = {
  passwordReset({ shopName, link, minutes = 30 }) {
    return render({
      shopName,
      subject: `ตั้งรหัสผ่านใหม่ — ${shopName}`,
      heading: "ตั้งรหัสผ่านใหม่",
      intro: `มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ ลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุใน ${minutes} นาที`,
      button: { label: "ตั้งรหัสผ่านใหม่", href: link },
      footer: "หากคุณไม่ได้ขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ · " + AUTOMATED,
    });
  },
  orderConfirmed({ shopName, orderNumber, product, quantity, total, link, preorder = false, queueNumber }) {
    return render({
      shopName,
      subject: `ยืนยันคำสั่งซื้อ #${orderNumber} — ${shopName}`,
      heading: "ยืนยันคำสั่งซื้อ",
      intro: preorder
        ? "ร้านได้รับชำระเงินสำหรับสินค้าพรีออเดอร์แล้ว เมื่อสินค้าพร้อม ร้านจะแจ้งให้ทราบอีกครั้ง"
        : "ร้านได้รับชำระเงินแล้ว สินค้าของคุณพร้อมใช้งาน เข้าสู่ระบบแล้วเปิดหน้าคำสั่งซื้อเพื่อดูข้อมูลสินค้า",
      rows: [
        ["เลขที่คำสั่งซื้อ", "#" + orderNumber],
        ["สินค้า", product],
        ["จำนวน", String(quantity ?? 1)],
        ["ยอดชำระ", baht(total)],
        ...(preorder && queueNumber ? [["คิวพรีออเดอร์", "#" + queueNumber]] : []),
      ],
      button: { label: "ดูคำสั่งซื้อ", href: link },
      footer: "ข้อมูลบัญชีหรือโค้ดสินค้าจะแสดงเฉพาะในหน้าคำสั่งซื้อหลังเข้าสู่ระบบเท่านั้น ร้านไม่ส่งรหัสทางอีเมล · " + AUTOMATED,
    });
  },
  preorderReady({ shopName, orderNumber, product, quantity, link }) {
    return render({
      shopName,
      subject: `สินค้าพรีออเดอร์พร้อมแล้ว #${orderNumber} — ${shopName}`,
      heading: "สินค้าพรีออเดอร์พร้อมแล้ว",
      intro: "สินค้าที่คุณสั่งจองพร้อมใช้งานแล้ว เข้าสู่ระบบแล้วเปิดหน้าคำสั่งซื้อเพื่อดูข้อมูลสินค้า",
      rows: [
        ["เลขที่คำสั่งซื้อ", "#" + orderNumber],
        ["สินค้า", product],
        ["จำนวน", String(quantity ?? 1)],
      ],
      button: { label: "ดูคำสั่งซื้อ", href: link },
      footer: "ข้อมูลบัญชีหรือโค้ดสินค้าจะแสดงเฉพาะในหน้าคำสั่งซื้อหลังเข้าสู่ระบบเท่านั้น ร้านไม่ส่งรหัสทางอีเมล · " + AUTOMATED,
    });
  },
  /** "แจ้งเตือนเมื่อสินค้าเข้า": sent once per request; never says how many are in stock. */
  backInStock({ shopName, product, link }) {
    return render({
      shopName,
      subject: `สินค้าที่คุณรอกลับมามีของแล้ว — ${shopName}`,
      heading: "สินค้าที่คุณรอกลับมามีของแล้ว",
      intro:
        "สินค้าที่คุณกดรอแจ้งเตือนไว้กลับมาพร้อมขายแล้ว สินค้ามีจำนวนจำกัดและขายตามลำดับการชำระเงิน ร้านไม่ได้จองสินค้าไว้ให้",
      rows: [["สินค้า", product]],
      button: /^https?:\/\//.test(String(link ?? "")) ? { label: "ดูสินค้า", href: link } : undefined,
      footer: "คุณได้รับอีเมลนี้เพราะกด “แจ้งเตือนเมื่อมีของ” ไว้ ระบบแจ้งครั้งเดียว หากต้องการรออีกครั้งให้กดใหม่ในหน้าสินค้า · " + AUTOMATED,
    });
  },
};
