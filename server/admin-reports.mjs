/** FR-R reports: paid sales + profit (ADMIN only). */
import { csvLine } from "./money.mjs";

export function createReportApis({ requireAdmin, all, one, fail, bangkokDayRange, moneyScope }) {
  // S2: live mode leaves sandbox payments and their refunds out of every report number.
  const paymentScope = moneyScope ? " AND " + moneyScope.payment("pay.") : "";
  const ledgerScope = moneyScope ? " AND " + moneyScope.ledger() : "";

  function reportRange(query) {
    const hasFrom = query.from != null && String(query.from).trim() !== "";
    const hasTo = query.to != null && String(query.to).trim() !== "";
    if (hasFrom !== hasTo) fail(400, "ต้องส่ง from และ to คู่กัน");
    const range = hasFrom
      ? bangkokDayRange(String(query.from).trim(), String(query.to).trim())
      : null;
    const when = "COALESCE(pay.finalized_at, pay.created_at)";
    const filter = range ? ` AND ${when} >= ? AND ${when} <= ?` : "";
    const params = range ? [range.fromUtc, range.toUtc] : [];
    return { range, when, filter, params };
  }

  function salesReport(user, query = {}) {
    requireAdmin(user);
    const { range, when, filter, params } = reportRange(query);
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
      WHERE pay.status = 'SUCCEEDED'${paymentScope}${filter}`;
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
      `SELECT COALESCE(SUM(ABS(amount)),0) AS n FROM ledger WHERE kind='REFUND'${ledgerScope}${range ? " AND created_at >= ? AND created_at <= ?" : ""}`,
      ...params,
    ).n;
    // Coupon discounts on paid orders, as a separate figure. Revenue above is already
    // what was actually paid (the discounted total), so this is never subtracted again.
    const discount = one(
      `SELECT COALESCE(SUM(discount),0) AS n, COUNT(*) AS orders FROM (
         SELECT DISTINCT x.id, x.discount
         FROM payments pay
         JOIN (SELECT id, discount FROM orders UNION ALL SELECT id, discount FROM reservations) x
           ON x.id = COALESCE(pay.order_id, pay.reservation_id)
         WHERE pay.status = 'SUCCEEDED' AND x.discount > 0${paymentScope}${filter})`,
      ...params,
    );
    const report = {
      from: range?.from ?? null,
      to: range?.to ?? null,
      timezone: "Asia/Bangkok",
      mode: moneyScope?.mode ?? "sandbox",
      totals: {
        ...totals,
        refunds,
        net: totals.revenue - refunds,
        discounts: discount.n,
        discountedOrders: discount.orders,
      },
      byProduct,
      byDay,
    };
    if (String(query.format || "").toLowerCase() === "csv") return { ...report, csv: salesCsv(report) };
    return report;
  }

  /**
   * Profit = revenue − refunds − inventory cost of units delivered on paid orders
   * in range. Missing cost counts as 0. Live mode excludes sandbox payments.
   */
  function profitReport(user, query = {}) {
    requireAdmin(user);
    const { range, when, filter, params } = reportRange(query);
    const revenue = one(
      `SELECT COALESCE(SUM(pay.amount),0) AS n, COUNT(*) AS orders
       FROM payments pay
       WHERE pay.status = 'SUCCEEDED'${paymentScope}${filter}`,
      ...params,
    );
    const refunds = one(
      `SELECT COALESCE(SUM(ABS(amount)),0) AS n FROM ledger WHERE kind='REFUND'${ledgerScope}${range ? " AND created_at >= ? AND created_at <= ?" : ""}`,
      ...params,
    ).n;
    const cost = one(
      `SELECT COALESCE(SUM(COALESCE(i.cost,0)),0) AS n, COUNT(*) AS units
       FROM inventory i
       JOIN payments pay ON (
         (pay.order_id IS NOT NULL AND pay.order_id = i.order_id)
         OR (pay.reservation_id IS NOT NULL AND pay.reservation_id = i.reservation_id)
       )
       WHERE pay.status = 'SUCCEEDED'${paymentScope}${filter}`,
      ...params,
    );
    // Cost per sold unit; revenue per payment (not multiplied by units on the same order).
    const byProduct = all(
      `SELECT c.product_id, c.product, c.variant_id, c.variant, c.units, c.cost,
              COALESCE(r.revenue, 0) AS revenue, COALESCE(r.orders, 0) AS orders
       FROM (
         SELECT p.id AS product_id, p.name AS product, v.id AS variant_id, v.label AS variant,
                COUNT(*) AS units, COALESCE(SUM(COALESCE(i.cost,0)),0) AS cost
         FROM inventory i
         JOIN payments pay ON (
           (pay.order_id IS NOT NULL AND pay.order_id = i.order_id)
           OR (pay.reservation_id IS NOT NULL AND pay.reservation_id = i.reservation_id)
         )
         JOIN variants v ON v.id = i.variant_id
         JOIN products p ON p.id = v.product_id
         WHERE pay.status = 'SUCCEEDED'${paymentScope}${filter}
         GROUP BY v.id
       ) c
       LEFT JOIN (
         SELECT x.variant_id, COUNT(*) AS orders, COALESCE(SUM(pay.amount),0) AS revenue
         FROM payments pay
         JOIN (
           SELECT id, variant_id FROM orders
           UNION ALL
           SELECT id, variant_id FROM reservations
         ) x ON x.id = COALESCE(pay.order_id, pay.reservation_id)
         WHERE pay.status = 'SUCCEEDED'${paymentScope}${filter}
         GROUP BY x.variant_id
       ) r ON r.variant_id = c.variant_id
       ORDER BY revenue DESC, units DESC`,
      ...params,
      ...params,
    );
    const profit = revenue.n - refunds - cost.n;
    const report = {
      from: range?.from ?? null,
      to: range?.to ?? null,
      timezone: "Asia/Bangkok",
      mode: moneyScope?.mode ?? "sandbox",
      totals: {
        orders: revenue.orders,
        units: cost.units,
        revenue: revenue.n,
        refunds,
        cost: cost.n,
        profit,
      },
      byProduct,
    };
    if (String(query.format || "").toLowerCase() === "csv")
      return { ...report, csv: profitCsv(report) };
    return report;
  }

  /** S5: server CSV with the same formula-injection escaping as the admin UI. */
  function salesCsv(report) {
    const baht = (satang) => (satang / 100).toFixed(2);
    const lines = [
      csvLine(["สินค้า", "ตัวเลือก", "ประเภท", "ออเดอร์", "ชิ้น", "ยอดขาย (บาท)"]),
      ...report.byProduct.map((r) =>
        csvLine([r.product, r.variant, r.preorder ? "พรีออเดอร์" : "พร้อมส่ง", r.orders, r.units, baht(r.revenue)]),
      ),
      "",
      csvLine(["วัน", "ออเดอร์", "ชิ้น", "ผู้ซื้อ", "ยอดขาย (บาท)"]),
      ...report.byDay.map((d) => csvLine([d.day, d.orders, d.units, d.buyers, baht(d.revenue)])),
      "",
      csvLine(["ยอดขาย (บาท)", "คืนเงิน (บาท)", "สุทธิ (บาท)", "ส่วนลดคูปอง (บาท)"]),
      csvLine([
        baht(report.totals.revenue),
        baht(report.totals.refunds),
        baht(report.totals.net),
        baht(report.totals.discounts),
      ]),
    ];
    return "\ufeff" + lines.join("\r\n") + "\r\n";
  }

  function profitCsv(report) {
    const baht = (satang) => (satang / 100).toFixed(2);
    const lines = [
      csvLine(["สินค้า", "ตัวเลือก", "ชิ้น", "ยอดขาย (บาท)", "ต้นทุน (บาท)"]),
      ...report.byProduct.map((r) =>
        csvLine([r.product, r.variant, r.units, baht(r.revenue), baht(r.cost)]),
      ),
      "",
      csvLine(["ยอดขาย (บาท)", "คืนเงิน (บาท)", "ต้นทุน (บาท)", "กำไร (บาท)"]),
      csvLine([
        baht(report.totals.revenue),
        baht(report.totals.refunds),
        baht(report.totals.cost),
        baht(report.totals.profit),
      ]),
    ];
    return "\ufeff" + lines.join("\r\n") + "\r\n";
  }

  return { salesReport, profitReport };
}
