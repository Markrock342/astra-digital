/**
 * Auto-expire unpaid orders and preorders (shop setting `pendingExpiryMinutes`).
 *
 * There is no cron. The sweep is lazy and request-driven: order list/detail reads,
 * createOrder, pay and retry call maybeSweep(), which runs the real sweep at most once
 * a minute (timestamp in runtime_flags, so it also holds across Durable Object restarts).
 * Pay and retry also check the one order they touch, so a customer can never pay an
 * order that is past its window even if the last sweep was less than a minute ago.
 *
 * Why not a DO alarm: an alarm needs scheduling/rescheduling code that only runs on
 * workerd, not under the Node tests, and nobody can see a stale unpaid order without
 * making one of the requests above, which already trigger the sweep.
 *
 * Stock: an unpaid order does not hold inventory. Units are bound to an order only
 * when payment succeeds (pay) and to a preorder only on delivery, and public stock
 * counts only unbound units. So expiring never has stock to release and does not
 * bump the catalog topic; only `orders` changes.
 *
 * Paid orders are never touched: every write is `... WHERE status='PENDING_PAYMENT'`.
 *
 * `afterSweep` rides on the same once-a-minute gate: preorder.mjs uses it for deposit / free
 * reservations (reminder before pay_by, lapse past pay_by, call the next in queue).
 */
export const PENDING_EXPIRY_DEFAULT = 30;
export const PENDING_EXPIRY_MIN = 5;
export const PENDING_EXPIRY_MAX = 1440;
export const EXPIRED_REASON = "หมดเวลาชำระเงิน";
export const EXPIRED_MESSAGE = "คำสั่งซื้อนี้หมดเวลาชำระเงินแล้ว กรุณาสั่งซื้อใหม่";
export const SWEEP_EVERY_MS = 60000;
const SWEEP_FLAG = "pending-expiry-sweep";
const SWEEP_BATCH = 200;

/** Setting value → minutes; anything invalid falls back to the default. */
export function pendingExpiryMinutes(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= PENDING_EXPIRY_MIN && n <= PENDING_EXPIRY_MAX
    ? n
    : PENDING_EXPIRY_DEFAULT;
}

/** ms → SQLite CURRENT_TIMESTAMP text (UTC "YYYY-MM-DD HH:MM:SS"). */
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

export function createPendingExpiry({
  one,
  all,
  run,
  tx,
  clock,
  settings,
  cancelUnpaidOrder,
  bump,
  // Extra work on the same gate (preorder.mjs: reminders, lapses past pay_by, queue calls).
  afterSweep = null,
}) {
  const minutes = () => pendingExpiryMinutes(settings().pendingExpiryMinutes);
  const cutoff = () => sqlTime(clock() - minutes() * 60000);

  /** Inside a transaction. True when this call moved the row to CANCELLED. */
  function expireRow(table, id) {
    return cancelUnpaidOrder({
      table,
      orderId: id,
      actor: null,
      action: "ORDER_EXPIRED",
      detail: { reason: EXPIRED_REASON, minutes: minutes() },
      expiredAt: sqlTime(clock()),
    });
  }
  const changed = (count) => {
    if (count) bump(["orders"]);
    return count;
  };

  /** Expire every unpaid order older than the setting (one batch). Returns the count. */
  function sweep() {
    const before = cutoff();
    const rows = all(
      `SELECT 'orders' AS tbl,id FROM orders WHERE status='PENDING_PAYMENT' AND created_at<?
       UNION ALL
       SELECT 'reservations' AS tbl,id FROM reservations WHERE status='PENDING_PAYMENT' AND created_at<?
       LIMIT ?`,
      before,
      before,
      SWEEP_BATCH,
    );
    if (!rows.length) return 0;
    return changed(tx(() => rows.reduce((n, r) => n + (expireRow(r.tbl, r.id) ? 1 : 0), 0)));
  }

  /** Cheap gate: at most one real sweep per minute. Never throws into the request. */
  function maybeSweep() {
    try {
      const t = clock();
      const last = Number(one("SELECT value FROM runtime_flags WHERE key=?", SWEEP_FLAG)?.value ?? 0);
      // A clock that went backwards (tests, restored backups) must not stop the sweep forever.
      if (last && t >= last && t - last < SWEEP_EVERY_MS) return 0;
      run(
        "INSERT INTO runtime_flags(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        SWEEP_FLAG,
        String(t),
      );
      const count = sweep();
      if (afterSweep) {
        try {
          afterSweep();
        } catch (error) {
          console.error("Preorder sweep failed:", error.message);
        }
      }
      return count;
    } catch (error) {
      console.error("Pending order sweep failed:", error.message);
      return 0;
    }
  }

  /** The one order a customer is about to pay or retry, regardless of the sweep gate. */
  function expireIfStale(user, id) {
    if (!user || typeof id !== "string" || !id) return false;
    try {
      const before = cutoff();
      for (const table of ["orders", "reservations"]) {
        const row = one(
          `SELECT id FROM ${table} WHERE id=? AND user_id=? AND status='PENDING_PAYMENT' AND created_at<?`,
          id,
          user.id,
          before,
        );
        if (row) return changed(tx(() => (expireRow(table, row.id) ? 1 : 0))) > 0;
      }
    } catch (error) {
      console.error("Pending order check failed:", error.message);
    }
    return false;
  }

  return { sweep, maybeSweep, expireIfStale, minutes };
}
