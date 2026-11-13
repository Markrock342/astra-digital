/**
 * ข้อความสำเร็จรูป (canned replies) for the team chat inbox.
 *
 * - ADMIN manages the list (title + body, order). ADMIN and STAFF read it and insert
 *   one into the chat composer; inserting never sends (the composer does that).
 * - Placeholders are filled from the open thread on the server, so the same rule is
 *   used everywhere: {ชื่อลูกค้า} = customer's first name (or display name),
 *   {เลขออเดอร์} = the order reported in the thread, else the customer's latest order.
 *   A value that is not known stays as the literal placeholder and is listed in
 *   `missing`, so the person sees it and edits it before sending.
 * - Schema: ensureCannedReplies() in ensure-admin-fr.mjs (table canned_replies).
 */

export const CANNED_REPLY_LIMIT = 50;
export const CANNED_REPLY_TITLE_MAX = 60;
export const CANNED_REPLY_BODY_MAX = 1000;
export const CANNED_PLACEHOLDERS = ["{ชื่อลูกค้า}", "{เลขออเดอร์}"];

/** Seeded once, when the table is first created (deleted defaults never come back). */
export const DEFAULT_CANNED_REPLIES = [
  {
    title: "วิธีเข้าใช้งานบัญชี",
    body:
      "เรียน คุณ{ชื่อลูกค้า}\n" +
      "ข้อมูลบัญชี (ID และรหัสผ่าน) ของคำสั่งซื้อ {เลขออเดอร์} อยู่ในหน้า “คำสั่งซื้อของฉัน” บนเว็บไซต์ " +
      "กรุณาเข้าสู่ระบบเว็บไซต์ เปิดคำสั่งซื้อดังกล่าว แล้วนำข้อมูลไปเข้าสู่ระบบในแอปของบริการนั้น " +
      "หากยังเข้าใช้งานไม่ได้ กรุณาส่งภาพหน้าจอให้ร้านทางแชทนี้",
  },
  {
    title: "การรับประกัน",
    body:
      "เรียน คุณ{ชื่อลูกค้า}\n" +
      "คำสั่งซื้อ {เลขออเดอร์} อยู่ในระยะรับประกันตามที่แสดงในหน้าคำสั่งซื้อ " +
      "หากบัญชีใช้งานไม่ได้ในระยะรับประกัน ร้านจะตรวจสอบและเปลี่ยนบัญชีใหม่ให้ " +
      "กรุณาแจ้งอาการพร้อมภาพหน้าจอทางแชทนี้",
  },
  {
    title: "รอการชำระเงิน",
    body:
      "เรียน คุณ{ชื่อลูกค้า}\n" +
      "คำสั่งซื้อ {เลขออเดอร์} ยังอยู่ในสถานะรอชำระเงิน " +
      "กรุณาชำระเงินจากหน้าคำสั่งซื้อภายในเวลาที่กำหนด เมื่อชำระสำเร็จ ระบบจะส่งข้อมูลบัญชีให้ทันที",
  },
  {
    title: "ส่งของแล้ว ตรวจหน้าคำสั่งซื้อ",
    body:
      "เรียน คุณ{ชื่อลูกค้า}\n" +
      "ร้านส่งคำสั่งซื้อ {เลขออเดอร์} เรียบร้อยแล้ว " +
      "กรุณาตรวจสอบข้อมูลบัญชีได้ที่หน้า “คำสั่งซื้อของฉัน” บนเว็บไซต์ ขอบคุณที่ใช้บริการ",
  },
  {
    title: "ขอบคุณที่ติดต่อ",
    body:
      "เรียน คุณ{ชื่อลูกค้า}\n" +
      "ขอบคุณที่ติดต่อร้าน ทีมงานได้รับข้อความแล้ว และจะตอบกลับโดยเร็วที่สุด",
  },
];

/** "#ABCD1234": the order number customers see on their order page. */
export const orderNumber = (id) => "#" + String(id).slice(0, 8).toUpperCase();

/**
 * Replace the known placeholders in `body`. Unknown ones (or a null value) stay as
 * typed and are reported in `missing`. Pure, so it is unit-tested directly.
 */
export function fillPlaceholders(body, context = {}) {
  const values = {
    "{ชื่อลูกค้า}": context.customerName ?? null,
    "{เลขออเดอร์}": context.orderNumber ?? null,
  };
  const missing = new Set();
  const text = String(body ?? "").replace(/\{[^{}\n]{1,30}\}/g, (token) => {
    if (!(token in values)) return token;
    const value = values[token];
    if (value == null || String(value).trim() === "") {
      missing.add(token);
      return token;
    }
    return String(value).trim();
  });
  return { text, missing: [...missing] };
}

export function createCannedReplyApis({ one, all, run, tx, fail, clean, requireStaff, requireAdmin, randomUUID }) {
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );
  const list = () =>
    all("SELECT id,title,body,sort_order,updated_at FROM canned_replies ORDER BY sort_order ASC, created_at ASC, id ASC");
  const load = (id) => {
    const row = one("SELECT * FROM canned_replies WHERE id=?", clean(id, 1, 80, "ข้อความสำเร็จรูป"));
    if (!row) fail(404, "ไม่พบข้อความสำเร็จรูป");
    return row;
  };
  const fields = (input = {}) => {
    const title = clean(input.title, 1, CANNED_REPLY_TITLE_MAX, "ชื่อข้อความ");
    if (typeof input.body !== "string") fail(400, "ข้อความไม่ถูกต้อง");
    // Keep line breaks; trim only the ends.
    const body = input.body.replace(/\r\n/g, "\n").trim();
    if (!body) fail(400, "กรุณาใส่ข้อความ");
    if (body.length > CANNED_REPLY_BODY_MAX) fail(400, "ข้อความยาวเกิน " + CANNED_REPLY_BODY_MAX + " ตัวอักษร");
    return { title, body };
  };

  /** Placeholder values for one chat thread (staff view). */
  function threadContext(threadId) {
    const thread = one(
      `SELECT t.id,t.order_id,u.id AS user_id,u.name,u.first_name
       FROM chat_threads t JOIN users u ON u.id=t.user_id WHERE t.id=?`,
      clean(threadId, 1, 80, "แชท"),
    );
    if (!thread) fail(404, "ไม่พบแชท");
    const latest = thread.order_id
      ? null
      : one(
          `SELECT id FROM (
             SELECT id,created_at FROM orders WHERE user_id=?
             UNION ALL
             SELECT id,created_at FROM reservations WHERE user_id=?
           ) ORDER BY created_at DESC, id DESC LIMIT 1`,
          thread.user_id,
          thread.user_id,
        );
    const orderId = thread.order_id ?? latest?.id ?? null;
    const first = String(thread.first_name ?? "").trim();
    return {
      customerName: first || String(thread.name ?? "").trim() || null,
      orderId,
      orderNumber: orderId ? orderNumber(orderId) : null,
    };
  }

  /**
   * GET list for the composer picker (ADMIN + STAFF). With `threadId`, every reply also
   * carries `text` (placeholders filled) and `missing` (placeholders left as typed).
   */
  function cannedReplies(user, query = {}) {
    requireStaff(user);
    const rows = list();
    const threadId = query.threadId != null && String(query.threadId).trim() !== "" ? query.threadId : null;
    if (!threadId) return { replies: rows, limit: CANNED_REPLY_LIMIT };
    const context = threadContext(threadId);
    return {
      replies: rows.map((r) => ({ ...r, ...fillPlaceholders(r.body, context) })),
      context,
      limit: CANNED_REPLY_LIMIT,
    };
  }

  function adminCreateCannedReply(user, input = {}) {
    requireAdmin(user);
    const { title, body } = fields(input);
    return tx(() => {
      const count = one("SELECT COUNT(*) AS n FROM canned_replies").n;
      if (count >= CANNED_REPLY_LIMIT) fail(409, "มีข้อความสำเร็จรูปครบ " + CANNED_REPLY_LIMIT + " ข้อความแล้ว ลบอันที่ไม่ใช้ก่อน");
      const next = one("SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM canned_replies").n;
      const id = randomUUID();
      run(
        "INSERT INTO canned_replies(id,title,body,sort_order,created_by) VALUES(?,?,?,?,?)",
        id,
        title,
        body,
        next,
        user.id,
      );
      auditDetail(user, "CANNED_REPLY_CREATE", id, { title });
      return { reply: one("SELECT id,title,body,sort_order,updated_at FROM canned_replies WHERE id=?", id) };
    });
  }

  function adminUpdateCannedReply(user, id, input = {}) {
    requireAdmin(user);
    const { title, body } = fields(input);
    return tx(() => {
      const row = load(id);
      run(
        "UPDATE canned_replies SET title=?,body=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        title,
        body,
        row.id,
      );
      auditDetail(user, "CANNED_REPLY_UPDATE", row.id, { title });
      return { reply: one("SELECT id,title,body,sort_order,updated_at FROM canned_replies WHERE id=?", row.id) };
    });
  }

  function adminDeleteCannedReply(user, id) {
    requireAdmin(user);
    return tx(() => {
      const row = load(id);
      run("DELETE FROM canned_replies WHERE id=?", row.id);
      auditDetail(user, "CANNED_REPLY_DELETE", row.id, { title: row.title });
      return { id: row.id, deleted: true };
    });
  }

  /** `ids` = the full list in the new order (same set as stored). */
  function adminReorderCannedReplies(user, input = {}) {
    requireAdmin(user);
    const ids = input.ids;
    if (!Array.isArray(ids) || ids.length > CANNED_REPLY_LIMIT || ids.some((x) => typeof x !== "string"))
      fail(400, "ลำดับไม่ถูกต้อง");
    return tx(() => {
      const current = list().map((r) => r.id);
      const unique = new Set(ids);
      if (unique.size !== ids.length || ids.length !== current.length || current.some((x) => !unique.has(x)))
        fail(409, "รายการเปลี่ยนไปแล้ว กรุณาโหลดใหม่");
      ids.forEach((rid, i) => run("UPDATE canned_replies SET sort_order=? WHERE id=?", (i + 1) * 10, rid));
      auditDetail(user, "CANNED_REPLY_REORDER", null, { total: ids.length });
      return { replies: list() };
    });
  }

  return {
    cannedReplies,
    adminCreateCannedReply,
    adminUpdateCannedReply,
    adminDeleteCannedReply,
    adminReorderCannedReplies,
  };
}
