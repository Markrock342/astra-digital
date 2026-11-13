// Finance hardening: livemode (S2), one balance formula (S4), CSV escaping (S5),
// refunds (FR-F6), credit adjustments (FR-C7), payment summary, dashboard numbers,
// append-only ledger/audit (S9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createCommerceCore } from "../server/domain.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { csvCell, csvLine, walletRowSql } from "../server/money.mjs";
import { randomUUID } from "node:crypto";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const auth = s.register({
    name: "Money Buyer",
    email: "money-buyer@example.invalid",
    password: "Test-only-Password-123",
  });
  const user = s.session(auth.token);
  const merchantAuth = s.demoMerchant();
  const merchant = s.session(merchantAuth.token);
  const staffAuth = s.register({
    name: "Money Staff",
    email: "money-staff@example.invalid",
    password: "Staff-only-Password-123",
  });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  return { s, user, merchant, staff, token: auth.token, merchantToken: merchantAuth.token, staffToken: staffAuth.token };
}

function buy(s, user, key, variantId = "stream-plus-30") {
  const order = s.createOrder(user, { variantId, quantity: 1, requestKey: key });
  return s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
}

/** Independent re-computation of the wallet: signed net over wallet rows. */
const ledgerSum = (s, userId) =>
  s.db.prepare(`SELECT COALESCE(SUM(net),0) AS n FROM ledger WHERE user_id=? AND ${walletRowSql()}`).get(userId).n;

function assertBalanceInvariant(s, merchant, user) {
  const balance = s.publicUser(user).balance;
  assert.equal(balance, ledgerSum(s, user.id), "balance == SUM(ledger net)");
  assert.equal(s.adminCustomerDetail(merchant, user.id).creditSatang, balance, "admin view == customer view");
  const history = s.ledger(user);
  assert.equal(history[0].balanceAfter, balance, "running balance ends at the balance");
  // Running balance is consistent row by row (newest first).
  for (let i = 0; i < history.length - 1; i++)
    assert.equal(history[i].balanceAfter - history[i].amount, history[i + 1].balanceAfter);
  assert.ok(balance >= 0, "never negative");
  return balance;
}

test("CSV cells starting with = + - @ tab or CR are neutralised", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\",\"a\")"), '"\'=HYPERLINK(""http://x"",""a"")"');
  assert.equal(csvCell("+1"), "\"'+1\"");
  assert.equal(csvCell("-5"), "\"'-5\"");
  assert.equal(csvCell("@cmd"), "\"'@cmd\"");
  assert.equal(csvCell("\tx"), "\"'\tx\"");
  assert.equal(csvCell("\rx"), "\"'\rx\"");
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell(null), "");
  assert.equal(csvLine(["x", "=1"]), "x,\"'=1\"");
});

test("S5: finance and report CSV escape formula cells server-side", async (t) => {
  const { s, merchant, merchantToken } = fixture(t);
  const evil = s.register({
    name: '=HYPERLINK("http://x/?"&A1,"คลิก")',
    email: "evil@example.invalid",
    password: "Evil-only-Password-123",
  });
  const evilUser = s.session(evil.token);
  buy(s, evilUser, "csv-evil-0001");
  s.db.prepare("UPDATE products SET name='=SUM(1+1)' WHERE id='stream-plus'").run();
  const csv = s.adminTransactions(merchant, { format: "csv" }).csv;
  assert.match(csv, /^id,kind,direction/);
  assert.ok(csv.includes("\"'=HYPERLINK"), "customer name is prefixed");
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv), "no raw formula cell");
  const report = s.salesReport(merchant, { format: "csv" }).csv;
  assert.ok(report.includes("\"'=SUM(1+1)\""));
  assert.ok(!/(^|,)=SUM/m.test(report));
  const handle = createAPIHandler(s);
  const res = await handle(
    new Request("http://local.test/api/admin/reports/sales?format=csv", {
      headers: { Cookie: "astra_session=" + merchantToken },
    }),
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /text\/csv/);
});

test("S4: one balance formula; invariant holds after topup, pay, refund and adjust", (t) => {
  const { s, user, merchant } = fixture(t);
  assertBalanceInvariant(s, merchant, user);
  s.topup(user, { amount: 300, requestKey: "inv-topup-0001" });
  assertBalanceInvariant(s, merchant, user);
  const paid = buy(s, user, "inv-pay-0001");
  assertBalanceInvariant(s, merchant, user);
  s.refundOrder(merchant, paid.id, {
    amount: 4000,
    reasonCode: "ACCOUNT_BROKEN",
    destination: "CREDIT",
    requestKey: "inv-refund-0001",
  });
  assertBalanceInvariant(s, merchant, user);
  s.refundOrder(merchant, paid.id, {
    amount: 1000,
    reasonCode: "CUSTOMER_CANCEL",
    destination: "EXTERNAL",
    externalRef: "KBANK-123456",
    requestKey: "inv-refund-0002",
  });
  const afterExternal = assertBalanceInvariant(s, merchant, user);
  s.adjustCustomerCredit(merchant, user.id, { amount: -2500, reason: "แก้ยอดเติมซ้ำ", requestKey: "inv-adjust-0001" });
  assert.equal(assertBalanceInvariant(s, merchant, user), afterExternal - 2500);
  s.adjustCustomerCredit(merchant, user.id, { amount: 700, reason: "ชดเชยความล่าช้า", requestKey: "inv-adjust-0002" });
  const final = assertBalanceInvariant(s, merchant, user);
  // 500 welcome + 300 topup − 100 order + 40 refund to credit − 25 + 7 (external refund leaves the wallet alone).
  assert.equal(final, 50000 + 30000 - paid.total + 4000 - 2500 + 700);
  const types = s.ledger(user).map((l) => l.type);
  for (const type of ["TOPUP", "PURCHASE", "REFUND", "ADJUSTMENT"]) assert.ok(types.includes(type), type);
  const adminTypes = s.adminCustomerDetail(merchant, user.id).ledger.map((l) => l.type);
  assert.deepEqual(adminTypes, types.slice(0, adminTypes.length));
  // Debits never take the wallet below zero.
  assert.throws(
    () => s.adjustCustomerCredit(merchant, user.id, { amount: -(final + 1), reason: "ลองติดลบ", requestKey: "inv-adjust-neg1" }),
    (e) => e.status === 409,
  );
  assert.equal(s.publicUser(user).balance, final);
});

test("FR-F6: partial then full refund of a delivered order", async (t) => {
  const { s, user, merchant, staff, merchantToken, staffToken, token } = fixture(t);
  const paid = buy(s, user, "refund-ready-0001");
  const revenueBefore = s.salesRevenueSatang();
  const body = { amount: 3000, reasonCode: "CUSTOMER_CANCEL", destination: "CREDIT", requestKey: "refund-ready-p1" };
  assert.throws(() => s.refundOrder(staff, paid.id, body), (e) => e.status === 403);
  assert.throws(() => s.refundOrder(user, paid.id, body), (e) => e.status === 403);
  assert.throws(() => s.refundOrder(merchant, paid.id, { ...body, reasonCode: "" }), (e) => e.status === 400);
  assert.throws(() => s.refundOrder(merchant, paid.id, { ...body, reasonCode: "OTHER" }), (e) => e.status === 400);
  assert.throws(() => s.refundOrder(merchant, paid.id, { ...body, destination: "EXTERNAL" }), (e) => e.status === 400);
  assert.throws(() => s.refundOrder(merchant, paid.id, { ...body, amount: paid.total + 1 }), (e) => e.status === 409);
  const balanceBefore = s.publicUser(user).balance;

  const first = s.refundOrder(merchant, paid.id, body);
  assert.equal(first.summary.refunded, 3000);
  assert.equal(first.summary.refundStatus, "PARTIALLY_REFUNDED");
  assert.equal(s.publicUser(user).balance, balanceBefore + 3000);
  // Same request key again: no second ledger row.
  const replay = s.refundOrder(merchant, paid.id, body);
  assert.equal(replay.replayed, true);
  assert.equal(replay.summary.refunded, 3000);
  assert.throws(() => s.refundOrder(merchant, paid.id, { ...body, amount: 2000 }), (e) => e.status === 409);
  assert.equal(s.orderDetail(user, paid.id).refundStatus, "PARTIALLY_REFUNDED");
  assert.equal(s.orderDetail(user, paid.id).credentials.length + s.orderDetail(user, paid.id).codes.length, 1);
  assert.equal(s.salesRevenueSatang(), revenueBefore - 3000);

  // Over the remaining amount is refused; the rest goes through HTTP.
  assert.throws(
    () => s.refundOrder(merchant, paid.id, { ...body, amount: paid.total - 2999, requestKey: "refund-ready-p2x" }),
    (e) => e.status === 409,
  );
  const handle = createAPIHandler(s);
  const post = (cookie, path, payload) =>
    handle(
      new Request("http://local.test" + path, {
        method: "POST",
        headers: { Cookie: "astra_session=" + cookie, "Content-Type": "application/json", "X-Astra-Request": "1" },
        body: JSON.stringify(payload),
      }),
    );
  const rest = { amount: paid.total - 3000, reasonCode: "OTHER", note: "ลูกค้าซื้อผิดแพ็กเกจ", destination: "EXTERNAL", externalRef: "SCB-998877", requestKey: "refund-ready-p2" };
  assert.equal((await post(staffToken, "/api/admin/orders/" + paid.id + "/refund", rest)).status, 403);
  assert.equal((await post(token, "/api/admin/orders/" + paid.id + "/refund", rest)).status, 403);
  const res = await post(merchantToken, "/api/admin/orders/" + paid.id + "/refund", rest);
  assert.equal(res.status, 200);
  const full = (await res.json()).summary;
  assert.equal(full.refundStatus, "REFUNDED");
  assert.equal(full.refundable, 0);
  assert.equal(full.refunds.length, 2);
  assert.equal(full.refunds[1].externalRef, "SCB-998877");
  // External refund does not touch the wallet.
  assert.equal(s.publicUser(user).balance, balanceBefore + 3000);
  assert.equal(s.salesRevenueSatang(), revenueBefore - paid.total);

  // Customer sees REFUNDED; the sold unit is retired and never reused.
  const mine = s.orderDetail(user, paid.id);
  assert.equal(mine.refundStatus, "REFUNDED");
  assert.equal(mine.refundedTotal, paid.total);
  const units = s.db.prepare("SELECT defective,defective_reason FROM inventory WHERE order_id=?").all(paid.id);
  assert.ok(units.length >= 1 && units.every((u) => u.defective === 1));
  assert.ok(s.notifications(user).some((n) => n.kind === "refund"));
  const audits = s.db.prepare("SELECT detail FROM audit WHERE action='ORDER_REFUND' AND entity_id=?").all(paid.id);
  assert.equal(audits.length, 2);
  assert.equal(JSON.parse(audits[1].detail).amount, paid.total - 3000);
  assert.match(JSON.parse(audits[1].detail).reason, /อื่นๆ — ลูกค้าซื้อผิดแพ็กเกจ/);
  assert.throws(
    () => s.refundOrder(merchant, paid.id, { ...body, amount: 1, requestKey: "refund-ready-p3" }),
    (e) => e.status === 409,
  );

  // Admin order detail carries the payment summary; staff does not get money numbers.
  assert.equal(s.adminOrderDetail(merchant, paid.id).paymentSummary.refunded, paid.total);
  assert.equal(s.adminOrderDetail(staff, paid.id).paymentSummary, undefined);
  assert.throws(() => s.adminOrderPaymentSummary(staff, paid.id), (e) => e.status === 403);
});

test("FR-F6: full refund of an undelivered preorder releases the queue; unpaid orders cannot be refunded", (t) => {
  const { s, user, merchant, staff } = fixture(t);
  const preorder = buy(s, user, "refund-pre-0001", "cinema-max-90");
  assert.equal(preorder.status, "PREORDER");
  assert.ok(s.queueBoard(staff).some((q) => q.id === preorder.id));
  const summary = s.adminOrderPaymentSummary(merchant, preorder.id);
  assert.equal(summary.paid, preorder.total);
  const done = s.refundOrder(merchant, preorder.id, {
    amount: preorder.total,
    reasonCode: "CANNOT_DELIVER",
    destination: "CREDIT",
    requestKey: "refund-pre-full",
  });
  assert.equal(done.summary.refundStatus, "REFUNDED");
  assert.ok(!s.queueBoard(staff).some((q) => q.id === preorder.id));
  assert.equal(s.orderDetail(user, preorder.id).refundStatus, "REFUNDED");

  const unpaid = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "refund-unpaid-01" });
  assert.throws(
    () => s.refundOrder(merchant, unpaid.id, { amount: 100, reasonCode: "CUSTOMER_CANCEL", destination: "CREDIT", requestKey: "refund-unpaid-x" }),
    (e) => e.status === 409,
  );
  assert.equal(s.adminOrderPaymentSummary(merchant, unpaid.id).outstanding, unpaid.total);
});

test("FR-C7: credit adjustment needs a reason, has a cap, cannot go below zero, ADMIN only", async (t) => {
  const { s, user, merchant, staff, staffToken, merchantToken } = fixture(t);
  const body = { amount: 1500, reason: "ชดเชยออเดอร์ล่าช้า", requestKey: "adjust-0001-aaaa" };
  assert.throws(() => s.adjustCustomerCredit(staff, user.id, body), (e) => e.status === 403);
  assert.throws(() => s.adjustCustomerCredit(user, user.id, body), (e) => e.status === 403);
  assert.throws(() => s.adjustCustomerCredit(merchant, user.id, { ...body, reason: "" }), (e) => e.status === 400);
  assert.throws(() => s.adjustCustomerCredit(merchant, user.id, { ...body, amount: 0 }), (e) => e.status === 400);
  assert.throws(() => s.adjustCustomerCredit(merchant, user.id, { ...body, amount: 1_000_001 }), (e) => e.status === 400);
  assert.throws(() => s.adjustCustomerCredit(merchant, user.id, { ...body, amount: -1_000_001 }), (e) => e.status === 400);
  assert.throws(() => s.adjustCustomerCredit(merchant, merchant.id, body), (e) => e.status === 404);
  const before = s.publicUser(user).balance;
  assert.throws(
    () => s.adjustCustomerCredit(merchant, user.id, { ...body, amount: -(before + 1), requestKey: "adjust-neg-0001" }),
    (e) => e.status === 409,
  );
  const max = s.adjustCustomerCredit(merchant, user.id, { ...body, amount: 1_000_000, requestKey: "adjust-cap-0001" });
  assert.equal(max.balance, before + 1_000_000);
  const once = s.adjustCustomerCredit(merchant, user.id, body);
  const twice = s.adjustCustomerCredit(merchant, user.id, body);
  assert.equal(twice.replayed, true);
  assert.equal(twice.balance, once.balance);
  const rows = s.db.prepare("SELECT kind,actor_id,reason FROM ledger WHERE reference=?").all("adjust:" + user.id + ":" + body.requestKey);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "ADJUSTMENT");
  assert.equal(rows[0].actor_id, merchant.id);
  const audit = s.db.prepare("SELECT detail FROM audit WHERE action='CREDIT_ADJUST' AND entity_id=? ORDER BY id DESC").get(user.id);
  assert.equal(JSON.parse(audit.detail).amount, 1500);
  assert.equal(s.adminCustomerDetail(merchant, user.id).history[0].action, "CREDIT_ADJUST");
  assert.ok(!s.adminCustomerDetail(staff, user.id).history.some((h) => h.action === "CREDIT_ADJUST"));

  const handle = createAPIHandler(s);
  const call = (cookie) =>
    handle(
      new Request("http://local.test/api/admin/customers/" + user.id + "/credit", {
        method: "POST",
        headers: { Cookie: "astra_session=" + cookie, "Content-Type": "application/json", "X-Astra-Request": "1" },
        body: JSON.stringify({ amount: -100, reason: "แก้ยอดผิด", requestKey: "adjust-http-0001" }),
      }),
    );
  assert.equal((await call(staffToken)).status, 403);
  const ok = await call(merchantToken);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).balance, once.balance - 100);
});

test("STAFF gets 403 on every new money endpoint", async (t) => {
  const { s, user, merchant, staffToken } = fixture(t);
  const paid = buy(s, user, "staff-403-0001");
  const txn = s.adminTransactions(merchant, { limit: 1 }).transactions[0];
  const handle = createAPIHandler(s);
  const get = (path) => handle(new Request("http://local.test" + path, { headers: { Cookie: "astra_session=" + staffToken } }));
  const post = (path, body) =>
    handle(
      new Request("http://local.test" + path, {
        method: "POST",
        headers: { Cookie: "astra_session=" + staffToken, "Content-Type": "application/json", "X-Astra-Request": "1" },
        body: JSON.stringify(body),
      }),
    );
  for (const res of [
    await get("/api/admin/transactions/" + txn.id),
    await get("/api/admin/orders/" + paid.id + "/payment-summary"),
    await get("/api/admin/reports/sales?format=csv"),
    await get("/api/admin/transactions?format=csv"),
    await get("/api/admin/summary"),
    await post("/api/admin/orders/" + paid.id + "/refund", { amount: 100, reasonCode: "CUSTOMER_CANCEL", destination: "CREDIT", requestKey: "staff-403-refund" }),
    await post("/api/admin/customers/" + user.id + "/credit", { amount: 100, reason: "ทดสอบ", requestKey: "staff-403-adjust" }),
  ])
    assert.equal(res.status, 403);
});

test("FR-F5: transaction detail links order, customer, actor and masks provider refs", (t) => {
  const { s, user, merchant } = fixture(t);
  const paid = buy(s, user, "detail-0001");
  s.refundOrder(merchant, paid.id, { amount: 1000, reasonCode: "ACCOUNT_BROKEN", destination: "CREDIT", requestKey: "detail-refund-1" });
  const rows = s.adminTransactions(merchant, { q: paid.id }).transactions;
  const payIn = rows.find((r) => r.kind === "PAYMENT_IN");
  const refund = rows.find((r) => r.kind === "REFUND");
  assert.equal(refund.flow, "out");
  const detail = s.adminTransactionDetail(merchant, payIn.id);
  assert.equal(detail.order.id, paid.id);
  assert.equal(detail.customer.id, user.id);
  assert.equal(detail.payment.provider, "sandbox");
  assert.ok(detail.payment.provider_ref.includes("…"), "long provider refs are masked");
  // Sandbox credit row, shop PAYMENT_IN and the refund all belong to this order.
  assert.deepEqual(detail.related.map((r) => r.kind).sort(), ["DEMO_CREDIT", "PAYMENT_IN", "REFUND"]);
  assert.ok(detail.events.some((e) => e.action === "ORDER_REFUND"));
  assert.equal(detail.transaction.test, true);
  const refundDetail = s.adminTransactionDetail(merchant, refund.id);
  assert.equal(refundDetail.actor.id, merchant.id);
  assert.throws(() => s.adminTransactionDetail(merchant, "missing"), (e) => e.status === 404);
});

test("4.3 dashboard: AOV over paid orders, chart uses the revenue formula, refunds and success rate", (t) => {
  const { s, user, merchant } = fixture(t);
  const a = buy(s, user, "dash-0001");
  buy(s, user, "dash-0002");
  s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "dash-unpaid-1" });
  s.refundOrder(merchant, a.id, { amount: 2000, reasonCode: "CUSTOMER_CANCEL", destination: "CREDIT", requestKey: "dash-refund-1" });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const sum = s.adminSummary(merchant, { from: today, to: today });
  assert.equal(sum.paidOrders, 2);
  assert.equal(sum.refunds, 2000);
  assert.equal(sum.revenue, 2 * a.total - 2000);
  assert.equal(sum.aov, Math.round(sum.revenue / 2));
  assert.equal(sum.orderCount, 3);
  assert.equal(sum.paymentSuccessRate, 2 / 3);
  assert.equal(sum.daily.reduce((n, d) => n + d.revenue, 0), sum.revenue);
  assert.equal(sum.mode, "sandbox");
  assert.equal(sum.customerCredit, s.adminTransactions(merchant, { limit: 1 }).summary.customerCredit);
});

test("S2: test money counts in sandbox mode and is excluded everywhere in live mode", (t) => {
  const { s, user, merchant } = fixture(t);
  const paid = buy(s, user, "live-0001");
  s.refundOrder(merchant, paid.id, { amount: 1000, reasonCode: "CUSTOMER_CANCEL", destination: "CREDIT", requestKey: "live-refund-1" });
  s.adjustCustomerCredit(merchant, user.id, { amount: 500, reason: "ทดสอบ UAT", requestKey: "live-adjust-1" });
  // Sandbox: UAT numbers include the sandbox payment.
  assert.equal(s.salesRevenueSatang(), paid.total - 1000);
  assert.equal(s.adminSummary(merchant).revenue, paid.total - 1000);
  assert.equal(s.salesReport(merchant).totals.revenue, paid.total);
  assert.ok(s.adminTransactions(merchant).summary.in >= paid.total);
  assert.ok(s.adminSummary(merchant).customerCredit > 0);

  // One real (non-sandbox) payment recorded by a future provider.
  const realOrder = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "live-real-01" });
  const paymentId = randomUUID();
  s.db.prepare("UPDATE orders SET status='DELIVERED' WHERE id=?").run(realOrder.id);
  s.db
    .prepare(
      "INSERT INTO payments(id,order_id,user_id,amount,currency,status,provider,provider_ref,idempotency_key,finalized_at) VALUES(?,?,?,?,'THB','SUCCEEDED','gateway','gw_123',?,CURRENT_TIMESTAMP)",
    )
    .run(paymentId, realOrder.id, user.id, realOrder.total, "gw:" + paymentId);
  s.db
    .prepare(
      "INSERT INTO ledger(id,user_id,amount,reference,label,kind,direction,fee,net,status,order_id,payment_id,provider_ref,finalized_at) VALUES(?,?,?,?,?,'PAYMENT_IN','in',0,?,'SUCCEEDED',?,?,'gw_123',CURRENT_TIMESTAMP)",
    )
    .run(randomUUID(), user.id, realOrder.total, "payment-in:" + paymentId, "รับชำระ", realOrder.total, realOrder.id, paymentId);

  // Same database, shop switched to live mode (the template cleanup already ran).
  s.db.prepare("INSERT OR IGNORE INTO runtime_flags(key,value) VALUES('template-ready','1')").run();
  const live = createCommerceCore({ db: s.db, allowSandbox: false, seed: false });
  const admin = live.session(s.demoMerchant().token);
  assert.equal(live.mode, "live");
  assert.equal(live.salesRevenueSatang(), realOrder.total);
  const summary = live.adminSummary(admin);
  assert.equal(summary.revenue, realOrder.total);
  assert.equal(summary.refunds, 0);
  assert.equal(summary.paidOrders, 1);
  assert.equal(summary.mode, "live");
  assert.equal(summary.customerCredit, 0, "test credit is not a real liability");
  assert.equal(live.salesReport(admin).totals.revenue, realOrder.total);
  const txns = live.adminTransactions(admin, { limit: 100 });
  assert.deepEqual(txns.transactions.map((r) => r.kind), ["PAYMENT_IN"]);
  assert.equal(txns.summary.in, realOrder.total);
  assert.equal(txns.summary.out, 0);
  assert.equal(live.adminTransactions(admin, { kind: "DEMO_CREDIT" }).transactions.length, 0);
  const csv = live.adminTransactions(admin, { format: "csv" }).csv.trim().split("\n");
  assert.equal(csv.length, 2);
  assert.ok(!csv.join("\n").includes("sandbox"));
  // Buyer ranking and customer spend count only the real payment.
  const ranked = live.buyerRanking(admin).find((r) => r.email === "money-buyer@example.invalid");
  assert.equal(ranked.spentSatang, realOrder.total);
  assert.equal(live.adminCustomerDetail(admin, user.id).spentSatang, realOrder.total);
  assert.ok(s.buyerRanking(merchant).find((r) => r.email === "money-buyer@example.invalid").spentSatang > realOrder.total);
  const sandboxRow = s.adminTransactions(merchant, { kind: "PAYMENT_IN" }).transactions.find((r) => r.order_id === paid.id);
  assert.throws(() => live.adminTransactionDetail(admin, sandboxRow.id), (e) => e.status === 404);
});

test("S9: ledger and audit rows cannot be updated or deleted; demo cleanup still works", (t) => {
  const { s, user } = fixture(t);
  buy(s, user, "immutable-0001");
  assert.throws(() => s.db.prepare("UPDATE ledger SET amount=1").run(), /append-only/);
  assert.throws(() => s.db.prepare("UPDATE ledger SET status='REFUNDED'").run(), /append-only/);
  assert.throws(() => s.db.prepare("DELETE FROM ledger").run(), /append-only/);
  assert.throws(() => s.db.prepare("UPDATE audit SET action='X'").run(), /append-only/);
  assert.throws(() => s.db.prepare("DELETE FROM audit").run(), /append-only/);
  // Switching the shop off test mode runs the one-time demo cleanup that deletes demo rows.
  const ledgerBefore = s.db.prepare("SELECT COUNT(*) AS n FROM ledger").get().n;
  const live = createCommerceCore({ db: s.db, allowSandbox: false, seed: false });
  assert.equal(live.mode, "live");
  assert.ok(s.db.prepare("SELECT COUNT(*) AS n FROM ledger").get().n < ledgerBefore);
  const triggers = s.db
    // ledger/audit only (finance-close.mjs tables have their own append-only triggers).
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%append_only%' AND (name LIKE 'ledger_%' OR name LIKE 'audit_%')")
    .all()
    .map((r) => r.name)
    .sort();
  assert.deepEqual(triggers, [
    "audit_append_only_delete",
    "audit_append_only_update",
    "ledger_append_only_delete",
    "ledger_append_only_update",
  ]);
  const real = live.register({ name: "Real Buyer", email: "real@shop.test", password: "Real-only-Password-123" });
  s.db
    .prepare("INSERT INTO ledger(id,user_id,amount,reference,label,kind,direction,fee,net) VALUES(?,?,100,'x-1','x','ADJUSTMENT','in',0,100)")
    .run(randomUUID(), real.user.id);
  assert.throws(() => s.db.prepare("DELETE FROM ledger").run(), /append-only/);
});

test("S9 on workerd: Durable Object SQLite enforces the append-only triggers", { timeout: 120000 }, async (t) => {
  const { Miniflare, convertV4MiniflareOptions } = await import("miniflare");
  const { build } = await import("esbuild");
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = mkdtempSync(join(tmpdir(), "astra-do-triggers-"));
  let mf;
  t.after(async () => {
    await mf?.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
  const server = fileURLToPath(new URL("../server/", import.meta.url));
  const entry = join(dir, "entry.mjs");
  writeFileSync(
    entry,
    `import { DurableObject } from "cloudflare:workers";
import { createDoSqliteAdapter } from ${JSON.stringify(server + "do-sqlite-adapter.mjs")};
import { ensureAppendOnlyMoney, dropAppendOnlyMoney } from ${JSON.stringify(server + "ensure-admin-fr.mjs")};
export class Probe extends DurableObject {
  async fetch() {
    const db = createDoSqliteAdapter(this.ctx.storage.sql);
    const tx = (fn) => this.ctx.storage.transactionSync(fn);
    const out = {};
    const attempt = (name, fn) => { try { fn(); out[name] = "allowed"; } catch (e) { out[name] = String(e.message); } };
    tx(() => {
      db.exec("CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY, amount INTEGER, status TEXT)");
      db.exec("CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT)");
      ensureAppendOnlyMoney(db);
      ensureAppendOnlyMoney(db);
    });
    db.prepare("INSERT INTO ledger VALUES(?,?,?)").run("a", 1, "SUCCEEDED");
    db.prepare("INSERT INTO audit(action) VALUES(?)").run("X");
    attempt("updateLedger", () => db.prepare("UPDATE ledger SET status='REFUNDED'").run());
    attempt("deleteLedger", () => db.prepare("DELETE FROM ledger").run());
    attempt("updateAudit", () => db.prepare("UPDATE audit SET action='Y'").run());
    attempt("deleteAudit", () => db.prepare("DELETE FROM audit").run());
    attempt("cleanup", () => tx(() => {
      dropAppendOnlyMoney(db);
      db.prepare("DELETE FROM ledger").run();
      ensureAppendOnlyMoney(db);
    }));
    out.rowsAfterCleanup = db.prepare("SELECT COUNT(*) AS n FROM ledger").get().n;
    db.prepare("INSERT INTO ledger VALUES(?,?,?)").run("b", 2, "SUCCEEDED");
    attempt("deleteAfterCleanup", () => db.prepare("DELETE FROM ledger").run());
    out.triggers = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n;
    return Response.json(out);
  }
}
export default { fetch: () => new Response("ok") };
`,
  );
  const script = (
    await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", external: ["cloudflare:workers", "node:*"] })
  ).outputFiles[0].text;
  mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "astra-do-append-only",
      modules: true,
      script,
      compatibilityDate: "2026-10-01",
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { PROBE: { className: "Probe", useSQLite: true } },
      cf: false,
    }),
    resourcePersistencePath: dir,
  });
  const ns = await mf.getDurableObjectNamespace("PROBE");
  const out = await (await ns.get(ns.idFromName("p")).fetch("http://probe/")).json();
  for (const name of ["updateLedger", "deleteLedger", "updateAudit", "deleteAudit", "deleteAfterCleanup"])
    assert.match(out[name], /append-only/, name);
  assert.equal(out.cleanup, "allowed");
  assert.equal(out.rowsAfterCleanup, 0);
  assert.equal(out.triggers, 4);
});
