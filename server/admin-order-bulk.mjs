/**
 * Bulk actions on the admin orders list ("เลือกหลายออเดอร์").
 *
 * One request, many orders, a result per order. Each order runs on its own (its own
 * transaction for cancel), so one failure never undoes the others; nothing is
 * all-or-nothing. The single-order rules are reused, not copied:
 * - cancel  → cancelUnpaidOrder (admin-customers.mjs): unpaid only, gives the coupon use
 *             back, one CANCEL_ORDER audit row per order. ADMIN only.
 * - resend  → resendOrderCredentials (admin-order-resend.mjs): delivered only, its own
 *             hourly limit and RESEND_CREDENTIALS audit row per order. ADMIN and STAFF.
 * - export  → the selected rows for a CSV (the client escapes formula cells); one
 *             ORDER_BULK_EXPORT audit row. ADMIN and STAFF.
 *
 * Targets are either `ids` (picked rows) or `filter` (the list's own filters, "select
 * everything that matches"). Both stop at BULK_ORDER_CAP orders; a filter that matches
 * more reports `capped: true` and only the newest BULK_ORDER_CAP are used.
 * `dryRun: true` changes nothing and returns what would happen (for the confirm dialog).
 */
export const BULK_ORDER_CAP = 100;
export const BULK_ORDER_ACTIONS = ["cancel", "resend", "export"];

const FILTER_KEYS = ["status", "group", "from", "to", "product", "customer", "type", "q"];

export function createAdminOrderBulkApis({
  requireStaff,
  requireAdmin,
  one,
  all,
  run,
  tx,
  fail,
  clean,
  ApiError,
  adminOrders,
  cancelUnpaidOrder,
  resendOrderCredentials,
  resendLimit,
}) {
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );
  const shortId = (id) => "#" + String(id).slice(0, 8).toUpperCase();

  function parseAction(user, input) {
    const action = input.action;
    if (!BULK_ORDER_ACTIONS.includes(action)) fail(400, "คำสั่งไม่ถูกต้อง");
    if (action === "cancel") requireAdmin(user);
    else requireStaff(user);
    return action;
  }

  /** The order ids this request is about (deduped, newest first for a filter). */
  function targets(user, input) {
    if (input.filter != null) {
      if (typeof input.filter !== "object" || Array.isArray(input.filter)) fail(400, "ตัวกรองไม่ถูกต้อง");
      const filter = {};
      for (const key of FILTER_KEYS) {
        const value = input.filter[key];
        if (value == null || value === "") continue;
        if (typeof value !== "string") fail(400, "ตัวกรองไม่ถูกต้อง");
        filter[key] = value;
      }
      // Same rules and SQL as the list the admin is looking at.
      const page = adminOrders(user, { ...filter, limit: String(BULK_ORDER_CAP) });
      return { ids: page.orders.map((o) => o.id), capped: !!page.nextCursor };
    }
    const ids = input.ids;
    if (!Array.isArray(ids) || !ids.length) fail(400, "กรุณาเลือกออเดอร์");
    if (ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 80))
      fail(400, "เลขออเดอร์ไม่ถูกต้อง");
    const unique = [...new Set(ids.map((id) => id.trim()))];
    if (unique.length > BULK_ORDER_CAP)
      fail(400, "เลือกได้ครั้งละไม่เกิน " + BULK_ORDER_CAP + " ออเดอร์");
    return { ids: unique, capped: false };
  }

  const findOrder = (id) => {
    const order = one("SELECT id,status,user_id FROM orders WHERE id=?", id);
    if (order) return { ...order, table: "orders" };
    const reservation = one("SELECT id,status,user_id FROM reservations WHERE id=?", id);
    return reservation ? { ...reservation, table: "reservations" } : null;
  };

  const recentResends = (id) =>
    one(
      "SELECT COUNT(*) AS n FROM audit WHERE action='RESEND_CREDENTIALS' AND entity_id=? AND created_at >= datetime('now','-1 hour')",
      id,
    ).n;

  /** What would happen to one order (no writes). */
  function check(action, id) {
    const order = findOrder(id);
    if (!order) return { id, shortId: shortId(id), result: "failed", message: "ไม่พบออเดอร์" };
    const base = { id, shortId: shortId(id), status: order.status };
    if (action === "cancel" && order.status !== "PENDING_PAYMENT")
      return { ...base, result: "skipped", message: "ยกเลิกได้เฉพาะออเดอร์ที่ยังไม่ชำระ" };
    if (action === "resend") {
      if (order.status !== "DELIVERED")
        return { ...base, result: "skipped", message: "ยังไม่ได้ส่งของ จึงไม่มีรหัสให้ส่งซ้ำ" };
      if (recentResends(id) >= resendLimit)
        return { ...base, result: "skipped", message: "ส่งซ้ำครบ " + resendLimit + " ครั้งในชั่วโมงนี้แล้ว" };
    }
    return { ...base, result: "ok", message: null };
  }

  function summarize(action, results, capped, dryRun) {
    const count = (r) => results.filter((x) => x.result === r).length;
    return {
      action,
      dryRun: !!dryRun,
      cap: BULK_ORDER_CAP,
      capped,
      total: results.length,
      ok: count("ok"),
      skipped: count("skipped"),
      failed: count("failed"),
      results,
    };
  }

  function exportRows(ids) {
    if (!ids.length) return [];
    const marks = ids.map(() => "?").join(",");
    const rows = all(
      `SELECT * FROM (
         SELECT o.id,o.status,o.total,o.quantity,o.created_at,u.name AS customer,u.email AS customer_email,
                p.name AS product,v.label AS variant_label,0 AS preorder,CAST(NULL AS INTEGER) AS queue_number
         FROM orders o JOIN users u ON u.id=o.user_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id
         WHERE o.id IN (${marks})
         UNION ALL
         SELECT r.id,r.status,r.total,r.quantity,r.created_at,u.name,u.email,p.name,v.label,1,r.queue_number
         FROM reservations r JOIN users u ON u.id=r.user_id JOIN variants v ON v.id=r.variant_id JOIN products p ON p.id=v.product_id
         WHERE r.id IN (${marks})
       ) ORDER BY created_at DESC, id DESC`,
      ...ids,
      ...ids,
    );
    return rows.map((r) => ({ ...r, preorder: !!r.preorder }));
  }

  /**
   * Read-only: dry run for cancel / resend (the confirm dialog counts), or the CSV rows
   * for export. Never changes an order.
   */
  function adminBulkOrderCheck(user, input = {}) {
    const action = parseAction(user, input);
    const { ids, capped } = targets(user, input);
    if (action === "export") {
      const rows = exportRows(ids);
      auditDetail(user, "ORDER_BULK_EXPORT", null, { total: rows.length });
      const found = new Set(rows.map((r) => r.id));
      const results = ids.map((id) =>
        found.has(id)
          ? { id, shortId: shortId(id), result: "ok", message: null }
          : { id, shortId: shortId(id), result: "failed", message: "ไม่พบออเดอร์" },
      );
      return { ...summarize(action, results, capped, false), rows };
    }
    return summarize(action, ids.map((id) => check(action, id)), capped, true);
  }

  /** Runs cancel / resend for every target and reports each one. */
  function adminBulkOrderAction(user, input = {}) {
    const action = parseAction(user, input);
    if (action === "export") return adminBulkOrderCheck(user, input);
    const reason =
      action === "cancel" ? clean(input.reason ?? "ยกเลิกหลายรายการจากหน้าออเดอร์", 3, 300, "เหตุผล") : null;
    const { ids, capped } = targets(user, input);
    const results = [];
    for (const id of ids) {
      const planned = check(action, id);
      if (planned.result !== "ok") {
        results.push(planned);
        continue;
      }
      try {
        if (action === "cancel") {
          const done = tx(() =>
            cancelUnpaidOrder({
              table: findOrder(id).table,
              orderId: id,
              actor: user,
              action: "CANCEL_ORDER",
              detail: { reason, bulk: true },
            }),
          );
          // Paid / expired between the check and the write: the conditional UPDATE skipped it.
          results.push(
            done
              ? { ...planned, status: "CANCELLED", message: null }
              : { ...planned, result: "skipped", message: "สถานะเปลี่ยนไปแล้ว ไม่ได้ยกเลิก" },
          );
        } else {
          resendOrderCredentials(user, id);
          results.push(planned);
        }
      } catch (error) {
        // Reported per order; the orders already done stay done.
        if (!(error instanceof ApiError)) console.error("Bulk order action failed:", error?.message);
        results.push({
          ...planned,
          result: "failed",
          message: error instanceof ApiError ? error.message : "ระบบทำรายการนี้ไม่สำเร็จ ลองใหม่อีกครั้ง",
        });
      }
    }
    return summarize(action, results, capped, false);
  }

  return { adminBulkOrderCheck, adminBulkOrderAction };
}
