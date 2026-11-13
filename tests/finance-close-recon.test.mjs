// การเงิน › ปิดยอดรายวัน (daily close), บันทึกการถอนเงิน (withdrawals), กระทบยอด (reconciliation):
// close math across days, changed-after-close + adjustment, append-only triggers, withdrawal
// reversal, matching algorithm, CSV formula escaping, money scope, STAFF 403.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createCommerceCore } from "../server/domain.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import {
  FINANCE_APPEND_ONLY_TRIGGERS,
  addDays,
  bangkokDayOf,
  ensureFinanceBooks,
  maskAccount,
} from "../server/finance-close.mjs";
import { TAX_INVOICE_APPEND_ONLY_TRIGGERS } from "../server/ensure-admin-fr.mjs";
import {
  RECON_MAX_ROWS,
  matchStatement,
  normalizeStatement,
  parseAmount,
  parseCsv,
  parseStatementDate,
  replayDecisions,
} from "../server/finance-recon.mjs";

const PASSWORD = randomBytes(18).toString("hex");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

function fixture(t, extra = {}) {
  const s = createCommerce({ adminPassword: PASSWORD, ...extra });
  t.after(() => s.db.close());
  const adminToken = s.login({ email: "admin@astra.local", password: PASSWORD }).token;
  const admin = s.session(adminToken);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const buyerAuth = s.register({ name: "Close Buyer", email: "close-buyer@example.invalid", password: "Close-buyer-Pass-123" });
  const buyer = s.session(buyerAuth.token);
  const staffAuth = s.register({ name: "Close Staff", email: "close-staff@example.invalid", password: "Close-staff-Pass-123" });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  s.importCodes(admin, {
    variantId: "stream-plus-30",
    items: Array.from({ length: 12 }, (_, i) => ({ loginId: `close-${i}-${randomUUID().slice(0, 6)}@example.invalid`, password: "pw-" + i })),
  });
  const today = bangkokDayOf(Date.now());
  const day = (n) => addDays(today, -n);
  /** Bangkok noon of a day as a UTC SQL timestamp. */
  const noon = (d, hour = 12, minute = 0) =>
    new Date(Date.parse(d + `T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`))
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
  /** Paid order whose payment is moved to the given Bangkok time. */
  const paidOn = (d, hour = 12, minute = 0) => {
    const order = s.createOrder(buyer, { variantId: "stream-plus-30", quantity: 1, requestKey: "close-" + randomUUID() });
    const paid = s.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
    const at = noon(d, hour, minute);
    s.db.prepare("UPDATE payments SET created_at=?, finalized_at=? WHERE order_id=?").run(at, at, order.id);
    return { ...paid, payment: s.db.prepare("SELECT * FROM payments WHERE order_id=?").get(order.id) };
  };
  /** Direct ledger row on a past day (refunds, fees, top-ups the provider would write). */
  const ledgerOn = (d, kind, amount, direction, extraCols = {}) => {
    const net = direction === "out" ? -amount : amount;
    s.db
      .prepare(
        `INSERT INTO ledger(id,user_id,amount,reference,label,kind,direction,fee,net,status,order_id,created_at)
         VALUES(?,?,?,?,?,?,?,0,?,'SUCCEEDED',?,?)`,
      )
      .run(randomUUID(), buyer.id, amount, kind.toLowerCase() + ":" + randomUUID(), kind, kind, direction, net, extraCols.orderId ?? null, noon(d));
  };
  return { s, admin, adminToken, buyer, staff, staffToken: staffAuth.token, today, day, noon, paidOn, ledgerOn };
}
const rowOf = (result, d) => result.days.find((r) => r.day === d);

test("daily close: math across days, chained opening, batch close, changed-after-close and adjustment", (t) => {
  const f = fixture(t);
  const { s, admin, day } = f;
  const [d1, d2, d3] = [day(3), day(2), day(1)];
  const baseline = s.adminFinanceDays(admin, { from: d1, to: f.today });
  const base = rowOf(baseline, d1).opening;
  // Seed data (demo grants / orders) may sit on these days; compare the change.
  const seeded = (d, key) => rowOf(baseline, d)[key];

  const p1 = f.paidOn(d1, 9);
  f.paidOn(d1, 15);
  f.ledgerOn(d1, "TOPUP", 5000, "in");
  f.ledgerOn(d1, "FEE", 300, "out");
  const p3 = f.paidOn(d2, 10);
  f.ledgerOn(d2, "REFUND", 4000, "out", { orderId: p3.id });
  f.ledgerOn(d2, "REFUND", 1000, "in", { orderId: p3.id });
  const price = p1.payment.amount;
  const w = s.recordWithdrawal(admin, {
    amount: 15000,
    day: d2,
    bank: "กสิกรไทย",
    account: "123-4-56789-0",
    reference: "TRF-001",
    requestKey: "wd-" + randomUUID(),
    currentPassword: PASSWORD,
  });
  assert.equal(w.withdrawal.account, "••••7890");

  let view = s.adminFinanceDays(admin, { from: d1, to: f.today });
  const r1 = rowOf(view, d1);
  assert.equal(r1.status, "OPEN");
  assert.equal(r1.paymentsIn - seeded(d1, "paymentsIn"), 2 * price);
  assert.equal(r1.topupsIn, 5000);
  assert.equal(r1.feesOut, 300);
  assert.equal(r1.moneyIn - seeded(d1, "moneyIn"), 2 * price + 5000);
  assert.equal(r1.moneyOut, 300);
  assert.equal(r1.closing, base + seeded(d1, "net") + 2 * price + 5000 - 300);
  assert.equal(r1.closing, r1.opening + r1.moneyIn - r1.moneyOut);
  assert.equal(r1.creditIn - seeded(d1, "creditIn"), 5000, "top-up raises customer credit (liability)");
  const r2 = rowOf(view, d2);
  assert.equal(r2.opening, r1.closing, "next day's opening = previous closing");
  assert.equal(r2.refundsOut, 5000, "both refund directions are money out");
  assert.equal(r2.refundsToCredit, 1000);
  assert.equal(r2.withdrawalsOut, 15000);
  assert.equal(r2.closing, r1.closing + seeded(d2, "net") + price - 5000 - 15000);
  assert.equal(r2.creditIn - seeded(d2, "creditIn"), 1000, "refund to credit is a liability move");
  assert.equal(r2.creditClosing, r2.creditOpening + r2.creditIn - r2.creditOut);
  assert.equal(rowOf(view, d3).creditOpening, r2.creditClosing);
  assert.equal(view.days[0].day, f.today, "newest day first");

  // Closing today is not allowed; STAFF and a wrong password are refused.
  assert.throws(() => s.closeFinanceDay(admin, { day: f.today, currentPassword: PASSWORD }), (e) => e.status === 409);
  assert.throws(() => s.closeFinanceDay(f.staff, { day: d1, currentPassword: PASSWORD }), (e) => e.status === 403);
  assert.throws(() => s.closeFinanceDay(admin, { day: d1, currentPassword: "wrong-password" }), (e) => e.status === 403);
  assert.throws(() => s.closeFinanceDay(admin, { day: "2026-13-01", currentPassword: PASSWORD }), (e) => e.status === 400);

  const first = s.closeFinanceDay(admin, { day: d1, note: "=HYPERLINK(\"http://x\",\"x\")", currentPassword: PASSWORD });
  assert.deepEqual(first.closed.map((c) => c.day), [d1]);
  assert.throws(() => s.closeFinanceDay(admin, { day: d1, currentPassword: PASSWORD }), (e) => e.status === 409);
  // Closing d3 closes the unclosed d2 with it, in order.
  const batch = s.closeFinanceDay(admin, { day: d3, currentPassword: PASSWORD });
  assert.deepEqual(batch.closed.map((c) => c.day), [d2, d3]);
  assert.throws(() => s.closeFinanceDay(admin, { day: d2, currentPassword: PASSWORD }), (e) => e.status === 409);
  view = s.adminFinanceDays(admin, { from: d1, to: f.today });
  assert.equal(rowOf(view, d1).status, "CLOSED");
  assert.equal(rowOf(view, d2).status, "CLOSED");
  assert.equal(rowOf(view, d2).closing, r2.closing);
  assert.equal(rowOf(view, d3).closing, r2.closing + rowOf(view, d3).net, "d3 opens from d2");
  const d3Close = rowOf(view, d3).closing;
  assert.equal(rowOf(view, f.today).opening, d3Close, "today opens from the last close");
  assert.deepEqual(view.summary.changedDays, []);
  assert.equal(view.summary.lastClosed, d3);
  // Closes before the first close cannot take withdrawals.
  assert.throws(
    () =>
      s.recordWithdrawal(admin, {
        amount: 100,
        day: day(5),
        bank: "SCB",
        account: "9999",
        requestKey: "wd-" + randomUUID(),
        currentPassword: PASSWORD,
      }),
    (e) => e.status === 409,
  );

  // A late refund dated d2: the closed day shows the change; nothing is edited.
  f.ledgerOn(d2, "REFUND", 2000, "out", { orderId: p3.id });
  view = s.adminFinanceDays(admin, { from: d1, to: f.today });
  const changed = rowOf(view, d2);
  assert.equal(changed.status, "CHANGED");
  assert.equal(changed.diff, -2000);
  assert.equal(changed.closing, r2.closing, "snapshot closing is kept");
  assert.equal(changed.live.refundsOut, 7000);
  assert.deepEqual(view.summary.changedDays, [d2]);
  // Changed days are reported even when outside the shown range.
  assert.deepEqual(s.adminFinanceDays(admin, { from: f.today, to: f.today }).summary.changedDays, [d2]);

  assert.throws(() => s.adjustFinanceDay(admin, { day: d1, note: "ไม่มีอะไรเปลี่ยน", currentPassword: PASSWORD }), (e) => e.status === 409);
  assert.throws(() => s.adjustFinanceDay(admin, { day: d2, note: "x", currentPassword: PASSWORD }), (e) => e.status === 400);
  const adj = s.adjustFinanceDay(admin, { day: d2, note: "คืนเงินย้อนหลัง ออเดอร์ลูกค้า", currentPassword: PASSWORD });
  assert.equal(adj.delta, -2000);
  view = s.adminFinanceDays(admin, { from: d1, to: f.today });
  assert.equal(rowOf(view, d2).status, "CLOSED");
  assert.equal(rowOf(view, d2).closing, r2.closing - 2000);
  assert.equal(rowOf(view, d2).adjustments.length, 1);
  assert.equal(rowOf(view, d3).carried, -2000, "later closed day carries the adjustment");
  assert.equal(rowOf(view, d3).closing, d3Close - 2000);
  assert.equal(rowOf(view, f.today).opening, d3Close - 2000);

  // Cancelling the d2 withdrawal is a reversal dated d2: the day changes again (+150 THB).
  s.reverseWithdrawal(admin, w.withdrawal.id, { reason: "บันทึกซ้ำ", currentPassword: PASSWORD });
  view = s.adminFinanceDays(admin, { from: d1, to: f.today });
  assert.equal(rowOf(view, d2).status, "CHANGED");
  assert.equal(rowOf(view, d2).diff, 15000);
  assert.equal(rowOf(view, d2).live.withdrawalsOut, 0);

  // CSV export escapes formula cells.
  const csv = s.adminFinanceDays(admin, { from: d1, to: d3, format: "csv" }).csv;
  assert.match(csv, /^day,status,opening/);
  assert.ok(csv.includes("\"'=HYPERLINK"), "note cell neutralised");
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
  assert.ok(csv.includes("ยอดเปลี่ยนหลังปิด"));

  // Audit trail.
  const actions = s.db.prepare("SELECT action FROM audit WHERE action LIKE 'FINANCE_%' OR action LIKE 'WITHDRAWAL_%'").all().map((a) => a.action);
  for (const a of ["FINANCE_DAY_CLOSE", "FINANCE_DAY_ADJUST", "WITHDRAWAL_RECORD", "WITHDRAWAL_REVERSE"]) assert.ok(actions.includes(a), a);
});

test("append-only: new finance tables refuse UPDATE/DELETE; ensure is idempotent; health checks the triggers", (t) => {
  const f = fixture(t);
  const { s, admin, day } = f;
  ensureFinanceBooks(s.db);
  ensureFinanceBooks(s.db);
  s.recordWithdrawal(admin, { amount: 500, day: day(2), bank: "SCB", account: "11112222", requestKey: "wd-" + randomUUID(), currentPassword: PASSWORD });
  s.closeFinanceDay(admin, { day: day(1), currentPassword: PASSWORD });
  const p = f.paidOn(day(1));
  s.createReconciliation(admin, {
    filename: "x.csv",
    csv: "date,amount,ref\n" + day(1) + " 12:00," + (p.payment.amount / 100).toFixed(2) + "," + p.payment.provider_ref + "\n",
    mapping: { date: 0, amount: 1, reference: 2 },
  });
  for (const table of ["finance_day_closes", "finance_withdrawals", "recon_runs", "recon_rows", "recon_decisions"]) {
    assert.ok(s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n > 0, table + " has rows");
    assert.throws(() => s.db.prepare(`UPDATE ${table} SET id=id`).run(), /append-only/, table + " update");
    assert.throws(() => s.db.prepare(`DELETE FROM ${table}`).run(), /append-only/, table + " delete");
  }
  const health = s.adminSystemHealth(admin);
  const check = health.checks.find((c) => c.id === "append_only");
  assert.equal(check.ok, true);
  // + the tax invoice tables (ensureTaxInvoices).
  assert.match(check.detail, new RegExp("ครบ " + (4 + FINANCE_APPEND_ONLY_TRIGGERS.length + TAX_INVOICE_APPEND_ONLY_TRIGGERS.length)));
  s.db.exec("DROP TRIGGER recon_decisions_append_only_delete");
  const broken = s.adminSystemHealth(admin).checks.find((c) => c.id === "append_only");
  assert.equal(broken.ok, false);
  assert.match(broken.detail, /recon_decisions_append_only_delete/);
  ensureFinanceBooks(s.db);
  assert.equal(s.adminSystemHealth(admin).checks.find((c) => c.id === "append_only").ok, true);
});

test("withdrawals: masked account, replay-safe, reversal entry with reason, totals, proof image is admin-only", async (t) => {
  const f = fixture(t);
  const { s, admin, staff, day } = f;
  const input = {
    amount: 250000,
    day: day(4),
    bank: "กรุงเทพ",
    account: "987-6-54321-0",
    reference: "=cmd|'/c calc'!A1",
    note: "ถอนเข้าบัญชีร้าน",
    requestKey: "wd-replay-0001",
    currentPassword: PASSWORD,
  };
  assert.throws(() => s.recordWithdrawal(staff, input), (e) => e.status === 403);
  assert.throws(() => s.recordWithdrawal(admin, { ...input, currentPassword: "nope-nope" }), (e) => e.status === 403);
  assert.throws(() => s.recordWithdrawal(admin, { ...input, amount: 0 }), (e) => e.status === 400);
  assert.throws(() => s.recordWithdrawal(admin, { ...input, account: "12" }), (e) => e.status === 400);
  assert.throws(() => s.recordWithdrawal(admin, { ...input, day: addDays(f.today, 1) }), (e) => e.status === 400);
  assert.throws(() => s.recordWithdrawal(admin, { ...input, proofKey: "../../etc" }), (e) => e.status === 400);
  const first = s.recordWithdrawal(admin, input);
  assert.equal(first.replayed, false);
  assert.equal(s.recordWithdrawal(admin, input).replayed, true, "same request key is a replay");
  assert.throws(() => s.recordWithdrawal(admin, { ...input, amount: 1 }), (e) => e.status === 409);
  const stored = JSON.stringify(s.db.prepare("SELECT * FROM finance_withdrawals").all());
  assert.ok(!stored.includes("54321"), "full account number is never stored");
  s.recordWithdrawal(admin, { ...input, amount: 100000, day: day(3), requestKey: "wd-second-0001" });

  let list = s.adminWithdrawals(admin, {});
  assert.equal(list.withdrawals.length, 2);
  assert.equal(list.summary.withdrawn, 350000);
  assert.equal(list.summary.net, 350000);
  assert.throws(() => s.reverseWithdrawal(admin, first.withdrawal.id, { reason: "x", currentPassword: PASSWORD }), (e) => e.status === 400);
  assert.throws(() => s.reverseWithdrawal(staff, first.withdrawal.id, { reason: "ผิดบัญชี", currentPassword: PASSWORD }), (e) => e.status === 403);
  s.reverseWithdrawal(admin, first.withdrawal.id, { reason: "ผิดบัญชี โอนกลับแล้ว", currentPassword: PASSWORD });
  assert.throws(
    () => s.reverseWithdrawal(admin, first.withdrawal.id, { reason: "ซ้ำอีกรอบ", currentPassword: PASSWORD }),
    (e) => e.status === 409,
  );
  list = s.adminWithdrawals(admin, {});
  assert.equal(list.summary.withdrawn, 350000);
  assert.equal(list.summary.reversed, 250000);
  assert.equal(list.summary.net, 100000);
  const reversed = list.withdrawals.find((w) => w.id === first.withdrawal.id);
  assert.equal(reversed.reversed.reason, "ผิดบัญชี โอนกลับแล้ว");
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM finance_withdrawals").get().n, 3, "reversal is a new row");
  const ranged = s.adminWithdrawals(admin, { from: day(3), to: day(3) });
  assert.equal(ranged.summary.net, 100000);
  assert.ok(list.summary.byMonth.length >= 1);
  const csv = s.adminWithdrawals(admin, { format: "csv" }).csv;
  assert.ok(csv.includes("\"'=cmd|"), "reference cell neutralised");
  assert.ok(!/(^|,)=cmd/m.test(csv));
  assert.ok(csv.includes("ยกเลิกแล้ว"));

  // Proof image: admin upload, admin-only read, never through the public /api/files route.
  await assert.rejects(s.uploadWithdrawalProof(staff, { bytes: PNG, contentType: "image/png" }), (e) => e.status === 403);
  await assert.rejects(s.uploadWithdrawalProof(admin, { bytes: PNG, contentType: "text/plain" }), (e) => e.status === 415);
  const { proofKey } = await s.uploadWithdrawalProof(admin, { bytes: PNG, contentType: "image/png" });
  assert.match(proofKey, /^proof-/);
  const withProof = s.recordWithdrawal(admin, { ...input, amount: 700, day: day(2), proofKey, requestKey: "wd-proof-0001" });
  assert.equal(withProof.withdrawal.hasProof, true);
  const file = await s.withdrawalProof(admin, withProof.withdrawal.id);
  assert.equal(file.mime, "image/png");
  await assert.rejects(s.withdrawalProof(staff, withProof.withdrawal.id), (e) => e.status === 403);
  const handle = createAPIHandler(s);
  const publicFile = await handle(new Request("http://local.test/api/files/" + proofKey));
  assert.equal(publicFile.status, 404, "proof is not public");
  const staffRes = await handle(
    new Request("http://local.test/api/admin/finance/withdrawals/" + withProof.withdrawal.id + "/proof", {
      headers: { Cookie: "astra_session=" + f.staffToken },
    }),
  );
  assert.equal(staffRes.status, 403);
  const adminRes = await handle(
    new Request("http://local.test/api/admin/finance/withdrawals/" + withProof.withdrawal.id + "/proof", {
      headers: { Cookie: "astra_session=" + f.adminToken },
    }),
  );
  assert.equal(adminRes.status, 200);
  assert.match(adminRes.headers.get("Cache-Control"), /no-store/);
  const upload = await handle(
    new Request("http://local.test/api/admin/finance/withdrawals/proof", {
      method: "POST",
      headers: { Cookie: "astra_session=" + f.adminToken, "X-Astra-Request": "1", "Content-Type": "image/png" },
      body: PNG,
    }),
  );
  assert.equal(upload.status, 200);
  assert.match((await upload.json()).proofKey, /^proof-/);
});

test("recon parsing: CSV quotes, Thai/BE dates, amounts, blank and negative rows", () => {
  assert.deepEqual(parseCsv('﻿a;b\n"x;1";"q""z"\r\n\n3;4'), [["a", "b"], ["x;1", 'q"z'], ["3", "4"]]);
  assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseStatementDate("13/11/2569 09:05"), { utc: "2026-11-13 02:05:00", hasTime: true });
  assert.deepEqual(parseStatementDate("2026-11-13"), { utc: "2026-11-12 17:00:00", hasTime: false });
  assert.deepEqual(parseStatementDate("11/13/2026 23:59:59", "MDY"), { utc: "2026-11-13 16:59:59", hasTime: true });
  assert.deepEqual(parseStatementDate("2026-11-13T02:05:00Z"), { utc: "2026-11-13 02:05:00", hasTime: true });
  assert.equal(parseStatementDate("31/02/2026"), null);
  assert.equal(parseStatementDate("yesterday"), null);
  assert.deepEqual(parseAmount("฿1,234.5"), { satang: 123450 });
  assert.deepEqual(parseAmount("(50.00)"), { satang: -5000 });
  assert.deepEqual(parseAmount("THB 100"), { satang: 10000 });
  assert.deepEqual(parseAmount(""), { blank: true });
  assert.deepEqual(parseAmount("-"), { blank: true });
  assert.equal(parseAmount("1.234"), null);
  assert.equal(parseAmount("abc"), null);
  const table = [
    ["วันที่", "ยอด", "ค่าธรรมเนียม", "อ้างอิง"],
    ["13/11/2026 10:00", "100.00", "3.50", "A1"],
    ["13/11/2026 11:00", "-20", "", "OUT"],
    ["13/11/2026 12:00", "", "", "blank"],
    ["bad", "5", "", "x"],
    ["13/11/2026 13:00", "x", "", "y"],
  ];
  const n = normalizeStatement(table, { date: 0, amount: 1, fee: 2, reference: 3 });
  assert.equal(n.rows.length, 1);
  assert.deepEqual(n.rows[0], { line: 2, at: "2026-11-13 03:00:00", hasTime: true, amount: 10000, fee: 350, reference: "A1" });
  assert.equal(n.skipped, 2);
  assert.deepEqual(n.invalid.map((i) => i.line), [5, 6]);
});

test("recon matching: reference first, duplicates, amount + time window, ambiguity, fee, mismatch", () => {
  const P = (id, amount, at, refs = []) => ({ id, amount, at, refs: [id, ...refs] });
  const R = (line, amount, at, reference = null, extra = {}) => ({ key: "r" + line, line, amount, at, hasTime: true, fee: 0, reference, ...extra });
  const payments = [
    P("pay-a", 10000, "2026-11-13 03:00:00", ["prov-AAA111"]),
    P("pay-b", 10000, "2026-11-13 03:10:00", ["prov-BBB222"]),
    P("pay-c", 25000, "2026-11-13 05:00:00", ["prov-CCC333"]),
    P("pay-d", 9900, "2026-11-13 06:00:00", ["prov-DDD444"]),
    P("pay-e", 5000, "2026-11-13 08:00:00", ["prov-EEE555"]),
    P("pay-f", 7000, "2026-11-12 20:00:00", ["prov-FFF666"]),
    P("pay-g", 4000, "2026-11-13 09:00:00", ["order-GGGG7777"]),
  ];
  const rows = [
    R(2, 10000, "2026-11-13 03:20:00", " PROV-bbb222 "), // exact ref (case/space-insensitive), even though pay-a is closer
    R(3, 10000, "2026-11-13 03:25:00", "prov-BBB222"), // duplicate ref → flagged, then not matched by amount either
    R(4, 24000, "2026-11-13 05:00:00", "prov-CCC333"), // ref match with a different amount → mismatch (checked later)
    R(5, 9700, "2026-11-13 06:05:00", null, { fee: 200 }), // amount + fee = payment (net report)
    R(6, 5000, "2026-11-13 09:00:00"), // 60 min away: outside a 30-min window
    R(7, 7000, "2026-11-12 17:00:00", null, { hasTime: false }), // date-only row, same Bangkok day (13th 00:00–) — pay-f is 13th 03:00 BKK
    R(8, 4000, "2026-11-13 12:00:00", "โอนค่าออเดอร์ order-GGGG7777 ครับ"), // reference contains our order id
    R(9, 10000, "2026-11-13 03:05:00"), // amount+time: only pay-a is left
  ];
  const { matches, flags } = matchStatement(rows, payments, { windowMinutes: 30 });
  const byLine = Object.fromEntries(matches.map((m) => [m.line, m]));
  assert.equal(byLine[2].paymentId, "pay-b");
  assert.equal(byLine[2].method, "REFERENCE");
  assert.equal(byLine[3], undefined, "duplicate reference is not matched twice");
  assert.match(flags.find((x) => x.key === "r3").note, /ซ้ำ/);
  assert.equal(byLine[4].paymentId, "pay-c");
  assert.equal(byLine[5].paymentId, "pay-d");
  assert.equal(byLine[5].method, "AMOUNT_TIME");
  assert.equal(byLine[6], undefined, "outside the time window");
  assert.equal(byLine[7].paymentId, "pay-f");
  assert.equal(byLine[8].paymentId, "pay-g");
  assert.equal(byLine[8].method, "REFERENCE");
  assert.equal(byLine[9].paymentId, "pay-a");
  // A wider window picks up row 6.
  assert.equal(matchStatement([rows[4]], payments, { windowMinutes: 60 }).matches[0].paymentId, "pay-e");
  // Two equal payments in the window: closest wins and the row is flagged.
  const twin = matchStatement([R(2, 10000, "2026-11-13 03:04:00")], payments.slice(0, 2), { windowMinutes: 30 });
  assert.equal(twin.matches[0].paymentId, "pay-a");
  assert.match(twin.flags[0].note, /หลายรายการ/);
  // Each payment is used once: two identical bank rows, one payment.
  const dup = matchStatement([R(2, 5000, "2026-11-13 08:00:00"), R(3, 5000, "2026-11-13 08:01:00")], [payments[4]], {});
  assert.equal(dup.matches.length, 1);
  assert.equal(dup.matches[0].line, 2);
  // Replay: latest decision wins; COMPLETE is remembered.
  const state = replayDecisions([
    { action: "AUTO_MATCH", row_id: "r1", payment_id: "p1" },
    { action: "UNMATCH", row_id: "r1" },
    { action: "MATCH", row_id: "r1", payment_id: "p2" },
    { action: "AUTO_FLAG", row_id: "r2", note: "x" },
    { action: "COMPLETE" },
  ]);
  assert.equal(state.matches.get("r1").payment_id, "p2");
  assert.equal(state.flags.get("r2"), "x");
  assert.ok(state.completed);
});

test("recon runs: upload, auto-match, manual match/unmatch with note, complete, CSV escaping, never touches payments", async (t) => {
  const f = fixture(t);
  const { s, admin, staff, day } = f;
  const d = day(1);
  const a = f.paidOn(d, 10, 0);
  const b = f.paidOn(d, 11, 0);
  const c = f.paidOn(d, 14, 0); // will be missing from the statement
  const before = JSON.stringify(s.db.prepare("SELECT * FROM payments ORDER BY id").all()) + JSON.stringify(s.db.prepare("SELECT id,status FROM orders ORDER BY id").all());
  const ledgerBefore = s.db.prepare("SELECT COUNT(*) AS n FROM ledger").get().n;
  const baht = (p) => (p.payment.amount / 100).toFixed(2);
  const [y, m, dd] = d.split("-");
  const csv = [
    "Date,Time,Amount,Fee,Memo",
    `${dd}/${m}/${Number(y) + 543},10:02,"${baht(a)}",0,${a.payment.provider_ref}`,
    `${dd}/${m}/${Number(y) + 543},11:05,${(b.payment.amount / 100 - 1).toFixed(2)},0,=HYPERLINK("http://evil")`,
    `${dd}/${m}/${Number(y) + 543},16:00,999.00,0,unknown deposit`,
    `${dd}/${m}/${Number(y) + 543},16:30,-50.00,0,withdrawal`,
    `oops,,1,0,bad row`,
  ].join("\n");
  assert.throws(() => s.previewReconciliation(staff, { csv }), (e) => e.status === 403);
  const preview = s.previewReconciliation(admin, { csv });
  assert.deepEqual(preview.headers, ["Date", "Time", "Amount", "Fee", "Memo"]);
  assert.equal(preview.rowCount, 5);
  assert.deepEqual(preview.guess, { date: 0, time: 1, amount: 2, reference: 4, fee: 3 });
  assert.throws(
    () => s.createReconciliation(admin, { csv, mapping: { amount: 2 } }),
    (e) => e.status === 400,
    "date column is required",
  );
  const created = s.createReconciliation(admin, {
    filename: "kbank-statement.csv",
    csv,
    mapping: { date: 0, time: 1, amount: 2, fee: 3, reference: 4 },
    windowMinutes: 30,
  });
  const runId = created.run.id;
  assert.equal(created.run.rowCount, 3);
  assert.equal(created.run.skipped, 1, "money-out row skipped");
  assert.equal(created.run.invalid, 1);
  assert.equal(created.run.counts.MATCHED.count, 1);
  assert.equal(created.run.counts.STATEMENT_ONLY.count, 2, "row 3 (amount off by 1 THB) and row 4 are not matched");
  const systemOnly = created.systemOnly.map((p) => p.id);
  assert.ok(systemOnly.includes(b.payment.id) && systemOnly.includes(c.payment.id));
  const matched = created.rows.find((r) => r.status === "MATCHED");
  assert.equal(matched.payment.id, a.payment.id);
  assert.equal(matched.method, "REFERENCE");

  // Manual match with a note; amount differs → shown as ยอดไม่ตรง.
  const row3 = created.rows.find((r) => r.line === 3);
  assert.throws(() => s.matchReconRow(admin, runId, { rowId: row3.id, paymentId: b.payment.id, note: "" }), (e) => e.status === 400);
  assert.throws(() => s.matchReconRow(staff, runId, { rowId: row3.id, paymentId: b.payment.id, note: "ตรวจแล้ว" }), (e) => e.status === 403);
  assert.throws(() => s.matchReconRow(admin, runId, { rowId: row3.id, paymentId: a.payment.id, note: "ซ้ำคู่เดิม" }), (e) => e.status === 409);
  s.matchReconRow(admin, runId, { rowId: row3.id, paymentId: b.payment.id, note: "ลูกค้าโอนขาด 1 บาท" });
  let detail = s.reconciliationDetail(admin, runId);
  assert.equal(detail.run.counts.MISMATCH.count, 1);
  assert.equal(detail.rows.find((r) => r.line === 3).diff, -100);
  assert.equal(detail.rows.find((r) => r.line === 3).note, "ลูกค้าโอนขาด 1 บาท");
  assert.ok(!detail.systemOnly.some((p) => p.id === b.payment.id));
  assert.throws(() => s.matchReconRow(admin, runId, { rowId: row3.id, paymentId: c.payment.id, note: "อีกคู่" }), (e) => e.status === 409);
  // Unmatch the auto match, with a note.
  assert.throws(() => s.unmatchReconRow(admin, runId, { rowId: created.rows.find((r) => r.line === 4).id, note: "ยังไม่จับคู่" }), (e) => e.status === 409);
  s.unmatchReconRow(admin, runId, { rowId: matched.id, note: "อ้างอิงผิด ตรวจใหม่" });
  detail = s.reconciliationDetail(admin, runId);
  assert.equal(detail.run.counts.MATCHED.count, 0);
  assert.ok(detail.systemOnly.some((p) => p.id === a.payment.id));
  assert.deepEqual(detail.history.map((h) => h.action), ["MATCH", "UNMATCH"]);
  // Status filter.
  assert.equal(s.reconciliationDetail(admin, runId, { status: "STATEMENT_ONLY" }).rows.length, 2);

  // CSV export is escaped.
  const out = s.reconciliationDetail(admin, runId, { format: "csv" }).csv;
  assert.ok(out.includes("\"'=HYPERLINK"));
  assert.ok(!/(^|,)=HYPERLINK/m.test(out));
  assert.ok(out.includes("มีในระบบแต่ไม่มีในรายงาน"));

  // Complete: no more changes.
  s.completeReconciliation(admin, runId, { note: "ตรวจครบ" });
  assert.throws(() => s.completeReconciliation(admin, runId, {}), (e) => e.status === 409);
  assert.throws(() => s.matchReconRow(admin, runId, { rowId: matched.id, paymentId: a.payment.id, note: "หลังปิด" }), (e) => e.status === 409);
  const runs = s.adminReconciliations(admin).runs;
  assert.equal(runs[0].completed.note, "ตรวจครบ");

  // Orders, payments and the ledger are untouched by reconciliation.
  const after = JSON.stringify(s.db.prepare("SELECT * FROM payments ORDER BY id").all()) + JSON.stringify(s.db.prepare("SELECT id,status FROM orders ORDER BY id").all());
  assert.equal(after, before);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ledger").get().n, ledgerBefore);

  // Size and row limits, plus the API body limit for a ~2 MB upload.
  assert.throws(() => s.previewReconciliation(admin, { csv: "a,b\n" + "x".repeat(2 * 1024 * 1024) }), (e) => e.status === 413);
  const many = "date,amount\n" + Array.from({ length: RECON_MAX_ROWS + 1 }, () => "2026-11-12,1").join("\n");
  assert.throws(() => s.previewReconciliation(admin, { csv: many }), (e) => e.status === 400);
  const handle = createAPIHandler(s);
  const big = "date,amount,ref\n" + Array.from({ length: 9000 }, (_, i) => `${d} 12:00,1.00,"ref ""${i}"" ${"x".repeat(150)}"`).join("\n");
  assert.ok(big.length > 1_400_000 && big.length < 2 * 1024 * 1024);
  const call = (token, path, body) =>
    handle(
      new Request("http://local.test" + path, {
        method: "POST",
        headers: { Cookie: "astra_session=" + token, "X-Astra-Request": "1", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const res = await call(f.adminToken, "/api/admin/finance/reconciliations/preview", { csv: big });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).rowCount, 9000);
  const staffRes = await call(f.staffToken, "/api/admin/finance/reconciliations/preview", { csv: big });
  assert.equal(staffRes.status, 413, "the larger body limit is for admins only");
  const staffSmall = await call(f.staffToken, "/api/admin/finance/reconciliations/preview", { csv: "a,b\n1,2" });
  assert.equal(staffSmall.status, 403);
  for (const path of ["/api/admin/finance/days", "/api/admin/finance/withdrawals", "/api/admin/finance/reconciliations"]) {
    const r = await handle(new Request("http://local.test" + path, { headers: { Cookie: "astra_session=" + f.staffToken } }));
    assert.equal(r.status, 403, path);
  }
  const csvRes = await handle(
    new Request("http://local.test/api/admin/finance/days?format=csv", { headers: { Cookie: "astra_session=" + f.adminToken } }),
  );
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.headers.get("Content-Type"), /text\/csv/);
});

test("money scope: live mode never sees sandbox closes, withdrawals, runs or sandbox payments", (t) => {
  const f = fixture(t);
  const { s, admin, day } = f;
  const p = f.paidOn(day(1));
  s.recordWithdrawal(admin, { amount: 900, day: day(2), bank: "SCB", account: "55556666", requestKey: "wd-" + randomUUID(), currentPassword: PASSWORD });
  s.closeFinanceDay(admin, { day: day(2), currentPassword: PASSWORD });
  s.createReconciliation(admin, {
    filename: "sandbox.csv",
    csv: "date,amount,ref\n" + day(1) + " 12:00," + (p.payment.amount / 100).toFixed(2) + "," + p.payment.provider_ref,
    mapping: { date: 0, amount: 1, reference: 2 },
  });
  assert.equal(s.adminFinanceDays(admin, {}).summary.mode, "sandbox");
  const live = createCommerceCore({ db: s.db, allowSandbox: false, seed: false });
  const liveAdmin = live.session(f.adminToken);
  const days = live.adminFinanceDays(liveAdmin, { from: day(3), to: f.today });
  assert.equal(days.summary.mode, "live");
  assert.equal(days.summary.lastClosed, null, "sandbox close is not a live close");
  assert.ok(days.days.every((r) => r.status === "OPEN" && r.paymentsIn === 0 && r.withdrawalsOut === 0));
  assert.equal(live.adminWithdrawals(liveAdmin, {}).withdrawals.length, 0);
  assert.equal(live.adminReconciliations(liveAdmin).runs.length, 0);
  const liveRun = live.createReconciliation(liveAdmin, {
    filename: "live.csv",
    csv: "date,amount,ref\n" + day(1) + " 12:00," + (p.payment.amount / 100).toFixed(2) + "," + p.payment.provider_ref,
    mapping: { date: 0, amount: 1, reference: 2 },
  });
  assert.equal(liveRun.run.counts.MATCHED.count, 0, "sandbox payment never matches in live mode");
  assert.equal(liveRun.systemOnly.length, 0);
  assert.throws(() => live.reconciliationDetail(liveAdmin, s.adminReconciliations(admin).runs[0].id), (e) => e.status === 404);
  // Account masking helper.
  assert.equal(maskAccount("xxx-x-x1234-x"), "••••1234");
  assert.equal(maskAccount("12"), null);
});
