/**
 * การเงิน › กระทบยอด (reconciliation). ADMIN only. Provider-agnostic: the admin uploads any
 * CSV (payment provider report or bank statement), maps its columns, and the rows are
 * matched to our SUCCEEDED payments — by reference first, then by amount + time window.
 *
 * Runs, statement rows and decisions are append-only (tables in finance-close.mjs). The
 * current match of a row is the replay of its decisions (AUTO_MATCH / MATCH / UNMATCH).
 * Nothing here ever changes an order, a payment or the ledger.
 */
import { randomUUID } from "node:crypto";
import { csvLine } from "./money.mjs";
import { addDays, bangkokDayOf } from "./finance-close.mjs";

export const RECON_MAX_BYTES = 2 * 1024 * 1024;
export const RECON_MAX_ROWS = 10000;
export const RECON_WINDOWS = [10, 30, 60, 180, 1440];
const MAX_COLUMNS = 100;
const MAX_CELL = 500;

// ------------------------------------------------------------------ CSV parsing

/** Pick the delimiter that splits the header line into the most columns. */
export function detectDelimiter(text) {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let count = 0;
  for (const d of [",", ";", "\t", "|"]) {
    const n = line.split(d).length;
    if (n > count) {
      best = d;
      count = n;
    }
  }
  return best;
}

/** RFC 4180-style parser (quoted cells, doubled quotes, CRLF). Empty lines are dropped. */
export function parseCsv(input, delimiter = detectDelimiter(input)) {
  const text = String(input).replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// ------------------------------------------------------------------ cell parsing

const pad = (n) => String(n).padStart(2, "0");
/**
 * Statement date → UTC "YYYY-MM-DD HH:MM:SS". Times without a zone are Bangkok time.
 * Accepts ISO (with Z / offset), YYYY-MM-DD, DD/MM/YYYY (or MM/DD with order "MDY"),
 * Buddhist years (> 2400), "." or "-" separators and an optional HH:MM[:SS].
 */
export function parseStatementDate(value, order = "DMY") {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (iso && iso[7]) {
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) return null;
    return { utc: new Date(ms).toISOString().slice(0, 19).replace("T", " "), hasTime: true };
  }
  const m =
    /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ T,]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/.exec(text);
  if (!m) return null;
  let year, month, day;
  if (m[1].length === 4) [year, month, day] = [+m[1], +m[2], +m[3]];
  else if (m[3].length === 4)
    [day, month, year] = order === "MDY" ? [+m[2], +m[1], +m[3]] : [+m[1], +m[2], +m[3]];
  else return null;
  if (year > 2400) year -= 543;
  const hasTime = m[4] != null;
  const [h, min, s] = hasTime ? [+m[4], +m[5], +(m[6] ?? 0)] : [0, 0, 0];
  if (month < 1 || month > 12 || day < 1 || day > 31 || h > 23 || min > 59 || s > 59) return null;
  const local = `${year}-${pad(month)}-${pad(day)}T${pad(h)}:${pad(min)}:${pad(s)}+07:00`;
  const ms = Date.parse(local);
  if (Number.isNaN(ms)) return null;
  // Reject 31/02 etc. (Date rolls them over).
  if (bangkokDayOf(ms) !== `${year}-${pad(month)}-${pad(day)}`) return null;
  return { utc: new Date(ms).toISOString().slice(0, 19).replace("T", " "), hasTime };
}

/**
 * Money text → satang. "1,234.50", "฿1,234.5", "THB 100", "(50.00)" and "-50" work.
 * Returns { blank: true } for an empty cell and null when it cannot be read.
 */
export function parseAmount(value) {
  let text = String(value ?? "").trim();
  if (!text || /^[-–—]$/.test(text)) return { blank: true };
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/฿|THB|บาท/gi, "").replace(/[\s,]/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) text = text.slice(1);
  if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const satang = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return { satang: negative ? -satang : satang };
}

/** Column guess from header names (Thai and English); each column is used once. */
export function guessMapping(headers) {
  const names = headers.map((h) => String(h).trim().toLowerCase());
  const taken = new Set();
  const find = (...patterns) => {
    for (const re of patterns) {
      const i = names.findIndex((h, n) => !taken.has(n) && re.test(h));
      if (i >= 0) {
        taken.add(i);
        return i;
      }
    }
    return null;
  };
  const date = find(/date|วันที่/, /time|เวลา|วัน/);
  const time = find(/^(time|เวลา)$/);
  const fee = find(/fee|ค่าธรรมเนียม/);
  const amount = find(/amount|gross|จำนวนเงิน|ยอด/, /deposit|credit|ฝาก|เงินเข้า/);
  const reference = find(/ref|อ้างอิง/, /transaction|txn|charge|\bid\b|รายการ|รายละเอียด|หมายเหตุ|memo|description/);
  return { date, time, amount, reference, fee };
}

/**
 * Header + data rows → statement rows. Blank or negative amounts (money out on a bank
 * statement) are skipped; unreadable cells are reported per line (line 1 = header).
 */
export function normalizeStatement(table, mapping, { dateOrder = "DMY" } = {}) {
  const rows = [];
  const invalid = [];
  let skipped = 0;
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const line = i + 1;
    const dateText =
      mapping.time != null
        ? String(cells[mapping.date] ?? "").trim() + " " + String(cells[mapping.time] ?? "").trim()
        : cells[mapping.date];
    const date = parseStatementDate(String(dateText ?? "").trim(), dateOrder);
    const amount = parseAmount(cells[mapping.amount]);
    if (amount && amount.blank) {
      skipped++;
      continue;
    }
    if (!date || !amount) {
      invalid.push({ line, error: !date ? "อ่านวันที่ไม่ได้" : "อ่านยอดเงินไม่ได้" });
      continue;
    }
    if (amount.satang <= 0) {
      skipped++;
      continue;
    }
    let fee = 0;
    if (mapping.fee != null) {
      const parsed = parseAmount(cells[mapping.fee]);
      if (!parsed) {
        invalid.push({ line, error: "อ่านค่าธรรมเนียมไม่ได้" });
        continue;
      }
      fee = parsed.blank ? 0 : Math.abs(parsed.satang);
    }
    const reference =
      mapping.reference != null ? String(cells[mapping.reference] ?? "").trim().slice(0, MAX_CELL) || null : null;
    rows.push({ line, at: date.utc, hasTime: date.hasTime, amount: amount.satang, fee, reference });
  }
  return { rows, invalid, skipped };
}

// ------------------------------------------------------------------ matching

const normRef = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
const toMs = (utc) => Date.parse(String(utc).replace(" ", "T") + "Z");
/** Statement amount fits the payment: same gross, or the report shows the net after fee. */
export const amountFits = (row, payment) =>
  row.amount === payment.amount || (row.fee > 0 && row.amount + row.fee === payment.amount);

/**
 * Pure matching. rows: [{ key, at, hasTime, amount, fee, reference }],
 * payments: [{ id, amount, at, refs: string[] }].
 * Returns { matches: [{ key, paymentId, method }], flags: [{ key, note }] }.
 *  1. Reference: exact (case/space-insensitive) to any payment ref, else the statement
 *     reference contains a payment ref of 8+ characters. A second row pointing at an
 *     already matched payment is flagged as a duplicate and left unmatched.
 *  2. Amount + time: same amount (or amount + fee) within ±windowMinutes; a date-only row
 *     matches payments on the same Bangkok day. Closest pairs first; a row that had more
 *     than one candidate is flagged so the admin can check it.
 */
export function matchStatement(rows, payments, { windowMinutes = 30 } = {}) {
  const matches = [];
  const flags = [];
  const usedPayments = new Set();
  const matchedRows = new Set();
  const exact = new Map();
  const containable = [];
  for (const p of payments)
    for (const ref of p.refs ?? []) {
      const key = normRef(ref);
      if (key.length < 4) continue;
      if (!exact.has(key)) exact.set(key, p);
      if (key.length >= 8) containable.push([key, p]);
    }
  for (const row of rows) {
    const ref = normRef(row.reference);
    if (ref.length < 4) continue;
    let payment = exact.get(ref) ?? null;
    if (!payment) payment = containable.find(([key]) => ref.includes(key))?.[1] ?? null;
    if (!payment) continue;
    if (usedPayments.has(payment.id)) {
      const first = matches.find((m) => m.paymentId === payment.id);
      flags.push({ key: row.key, note: "อ้างอิงซ้ำกับแถวที่ " + first.line + " (ไม่จับคู่ซ้ำ)" });
      matchedRows.add(row.key);
      continue;
    }
    usedPayments.add(payment.id);
    matchedRows.add(row.key);
    matches.push({ key: row.key, line: row.line, paymentId: payment.id, method: "REFERENCE" });
  }
  const windowMs = windowMinutes * 60000;
  const byAmount = new Map();
  for (const p of payments) {
    if (usedPayments.has(p.id)) continue;
    if (!byAmount.has(p.amount)) byAmount.set(p.amount, []);
    byAmount.get(p.amount).push(p);
  }
  const pairs = [];
  const candidates = new Map();
  for (const row of rows) {
    if (matchedRows.has(row.key)) continue;
    const pool = [...(byAmount.get(row.amount) ?? [])];
    if (row.fee > 0) pool.push(...(byAmount.get(row.amount + row.fee) ?? []));
    const rowMs = toMs(row.at);
    const rowDay = bangkokDayOf(rowMs);
    let n = 0;
    for (const p of pool) {
      const pMs = toMs(p.at);
      const fits = row.hasTime ? Math.abs(pMs - rowMs) <= windowMs : bangkokDayOf(pMs) === rowDay;
      if (!fits) continue;
      n++;
      pairs.push({ row, payment: p, diff: Math.abs(pMs - rowMs) });
    }
    candidates.set(row.key, n);
  }
  pairs.sort(
    (a, b) =>
      a.diff - b.diff ||
      a.row.line - b.row.line ||
      String(a.payment.at).localeCompare(String(b.payment.at)) ||
      String(a.payment.id).localeCompare(String(b.payment.id)),
  );
  for (const { row, payment } of pairs) {
    if (matchedRows.has(row.key) || usedPayments.has(payment.id)) continue;
    matchedRows.add(row.key);
    usedPayments.add(payment.id);
    matches.push({ key: row.key, line: row.line, paymentId: payment.id, method: "AMOUNT_TIME" });
    if (candidates.get(row.key) > 1)
      flags.push({ key: row.key, note: "พบหลายรายการยอดเท่ากัน เลือกเวลาใกล้สุด กรุณาตรวจ" });
  }
  return { matches, flags };
}

/** Replay decisions → current state { matches: Map(rowId → decision), completed }. */
export function replayDecisions(decisions) {
  const matches = new Map();
  const flags = new Map();
  let completed = null;
  for (const d of decisions) {
    if (d.action === "AUTO_MATCH" || d.action === "MATCH") matches.set(d.row_id, d);
    else if (d.action === "UNMATCH") matches.delete(d.row_id);
    else if (d.action === "AUTO_FLAG") flags.set(d.row_id, d.note);
    else if (d.action === "COMPLETE") completed = d;
  }
  return { matches, flags, completed };
}

// ------------------------------------------------------------------ APIs

const STATUS_TEXT = {
  MATCHED: "ตรงกัน",
  MISMATCH: "ยอดไม่ตรง",
  STATEMENT_ONLY: "เงินเข้าแต่ไม่มีในระบบ",
  SYSTEM_ONLY: "มีในระบบแต่ไม่มีในรายงาน",
};

export function createReconApis({ requireAdmin, one, all, run, tx, fail, clean, clock, moneyScope, bangkokDayRange }) {
  const scope = moneyScope.mode;
  const nowSql = () => new Date(clock()).toISOString().slice(0, 19).replace("T", " ");
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      JSON.stringify(detail),
    );
  const paidAt = "COALESCE(p.finalized_at, p.created_at)";
  const paymentColumns = `p.id, p.amount, p.provider, p.provider_ref, p.idempotency_key,
    COALESCE(p.order_id, p.reservation_id) AS order_id, ${paidAt} AS at, u.name AS customer`;

  function readCsvInput(input) {
    if (typeof input.csv !== "string" || !input.csv.trim()) fail(400, "กรุณาเลือกไฟล์ CSV");
    if (Buffer.byteLength(input.csv, "utf8") > RECON_MAX_BYTES) fail(413, "ไฟล์ใหญ่เกิน 2 MB");
    const table = parseCsv(input.csv);
    if (table.length < 2) fail(400, "ไฟล์ต้องมีหัวตารางและข้อมูลอย่างน้อย 1 แถว");
    if (table.length - 1 > RECON_MAX_ROWS) fail(400, "ไฟล์มีเกิน " + RECON_MAX_ROWS.toLocaleString("en-US") + " แถว");
    if (table[0].length > MAX_COLUMNS) fail(400, "ไฟล์มีคอลัมน์มากเกินไป");
    return table;
  }

  function previewReconciliation(user, input = {}) {
    requireAdmin(user);
    const table = readCsvInput(input);
    const headers = table[0].map((h, i) => String(h).trim().slice(0, 80) || "คอลัมน์ " + (i + 1));
    return {
      headers,
      sample: table.slice(1, 6).map((r) => headers.map((_, i) => String(r[i] ?? "").slice(0, 80))),
      rowCount: table.length - 1,
      guess: guessMapping(headers),
    };
  }

  /** Our SUCCEEDED payments (current scope) paid inside the UTC range. */
  function paymentsBetween(fromUtc, toUtc) {
    return all(
      `SELECT ${paymentColumns} FROM payments p LEFT JOIN users u ON u.id=p.user_id
       WHERE p.status='SUCCEEDED' AND ${moneyScope.payment("p.")}
         AND ${paidAt} >= ? AND ${paidAt} <= ?
       ORDER BY ${paidAt} ASC, p.id ASC`,
      fromUtc,
      toUtc,
    );
  }

  function createReconciliation(user, input = {}) {
    requireAdmin(user);
    const filename = clean(String(input.filename ?? "statement.csv"), 1, 120, "ชื่อไฟล์");
    const table = readCsvInput(input);
    const width = table[0].length;
    const column = (value, label, required) => {
      if (value == null || value === "") {
        if (required) fail(400, "กรุณาเลือกคอลัมน์" + label);
        return null;
      }
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n >= width) fail(400, "คอลัมน์" + label + "ไม่ถูกต้อง");
      return n;
    };
    const m = input.mapping ?? {};
    const mapping = {
      date: column(m.date, "วันที่", true),
      time: column(m.time, "เวลา", false),
      amount: column(m.amount, "ยอดเงิน", true),
      reference: column(m.reference, "เลขอ้างอิง", false),
      fee: column(m.fee, "ค่าธรรมเนียม", false),
    };
    const dateOrder = ["DMY", "MDY"].includes(input.dateOrder) ? input.dateOrder : "DMY";
    const windowMinutes = RECON_WINDOWS.includes(Number(input.windowMinutes)) ? Number(input.windowMinutes) : 30;
    const { rows, invalid, skipped } = normalizeStatement(table, mapping, { dateOrder });
    if (!rows.length)
      fail(400, invalid.length ? "อ่านแถวไม่ได้เลย: แถว " + invalid[0].line + " " + invalid[0].error : "ไม่พบยอดเงินเข้าในไฟล์");
    const days = rows.map((r) => bangkokDayOf(toMs(r.at))).sort();
    const dayFrom = days[0];
    const dayTo = days.at(-1);
    if (Date.parse(dayTo) - Date.parse(dayFrom) > 400 * 86400000) fail(400, "ช่วงวันในไฟล์ยาวเกิน 400 วัน");
    // Candidates one day either side, so a payment at 23:55 can meet a bank row at 00:05.
    const padded = bangkokDayRange(addDays(dayFrom, -1), addDays(dayTo, 1));
    const payments = paymentsBetween(padded.fromUtc, padded.toUtc).map((p) => ({
      ...p,
      refs: [p.provider_ref, p.id, p.order_id, p.idempotency_key].filter(Boolean),
    }));
    const keyed = rows.map((r) => ({ ...r, key: randomUUID() }));
    const result = matchStatement(keyed, payments, { windowMinutes });
    const runId = randomUUID();
    const at = nowSql();
    tx(() => {
      run(
        `INSERT INTO recon_runs(id,scope,filename,mapping,date_order,window_minutes,row_count,skipped_count,
           invalid_count,invalid_samples,day_from,day_to,created_by,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        runId,
        scope,
        filename,
        JSON.stringify({ ...mapping, headers: table[0].map((h) => String(h).slice(0, 80)) }),
        dateOrder,
        windowMinutes,
        rows.length,
        skipped,
        invalid.length,
        JSON.stringify(invalid.slice(0, 20)),
        dayFrom,
        dayTo,
        user.id,
        at,
      );
      for (const r of keyed)
        run(
          "INSERT INTO recon_rows(id,run_id,line,occurred_at,has_time,amount,fee,reference) VALUES(?,?,?,?,?,?,?,?)",
          r.key,
          runId,
          r.line,
          r.at,
          r.hasTime ? 1 : 0,
          r.amount,
          r.fee,
          r.reference,
        );
      for (const mt of result.matches)
        run(
          "INSERT INTO recon_decisions(id,run_id,action,row_id,payment_id,method,note,actor_id,created_at) VALUES(?,?,'AUTO_MATCH',?,?,?,NULL,NULL,?)",
          randomUUID(),
          runId,
          mt.key,
          mt.paymentId,
          mt.method,
          at,
        );
      for (const f of result.flags)
        run(
          "INSERT INTO recon_decisions(id,run_id,action,row_id,payment_id,method,note,actor_id,created_at) VALUES(?,?,'AUTO_FLAG',?,NULL,NULL,?,NULL,?)",
          randomUUID(),
          runId,
          f.key,
          f.note,
          at,
        );
      auditDetail(user, "RECON_RUN", runId, {
        scope,
        filename,
        rows: rows.length,
        matched: result.matches.length,
        invalid: invalid.length,
      });
    });
    return reconciliationDetail(user, runId);
  }

  const loadRun = (id) => {
    const runRow = one(
      "SELECT r.*, u.name AS actor_name FROM recon_runs r LEFT JOIN users u ON u.id=r.created_by WHERE r.id=? AND r.scope=?",
      clean(String(id ?? ""), 1, 80, "รอบกระทบยอด"),
      scope,
    );
    if (!runRow) fail(404, "ไม่พบรอบกระทบยอด");
    return runRow;
  };
  const decisionsOf = (runId) =>
    all(
      `SELECT d.*, u.name AS actor_name FROM recon_decisions d LEFT JOIN users u ON u.id=d.actor_id
       WHERE d.run_id=? ORDER BY d.rowid ASC`,
      runId,
    );

  /** Full state of a run: every row with its status, plus our payments missing from the file. */
  function computeRun(runRow) {
    const rows = all("SELECT * FROM recon_rows WHERE run_id=? ORDER BY line ASC", runRow.id);
    const decisions = decisionsOf(runRow.id);
    const state = replayDecisions(decisions);
    const range = bangkokDayRange(runRow.day_from, runRow.day_to);
    const inRange = paymentsBetween(range.fromUtc, range.toUtc);
    const matchedIds = [...state.matches.values()].map((d) => d.payment_id);
    const known = new Map(inRange.map((p) => [p.id, p]));
    for (const id of matchedIds)
      if (!known.has(id)) {
        const p = one(
          `SELECT ${paymentColumns} FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=?`,
          id,
        );
        if (p) known.set(id, p);
      }
    const used = new Set(matchedIds);
    const paymentView = (p) =>
      p && {
        id: p.id,
        amount: p.amount,
        at: p.at,
        provider: p.provider,
        reference: p.provider_ref,
        orderId: p.order_id,
        customer: p.customer ?? null,
      };
    const items = rows.map((r) => {
      const d = state.matches.get(r.id);
      const payment = d ? known.get(d.payment_id) : null;
      const status = !d ? "STATEMENT_ONLY" : payment && amountFits(r, payment) ? "MATCHED" : "MISMATCH";
      return {
        id: r.id,
        line: r.line,
        at: r.occurred_at,
        hasTime: !!r.has_time,
        amount: r.amount,
        fee: r.fee,
        reference: r.reference,
        status,
        method: d?.method ?? null,
        note: d?.action === "MATCH" ? d.note : null,
        matchedBy: d?.action === "MATCH" ? (d.actor_name ?? null) : null,
        flag: state.flags.get(r.id) ?? null,
        payment: paymentView(payment),
        diff: payment ? r.amount - payment.amount : null,
      };
    });
    const systemOnly = inRange.filter((p) => !used.has(p.id)).map(paymentView);
    const sum = (list) => list.reduce((n, x) => n + x.amount, 0);
    const of = (status) => items.filter((i) => i.status === status);
    const counts = {
      MATCHED: { count: of("MATCHED").length, amount: sum(of("MATCHED")) },
      MISMATCH: { count: of("MISMATCH").length, amount: sum(of("MISMATCH")) },
      STATEMENT_ONLY: { count: of("STATEMENT_ONLY").length, amount: sum(of("STATEMENT_ONLY")) },
      SYSTEM_ONLY: { count: systemOnly.length, amount: sum(systemOnly) },
    };
    const history = decisions
      .filter((d) => ["MATCH", "UNMATCH", "COMPLETE"].includes(d.action))
      .map((d) => ({
        action: d.action,
        line: rows.find((r) => r.id === d.row_id)?.line ?? null,
        paymentId: d.payment_id,
        note: d.note,
        by: d.actor_name ?? null,
        at: d.created_at,
      }));
    return { rows: items, systemOnly, counts, state, history };
  }

  const runView = (runRow, computed) => ({
    id: runRow.id,
    filename: runRow.filename,
    createdAt: runRow.created_at,
    createdBy: runRow.actor_name ?? null,
    dayFrom: runRow.day_from,
    dayTo: runRow.day_to,
    windowMinutes: runRow.window_minutes,
    dateOrder: runRow.date_order,
    rowCount: runRow.row_count,
    skipped: runRow.skipped_count,
    invalid: runRow.invalid_count,
    invalidSamples: JSON.parse(runRow.invalid_samples || "[]"),
    completed: computed.state.completed
      ? {
          at: computed.state.completed.created_at,
          by: computed.state.completed.actor_name ?? null,
          note: computed.state.completed.note,
        }
      : null,
    counts: computed.counts,
  });

  function adminReconciliations(user) {
    requireAdmin(user);
    const runs = all(
      `SELECT r.*, u.name AS actor_name FROM recon_runs r LEFT JOIN users u ON u.id=r.created_by
       WHERE r.scope=? ORDER BY r.created_at DESC, r.rowid DESC LIMIT 50`,
      scope,
    );
    return { runs: runs.map((r) => runView(r, computeRun(r))), mode: scope };
  }

  function reconciliationDetail(user, id, query = {}) {
    requireAdmin(user);
    const runRow = loadRun(id);
    const computed = computeRun(runRow);
    if (String(query.format || "").toLowerCase() === "csv") {
      const baht = (n) => (n == null ? "" : (n / 100).toFixed(2));
      const lines = [
        csvLine([
          "status",
          "line",
          "statement_time",
          "statement_amount",
          "statement_fee",
          "statement_reference",
          "payment_id",
          "order_id",
          "payment_time",
          "payment_amount",
          "difference",
          "method",
          "note",
        ]),
      ];
      for (const r of computed.rows)
        lines.push(
          csvLine([
            STATUS_TEXT[r.status],
            r.line,
            r.at,
            baht(r.amount),
            baht(r.fee),
            r.reference,
            r.payment?.id,
            r.payment?.orderId,
            r.payment?.at,
            baht(r.payment?.amount),
            baht(r.diff),
            r.method,
            r.note ?? r.flag,
          ]),
        );
      for (const p of computed.systemOnly)
        lines.push(
          csvLine([STATUS_TEXT.SYSTEM_ONLY, "", "", "", "", "", p.id, p.orderId, p.at, baht(p.amount), "", "", p.reference]),
        );
      return { csv: lines.join("\n") + "\n" };
    }
    const status = query.status && STATUS_TEXT[query.status] ? query.status : null;
    const rows = status ? computed.rows.filter((r) => r.status === status) : computed.rows;
    const offset = Math.max(0, Number.parseInt(query.offset ?? "0", 10) || 0);
    const limit = 200;
    return {
      run: runView(runRow, computed),
      rows: status === "SYSTEM_ONLY" ? [] : rows.slice(offset, offset + limit),
      total: status === "SYSTEM_ONLY" ? 0 : rows.length,
      offset,
      systemOnly: computed.systemOnly.slice(0, 500),
      history: computed.history,
      mode: scope,
    };
  }

  const openRun = (id) => {
    const runRow = loadRun(id);
    const computed = computeRun(runRow);
    if (computed.state.completed) fail(409, "รอบนี้ปิดงานแล้ว แก้การจับคู่ไม่ได้");
    return { runRow, computed };
  };

  function matchReconRow(user, id, input = {}) {
    requireAdmin(user);
    const rowId = clean(String(input.rowId ?? ""), 1, 80, "แถว");
    const paymentKey = clean(String(input.paymentId ?? ""), 1, 200, "รายการชำระ");
    const note = clean(input.note, 3, 300, "หมายเหตุ");
    return tx(() => {
      const { runRow, computed } = openRun(id);
      const row = computed.rows.find((r) => r.id === rowId);
      if (!row) fail(404, "ไม่พบแถวในรอบนี้");
      if (row.status !== "STATEMENT_ONLY") fail(409, "แถวนี้จับคู่อยู่แล้ว ยกเลิกคู่เดิมก่อน");
      const payment = one(
        `SELECT p.id FROM payments p WHERE p.status='SUCCEEDED' AND ${moneyScope.payment("p.")}
           AND (p.id=? OR p.provider_ref=? OR p.order_id=? OR p.reservation_id=?)
         ORDER BY p.created_at DESC LIMIT 1`,
        paymentKey,
        paymentKey,
        paymentKey,
        paymentKey,
      );
      if (!payment) fail(404, "ไม่พบรายการชำระที่สำเร็จ");
      if (computed.state.matches.size && [...computed.state.matches.values()].some((d) => d.payment_id === payment.id))
        fail(409, "รายการชำระนี้จับคู่กับแถวอื่นแล้ว");
      run(
        "INSERT INTO recon_decisions(id,run_id,action,row_id,payment_id,method,note,actor_id,created_at) VALUES(?,?,'MATCH',?,?,'MANUAL',?,?,?)",
        randomUUID(),
        runRow.id,
        rowId,
        payment.id,
        note,
        user.id,
        nowSql(),
      );
      auditDetail(user, "RECON_MATCH", runRow.id, { line: row.line, paymentId: payment.id, note });
      return { ok: true, paymentId: payment.id };
    });
  }

  function unmatchReconRow(user, id, input = {}) {
    requireAdmin(user);
    const rowId = clean(String(input.rowId ?? ""), 1, 80, "แถว");
    const note = clean(input.note, 3, 300, "หมายเหตุ");
    return tx(() => {
      const { runRow, computed } = openRun(id);
      const row = computed.rows.find((r) => r.id === rowId);
      if (!row) fail(404, "ไม่พบแถวในรอบนี้");
      const current = computed.state.matches.get(rowId);
      if (!current) fail(409, "แถวนี้ยังไม่ได้จับคู่");
      run(
        "INSERT INTO recon_decisions(id,run_id,action,row_id,payment_id,method,note,actor_id,created_at) VALUES(?,?,'UNMATCH',?,?,NULL,?,?,?)",
        randomUUID(),
        runRow.id,
        rowId,
        current.payment_id,
        note,
        user.id,
        nowSql(),
      );
      auditDetail(user, "RECON_UNMATCH", runRow.id, { line: row.line, paymentId: current.payment_id, note });
      return { ok: true };
    });
  }

  function completeReconciliation(user, id, input = {}) {
    requireAdmin(user);
    const note = input.note == null || String(input.note).trim() === "" ? null : clean(input.note, 1, 300, "หมายเหตุ");
    return tx(() => {
      const { runRow, computed } = openRun(id);
      run(
        "INSERT INTO recon_decisions(id,run_id,action,row_id,payment_id,method,note,actor_id,created_at) VALUES(?,?,'COMPLETE',NULL,NULL,NULL,?,?,?)",
        randomUUID(),
        runRow.id,
        note,
        user.id,
        nowSql(),
      );
      auditDetail(user, "RECON_COMPLETE", runRow.id, { counts: computed.counts, note });
      return { ok: true };
    });
  }

  return {
    previewReconciliation,
    createReconciliation,
    adminReconciliations,
    reconciliationDetail,
    matchReconRow,
    unmatchReconRow,
    completeReconciliation,
  };
}
