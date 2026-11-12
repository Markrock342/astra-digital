/**
 * FR-F6 refunds, FR-C7 credit adjustments and the per-order payment summary.
 * ADMIN only. Every money change is a new, append-only ledger row plus an audit row.
 * Wallet and revenue rules live in ./money.mjs.
 */
import { walletBalanceSql } from "./money.mjs";

export const REFUND_REASONS = {
  CUSTOMER_CANCEL: "ลูกค้าขอยกเลิก",
  ACCOUNT_BROKEN: "บัญชีใช้งานไม่ได้",
  CANNOT_DELIVER: "ส่งของไม่ได้",
  OTHER: "อื่นๆ",
};
export const REFUND_DESTINATIONS = ["CREDIT", "EXTERNAL"];
/** FR-C7: 10,000 THB per adjustment, in satang. */
export const CREDIT_ADJUST_CAP = 1_000_000;

const shortId = (id) => "#" + String(id).slice(0, 8).toUpperCase();
const thb = (satang) =>
  "฿" + (satang / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function createAdminMoneyApis({
  requireAdmin,
  one,
  all,
  run,
  tx,
  fail,
  clean,
  integer,
  insertLedgerEntry,
  notify,
  allowSandbox,
}) {
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      JSON.stringify(detail),
    );
  const balanceOf = (userId) => one(walletBalanceSql, userId).value;
  const optionalText = (value, max, label) => {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (text.length > max) fail(400, label + "ยาวเกินไป");
    return text;
  };

  /** Order or preorder row with the columns the money code needs. */
  function loadOrder(orderId) {
    const order = one("SELECT *, 0 AS preorder FROM orders WHERE id=?", orderId);
    if (order) return order;
    return one("SELECT *, 1 AS preorder FROM reservations WHERE id=?", orderId) ?? null;
  }

  function succeededPayments(order) {
    return all(
      `SELECT id,amount,provider,provider_ref,created_at,finalized_at FROM payments
       WHERE ${order.preorder ? "reservation_id" : "order_id"}=? AND status='SUCCEEDED'
       ORDER BY created_at ASC, rowid ASC`,
      order.id,
    );
  }

  /** Paid / refunded / outstanding / fee for one order (FR "สรุปเงินต่อออเดอร์"). */
  function paymentSummaryFor(order) {
    const payments = succeededPayments(order);
    const paid = payments.reduce((n, p) => n + p.amount, 0);
    const refunds = all(
      `SELECT l.id,l.amount,l.direction,l.reason,l.provider_ref,l.label,l.created_at,u.name AS actor
       FROM ledger l LEFT JOIN users u ON u.id=l.actor_id
       WHERE l.order_id=? AND l.kind='REFUND' ORDER BY l.created_at ASC, l.rowid ASC`,
      order.id,
    );
    const refunded = refunds.reduce((n, r) => n + r.amount, 0);
    const fee = one(
      `SELECT COALESCE(SUM(fee),0) + COALESCE(SUM(CASE WHEN kind='FEE' THEN amount ELSE 0 END),0) AS n
       FROM ledger WHERE order_id=?`,
      order.id,
    ).n;
    const closed = ["FAILED", "CANCELLED", "OUT_OF_STOCK"].includes(order.status) && paid === 0;
    return {
      paid,
      refunded,
      outstanding: closed ? 0 : Math.max(0, order.total - paid),
      fee,
      net: paid - refunded - fee,
      refundable: Math.max(0, paid - refunded),
      refundStatus: refundStatusOf(paid, refunded),
      refunds: refunds.map((r) => ({
        id: r.id,
        amount: r.amount,
        destination: r.direction === "in" ? "CREDIT" : "EXTERNAL",
        reason: r.reason,
        externalRef: r.direction === "out" ? r.provider_ref : null,
        actor: r.actor ?? null,
        created_at: r.created_at,
      })),
    };
  }
  const refundStatusOf = (paid, refunded) =>
    refunded <= 0 ? null : refunded >= paid ? "REFUNDED" : "PARTIALLY_REFUNDED";

  /** Refund state for the customer's own order view (no admin detail). */
  function orderRefundState(orderId, preorder) {
    const refunded = one(
      "SELECT COALESCE(SUM(amount),0) AS n FROM ledger WHERE order_id=? AND kind='REFUND'",
      orderId,
    ).n;
    if (!refunded) return { refundStatus: null, refundedTotal: 0 };
    const paid = one(
      `SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE ${preorder ? "reservation_id" : "order_id"}=? AND status='SUCCEEDED'`,
      orderId,
    ).n;
    return { refundStatus: refundStatusOf(paid, refunded), refundedTotal: refunded };
  }

  function adminOrderPaymentSummary(user, id) {
    requireAdmin(user);
    const order = loadOrder(clean(id, 1, 80, "คำสั่งซื้อ"));
    if (!order) fail(404, "ไม่พบคำสั่งซื้อ");
    return paymentSummaryFor(order);
  }

  function refundOrder(user, id, input = {}) {
    requireAdmin(user);
    const orderId = clean(id, 1, 80, "คำสั่งซื้อ");
    const amount = integer(input.amount, 1, Number.MAX_SAFE_INTEGER, "ยอดคืนเงิน");
    const reasonCode = String(input.reasonCode ?? "");
    if (!REFUND_REASONS[reasonCode]) fail(400, "กรุณาเลือกเหตุผลการคืนเงิน");
    const note =
      reasonCode === "OTHER"
        ? clean(input.note, 3, 300, "รายละเอียดเหตุผล")
        : optionalText(input.note, 300, "รายละเอียดเหตุผล");
    const destination = String(input.destination ?? "");
    if (!REFUND_DESTINATIONS.includes(destination)) fail(400, "กรุณาเลือกช่องทางคืนเงิน");
    const externalRef =
      destination === "EXTERNAL" ? clean(input.externalRef, 3, 120, "เลขอ้างอิงการโอนคืน") : null;
    const requestKey = clean(input.requestKey, 8, 128, "รหัสคำขอ");
    const reason = REFUND_REASONS[reasonCode] + (note ? " — " + note : "");
    const reference = "refund:" + orderId + ":" + requestKey;
    return tx(() => {
      const order = loadOrder(orderId);
      if (!order) fail(404, "ไม่พบคำสั่งซื้อ");
      const prior = one("SELECT amount,direction FROM ledger WHERE reference=?", reference);
      if (prior) {
        const sameDestination = (prior.direction === "in" ? "CREDIT" : "EXTERNAL") === destination;
        if (prior.amount !== amount || !sameDestination)
          fail(409, "รหัสคำขอนี้ถูกใช้กับการคืนเงินอื่นแล้ว");
        return { replayed: true, summary: paymentSummaryFor(order) };
      }
      const paidState = order.preorder
        ? ["PREORDER", "DELIVERED"].includes(order.status)
        : order.status === "DELIVERED";
      if (!paidState) fail(409, "คืนเงินได้เฉพาะออเดอร์ที่ชำระแล้วหรือส่งของแล้ว");
      const payments = succeededPayments(order);
      if (!payments.length) fail(409, "ออเดอร์นี้ไม่มียอดที่ชำระผ่านระบบ");
      const before = paymentSummaryFor(order);
      if (amount > before.refundable)
        fail(
          409,
          "ยอดคืนเกินยอดที่คืนได้ (คืนได้อีก " + thb(before.refundable) + ")",
        );
      const payment = payments[payments.length - 1];
      insertLedgerEntry({
        userId: order.user_id,
        amount,
        reference,
        label:
          (destination === "CREDIT" ? "คืนเงินเข้าเครดิต ออเดอร์ " : "คืนเงินนอกระบบ ออเดอร์ ") +
          shortId(orderId),
        kind: "REFUND",
        direction: destination === "CREDIT" ? "in" : "out",
        orderId,
        paymentId: payment.id,
        providerRef: externalRef,
        actorId: user.id,
        reason,
      });
      const full = before.refunded + amount >= before.paid;
      let released = false;
      let retired = 0;
      if (full && order.preorder && order.status === "PREORDER") {
        // Undelivered preorder: leave the queue.
        run("UPDATE reservations SET status='CANCELLED' WHERE id=? AND status='PREORDER'", orderId);
        released = true;
      }
      if (full && order.status === "DELIVERED") {
        // The account was sold and refunded: never hand it to anyone again.
        retired = run(
          `UPDATE inventory SET defective=1, defective_at=CURRENT_TIMESTAMP, defective_by=?, defective_reason=?
           WHERE ${order.preorder ? "reservation_id" : "order_id"}=? AND COALESCE(defective,0)=0`,
          user.id,
          "คืนเงินแล้ว (" + REFUND_REASONS[reasonCode] + ")",
          orderId,
        ).changes;
      }
      notify(
        order.user_id,
        "refund",
        full ? "คืนเงินแล้ว" : "คืนเงินบางส่วนแล้ว",
        "ออเดอร์ " +
          shortId(orderId) +
          " คืนเงิน " +
          thb(amount) +
          (destination === "CREDIT" ? " เข้าเครดิตของคุณ" : " โอนคืนนอกระบบ อ้างอิง " + externalRef),
        "/orders/" + orderId,
      );
      auditDetail(user, "ORDER_REFUND", orderId, {
        amount,
        reasonCode,
        reason,
        destination,
        externalRef,
        full,
        released,
        retiredUnits: retired,
        test: payment.provider === "sandbox",
      });
      return { replayed: false, summary: paymentSummaryFor(loadOrder(orderId)) };
    });
  }

  function adjustCustomerCredit(user, id, input = {}) {
    requireAdmin(user);
    const customerId = clean(id, 1, 80, "ลูกค้า");
    const amount = integer(input.amount, -CREDIT_ADJUST_CAP, CREDIT_ADJUST_CAP, "ยอดปรับ");
    if (amount === 0) fail(400, "ยอดปรับต้องไม่เป็นศูนย์");
    const reason = clean(input.reason, 3, 300, "เหตุผล");
    const requestKey = clean(input.requestKey, 8, 128, "รหัสคำขอ");
    const reference = "adjust:" + customerId + ":" + requestKey;
    return tx(() => {
      const customer = one("SELECT id,role FROM users WHERE id=?", customerId);
      if (!customer || customer.role !== "CUSTOMER") fail(404, "ไม่พบลูกค้า");
      const prior = one("SELECT net FROM ledger WHERE reference=?", reference);
      if (prior) {
        if (prior.net !== amount) fail(409, "รหัสคำขอนี้ถูกใช้กับการปรับยอดอื่นแล้ว");
        return { replayed: true, balance: balanceOf(customerId) };
      }
      const before = balanceOf(customerId);
      if (before + amount < 0)
        fail(409, "ยอดเครดิตติดลบไม่ได้ (คงเหลือ " + thb(before) + ")");
      insertLedgerEntry({
        userId: customerId,
        amount,
        reference,
        label: (amount > 0 ? "แอดมินเพิ่มเครดิต" : "แอดมินหักเครดิต") + " — " + reason,
        kind: "ADJUSTMENT",
        direction: amount > 0 ? "in" : "out",
        actorId: user.id,
        reason,
        // Adjustments made while the shop runs on test money are test money too.
        providerRef: allowSandbox ? "sandbox:adjust:" + requestKey : null,
      });
      const after = balanceOf(customerId);
      notify(
        customerId,
        "credit",
        amount > 0 ? "ร้านเพิ่มเครดิตให้คุณ" : "ร้านปรับลดเครดิตของคุณ",
        (amount > 0 ? "+" : "−") + thb(Math.abs(amount)) + " · คงเหลือ " + thb(after),
      );
      auditDetail(user, "CREDIT_ADJUST", customerId, { amount, reason, before, after });
      return { replayed: false, balance: after };
    });
  }

  return {
    adminOrderPaymentSummary,
    refundOrder,
    adjustCustomerCredit,
    paymentSummaryFor,
    orderRefundState,
    loadMoneyOrder: loadOrder,
  };
}
