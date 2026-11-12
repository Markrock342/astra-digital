/** FR-R reports: paid sales grouped by product/variant and by Bangkok day (ADMIN only). */
export function createReportApis({ requireAdmin, all, one, fail, bangkokDayRange }) {
  function salesReport(user, query = {}) {
    requireAdmin(user);
    const hasFrom = query.from != null && String(query.from).trim() !== "";
    const hasTo = query.to != null && String(query.to).trim() !== "";
    if (hasFrom !== hasTo) fail(400, "ต้องส่ง from และ to คู่กัน");
    const range = hasFrom ? bangkokDayRange(String(query.from).trim(), String(query.to).trim()) : null;
    const when = "COALESCE(pay.finalized_at, pay.created_at)";
    const filter = range ? ` AND ${when} >= ? AND ${when} <= ?` : "";
    const params = range ? [range.fromUtc, range.toUtc] : [];
    // One row per successful payment, tied to the order or preorder it paid for.
    const paid = `
      SELECT pay.amount, ${when} AS paid_at, x.quantity, x.preorder, v.id AS variant_id, v.label AS variant, p.id AS product_id, p.name AS product, x.user_id
      FROM payments pay
      JOIN (
        SELECT id, variant_id, quantity, user_id, 0 AS preorder FROM orders
        UNION ALL
        SELECT id, variant_id, quantity, user_id, 1 AS preorder FROM reservations
      ) x ON x.id = COALESCE(pay.order_id, pay.reservation_id)
      JOIN variants v ON v.id = x.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE pay.status = 'SUCCEEDED'${filter}`;
    const byProduct = all(
      `SELECT product_id, product, variant_id, variant, MAX(preorder) AS preorder,
              COUNT(*) AS orders, SUM(quantity) AS units, SUM(amount) AS revenue
       FROM (${paid}) GROUP BY variant_id ORDER BY revenue DESC, units DESC`,
      ...params,
    ).map((r) => ({ ...r, preorder: !!r.preorder }));
    const byDay = all(
      `SELECT substr(datetime(paid_at, '+7 hours'), 1, 10) AS day, COUNT(*) AS orders, SUM(quantity) AS units, SUM(amount) AS revenue,
              COUNT(DISTINCT user_id) AS buyers
       FROM (${paid}) GROUP BY day ORDER BY day ASC`,
      ...params,
    );
    const totals = one(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(quantity),0) AS units, COALESCE(SUM(amount),0) AS revenue,
              COUNT(DISTINCT user_id) AS buyers
       FROM (${paid})`,
      ...params,
    );
    const refunds = one(
      `SELECT COALESCE(SUM(ABS(amount)),0) AS n FROM ledger WHERE kind='REFUND'${range ? " AND created_at >= ? AND created_at <= ?" : ""}`,
      ...params,
    ).n;
    return {
      from: range?.from ?? null,
      to: range?.to ?? null,
      timezone: "Asia/Bangkok",
      totals: { ...totals, refunds, net: totals.revenue - refunds },
      byProduct,
      byDay,
    };
  }
  return { salesReport };
}
