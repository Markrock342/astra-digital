/**
 * Editable email templates (admin › ตั้งค่า › ข้อความอีเมล).
 *
 * Every email the shop sends has a default here: subject, heading and body text with
 * placeholders such as {ชื่อลูกค้า} or {ลิงก์ออเดอร์}. The admin may override subject /
 * heading / body per template (table email_templates); "reset to default" deletes the row.
 *
 * Safety rules:
 * - Only the placeholders listed for a template are accepted; anything else in {…} is
 *   rejected on save, so a typo never reaches a customer as "{ลิงค์ออเดอร์}".
 * - Every value is HTML-escaped. Template text is escaped too (admins type plain text).
 * - Links are built by the server (order page, reset link…). Only placeholder values that
 *   are http(s) URLs become <a href>; a URL typed by the admin stays plain text.
 * - The details table, the button and the footer stay fixed per template (no credentials,
 *   no passwords). The password-reset body must contain {ลิงก์รีเซ็ต}.
 * - A stored override that no longer validates (placeholders changed in a later version)
 *   falls back to the default instead of breaking the send.
 * Schema: ensureEmailTemplates() in ensure-admin-fr.mjs.
 */
import { randomUUID } from "node:crypto";

export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const baht = (satang) =>
  (Number(satang ?? 0) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
  " บาท";
/** UTC "YYYY-MM-DD HH:MM:SS" → "13 พ.ย. 2569 18:30 น." (Bangkok wall time). */
const bangkokTime = (sql) => {
  const ms = Date.parse(String(sql ?? "").replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return "-";
  return (
    new Date(ms).toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " น."
  );
};
const isHttpUrl = (value) => /^https?:\/\/[^\s<>"']+$/i.test(String(value ?? ""));

export const AUTOMATED =
  "อีเมลนี้ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับ หากมีคำถามติดต่อร้านผ่านช่องทางบนหน้าร้าน";
const NO_SECRETS =
  "ข้อมูลบัญชีหรือโค้ดสินค้าจะแสดงเฉพาะในหน้าคำสั่งซื้อหลังเข้าสู่ระบบเท่านั้น ร้านไม่ส่งรหัสทางอีเมล · " + AUTOMATED;

/** Placeholder name (Thai, what the admin types inside {}) → short hint for the editor. */
export const PLACEHOLDER_HINTS = {
  ชื่อร้าน: "ชื่อร้านจากหน้าตั้งค่า",
  ชื่อลูกค้า: "ชื่อที่ลูกค้าใช้สมัคร",
  เลขออเดอร์: "เลขคำสั่งซื้อ 8 ตัว",
  ลิงก์ออเดอร์: "ลิงก์ไปหน้าคำสั่งซื้อ",
  สินค้า: "ชื่อสินค้าและตัวเลือก",
  จำนวน: "จำนวนที่สั่ง",
  ยอดชำระ: "ยอดเงิน เช่น 150.00 บาท",
  คิวพรีออเดอร์: "เลขคิวพรีออเดอร์",
  ชำระภายใน: "วันเวลาที่ต้องชำระส่วนที่เหลือให้เสร็จ (เวลาไทย)",
  ลิงก์รีเซ็ต: "ลิงก์ตั้งรหัสผ่านใหม่ (ต้องมี)",
  นาที: "อายุลิงก์เป็นนาที",
  ลิงก์สินค้า: "ลิงก์ไปหน้าสินค้า",
  หัวข้อประกาศ: "หัวข้อที่พิมพ์ตอนส่งประกาศ",
  ข้อความประกาศ: "ข้อความที่พิมพ์ตอนส่งประกาศ (ต้องมี)",
  ลิงก์ประกาศ: "ลิงก์ที่แนบกับประกาศ (ถ้ามี)",
};
/** Placeholders whose value is a server-built URL (rendered as a link in HTML). */
const LINK_PLACEHOLDERS = new Set(["ลิงก์ออเดอร์", "ลิงก์รีเซ็ต", "ลิงก์สินค้า", "ลิงก์ประกาศ"]);

const orderRows = (a, queue = false) => [
  ["เลขที่คำสั่งซื้อ", "#" + a.orderNumber],
  ["สินค้า", a.product],
  ["จำนวน", String(a.quantity ?? 1)],
  ...(a.total !== undefined ? [["ยอดชำระ", baht(a.total)]] : []),
  ...(queue && a.queueNumber ? [["คิวพรีออเดอร์", "#" + a.queueNumber]] : []),
];
const orderValues = (a) => ({
  ชื่อร้าน: a.shopName,
  ชื่อลูกค้า: a.customerName || "ลูกค้า",
  เลขออเดอร์: a.orderNumber,
  ลิงก์ออเดอร์: a.link,
  สินค้า: a.product,
  จำนวน: String(a.quantity ?? 1),
});

/**
 * Every template the system sends. `values(args)` maps the sender's arguments to the
 * placeholder values; rows / button / footer are fixed (server values only).
 */
export const EMAIL_TEMPLATES = {
  order_confirmed: {
    label: "ยืนยันคำสั่งซื้อ (สินค้าพร้อมส่ง)",
    when: "ส่งเมื่อลูกค้าชำระเงินสำเร็จและได้รับสินค้าแล้ว",
    placeholders: ["ชื่อร้าน", "ชื่อลูกค้า", "เลขออเดอร์", "ลิงก์ออเดอร์", "สินค้า", "จำนวน", "ยอดชำระ"],
    required: [],
    defaults: {
      subject: "ยืนยันคำสั่งซื้อ #{เลขออเดอร์} — {ชื่อร้าน}",
      heading: "ยืนยันคำสั่งซื้อ",
      body: "ร้านได้รับชำระเงินแล้ว สินค้าของคุณพร้อมใช้งาน เข้าสู่ระบบแล้วเปิดหน้าคำสั่งซื้อเพื่อดูข้อมูลสินค้า",
    },
    values: (a) => ({ ...orderValues(a), ยอดชำระ: baht(a.total) }),
    rows: (a) => orderRows(a),
    button: (a) => ({ label: "ดูคำสั่งซื้อ", href: a.link }),
    footer: NO_SECRETS,
  },
  preorder_confirmed: {
    label: "ยืนยันคำสั่งซื้อ (พรีออเดอร์)",
    when: "ส่งเมื่อลูกค้าชำระเงินพรีออเดอร์และได้เลขคิว",
    placeholders: ["ชื่อร้าน", "ชื่อลูกค้า", "เลขออเดอร์", "ลิงก์ออเดอร์", "สินค้า", "จำนวน", "ยอดชำระ", "คิวพรีออเดอร์"],
    required: [],
    defaults: {
      subject: "ยืนยันคำสั่งซื้อ #{เลขออเดอร์} — {ชื่อร้าน}",
      heading: "ยืนยันคำสั่งซื้อ",
      body: "ร้านได้รับชำระเงินสำหรับสินค้าพรีออเดอร์แล้ว เมื่อสินค้าพร้อม ร้านจะแจ้งให้ทราบอีกครั้ง",
    },
    values: (a) => ({
      ...orderValues(a),
      ยอดชำระ: baht(a.total),
      คิวพรีออเดอร์: a.queueNumber ? "#" + a.queueNumber : "-",
    }),
    rows: (a) => orderRows(a, true),
    button: (a) => ({ label: "ดูคำสั่งซื้อ", href: a.link }),
    footer: NO_SECRETS,
  },
  preorder_ready: {
    label: "สินค้าพรีออเดอร์พร้อมแล้ว",
    when: "ส่งเมื่อทีมงานกดส่งของให้พรีออเดอร์",
    placeholders: ["ชื่อร้าน", "ชื่อลูกค้า", "เลขออเดอร์", "ลิงก์ออเดอร์", "สินค้า", "จำนวน"],
    required: [],
    defaults: {
      subject: "สินค้าพรีออเดอร์พร้อมแล้ว #{เลขออเดอร์} — {ชื่อร้าน}",
      heading: "สินค้าพรีออเดอร์พร้อมแล้ว",
      body: "สินค้าที่คุณสั่งจองพร้อมใช้งานแล้ว เข้าสู่ระบบแล้วเปิดหน้าคำสั่งซื้อเพื่อดูข้อมูลสินค้า",
    },
    values: (a) => orderValues(a),
    rows: (a) => orderRows({ ...a, total: undefined }),
    button: (a) => ({ label: "ดูคำสั่งซื้อ", href: a.link }),
    footer: NO_SECRETS,
  },
  preorder_called: {
    label: "ถึงคิวพรีออเดอร์ (มัดจำ / จองฟรี)",
    when: "ส่งเมื่อของพร้อมและร้านเรียกคิว ลูกค้าต้องชำระส่วนที่เหลือภายในเวลาที่กำหนด",
    placeholders: ["ชื่อร้าน", "ชื่อลูกค้า", "เลขออเดอร์", "ลิงก์ออเดอร์", "สินค้า", "จำนวน", "ยอดชำระ", "คิวพรีออเดอร์", "ชำระภายใน"],
    required: [],
    defaults: {
      subject: "ถึงคิวของคุณแล้ว {คิวพรีออเดอร์} — {ชื่อร้าน}",
      heading: "ของพร้อมแล้ว ถึงคิวของคุณ",
      body:
        "ร้านกันสินค้าไว้ให้คุณแล้ว กรุณาชำระ {ยอดชำระ} ภายใน {ชำระภายใน} เพื่อรับสินค้า หากไม่ชำระภายในเวลา สิทธิ์จะส่งต่อให้คิวถัดไปตามเงื่อนไขที่แจ้งไว้ตอนจอง",
    },
    values: (a) => ({
      ...orderValues(a),
      ยอดชำระ: baht(a.total),
      คิวพรีออเดอร์: a.queueNumber ? "#" + a.queueNumber : "-",
      ชำระภายใน: bangkokTime(a.payBy),
    }),
    rows: (a) => [...orderRows(a, true), ["ชำระภายใน", bangkokTime(a.payBy)]],
    button: (a) => ({ label: "ชำระส่วนที่เหลือ", href: a.link }),
    footer: NO_SECRETS,
  },
  preorder_reminder: {
    label: "เตือนก่อนหมดเวลาชำระพรีออเดอร์",
    when: "ส่งครั้งเดียวประมาณ 2 ชั่วโมงก่อนหมดเวลาชำระส่วนที่เหลือ",
    placeholders: ["ชื่อร้าน", "ชื่อลูกค้า", "เลขออเดอร์", "ลิงก์ออเดอร์", "สินค้า", "จำนวน", "ยอดชำระ", "คิวพรีออเดอร์", "ชำระภายใน"],
    required: [],
    defaults: {
      subject: "ใกล้หมดเวลาชำระ คิว {คิวพรีออเดอร์} — {ชื่อร้าน}",
      heading: "ใกล้หมดเวลาชำระส่วนที่เหลือ",
      body: "สินค้าที่กันไว้ให้คุณจะถูกส่งต่อให้คิวถัดไปหากไม่ชำระ {ยอดชำระ} ภายใน {ชำระภายใน}",
    },
    values: (a) => ({
      ...orderValues(a),
      ยอดชำระ: baht(a.total),
      คิวพรีออเดอร์: a.queueNumber ? "#" + a.queueNumber : "-",
      ชำระภายใน: bangkokTime(a.payBy),
    }),
    rows: (a) => [...orderRows(a, true), ["ชำระภายใน", bangkokTime(a.payBy)]],
    button: (a) => ({ label: "ชำระส่วนที่เหลือ", href: a.link }),
    footer: NO_SECRETS,
  },
  password_reset: {
    label: "ลิงก์ตั้งรหัสผ่านใหม่",
    when: "ส่งเมื่อลูกค้ากด “ลืมรหัสผ่าน”",
    placeholders: ["ชื่อร้าน", "ชื่อลูกค้า", "ลิงก์รีเซ็ต", "นาที"],
    required: ["ลิงก์รีเซ็ต"],
    defaults: {
      subject: "ตั้งรหัสผ่านใหม่ — {ชื่อร้าน}",
      heading: "ตั้งรหัสผ่านใหม่",
      body:
        "มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ ลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุใน {นาที} นาที\n\nลิงก์ตั้งรหัสผ่านใหม่: {ลิงก์รีเซ็ต}",
    },
    values: (a) => ({
      ชื่อร้าน: a.shopName,
      ชื่อลูกค้า: a.customerName || "ลูกค้า",
      ลิงก์รีเซ็ต: a.link,
      นาที: String(a.minutes ?? 30),
    }),
    rows: () => [],
    button: (a) => ({ label: "ตั้งรหัสผ่านใหม่", href: a.link }),
    footer: "หากคุณไม่ได้ขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ · " + AUTOMATED,
  },
  back_in_stock: {
    label: "สินค้าที่รอกลับมามีของ",
    when: "ส่งเมื่อสินค้าที่ลูกค้ากด “แจ้งเตือนเมื่อมีของ” กลับมาขาย",
    placeholders: ["ชื่อร้าน", "สินค้า", "ลิงก์สินค้า"],
    required: [],
    defaults: {
      subject: "สินค้าที่คุณรอกลับมามีของแล้ว — {ชื่อร้าน}",
      heading: "สินค้าที่คุณรอกลับมามีของแล้ว",
      body:
        "สินค้าที่คุณกดรอแจ้งเตือนไว้กลับมาพร้อมขายแล้ว สินค้ามีจำนวนจำกัดและขายตามลำดับการชำระเงิน ร้านไม่ได้จองสินค้าไว้ให้",
    },
    values: (a) => ({ ชื่อร้าน: a.shopName, สินค้า: a.product, ลิงก์สินค้า: isHttpUrl(a.link) ? a.link : "" }),
    rows: (a) => [["สินค้า", a.product]],
    button: (a) => (isHttpUrl(a.link) ? { label: "ดูสินค้า", href: a.link } : null),
    footer:
      "คุณได้รับอีเมลนี้เพราะกด “แจ้งเตือนเมื่อมีของ” ไว้ ระบบแจ้งครั้งเดียว หากต้องการรออีกครั้งให้กดใหม่ในหน้าสินค้า · " +
      AUTOMATED,
  },
  broadcast: {
    label: "ประกาศถึงลูกค้า (ทางอีเมล)",
    when: "ส่งเมื่อแอดมินส่งประกาศและเลือกส่งอีเมลด้วย",
    placeholders: ["ชื่อร้าน", "หัวข้อประกาศ", "ข้อความประกาศ", "ลิงก์ประกาศ"],
    required: ["ข้อความประกาศ"],
    defaults: {
      subject: "{หัวข้อประกาศ} — {ชื่อร้าน}",
      heading: "{หัวข้อประกาศ}",
      body: "{ข้อความประกาศ}",
    },
    values: (a) => ({
      ชื่อร้าน: a.shopName,
      หัวข้อประกาศ: a.title,
      ข้อความประกาศ: a.body,
      ลิงก์ประกาศ: isHttpUrl(a.link) ? a.link : "",
    }),
    rows: () => [],
    button: (a) => (isHttpUrl(a.link) ? { label: "ดูรายละเอียด", href: a.link } : null),
    footer: "คุณได้รับอีเมลนี้เพราะมีบัญชีลูกค้ากับร้าน · " + AUTOMATED,
  },
};
export const EMAIL_TEMPLATE_KEYS = Object.keys(EMAIL_TEMPLATES);

export const TEMPLATE_LIMITS = { subject: 150, heading: 150, body: 4000 };
const TOKEN = /\{([^{}\r\n]{1,40})\}/g;

class TemplateError extends Error {}
const reject = (message) => {
  throw new TemplateError(message);
};

/**
 * Check a draft { subject, heading, body } for one template. Returns the trimmed draft or
 * throws (TemplateError, or `fail(400, …)` when given) with a short Thai message.
 */
export function validateTemplate(key, input = {}, fail = null) {
  try {
    const def = EMAIL_TEMPLATES[key];
    if (!def) reject("ไม่พบแม่แบบอีเมลนี้");
    const out = {};
    for (const [field, label] of [
      ["subject", "หัวข้ออีเมล"],
      ["heading", "หัวเรื่องในอีเมล"],
      ["body", "ข้อความ"],
    ]) {
      const raw = input[field];
      if (typeof raw !== "string") reject("กรุณากรอก" + label);
      const value = raw.replace(/\r\n?/g, "\n").trim();
      if (!value) reject("กรุณากรอก" + label);
      if (value.length > TEMPLATE_LIMITS[field])
        reject(label + "ยาวเกิน " + TEMPLATE_LIMITS[field] + " ตัวอักษร");
      if (field !== "body" && value.includes("\n")) reject(label + "ต้องอยู่ในบรรทัดเดียว");
      const unknown = [...value.matchAll(TOKEN)].map((m) => m[1]).filter((name) => !def.placeholders.includes(name));
      if (unknown.length)
        reject(
          "ไม่รู้จัก {" + unknown[0] + "} ใน" + label + " ใช้ได้เฉพาะ " + def.placeholders.map((p) => "{" + p + "}").join(" "),
        );
      out[field] = value;
    }
    for (const name of def.required)
      if (!out.body.includes("{" + name + "}")) reject("ข้อความต้องมี {" + name + "} เสมอ");
    return out;
  } catch (error) {
    if (error instanceof TemplateError && fail) fail(400, error.message);
    throw error;
  }
}

/** Plain-text fill: one pass, so a value that looks like "{x}" is never filled again. */
function fillText(template, values) {
  return template.replace(TOKEN, (whole, name) => (name in values ? String(values[name] ?? "") : whole));
}
/** HTML fill: template text and values escaped; server URLs in link placeholders become links. */
function fillHtml(template, values) {
  let out = "";
  let last = 0;
  for (const match of template.matchAll(TOKEN)) {
    out += escapeHtml(template.slice(last, match.index));
    const name = match[1];
    if (!(name in values)) out += escapeHtml(match[0]);
    else {
      const value = String(values[name] ?? "");
      out +=
        LINK_PLACEHOLDERS.has(name) && isHttpUrl(value)
          ? `<a href="${escapeHtml(value)}" style="color:#1534ff;word-break:break-all">${escapeHtml(value)}</a>`
          : escapeHtml(value);
    }
    last = match.index + match[0].length;
  }
  return out + escapeHtml(template.slice(last));
}

/** One white card on a cool grey background, one button (same look as before). */
function layout({ shopName, headingHtml, title, bodyHtml, rows, button, footer }) {
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
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f1f3f6;font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;color:#0b0b0c"><div style="max-width:520px;margin:0 auto;padding:24px 16px"><p style="font-weight:700;font-size:15px;margin:0 0 12px">${escapeHtml(shopName)}</p><div style="background:#ffffff;border:1px solid #e3e6eb;border-radius:14px;padding:24px;box-shadow:0 1px 2px rgba(16,24,40,.06)"><h1 style="font-size:20px;margin:0 0 12px">${headingHtml}</h1><p style="font-size:14px;line-height:1.7;margin:0;white-space:pre-line">${bodyHtml}</p>${rowsHtml}${buttonHtml}</div><p style="font-size:12px;color:#5f6066;line-height:1.6;margin:16px 4px">${escapeHtml(footer)}</p></div></body></html>`;
}

/**
 * Render one template. `override` is a validated { subject, heading, body } or null for the
 * default. Returns { subject, text, html } for mailer.send().
 */
export function renderTemplate(key, args = {}, override = null) {
  const def = EMAIL_TEMPLATES[key];
  if (!def) throw new Error("unknown email template " + key);
  const content = override ?? def.defaults;
  const values = def.values(args);
  const rows = def.rows(args);
  const button = def.button(args);
  const subject = fillText(content.subject, values).replace(/[\r\n]+/g, " ").trim().slice(0, 250);
  const heading = fillText(content.heading, values).replace(/[\r\n]+/g, " ").trim();
  const body = fillText(content.body, values);
  const shopName = String(args.shopName ?? "");
  const text = [
    shopName,
    "",
    heading,
    "",
    body,
    ...(rows.length ? ["", ...rows.map(([l, v]) => l + ": " + v)] : []),
    // The plain-text part repeats the button link only when the body did not already show it.
    ...(button && !body.includes(button.href) ? ["", button.label + ":", button.href] : []),
    "",
    def.footer,
  ].join("\n");
  const html = layout({
    shopName,
    title: heading,
    headingHtml: fillHtml(content.heading, values),
    bodyHtml: fillHtml(content.body, values),
    rows,
    button,
    footer: def.footer,
  });
  return { subject, text, html };
}

/** Sample data for preview / test send. Links point at the shop (server values). */
export function sampleArgs(key, { shopName = "ASIA EXTRA", base = "" } = {}) {
  const origin = base || "https://shop.example.com";
  const common = {
    shopName,
    customerName: "สมชาย ใจดี",
    orderNumber: "A1B2C3D4",
    product: "บัญชีสตรีมมิง · 30 วัน",
    quantity: 1,
    total: 15000,
    queueNumber: 12,
    link: origin + "/orders/ตัวอย่าง",
  };
  if (key === "password_reset") return { ...common, link: origin + "/reset-password?token=ตัวอย่าง", minutes: 30 };
  if (key === "back_in_stock") return { ...common, link: origin + "/products" };
  if (key === "preorder_called" || key === "preorder_reminder")
    return { ...common, total: 10500, payBy: new Date(Date.now() + 24 * 3600000).toISOString().slice(0, 19).replace("T", " ") };
  if (key === "broadcast")
    return {
      shopName,
      title: "โปรโมชันเดือนนี้",
      body: "ลด 10% ทุกสินค้า ถึงสิ้นเดือนนี้\nใช้โค้ดที่หน้าชำระเงิน",
      link: origin + "/products",
    };
  return common;
}

export const TEST_SEND_PER_HOUR = 5;

/**
 * Admin APIs + the resolver senders use. `queue` is account-email's queue(); `enabled`
 * says whether an email provider is configured.
 */
export function createEmailTemplateApis({
  one,
  all,
  run,
  fail,
  clock = () => Date.now(),
  requireAdmin,
  shopName = () => "ASIA EXTRA",
  queue = () => false,
  enabled = false,
  isRealEmail = () => false,
  maskEmail = (v) => v,
  publicBaseUrl = "",
}) {
  const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  const auditDetail = (userId, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      userId ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );
  function stored(key) {
    try {
      return one("SELECT subject, heading, body, updated_at FROM email_templates WHERE key=?", key) ?? null;
    } catch {
      return null; // table missing (very old test db): defaults
    }
  }
  /** The override for `key`, or null when none is saved or the saved one no longer validates. */
  function override(key) {
    const row = stored(key);
    if (!row) return null;
    try {
      return validateTemplate(key, row);
    } catch {
      return null;
    }
  }
  /** Used by every sender. Never throws for a broken override (falls back to the default). */
  function render(key, args) {
    return renderTemplate(key, args, override(key));
  }
  function base(ctx = {}) {
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
  const keyOf = (key) => {
    if (typeof key !== "string" || !EMAIL_TEMPLATES[key]) fail(404, "ไม่พบแม่แบบอีเมลนี้");
    return key;
  };
  function view(key) {
    const def = EMAIL_TEMPLATES[key];
    const row = stored(key);
    const current = override(key) ?? def.defaults;
    return {
      key,
      label: def.label,
      when: def.when,
      placeholders: def.placeholders.map((name) => ({ name, hint: PLACEHOLDER_HINTS[name] ?? "" })),
      required: def.required,
      subject: current.subject,
      heading: current.heading,
      body: current.body,
      defaults: { ...def.defaults },
      customized: !!row,
      updatedAt: row?.updated_at ?? null,
    };
  }
  function testsLastHour(user) {
    try {
      // email_log.created_at is the database clock (CURRENT_TIMESTAMP), so the window is too.
      return one(
        "SELECT COUNT(*) AS n FROM email_log WHERE kind='template_test' AND ref LIKE ? AND created_at>datetime('now','-1 hour')",
        "template-test:" + user.id + ":%",
      ).n;
    } catch {
      return 0;
    }
  }

  function adminEmailTemplates(user) {
    requireAdmin(user);
    return {
      email: { enabled: !!enabled, canTest: !!enabled && isRealEmail(user.email) },
      limits: { ...TEMPLATE_LIMITS, testPerHour: TEST_SEND_PER_HOUR, testsLeft: Math.max(0, TEST_SEND_PER_HOUR - testsLastHour(user)) },
      templates: EMAIL_TEMPLATE_KEYS.map(view),
    };
  }
  function adminSaveEmailTemplate(user, key, input = {}) {
    requireAdmin(user);
    keyOf(key);
    const draft = validateTemplate(key, input, fail);
    run(
      `INSERT INTO email_templates(key,subject,heading,body,updated_at,updated_by) VALUES(?,?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET subject=excluded.subject, heading=excluded.heading, body=excluded.body,
         updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
      key,
      draft.subject,
      draft.heading,
      draft.body,
      sqlTime(clock()),
      user.id,
    );
    auditDetail(user.id, "EMAIL_TEMPLATE_SAVE", key, { key });
    return { template: view(key) };
  }
  function adminResetEmailTemplate(user, key) {
    requireAdmin(user);
    keyOf(key);
    const removed = run("DELETE FROM email_templates WHERE key=?", key);
    if (removed?.changes) auditDetail(user.id, "EMAIL_TEMPLATE_RESET", key, { key });
    return { template: view(key) };
  }
  /** Draft fields given → preview the draft (validated); none → the saved version. */
  function draftOf(key, input) {
    const given = ["subject", "heading", "body"].some((f) => input?.[f] !== undefined);
    return given ? validateTemplate(key, input, fail) : override(key);
  }
  function adminPreviewEmailTemplate(user, key, input = {}, ctx = {}) {
    requireAdmin(user);
    keyOf(key);
    const draft = draftOf(key, input);
    return { preview: renderTemplate(key, sampleArgs(key, { shopName: shopName(), base: base(ctx) }), draft) };
  }
  function adminSendTestEmail(user, key, input = {}, ctx = {}) {
    requireAdmin(user);
    keyOf(key);
    if (!enabled)
      fail(409, "ยังไม่ได้ตั้งค่าระบบส่งอีเมล จึงส่งทดสอบไม่ได้ ดูวิธีตั้งค่าที่ ตั้งค่า › ร้าน › อีเมลและการป้องกันบอท");
    if (!isRealEmail(user.email))
      fail(400, "บัญชีแอดมินนี้ไม่มีอีเมลที่รับจดหมายได้ จึงส่งทดสอบไม่ได้");
    if (testsLastHour(user) >= TEST_SEND_PER_HOUR)
      fail(429, "ส่งทดสอบครบ " + TEST_SEND_PER_HOUR + " ครั้งในชั่วโมงนี้แล้ว กรุณารอสักครู่");
    const draft = draftOf(key, input);
    const message = renderTemplate(key, sampleArgs(key, { shopName: shopName(), base: base(ctx) }), draft);
    const queued = queue({
      kind: "template_test",
      to: user.email,
      ref: "template-test:" + user.id + ":" + randomUUID(),
      message: { ...message, subject: "[ทดสอบ] " + message.subject },
    });
    if (!queued) fail(503, "ส่งทดสอบไม่สำเร็จ กรุณาลองใหม่");
    auditDetail(user.id, "EMAIL_TEMPLATE_TEST", key, { key, to: maskEmail(user.email) });
    return { queued: true, to: maskEmail(user.email) };
  }

  return {
    render,
    adminEmailTemplates,
    adminSaveEmailTemplate,
    adminResetEmailTemplate,
    adminPreviewEmailTemplate,
    adminSendTestEmail,
  };
}
