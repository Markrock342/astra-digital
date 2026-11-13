/**
 * การเงิน › ปิดยอดรายวัน (daily close) and บันทึกการถอนเงิน (withdrawals). ADMIN only.
 *
 * Money rules (integer satang, Asia/Bangkok calendar days, one money scope at a time):
 *  - Money in:  payments SUCCEEDED (by COALESCE(finalized_at, created_at)) + TOPUP ledger rows.
 *  - Money out: REFUND ledger rows (both directions, same as revenue = gross − refunds),
 *               fees (ledger.fee + FEE rows) and withdrawals recorded here.
 *  - closing = opening + in − out. A day's opening is the previous closed day's closing
 *    (plus later adjustments), so the chain never re-computes history silently.
 *  - Customer credit (wallet rows, a liability) is reported beside the shop cash, never in it.
 *
 * Every table here is append-only (triggers). A close is a snapshot row; a later change
 * to a closed day is shown as "ยอดเปลี่ยนหลังปิด" and corrected with an ADJUST row.
 * A withdrawal is cancelled with a REVERSAL row dated on the same day.
 * Sandbox and live never mix: every row carries the scope it was written in and every
 * read filters on the current scope (money.mjs createMoneyScope).
 */
import { randomUUID } from "node:crypto";
import { assertAllowedImage } from "./file-store.mjs";
import { csvLine, walletRowSql } from "./money.mjs";

const APPEND_ONLY_TABLES = [
  "finance_day_closes",
  "finance_withdrawals",
  "recon_runs",
  "recon_rows",
  "recon_decisions",
];
/** Trigger names the admin health page expects (admin-health.mjs). */
export const FINANCE_APPEND_ONLY_TRIGGERS = APPEND_ONLY_TABLES.flatMap((t) => [
  t + "_append_only_update",
  t + "_append_only_delete",
]);

/** Idempotent schema for daily close, withdrawals and reconciliation (no numbered migration). */
export function ensureFinanceBooks(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS finance_day_closes (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('sandbox','live')),
    day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('CLOSE','ADJUST')),
    opening INTEGER NOT NULL,
    payments_in INTEGER NOT NULL,
    topups_in INTEGER NOT NULL,
    refunds_out INTEGER NOT NULL,
    refunds_to_credit INTEGER NOT NULL DEFAULT 0,
    fees_out INTEGER NOT NULL,
    withdrawals_out INTEGER NOT NULL,
    net INTEGER NOT NULL,
    delta INTEGER NOT NULL DEFAULT 0,
    closing INTEGER NOT NULL,
    credit_opening INTEGER NOT NULL,
    credit_in INTEGER NOT NULL,
    credit_out INTEGER NOT NULL,
    credit_closing INTEGER NOT NULL,
    note TEXT,
    actor_id TEXT,
    created_at TEXT NOT NULL
  )`);
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS finance_day_closes_once ON finance_day_closes(scope, day) WHERE kind='CLOSE'",
  );
  db.exec("CREATE INDEX IF NOT EXISTS finance_day_closes_day ON finance_day_closes(scope, day)");
  db.exec(`CREATE TABLE IF NOT EXISTS finance_withdrawals (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('sandbox','live')),
    kind TEXT NOT NULL CHECK (kind IN ('WITHDRAWAL','REVERSAL')),
    reverses_id TEXT,
    day TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    bank TEXT,
    account_masked TEXT,
    reference TEXT,
    proof_key TEXT,
    note TEXT,
    request_key TEXT UNIQUE,
    actor_id TEXT,
    created_at TEXT NOT NULL,
    CHECK ((kind = 'WITHDRAWAL' AND reverses_id IS NULL) OR (kind = 'REVERSAL' AND reverses_id IS NOT NULL))
  )`);
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS finance_withdrawals_reversal ON finance_withdrawals(reverses_id) WHERE reverses_id IS NOT NULL",
  );
  db.exec("CREATE INDEX IF NOT EXISTS finance_withdrawals_day ON finance_withdrawals(scope, day)");
  db.exec(`CREATE TABLE IF NOT EXISTS recon_runs (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('sandbox','live')),
    filename TEXT NOT NULL,
    mapping TEXT NOT NULL,
    date_order TEXT NOT NULL,
    window_minutes INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    invalid_count INTEGER NOT NULL DEFAULT 0,
    invalid_samples TEXT,
    day_from TEXT NOT NULL,
    day_to TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS recon_runs_scope ON recon_runs(scope, created_at)");
  db.exec(`CREATE TABLE IF NOT EXISTS recon_rows (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    line INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    has_time INTEGER NOT NULL DEFAULT 1,
    amount INTEGER NOT NULL,
    fee INTEGER NOT NULL DEFAULT 0,
    reference TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS recon_rows_run ON recon_rows(run_id, line)");
  db.exec(`CREATE TABLE IF NOT EXISTS recon_decisions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('AUTO_MATCH','AUTO_FLAG','MATCH','UNMATCH','COMPLETE')),
    row_id TEXT,
    payment_id TEXT,
    method TEXT,
    note TEXT,
    actor_id TEXT,
    created_at TEXT NOT NULL
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS recon_decisions_run ON recon_decisions(run_id)");
  for (const table of APPEND_ONLY_TABLES) {
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS ${table}_append_only_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} rows are append-only'); END`,
    );
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS ${table}_append_only_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} rows are append-only'); END`,
    );
  }
}

// ------------------------------------------------------------------ day helpers

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
/** Bangkok calendar day of a ms timestamp. */
export const bangkokDayOf = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
export const addDays = (day, n) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
export function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
const bangkokDaySql = (column) => `substr(datetime(${column}, '+7 hours'), 1, 10)`;
const LINE_KEYS = [
  "paymentsIn",
  "topupsIn",
  "refundsOut",
  "feesOut",
  "withdrawalsOut",
  "creditIn",
  "creditOut",
];
const zeroLines = () => ({
  paymentsIn: 0,
  topupsIn: 0,
  refundsOut: 0,
  refundsToCredit: 0,
  feesOut: 0,
  withdrawalsOut: 0,
  creditIn: 0,
  creditOut: 0,
});
/** money in / out / net from the lines (one formula for live figures and snapshots). */
export function withTotals(lines) {
  const moneyIn = lines.paymentsIn + lines.topupsIn;
  const moneyOut = lines.refundsOut + lines.feesOut + lines.withdrawalsOut;
  return { ...lines, moneyIn, moneyOut, net: moneyIn - moneyOut };
}
const entryLines = (e) =>
  withTotals({
    paymentsIn: e.payments_in,
    topupsIn: e.topups_in,
    refundsOut: e.refunds_out,
    refundsToCredit: e.refunds_to_credit,
    feesOut: e.fees_out,
    withdrawalsOut: e.withdrawals_out,
    creditIn: e.credit_in,
    creditOut: e.credit_out,
  });
export const sameLines = (a, b) => LINE_KEYS.every((k) => a[k] === b[k]);

/** Last 4 digits only; the full account number is never stored. */
export function maskAccount(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 20) return null;
  return "••••" + digits.slice(-4);
}

export function createFinanceCloseApis({
  requireAdmin,
  confirmPassword,
  one,
  all,
  run,
  tx,
  fail,
  clean,
  integer,
  clock,
  moneyScope,
  bangkokDayRange,
  fileStore,
}) {
  const scope = moneyScope.mode;
  const nowSql = () => new Date(clock()).toISOString().slice(0, 19).replace("T", " ");
  const today = () => bangkokDayOf(clock());
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      JSON.stringify(detail),
    );
  const optionalText = (value, max, label) => {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (text.length > max) fail(400, label + "ยาวเกินไป");
    return text;
  };
  const validDay = (value, label = "วันที่") => {
    const text = String(value ?? "").trim();
    if (!DAY_RE.test(text) || Number.isNaN(Date.parse(text + "T00:00:00Z")))
      fail(400, label + "ต้องเป็น YYYY-MM-DD");
    if (addDays(text, 0) !== text) fail(400, label + "ไม่ถูกต้อง");
    return text;
  };
  const utcStart = (day) => bangkokDayRange(day, day).fromUtc;

  // ---------------------------------------------------------------- live figures

  const ledgerSums = `
    COALESCE(SUM(CASE WHEN kind='TOPUP' AND status='SUCCEEDED' THEN ABS(amount) ELSE 0 END),0) AS topups,
    COALESCE(SUM(CASE WHEN kind='REFUND' THEN ABS(amount) ELSE 0 END),0) AS refunds,
    COALESCE(SUM(CASE WHEN kind='REFUND' AND direction='in' THEN ABS(amount) ELSE 0 END),0) AS refunds_credit,
    COALESCE(SUM(CASE WHEN status='SUCCEEDED' THEN fee ELSE 0 END),0)
      + COALESCE(SUM(CASE WHEN kind='FEE' AND status='SUCCEEDED' THEN ABS(amount) ELSE 0 END),0) AS fees,
    COALESCE(SUM(CASE WHEN ${walletRowSql()} AND net>0 THEN net ELSE 0 END),0) AS credit_in,
    COALESCE(SUM(CASE WHEN ${walletRowSql()} AND net<0 THEN -net ELSE 0 END),0) AS credit_out`;
  /** Live lines per Bangkok day for [from, to] (Map day → lines). */
  function liveFigures(from, to) {
    const range = bangkokDayRange(from, to);
    const map = new Map();
    const at = (day) => {
      if (!map.has(day)) map.set(day, zeroLines());
      return map.get(day);
    };
    const paidAt = "COALESCE(finalized_at, created_at)";
    for (const row of all(
      `SELECT ${bangkokDaySql(paidAt)} AS day, COALESCE(SUM(amount),0) AS n
       FROM payments WHERE status='SUCCEEDED' AND ${moneyScope.payment()}
         AND ${paidAt} >= ? AND ${paidAt} <= ?
       GROUP BY day`,
      range.fromUtc,
      range.toUtc,
    ))
      at(row.day).paymentsIn = row.n;
    for (const row of all(
      `SELECT ${bangkokDaySql("created_at")} AS day, ${ledgerSums}
       FROM ledger WHERE ${moneyScope.ledger()} AND created_at >= ? AND created_at <= ?
       GROUP BY day`,
      range.fromUtc,
      range.toUtc,
    ))
      Object.assign(at(row.day), {
        topupsIn: row.topups,
        refundsOut: row.refunds,
        refundsToCredit: row.refunds_credit,
        feesOut: row.fees,
        creditIn: row.credit_in,
        creditOut: row.credit_out,
      });
    for (const row of all(
      `SELECT day, COALESCE(SUM(CASE WHEN kind='WITHDRAWAL' THEN amount ELSE -amount END),0) AS n
       FROM finance_withdrawals WHERE scope=? AND day >= ? AND day <= ? GROUP BY day`,
      scope,
      from,
      to,
    ))
      at(row.day).withdrawalsOut = row.n;
    for (const [day, lines] of map) map.set(day, withTotals(lines));
    return map;
  }
  const figuresOf = (map, day) => map.get(day) ?? withTotals(zeroLines());

  /** Shop cash net and customer credit of everything before the given Bangkok day. */
  function liveBefore(day) {
    const before = utcStart(day);
    const paidAt = "COALESCE(finalized_at, created_at)";
    const paid = one(
      `SELECT COALESCE(SUM(amount),0) AS n FROM payments
       WHERE status='SUCCEEDED' AND ${moneyScope.payment()} AND ${paidAt} < ?`,
      before,
    ).n;
    const l = one(
      `SELECT ${ledgerSums} FROM ledger WHERE ${moneyScope.ledger()} AND created_at < ?`,
      before,
    );
    const withdrawn = one(
      `SELECT COALESCE(SUM(CASE WHEN kind='WITHDRAWAL' THEN amount ELSE -amount END),0) AS n
       FROM finance_withdrawals WHERE scope=? AND day < ?`,
      scope,
      day,
    ).n;
    return {
      cash: paid + l.topups - l.refunds - l.fees - withdrawn,
      credit: l.credit_in - l.credit_out,
    };
  }

  // ---------------------------------------------------------------- close state

  function closeState() {
    const entries = all(
      `SELECT c.rowid AS seq, c.*, u.name AS actor_name FROM finance_day_closes c
       LEFT JOIN users u ON u.id=c.actor_id WHERE c.scope=? ORDER BY c.rowid ASC`,
      scope,
    );
    const closes = new Map();
    const byDay = new Map();
    const adjustments = [];
    for (const e of entries) {
      if (!byDay.has(e.day)) byDay.set(e.day, []);
      byDay.get(e.day).push(e);
      if (e.kind === "CLOSE") closes.set(e.day, e);
      else adjustments.push(e);
    }
    const closedDays = [...closes.keys()].sort();
    const sumDelta = (list) => list.reduce((n, a) => n + a.delta, 0);
    /** Adjustments made after this close for earlier days (carried into its closing). */
    const carried = (close) =>
      sumDelta(adjustments.filter((a) => a.day < close.day && a.seq > close.seq));
    /** Closing to carry forward: snapshot + every adjustment it has not seen yet. */
    const effective = (close) =>
      close.closing + sumDelta(adjustments.filter((a) => a.day <= close.day && a.seq > close.seq));
    const latestBefore = (day) => {
      let found = null;
      for (const d of closedDays) if (d < day) found = closes.get(d);
      return found;
    };
    return {
      closes,
      byDay,
      closedDays,
      first: closedDays.length ? closes.get(closedDays[0]) : null,
      latest: closedDays.length ? closes.get(closedDays[closedDays.length - 1]) : null,
      latestEntry: (day) => byDay.get(day)?.at(-1) ?? null,
      carried,
      effective,
      latestBefore,
    };
  }

  /** Opening shop cash for a day: previous close (plus adjustments) + live days since. */
  function openingFor(day, state) {
    const previous = state.latestBefore(day);
    if (!previous) return liveBefore(day).cash;
    const between = liveBefore(day).cash - liveBefore(addDays(previous.day, 1)).cash;
    return state.effective(previous) + between;
  }

  function dayRow(day, live, opening, creditOpening, state, todayDay) {
    const close = state.closes.get(day);
    if (!close) {
      return {
        day,
        status: "OPEN",
        opening,
        ...live,
        closing: opening + live.net,
        carried: 0,
        creditOpening,
        creditClosing: creditOpening + live.creditIn - live.creditOut,
        diff: 0,
        closable: day < todayDay && (!state.latest || state.latest.day < day),
        active: LINE_KEYS.some((k) => live[k] !== 0),
        closedAt: null,
        closedBy: null,
        note: null,
        adjustments: [],
      };
    }
    const latest = state.latestEntry(day);
    const snap = entryLines(latest);
    const changed = !sameLines(snap, live);
    const carried = state.carried(close);
    return {
      day,
      status: changed ? "CHANGED" : "CLOSED",
      opening: close.opening,
      ...snap,
      closing: state.effective(close),
      carried,
      creditOpening: close.credit_opening,
      creditClosing: latest.credit_closing,
      diff: live.net - snap.net,
      creditDiff: live.creditIn - live.creditOut - (snap.creditIn - snap.creditOut),
      live: changed ? live : null,
      closable: false,
      active: true,
      closedAt: close.created_at,
      closedBy: close.actor_name ?? null,
      note: close.note ?? null,
      adjustments: state.byDay
        .get(day)
        .filter((e) => e.kind === "ADJUST")
        .map((a) => ({ delta: a.delta, note: a.note, at: a.created_at, by: a.actor_name ?? null })),
    };
  }

  // ---------------------------------------------------------------- daily close APIs

  function adminFinanceDays(user, query = {}) {
    requireAdmin(user);
    const todayDay = today();
    const hasFrom = query.from != null && String(query.from).trim() !== "";
    const hasTo = query.to != null && String(query.to).trim() !== "";
    const to = hasTo ? validDay(query.to, "วันสิ้นสุด") : todayDay;
    const from = hasFrom ? validDay(query.from, "วันเริ่ม") : addDays(to, -29);
    if (from > to) fail(400, "ช่วงวันไม่ถูกต้อง");
    if (daysBetween(from, to).length > 366) fail(400, "เลือกได้ไม่เกิน 366 วัน");
    const state = closeState();
    const live = liveFigures(from, to);
    let opening = openingFor(from, state);
    // Customer credit is always the live wallet total (a liability, never chained).
    let credit = liveBefore(from).credit;
    const rows = [];
    for (const day of daysBetween(from, to)) {
      const lines = figuresOf(live, day);
      const row = dayRow(day, lines, opening, credit, state, todayDay);
      rows.push(row);
      opening = row.status === "OPEN" ? row.closing : state.effective(state.closes.get(day));
      credit += lines.creditIn - lines.creditOut;
    }
    // Changed-after-close is checked on every closed day, not only the range shown.
    let changedDays = [];
    if (state.closedDays.length) {
      const closedLive = liveFigures(state.closedDays[0], state.closedDays.at(-1));
      changedDays = state.closedDays.filter(
        (d) => !sameLines(entryLines(state.latestEntry(d)), figuresOf(closedLive, d)),
      );
    }
    const nextToClose = state.latest ? addDays(state.latest.day, 1) : null;
    const summary = {
      mode: scope,
      today: todayDay,
      from,
      to,
      firstClosed: state.first?.day ?? null,
      lastClosed: state.latest?.day ?? null,
      nextToClose: nextToClose && nextToClose < todayDay ? nextToClose : null,
      changedDays,
      // Days still to close (not the ones before the first close, which are never closed).
      openDays: rows.filter((r) => r.status === "OPEN" && r.closable && r.active).length,
      moneyIn: rows.reduce((n, r) => n + r.moneyIn, 0),
      moneyOut: rows.reduce((n, r) => n + r.moneyOut, 0),
    };
    rows.reverse();
    if (String(query.format || "").toLowerCase() === "csv") {
      const statusText = { OPEN: "ยังไม่ปิด", CLOSED: "ปิดแล้ว", CHANGED: "ยอดเปลี่ยนหลังปิด" };
      const baht = (n) => (n / 100).toFixed(2);
      const lines = [
        csvLine([
          "day",
          "status",
          "opening",
          "payments_in",
          "topups_in",
          "refunds_out",
          "refunds_to_credit",
          "fees_out",
          "withdrawals_out",
          "money_in",
          "money_out",
          "closing",
          "changed_by",
          "credit_opening",
          "credit_in",
          "credit_out",
          "credit_closing",
          "closed_by",
          "closed_at",
          "note",
        ]),
      ];
      for (const r of rows)
        lines.push(
          csvLine([
            r.day,
            statusText[r.status],
            baht(r.opening),
            baht(r.paymentsIn),
            baht(r.topupsIn),
            baht(r.refundsOut),
            baht(r.refundsToCredit),
            baht(r.feesOut),
            baht(r.withdrawalsOut),
            baht(r.moneyIn),
            baht(r.moneyOut),
            baht(r.closing),
            baht(r.diff),
            baht(r.creditOpening),
            baht(r.creditIn),
            baht(r.creditOut),
            baht(r.creditClosing),
            r.closedBy,
            r.closedAt,
            r.note,
          ]),
        );
      return { csv: lines.join("\n") + "\n", summary };
    }
    return { days: rows, summary };
  }

  /** Close one day; any unclosed days since the last close are closed with it, in order. */
  function closeFinanceDay(user, input = {}) {
    requireAdmin(user);
    const day = validDay(input.day);
    const note = optionalText(input.note, 300, "หมายเหตุ");
    if (day >= today()) fail(409, "ปิดยอดได้เมื่อจบวันแล้ว (ปิดได้ถึงเมื่อวาน)");
    confirmPassword(user, input.currentPassword);
    return tx(() => {
      const state = closeState();
      if (state.closes.has(day)) fail(409, "วันนี้ปิดยอดแล้ว");
      if (state.latest && state.latest.day > day)
        fail(409, "ปิดย้อนหลังไม่ได้ ปิดถึงวันที่ " + state.latest.day + " แล้ว");
      const start = state.latest ? addDays(state.latest.day, 1) : day;
      const days = daysBetween(start, day);
      if (days.length > 400) fail(400, "ช่วงที่ยังไม่ปิดยาวเกิน 400 วัน");
      const live = liveFigures(start, day);
      let opening = openingFor(start, state);
      let creditOpening = liveBefore(start).credit;
      const at = nowSql();
      const closed = [];
      for (const d of days) {
        const f = figuresOf(live, d);
        const closing = opening + f.net;
        const creditClosing = creditOpening + f.creditIn - f.creditOut;
        run(
          `INSERT INTO finance_day_closes(
            id,scope,day,kind,opening,payments_in,topups_in,refunds_out,refunds_to_credit,fees_out,
            withdrawals_out,net,delta,closing,credit_opening,credit_in,credit_out,credit_closing,
            note,actor_id,created_at
          ) VALUES(?,?,?,'CLOSE',?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)`,
          randomUUID(),
          scope,
          d,
          opening,
          f.paymentsIn,
          f.topupsIn,
          f.refundsOut,
          f.refundsToCredit,
          f.feesOut,
          f.withdrawalsOut,
          f.net,
          closing,
          creditOpening,
          f.creditIn,
          f.creditOut,
          creditClosing,
          note,
          user.id,
          at,
        );
        closed.push({ day: d, opening, closing, net: f.net });
        opening = closing;
        creditOpening = creditClosing;
      }
      auditDetail(user, "FINANCE_DAY_CLOSE", day, {
        scope,
        from: start,
        to: day,
        days: days.length,
        closing: opening,
        note,
      });
      return { closed };
    });
  }

  /** Record that a closed day changed: a new ADJUST row, the close itself is never edited. */
  function adjustFinanceDay(user, input = {}) {
    requireAdmin(user);
    const day = validDay(input.day);
    const note = clean(input.note, 3, 300, "เหตุผล");
    confirmPassword(user, input.currentPassword);
    return tx(() => {
      const state = closeState();
      const close = state.closes.get(day);
      if (!close) fail(404, "วันนี้ยังไม่ได้ปิดยอด");
      const latest = state.latestEntry(day);
      const snap = entryLines(latest);
      const live = figuresOf(liveFigures(day, day), day);
      if (sameLines(snap, live)) fail(409, "ยอดของวันนี้ไม่เปลี่ยนหลังปิด");
      const delta = live.net - snap.net;
      const closing = state.effective(close) + delta;
      run(
        `INSERT INTO finance_day_closes(
          id,scope,day,kind,opening,payments_in,topups_in,refunds_out,refunds_to_credit,fees_out,
          withdrawals_out,net,delta,closing,credit_opening,credit_in,credit_out,credit_closing,
          note,actor_id,created_at
        ) VALUES(?,?,?,'ADJUST',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        randomUUID(),
        scope,
        day,
        close.opening,
        live.paymentsIn,
        live.topupsIn,
        live.refundsOut,
        live.refundsToCredit,
        live.feesOut,
        live.withdrawalsOut,
        live.net,
        delta,
        closing,
        close.credit_opening,
        live.creditIn,
        live.creditOut,
        close.credit_opening + live.creditIn - live.creditOut,
        note,
        user.id,
        nowSql(),
      );
      auditDetail(user, "FINANCE_DAY_ADJUST", day, { scope, delta, note });
      return { day, delta, closing };
    });
  }

  // ---------------------------------------------------------------- withdrawals

  const WITHDRAWAL_CAP = 1_000_000_000; // 10,000,000 THB per entry
  const PROOF_KEY_RE = /^proof-[0-9a-f-]{36}$/;
  const mapWithdrawal = (w) => ({
    id: w.id,
    kind: w.kind,
    reversesId: w.reverses_id ?? null,
    day: w.day,
    amount: w.amount,
    bank: w.bank,
    account: w.account_masked,
    reference: w.reference,
    hasProof: !!w.proof_key,
    note: w.note,
    actor: w.actor_name ?? null,
    createdAt: w.created_at,
    reversed: w.reversal_id
      ? { id: w.reversal_id, reason: w.reversal_note, at: w.reversal_at, by: w.reversal_actor ?? null }
      : null,
  });

  function adminWithdrawals(user, query = {}) {
    requireAdmin(user);
    const hasFrom = query.from != null && String(query.from).trim() !== "";
    const hasTo = query.to != null && String(query.to).trim() !== "";
    if (hasFrom !== hasTo) fail(400, "ต้องส่ง from และ to คู่กัน");
    const from = hasFrom ? validDay(query.from, "วันเริ่ม") : null;
    const to = hasTo ? validDay(query.to, "วันสิ้นสุด") : null;
    if (from && from > to) fail(400, "ช่วงวันไม่ถูกต้อง");
    const where = ["w.scope=?"];
    const params = [scope];
    if (from) {
      where.push("w.day >= ? AND w.day <= ?");
      params.push(from, to);
    }
    const rows = all(
      `SELECT w.*, u.name AS actor_name, r.id AS reversal_id, r.note AS reversal_note,
              r.created_at AS reversal_at, ru.name AS reversal_actor
       FROM finance_withdrawals w
       LEFT JOIN users u ON u.id=w.actor_id
       LEFT JOIN finance_withdrawals r ON r.reverses_id=w.id
       LEFT JOIN users ru ON ru.id=r.actor_id
       WHERE ${where.join(" AND ")} AND w.kind='WITHDRAWAL'
       ORDER BY w.day DESC, w.created_at DESC, w.rowid DESC
       LIMIT 1001`,
      ...params,
    );
    if (rows.length > 1000) fail(400, "รายการเกิน 1,000 แถว กรุณาเลือกช่วงวันให้แคบลง");
    const totals = one(
      `SELECT COALESCE(SUM(CASE WHEN w.kind='WITHDRAWAL' THEN w.amount ELSE 0 END),0) AS withdrawn,
              COALESCE(SUM(CASE WHEN w.kind='REVERSAL' THEN w.amount ELSE 0 END),0) AS reversed,
              COALESCE(SUM(CASE WHEN w.kind='WITHDRAWAL' THEN 1 ELSE 0 END),0) AS count
       FROM finance_withdrawals w WHERE ${where.join(" AND ")}`,
      ...params,
    );
    const byMonth = all(
      `SELECT substr(day,1,7) AS month,
              COALESCE(SUM(CASE WHEN kind='WITHDRAWAL' THEN amount ELSE -amount END),0) AS net,
              COALESCE(SUM(CASE WHEN kind='WITHDRAWAL' THEN 1 ELSE 0 END),0) AS count
       FROM finance_withdrawals WHERE scope=? GROUP BY month ORDER BY month DESC LIMIT 12`,
      scope,
    );
    const entries = rows.map(mapWithdrawal);
    const summary = {
      mode: scope,
      from,
      to,
      withdrawn: totals.withdrawn,
      reversed: totals.reversed,
      net: totals.withdrawn - totals.reversed,
      count: totals.count,
      byMonth,
      firstClosed: closeState().first?.day ?? null,
      today: today(),
    };
    if (String(query.format || "").toLowerCase() === "csv") {
      const lines = [
        csvLine([
          "id",
          "day",
          "amount",
          "bank",
          "account",
          "reference",
          "note",
          "recorded_by",
          "recorded_at",
          "status",
          "cancel_reason",
          "cancelled_at",
        ]),
      ];
      for (const w of entries)
        lines.push(
          csvLine([
            w.id,
            w.day,
            (w.amount / 100).toFixed(2),
            w.bank,
            w.account,
            w.reference,
            w.note,
            w.actor,
            w.createdAt,
            w.reversed ? "ยกเลิกแล้ว" : "ถอนแล้ว",
            w.reversed?.reason ?? "",
            w.reversed?.at ?? "",
          ]),
        );
      return { csv: lines.join("\n") + "\n", summary };
    }
    return { withdrawals: entries, summary };
  }

  function recordWithdrawal(user, input = {}) {
    requireAdmin(user);
    const amount = integer(input.amount, 1, WITHDRAWAL_CAP, "ยอดถอน");
    const day = validDay(input.day, "วันที่ถอน");
    if (day > today()) fail(400, "วันที่ถอนต้องไม่เกินวันนี้");
    const bank = clean(input.bank, 2, 60, "ธนาคาร");
    const account = maskAccount(input.account);
    if (!account) fail(400, "เลขบัญชีปลายทางไม่ถูกต้อง (ตัวเลข 4–20 หลัก)");
    const reference = optionalText(input.reference, 80, "เลขอ้างอิง");
    const note = optionalText(input.note, 300, "หมายเหตุ");
    const proofKey = optionalText(input.proofKey, 80, "ไฟล์หลักฐาน");
    if (proofKey && !PROOF_KEY_RE.test(proofKey)) fail(400, "ไฟล์หลักฐานไม่ถูกต้อง");
    const requestKey = clean(input.requestKey, 8, 128, "รหัสคำขอ");
    confirmPassword(user, input.currentPassword);
    return tx(() => {
      const prior = one("SELECT * FROM finance_withdrawals WHERE request_key=?", requestKey);
      if (prior) {
        if (prior.amount !== amount || prior.day !== day || prior.scope !== scope)
          fail(409, "รหัสคำขอนี้ถูกใช้กับรายการอื่นแล้ว");
        return { replayed: true, withdrawal: mapWithdrawal(prior), closedDay: false };
      }
      const state = closeState();
      if (state.first && day < state.first.day)
        fail(409, "วันที่นี้อยู่ก่อนวันแรกที่ปิดยอด (" + state.first.day + ") บันทึกไม่ได้");
      const id = randomUUID();
      run(
        `INSERT INTO finance_withdrawals(id,scope,kind,reverses_id,day,amount,bank,account_masked,
           reference,proof_key,note,request_key,actor_id,created_at)
         VALUES(?,?,'WITHDRAWAL',NULL,?,?,?,?,?,?,?,?,?,?)`,
        id,
        scope,
        day,
        amount,
        bank,
        account,
        reference,
        proofKey,
        note,
        requestKey,
        user.id,
        nowSql(),
      );
      auditDetail(user, "WITHDRAWAL_RECORD", id, { scope, day, amount, bank, account, reference });
      const row = one("SELECT w.*, u.name AS actor_name FROM finance_withdrawals w LEFT JOIN users u ON u.id=w.actor_id WHERE w.id=?", id);
      return { replayed: false, withdrawal: mapWithdrawal(row), closedDay: state.closes.has(day) };
    });
  }

  function reverseWithdrawal(user, id, input = {}) {
    requireAdmin(user);
    const withdrawalId = clean(id, 1, 80, "รายการ");
    const reason = clean(input.reason, 3, 300, "เหตุผลที่ยกเลิก");
    confirmPassword(user, input.currentPassword);
    return tx(() => {
      const w = one(
        "SELECT * FROM finance_withdrawals WHERE id=? AND scope=? AND kind='WITHDRAWAL'",
        withdrawalId,
        scope,
      );
      if (!w) fail(404, "ไม่พบรายการถอนเงิน");
      if (one("SELECT id FROM finance_withdrawals WHERE reverses_id=?", w.id))
        fail(409, "รายการนี้ยกเลิกไปแล้ว");
      const state = closeState();
      if (state.first && w.day < state.first.day)
        fail(409, "รายการนี้อยู่ก่อนวันแรกที่ปิดยอด ยกเลิกไม่ได้");
      const reversalId = randomUUID();
      run(
        `INSERT INTO finance_withdrawals(id,scope,kind,reverses_id,day,amount,bank,account_masked,
           reference,proof_key,note,request_key,actor_id,created_at)
         VALUES(?,?,'REVERSAL',?,?,?,?,?,?,NULL,?,NULL,?,?)`,
        reversalId,
        scope,
        w.id,
        w.day,
        w.amount,
        w.bank,
        w.account_masked,
        w.reference,
        reason,
        user.id,
        nowSql(),
      );
      auditDetail(user, "WITHDRAWAL_REVERSE", w.id, { scope, day: w.day, amount: w.amount, reason });
      return { id: w.id, reversalId, closedDay: state.closes.has(w.day) };
    });
  }

  /** Proof image (JPEG/PNG/WebP ≤ 2 MB). The key is not hex, so /api/files never serves it. */
  async function uploadWithdrawalProof(user, { bytes, contentType } = {}) {
    requireAdmin(user);
    if (!bytes || bytes.byteLength === 0) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
    const mime = assertAllowedImage(contentType, bytes, fail);
    const key = "proof-" + randomUUID();
    await fileStore.put(key, bytes, mime);
    return { proofKey: key };
  }

  async function withdrawalProof(user, id) {
    requireAdmin(user);
    const row = one(
      "SELECT proof_key FROM finance_withdrawals WHERE id=? AND scope=?",
      clean(id, 1, 80, "รายการ"),
      scope,
    );
    if (!row?.proof_key) fail(404, "ไม่พบไฟล์หลักฐาน");
    const file = await fileStore.get(row.proof_key);
    if (!file) fail(404, "ไม่พบไฟล์หลักฐาน");
    return file;
  }

  return {
    adminFinanceDays,
    closeFinanceDay,
    adjustFinanceDay,
    adminWithdrawals,
    recordWithdrawal,
    reverseWithdrawal,
    uploadWithdrawalProof,
    withdrawalProof,
  };
}
