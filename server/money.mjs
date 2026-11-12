/**
 * Money rules shared by every balance, revenue, finance, report, dashboard and CSV
 * formula. Keep the rules here so they live in one place.
 *
 * Ledger rows come in two families (migration 006 columns):
 *  - Customer credit (wallet) rows. `direction` is from the wallet's point of view:
 *    DEMO_CREDIT, TOPUP, PURCHASE, ADJUSTMENT, and REFUND with direction 'in'
 *    (a refund paid back into store credit).
 *  - Shop money rows. `direction` is from the shop's point of view:
 *    PAYMENT_IN (in), FEE (out), WITHDRAWAL (out), and REFUND with direction 'out'
 *    (a refund paid outside the system, e.g. a bank transfer; the wallet is untouched).
 * Both REFUND directions lower revenue.
 *
 * Balance = SUM(net) over the customer's wallet rows. `net` is always signed.
 */

/** SQL predicate for "this ledger row moves the customer's credit". */
export const walletRowSql = (a = "") =>
  `(${a}kind IN ('DEMO_CREDIT','TOPUP','PURCHASE','ADJUSTMENT') OR (${a}kind='REFUND' AND ${a}direction='in'))`;

/** Signed credit balance of one customer (single formula, S4). */
export const walletBalanceSql = `SELECT COALESCE(SUM(net),0) AS value FROM ledger WHERE user_id=? AND ${walletRowSql()}`;

/**
 * Test-money scope (S2 livemode). In sandbox mode (ASTRA_TEST_PAYMENTS) every
 * formula keeps test money so UAT numbers match what testers did. In live mode test
 * money is excluded everywhere: sandbox payments, the ledger rows tied to them
 * (PAYMENT_IN, refunds of them), rows tagged `sandbox:` and DEMO_CREDIT.
 */
export function createMoneyScope(allowSandbox) {
  const live = !allowSandbox;
  return {
    mode: live ? "live" : "sandbox",
    live,
    /** Predicate for a `payments` row that counts as money. */
    payment: (a = "") => (live ? `${a}provider<>'sandbox'` : "1=1"),
    /** Predicate for a `ledger` row that counts as money. */
    ledger: (a = "") =>
      live
        ? `(${a}kind<>'DEMO_CREDIT' AND COALESCE(${a}provider_ref,'') NOT LIKE 'sandbox:%' AND NOT EXISTS (SELECT 1 FROM payments sp WHERE sp.id=${a}payment_id AND sp.provider='sandbox'))`
        : "1=1",
  };
}

/** Customer-facing type of a wallet row: TOPUP / PURCHASE / REFUND / ADJUSTMENT. */
export function walletEntryType(row) {
  if (row.kind === "REFUND") return "REFUND";
  if (row.kind === "ADJUSTMENT") return "ADJUSTMENT";
  if (row.kind === "PURCHASE") return "PURCHASE";
  if (row.kind === "TOPUP") return "TOPUP";
  return row.direction === "out" || row.net < 0 ? "PURCHASE" : "TOPUP";
}

/**
 * Wallet history with the running balance after each row, newest first.
 * Uses a window over all of the customer's wallet rows so the running balance is
 * right even when only the latest `limit` rows are returned.
 */
export function walletHistory(all, userId, limit = 200) {
  return all(
    `SELECT id,kind,direction,amount,net,label,reference,reason,order_id,created_at,balance_after FROM (
       SELECT id,kind,direction,amount,net,label,reference,reason,order_id,created_at,rowid AS seq,
              SUM(net) OVER (ORDER BY created_at ASC, rowid ASC ROWS UNBOUNDED PRECEDING) AS balance_after
       FROM ledger WHERE user_id=? AND ${walletRowSql()}
     ) ORDER BY created_at DESC, seq DESC LIMIT ?`,
    userId,
    limit,
  ).map((row) => ({
    id: row.id,
    type: walletEntryType(row),
    kind: row.kind,
    amount: row.net,
    label: row.label,
    reference: row.reference,
    reason: row.reason ?? null,
    order_id: row.order_id ?? null,
    balanceAfter: row.balance_after,
    created_at: row.created_at,
  }));
}

/** CSV cell, same rule as downloadCsv in src/AdminLists.tsx (S5 formula injection). */
export function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) || text !== String(value ?? "")
    ? '"' + text.replace(/"/g, '""') + '"'
    : text;
}

export const csvLine = (cells) => cells.map(csvCell).join(",");

/** Mask a long provider reference or token: keep the head and the tail only. */
export function maskRef(value) {
  if (value == null) return null;
  const text = String(value);
  if (text.length <= 16) return text;
  return text.slice(0, 8) + "…" + text.slice(-4);
}
