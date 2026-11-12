/**
 * Review replies and moderation (admin › สินค้า › รีวิว).
 *
 * - Reply: ADMIN and STAFF. One public reply per review ("ตอบกลับจากร้าน"), editable.
 *   The first reply sends the customer an in-site notice linking to the review; edits do not.
 *   Audit REVIEW_REPLY (detail: edited, length).
 * - Hide: ADMIN only, and only with a reason from REVIEW_HIDE_REASONS ("อื่นๆ" needs a note).
 *   A low rating is never a reason. Hidden reviews leave the public list and the rating
 *   averages, stay in the admin list, can be shown again, and every change is audited
 *   (REVIEW_HIDE / REVIEW_UNHIDE with the reason and note).
 * Schema: ensureReviewModeration() in ensure-admin-fr.mjs.
 */

export const REVIEW_HIDE_REASONS = {
  SPAM: "สแปม/โฆษณา",
  ABUSE: "คำหยาบ/ข้อมูลส่วนตัว",
  OFF_TOPIC: "ไม่เกี่ยวกับสินค้า",
  OTHER: "อื่นๆ",
};
export const REVIEW_REPLY_MAX = 1000;
export const REVIEW_REPLY_TITLE = "ร้านตอบกลับรีวิวของคุณ";

/** Public name: first two letters + *** + last letter (same as before). */
export const maskReviewer = (name) => {
  const text = String(name ?? "");
  return text.slice(0, 2) + "***" + text.slice(-1);
};

export function createReviewModeration({
  one,
  all,
  run,
  tx,
  fail,
  clean,
  requireStaff,
  requireAdmin,
  notify,
  clock = () => Date.now(),
}) {
  const now = () => new Date(clock()).toISOString().slice(0, 19).replace("T", " ");
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );
  const reviewLink = (id) => "/reviews?review=" + encodeURIComponent(id);
  const select = `SELECT r.id, r.rating, r.comment, r.created_at, r.order_id, r.user_id,
           r.reply_text, r.reply_at, r.reply_updated_at, r.hidden_at, r.hidden_reason, r.hidden_note,
           u.name AS customer, p.id AS product_id, p.name AS product, v.label,
           rb.name AS reply_by_name, hb.name AS hidden_by_name
    FROM reviews r
    JOIN users u ON u.id=r.user_id
    JOIN orders o ON o.id=r.order_id
    JOIN variants v ON v.id=o.variant_id
    JOIN products p ON p.id=v.product_id
    LEFT JOIN users rb ON rb.id=r.reply_by
    LEFT JOIN users hb ON hb.id=r.hidden_by`;
  const shape = (row) => ({
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    created_at: row.created_at,
    orderId: row.order_id,
    customerId: row.user_id,
    customer: row.customer,
    productId: row.product_id,
    product: row.product,
    label: row.label,
    reply: row.reply_text
      ? {
          text: row.reply_text,
          at: row.reply_at,
          updatedAt: row.reply_updated_at,
          by: row.reply_by_name ?? null,
        }
      : null,
    hidden: row.hidden_at
      ? {
          at: row.hidden_at,
          reason: row.hidden_reason,
          reasonText: REVIEW_HIDE_REASONS[row.hidden_reason] ?? row.hidden_reason,
          note: row.hidden_note ?? "",
          by: row.hidden_by_name ?? null,
        }
      : null,
  });
  const reviewRow = (idRaw) => {
    const id = clean(idRaw, 1, 80, "รีวิว");
    const row = one(select + " WHERE r.id=?", id);
    if (!row) fail(404, "ไม่พบรีวิว");
    return row;
  };
  const optional = (value) => (value == null || String(value).trim() === "" ? null : String(value).trim());

  /**
   * GET /api/admin/reviews — newest first. Filters: rating 1–5, product (id),
   * reply yes|no, hidden yes|no (default: all). Cursor = "<created_at>|<rowid>".
   */
  function adminReviews(user, query = {}) {
    requireStaff(user);
    const where = [];
    const params = [];
    const rating = optional(query.rating);
    if (rating) {
      if (!/^[1-5]$/.test(rating)) fail(400, "คะแนนไม่ถูกต้อง");
      where.push("r.rating=?");
      params.push(Number(rating));
    }
    const product = optional(query.product);
    if (product) {
      where.push("p.id=?");
      params.push(clean(product, 1, 80, "สินค้า"));
    }
    const reply = optional(query.reply);
    if (reply) {
      if (!["yes", "no"].includes(reply)) fail(400, "ตัวกรองการตอบกลับไม่ถูกต้อง");
      where.push(reply === "yes" ? "r.reply_text IS NOT NULL" : "r.reply_text IS NULL");
    }
    const hidden = optional(query.hidden);
    if (hidden) {
      if (!["yes", "no"].includes(hidden)) fail(400, "ตัวกรองการซ่อนไม่ถูกต้อง");
      where.push(hidden === "yes" ? "r.hidden_at IS NOT NULL" : "r.hidden_at IS NULL");
    }
    const limitRaw = optional(query.limit);
    const limit = limitRaw == null ? 30 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, "จำนวนรายการไม่ถูกต้อง");
    const cursor = optional(query.cursor);
    if (cursor) {
      const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|(\d{1,15})$/.exec(cursor);
      if (!match) fail(400, "cursor ไม่ถูกต้อง");
      where.push("(r.created_at < ? OR (r.created_at = ? AND r.rowid < ?))");
      params.push(match[1], match[1], Number(match[2]));
    }
    const rows = all(
      select.replace("SELECT r.id,", "SELECT r.rowid AS row_no, r.id,") +
        (where.length ? " WHERE " + where.join(" AND ") : "") +
        " ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?",
      ...params,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const summary = one(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN hidden_at IS NOT NULL THEN 1 ELSE 0 END) AS hidden,
              SUM(CASE WHEN hidden_at IS NULL AND reply_text IS NULL THEN 1 ELSE 0 END) AS unanswered,
              AVG(CASE WHEN hidden_at IS NULL THEN rating END) AS average
       FROM reviews`,
    );
    return {
      reviews: page.map(shape),
      nextCursor: rows.length > limit && last ? last.created_at + "|" + last.row_no : null,
      summary: {
        total: summary.total ?? 0,
        hidden: summary.hidden ?? 0,
        unanswered: summary.unanswered ?? 0,
        average: summary.average == null ? null : Math.round(summary.average * 10) / 10,
      },
      products: all(
        `SELECT DISTINCT p.id, p.name FROM reviews r JOIN orders o ON o.id=r.order_id
         JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id ORDER BY p.name`,
      ),
      reasons: Object.entries(REVIEW_HIDE_REASONS).map(([id, label]) => ({ id, label })),
      canHide: user.role === "ADMIN",
    };
  }

  /** POST /api/admin/reviews/:id/reply {text} — create or edit the shop's public reply. */
  function replyToReview(user, idRaw, input = {}) {
    requireStaff(user);
    const text = clean(input.text, 1, REVIEW_REPLY_MAX, "คำตอบกลับ (1–" + REVIEW_REPLY_MAX + " ตัวอักษร)");
    return tx(() => {
      const row = reviewRow(idRaw);
      const edited = !!row.reply_text;
      if (edited && row.reply_text === text) return shape(row);
      const at = now();
      run(
        `UPDATE reviews SET reply_text=?, reply_by=?, reply_at=COALESCE(reply_at, ?),
           reply_updated_at=CASE WHEN reply_text IS NULL THEN NULL ELSE ? END
         WHERE id=?`,
        text,
        user.id,
        at,
        at,
        row.id,
      );
      auditDetail(user, "REVIEW_REPLY", row.id, { edited, length: text.length });
      // First reply only; a hidden review is not shown, so its author is not sent there.
      if (!edited && !row.hidden_at)
        notify(
          row.user_id,
          "review_reply",
          REVIEW_REPLY_TITLE,
          text.length > 120 ? text.slice(0, 119) + "…" : text,
          reviewLink(row.id),
        );
      return shape(reviewRow(row.id));
    });
  }

  /** POST /api/admin/reviews/:id/hide {reason, note} — ADMIN only, reason required. */
  function hideReview(user, idRaw, input = {}) {
    requireAdmin(user);
    const reason = String(input.reason ?? "");
    if (!Object.hasOwn(REVIEW_HIDE_REASONS, reason))
      fail(400, "เลือกเหตุผลในการซ่อนรีวิว (สแปม/โฆษณา, คำหยาบ/ข้อมูลส่วนตัว, ไม่เกี่ยวกับสินค้า หรืออื่นๆ)");
    const note =
      reason === "OTHER"
        ? clean(input.note, 3, 300, "รายละเอียดเหตุผล (3–300 ตัวอักษร)")
        : optional(input.note)
          ? clean(input.note, 1, 300, "หมายเหตุ")
          : null;
    return tx(() => {
      const row = reviewRow(idRaw);
      if (row.hidden_at) fail(409, "รีวิวนี้ถูกซ่อนอยู่แล้ว");
      run(
        "UPDATE reviews SET hidden_at=?, hidden_by=?, hidden_reason=?, hidden_note=? WHERE id=? AND hidden_at IS NULL",
        now(),
        user.id,
        reason,
        note,
        row.id,
      );
      auditDetail(user, "REVIEW_HIDE", row.id, { reason, note, rating: row.rating });
      return shape(reviewRow(row.id));
    });
  }

  /** POST /api/admin/reviews/:id/unhide — ADMIN only. */
  function unhideReview(user, idRaw) {
    requireAdmin(user);
    return tx(() => {
      const row = reviewRow(idRaw);
      if (!row.hidden_at) fail(409, "รีวิวนี้แสดงอยู่แล้ว");
      run(
        "UPDATE reviews SET hidden_at=NULL, hidden_by=NULL, hidden_reason=NULL, hidden_note=NULL WHERE id=?",
        row.id,
      );
      auditDetail(user, "REVIEW_UNHIDE", row.id, {
        previousReason: row.hidden_reason,
        previousNote: row.hidden_note ?? null,
      });
      return shape(reviewRow(row.id));
    });
  }

  return { adminReviews, replyToReview, hideReview, unhideReview };
}
