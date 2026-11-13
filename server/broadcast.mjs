/**
 * Announcements to customers (ลูกค้า › ประกาศถึงลูกค้า). ADMIN only.
 *
 * - Audience: every active customer, customers who bought one product in the last N days
 *   (paid orders, paid or delivered preorders), or customers with an unpaid order.
 * - Channels: an in-site notification (kind `broadcast`, the bell) for every recipient, and
 *   optionally an email to real addresses only (never *.local), capped per broadcast and
 *   queued in the background (account-email.mjs `queue`), so the request never waits on it.
 * - Sending needs the admin's password again, is limited to MAX_PER_DAY in a rolling 24 hours
 *   (shop-wide), writes one `broadcasts` history row and a BROADCAST_SEND audit row.
 * - Recipients are read and written in chunks of CHUNK users (keyset on users.rowid), inside one
 *   transaction, so a large customer list never builds one huge statement.
 * Schema: ensureBroadcasts() in ensure-admin-fr.mjs.
 */
import { randomUUID } from "node:crypto";
import { isRealEmail, templates } from "./email.mjs";

export const BROADCAST_LIMITS = Object.freeze({
  maxPerDay: 5,
  windowMs: 24 * 3600000,
  emailCap: 100,
  chunk: 500,
  title: 120,
  body: 2000,
  link: 500,
  maxDays: 365,
});
export const AUDIENCES = ["all", "buyers", "unpaid"];

const DAY_MS = 86400000;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const normalize = (value) =>
  String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

/** "/products/x" (same site) or an https:// URL; anything else is rejected. "" = no link. */
export function cleanBroadcastLink(value, fail) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(400, "ลิงก์ไม่ถูกต้อง");
  const link = value.trim();
  if (!link) return null;
  if (link.length > BROADCAST_LIMITS.link) fail(400, "ลิงก์ยาวเกินไป");
  if (/\s/.test(link)) fail(400, "ลิงก์ต้องไม่มีช่องว่าง");
  if (/^\/(?!\/)/.test(link)) {
    if (/[\\\u0000-\u001f]/.test(link)) fail(400, "ลิงก์ไม่ถูกต้อง");
    return link;
  }
  let url;
  try {
    url = new URL(link);
  } catch {
    fail(400, "ลิงก์ต้องขึ้นต้นด้วย / (หน้าในร้าน) หรือ https://");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
    fail(400, "ลิงก์ต้องขึ้นต้นด้วย / (หน้าในร้าน) หรือ https://");
  return url.href;
}

export function createBroadcastApis({
  one,
  all,
  run,
  tx,
  fail,
  clock = () => Date.now(),
  requireAdmin,
  confirmPassword,
  emailQueue,
  emailEnabled = false,
  shopName = () => "ASIA EXTRA",
  publicBaseUrl = "",
  // Admin-edited template (email-templates.mjs); defaults to the built-in one.
  renderEmail = (args) => templates.broadcast(args),
}) {
  const L = BROADCAST_LIMITS;

  /** Validated audience from a request body or query: { type, productId?, days? }. */
  function audienceFrom(input = {}) {
    const type = input.audience ?? "all";
    if (!AUDIENCES.includes(type)) fail(400, "กลุ่มผู้รับไม่ถูกต้อง");
    if (type !== "buyers") return { type };
    const productId = typeof input.productId === "string" ? input.productId.trim() : "";
    if (!productId || productId.length > 80) fail(400, "กรุณาเลือกสินค้า");
    const product = one("SELECT id,name FROM products WHERE id=?", productId);
    if (!product) fail(400, "ไม่พบสินค้าที่เลือก");
    const raw = input.days;
    const days = typeof raw === "string" && /^\s*\d{1,4}\s*$/.test(raw) ? Number(raw) : raw;
    if (!Number.isSafeInteger(days) || days < 1 || days > L.maxDays)
      fail(400, `จำนวนวันต้องอยู่ระหว่าง 1–${L.maxDays} วัน`);
    return { type, productId: product.id, productName: product.name, days };
  }
  /** WHERE clause on `users u` for one audience. */
  function audienceSql(audience, now = clock()) {
    const base = "u.role='CUSTOMER' AND COALESCE(u.status,'ACTIVE')='ACTIVE'";
    if (audience.type === "buyers") {
      const since = sqlTime(now - audience.days * DAY_MS);
      return {
        where:
          base +
          ` AND (EXISTS (SELECT 1 FROM orders o JOIN variants v ON v.id=o.variant_id
                 WHERE o.user_id=u.id AND v.product_id=? AND o.status='DELIVERED' AND o.created_at>=?)
             OR EXISTS (SELECT 1 FROM reservations r JOIN variants v ON v.id=r.variant_id
                 WHERE r.user_id=u.id AND v.product_id=? AND r.status IN ('PREORDER','DELIVERED') AND r.created_at>=?))`,
        params: [audience.productId, since, audience.productId, since],
      };
    }
    if (audience.type === "unpaid")
      return {
        where:
          base +
          ` AND (EXISTS (SELECT 1 FROM orders o WHERE o.user_id=u.id AND o.status='PENDING_PAYMENT')
             OR EXISTS (SELECT 1 FROM reservations r WHERE r.user_id=u.id AND r.status='PENDING_PAYMENT'))`,
        params: [],
      };
    return { where: base, params: [] };
  }
  const audienceLabel = (a) =>
    a.type === "buyers"
      ? `ลูกค้าที่ซื้อ ${a.productName} ใน ${a.days} วันที่ผ่านมา`
      : a.type === "unpaid"
        ? "ลูกค้าที่มีออเดอร์ค้างชำระ"
        : "ลูกค้าทั้งหมด";

  /** Every recipient in chunks: fn(rows) gets up to L.chunk users { rid, id, email }. */
  function eachChunk(audience, fn, now = clock()) {
    const { where, params } = audienceSql(audience, now);
    let last = -1;
    for (;;) {
      const rows = all(
        `SELECT u.rowid AS rid, u.id, u.email FROM users u WHERE ${where} AND u.rowid>? ORDER BY u.rowid LIMIT ${L.chunk}`,
        ...params,
        last,
      );
      if (!rows.length) return;
      fn(rows);
      last = rows[rows.length - 1].rid;
      if (rows.length < L.chunk) return;
    }
  }
  function counts(audience) {
    const { where, params } = audienceSql(audience);
    const count = one(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`, ...params).n;
    let emails = 0;
    if (emailEnabled) eachChunk(audience, (rows) => (emails += rows.filter((r) => isRealEmail(r.email)).length));
    return { count, emails };
  }
  function usage(now = clock()) {
    const rows = all(
      "SELECT created_ms FROM broadcasts WHERE created_ms>? ORDER BY created_ms ASC",
      now - L.windowMs,
    );
    return {
      max: L.maxPerDay,
      used: rows.length,
      remaining: Math.max(0, L.maxPerDay - rows.length),
      windowHours: L.windowMs / 3600000,
      // When the oldest send in the window drops out (only meaningful when nothing is left).
      nextAt: rows.length >= L.maxPerDay ? new Date(rows[0].created_ms + L.windowMs).toISOString() : null,
    };
  }
  function cleanContent(input) {
    if (typeof input.title !== "string") fail(400, "กรุณากรอกหัวข้อประกาศ");
    const title = normalize(input.title).replace(/\s+/g, " ").trim();
    if (!title) fail(400, "กรุณากรอกหัวข้อประกาศ");
    if (title.length > L.title) fail(400, `หัวข้อประกาศยาวได้ไม่เกิน ${L.title} ตัวอักษร`);
    if (typeof input.body !== "string") fail(400, "กรุณากรอกข้อความประกาศ");
    const body = normalize(input.body).replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!body) fail(400, "กรุณากรอกข้อความประกาศ");
    if (body.length > L.body) fail(400, `ข้อความประกาศยาวได้ไม่เกิน ${L.body} ตัวอักษร`);
    return { title, body, link: cleanBroadcastLink(input.link, fail) };
  }
  const baseUrl = (ctx = {}) => {
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
  };
  const historyRow = (r) => ({
    id: r.id,
    createdAt: r.created_at,
    sender: r.sender ?? null,
    title: r.title,
    body: r.body,
    link: r.link,
    audience: r.audience,
    audienceLabel: r.audience_label,
    recipients: r.recipients,
    email: !!r.email_requested,
    emailsQueued: r.emails_queued ?? 0,
  });

  /** GET /api/admin/broadcasts */
  function broadcastStatus(user) {
    requireAdmin(user);
    return {
      history: all(
        `SELECT b.*, u.name AS sender FROM broadcasts b LEFT JOIN users u ON u.id=b.sender_id
         ORDER BY b.created_ms DESC, b.rowid DESC LIMIT 50`,
      ).map(historyRow),
      limit: usage(),
      email: { enabled: !!emailEnabled, cap: L.emailCap },
      products: all("SELECT id,name,active FROM products WHERE COALESCE(hidden_seed,0)=0 ORDER BY active DESC, name"),
      limits: { title: L.title, body: L.body, link: L.link, maxDays: L.maxDays },
    };
  }
  /** GET /api/admin/broadcasts/preview?audience=&productId=&days= — the recipient count. */
  function broadcastPreview(user, query = {}) {
    requireAdmin(user);
    const audience = audienceFrom(query);
    const { count, emails } = counts(audience);
    return {
      audience: audience.type,
      label: audienceLabel(audience),
      count,
      emailEnabled: !!emailEnabled,
      emailRecipients: emails,
      emailCap: L.emailCap,
    };
  }
  /** POST /api/admin/broadcasts — { title, body, link?, audience, productId?, days?, email?, currentPassword }. */
  function sendBroadcast(user, input = {}, ctx = {}) {
    requireAdmin(user);
    const content = cleanContent(input);
    const audience = audienceFrom(input);
    if (input.email !== undefined && typeof input.email !== "boolean") fail(400, "ช่องทางอีเมลไม่ถูกต้อง");
    const wantsEmail = input.email === true;
    if (wantsEmail && !emailEnabled) fail(400, "ระบบอีเมลยังไม่เปิดใช้งาน ส่งได้เฉพาะแจ้งเตือนในเว็บ");
    const now = clock();
    const limit = usage(now);
    if (limit.remaining <= 0)
      fail(429, `ส่งประกาศได้สูงสุด ${L.maxPerDay} ครั้งใน 24 ชั่วโมง กรุณาลองใหม่ภายหลัง`);
    confirmPassword(user, input.currentPassword);
    const id = randomUUID();
    const label = audienceLabel(audience);
    const emailTargets = [];
    let realEmails = 0;
    const recipients = tx(() => {
      let n = 0;
      eachChunk(
        audience,
        (rows) => {
          for (const row of rows) {
            run(
              "INSERT INTO notifications(id,user_id,kind,title,body,link,created_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)",
              randomUUID(),
              row.id,
              "broadcast",
              content.title,
              content.body,
              content.link,
            );
            if (wantsEmail && isRealEmail(row.email)) {
              realEmails += 1;
              if (emailTargets.length < L.emailCap) emailTargets.push(row);
            }
          }
          n += rows.length;
        },
        now,
      );
      if (!n) fail(400, "ไม่มีลูกค้าในกลุ่มนี้ ระบบยังไม่ได้ส่งประกาศ");
      run(
        `INSERT INTO broadcasts(id,created_at,created_ms,sender_id,title,body,link,audience,audience_label,recipients,email_requested,emails_queued)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`,
        id,
        sqlTime(now),
        now,
        user.id,
        content.title,
        content.body,
        content.link,
        JSON.stringify({ type: audience.type, productId: audience.productId ?? null, days: audience.days ?? null }),
        label,
        n,
        wantsEmail ? 1 : 0,
      );
      return n;
    });
    // Emails go out after the notifications are committed; each send runs in the background.
    let emailsQueued = 0;
    if (wantsEmail && emailTargets.length) {
      const base = baseUrl(ctx);
      const link = content.link ? (content.link.startsWith("/") ? (base ? base + content.link : "") : content.link) : "";
      const message = renderEmail({
        shopName: shopName(),
        title: content.title,
        body: content.body,
        link,
      });
      for (const row of emailTargets)
        if (emailQueue({ kind: "broadcast", to: row.email, ref: "broadcast:" + id + ":" + row.id, message }))
          emailsQueued += 1;
      run("UPDATE broadcasts SET emails_queued=? WHERE id=?", emailsQueued, id);
    }
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      "BROADCAST_SEND",
      id,
      JSON.stringify({ count: recipients, audience: label, email: wantsEmail ? emailsQueued : null }),
    );
    const row = one(
      "SELECT b.*, u.name AS sender FROM broadcasts b LEFT JOIN users u ON u.id=b.sender_id WHERE b.id=?",
      id,
    );
    return {
      broadcast: historyRow(row),
      count: recipients,
      emailsQueued,
      // Real addresses past the cap (only counted when email was asked for).
      emailsSkipped: wantsEmail ? Math.max(0, realEmails - emailsQueued) : 0,
      limit: usage(),
    };
  }

  return { broadcastStatus, broadcastPreview, sendBroadcast };
}
