// Preorder modes (server/preorder.mjs): full (unchanged) / deposit / free, calling the queue
// as stock arrives, holding units, paying the balance, lapses with the deposit policy,
// cancels, limits, locked price, closed shop, finance "มัดจำค้าง", tax invoice amount.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { depositFor, sqlTime } from "../server/preorder.mjs";
import { SHOP_CLOSED_ORDER, SHOP_CLOSED_PAY } from "../server/domain.mjs";

const HOUR = 3600 * 1000;
const status = (code) => (e) => e.status === code;
const COMPANY = {
  legalName: "บริษัท พรีออเดอร์ ทดสอบ จำกัด",
  taxId: "0105556123453",
  branch: "HEAD",
  address: "99/1 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110",
  phone: "02-123-4567",
  email: "billing@example.invalid",
  footerNote: "",
  vatRegistered: true,
};
const BUYER = {
  type: "COMPANY",
  name: "บริษัท ผู้ซื้อ จำกัด",
  taxId: "0105561000003",
  branch: "HEAD",
  address: "1 ถนนพระราม 4 แขวงสีลม เขตบางรัก กรุงเทพฯ 10500",
};

function fixture(t, { mode = "deposit", price = 10000, settings = {} } = {}) {
  let now = Date.parse("2026-11-13T03:00:00Z");
  const s = createCommerce({ allowDemoAdmin: true, clock: () => now });
  t.after(() => s.db.close());
  const admin = s.session(s.demoMerchant().token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const product = s.saveProduct(admin, {
    name: "Deposit Stream",
    description: "สินค้าพรีออเดอร์แบบมัดจำ",
    category: "streaming",
    price,
    active: true,
    preorder: true,
    firstLabel: "1 เดือน",
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  if (mode !== "full")
    s.adminSavePreorderSettings(admin, product.id, {
      mode,
      depositType: "percent",
      depositValue: 30,
      payWindowHours: 24,
      lapsePolicy: "refund_credit",
      ...settings,
    });
  let n = 0;
  const buyer = (credit = 50000) => {
    n++;
    const auth = s.register({ name: "Buyer " + n, email: `pre-buyer-${n}@example.invalid`, password: "Preorder-buyer-Pass-" + n });
    const user = s.session(auth.token);
    if (credit) s.adjustCustomerCredit(admin, user.id, { amount: credit, reason: "ทดสอบพรีออเดอร์", requestKey: randomUUID() });
    user.start = s.publicUser(user).balance;
    return user;
  };
  const reserve = (user, quantity = 1) =>
    s.createOrder(user, { variantId, quantity, requestKey: randomUUID() });
  const payNow = (user, order) => s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  const payBalance = (user, id) => {
    const token = s.retry(user, id).paymentToken;
    return s.pay(user, id, { paymentToken: token, outcome: "success" });
  };
  let unit = 0;
  const importUnits = (count) =>
    s.importCodes(admin, {
      variantId,
      items: Array.from({ length: count }, () => ({ loginId: "pre-unit-" + ++unit + "@x.test", password: "pw-" + unit })),
    });
  const reservation = (id) => s.db.prepare("SELECT * FROM reservations WHERE id=?").get(id);
  const held = (id) =>
    s.db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE reservation_id=? AND sold_at IS NULL").get(id).n;
  // Credit spent (−) or got back (+) since the buyer was created.
  const balanceOf = (user) => s.publicUser(user).balance - user.start;
  const advance = (ms) => {
    now += ms;
  };
  return { s, admin, product, variantId, buyer, reserve, payNow, payBalance, importUnits, reservation, held, balanceOf, advance, now: () => now };
}

test("deposit math: percent rounds half up to the satang, fixed per unit, capped at 90%", () => {
  assert.equal(depositFor({ depositType: "percent", depositValue: 30 }, 10000, 1), 3000);
  assert.equal(depositFor({ depositType: "percent", depositValue: 33 }, 9999, 1), 3300); // 3299.67
  assert.equal(depositFor({ depositType: "percent", depositValue: 25 }, 1002, 1), 251); // 250.5 → 251
  assert.equal(depositFor({ depositType: "percent", depositValue: 1 }, 149, 1), 1); // 1.49 → 1
  assert.equal(depositFor({ depositType: "fixed", depositValue: 2000 }, 30000, 3), 6000);
  // A fixed deposit can never swallow the price (sale price / coupon lowered the total).
  assert.equal(depositFor({ depositType: "fixed", depositValue: 9500 }, 10000, 1), 9000);
  assert.equal(depositFor({ depositType: "percent", depositValue: 50 }, 0, 1), 0);
});

test("settings: ADMIN only, preorder products only, values validated, audited", (t) => {
  const { s, admin, product, buyer } = fixture(t, { mode: "full" });
  const customer = buyer(0);
  assert.equal(s.adminPreorderSettings(admin, product.id).settings.mode, "full");
  assert.throws(() => s.adminSavePreorderSettings(customer, product.id, { mode: "free" }), status(403));
  const bad = [
    { mode: "later" },
    { mode: "deposit", depositType: "percent", depositValue: 0, lapsePolicy: "keep" },
    { mode: "deposit", depositType: "percent", depositValue: 91, lapsePolicy: "keep" },
    { mode: "deposit", depositType: "fixed", depositValue: 10000, lapsePolicy: "keep" }, // = price
    { mode: "deposit", depositType: "fixed", depositValue: 0, lapsePolicy: "keep" },
    { mode: "deposit", depositType: "percent", depositValue: 30, lapsePolicy: "maybe" },
    { mode: "free", payWindowHours: 0 },
    { mode: "free", payWindowHours: 169 },
    { mode: "free", payWindowHours: 24, maxPerCustomer: 0 },
  ];
  for (const input of bad) assert.throws(() => s.adminSavePreorderSettings(admin, product.id, input), status(400), JSON.stringify(input));
  const saved = s.adminSavePreorderSettings(admin, product.id, {
    mode: "deposit",
    depositType: "fixed",
    depositValue: 2500,
    payWindowHours: 48,
    lapsePolicy: "keep",
    maxPerCustomer: "2",
    queueLimit: "",
  });
  assert.deepEqual(saved.settings, {
    mode: "deposit",
    depositType: "fixed",
    depositValue: 2500,
    payWindowHours: 48,
    lapsePolicy: "keep",
    maxPerCustomer: 2,
    queueLimit: null,
  });
  const audit = s.db.prepare("SELECT detail FROM audit WHERE action='PRODUCT_PREORDER_SETTINGS' ORDER BY rowid DESC").get();
  assert.equal(JSON.parse(audit.detail).changed.mode.to, "deposit");
  // Storefront shows the terms before reserving.
  const terms = s.productDetail(product.id).preorderTerms;
  assert.deepEqual(
    [terms.mode, terms.depositType, terms.depositValue, terms.payWindowHours, terms.lapsePolicy],
    ["deposit", "fixed", 2500, 48, "keep"],
  );
  // Ready-stock products cannot take a preorder mode.
  const ready = s.saveProduct(admin, { name: "Ready Stream", description: "พร้อมส่ง", category: "streaming", price: 5000, active: true, firstLabel: "1 เดือน" });
  assert.throws(() => s.adminSavePreorderSettings(admin, ready.id, { mode: "free" }), status(409));
  assert.equal(s.productDetail(ready.id).preorderTerms, null);
});

test("deposit flow: deposit → queue → stock import calls → balance → delivered with the held unit", (t) => {
  const { s, admin, buyer, reserve, payNow, payBalance, importUnits, reservation, held, balanceOf, variantId } = fixture(t);
  const user = buyer(50000);
  const order = reserve(user);
  assert.equal(order.status, "PENDING_PAYMENT");
  assert.equal(order.preorderMode, "deposit");
  assert.equal(order.amountDue, 3000);
  assert.ok(order.paymentToken);
  const paid = payNow(user, order);
  assert.equal(paid.status, "PREORDER");
  assert.equal(paid.stage, "queued");
  assert.equal(paid.depositPaid, 3000);
  assert.equal(paid.balanceDue, 7000);
  assert.ok(paid.queueNumber > 0);
  assert.equal(balanceOf(user), -3000);
  const deposit = s.db.prepare("SELECT * FROM payments WHERE reservation_id=?").all(order.id);
  assert.deepEqual(deposit.map((p) => [p.purpose, p.amount, p.status]), [["deposit", 3000, "SUCCEEDED"]]);
  // Finance: the deposit is money in, and shows as มัดจำค้าง until delivery.
  assert.equal(s.adminSummary(admin).depositsHeld, 3000);
  assert.equal(s.adminTransactions(admin, { limit: "1" }).summary.depositsHeld, 3000);
  const grossBefore = s.adminSummary(admin).gross;
  // Nothing to pay while queued.
  assert.throws(() => s.retry(user, order.id), status(409));
  // Stock arrives: the queue is called automatically and one unit is held.
  const imported = importUnits(1);
  assert.equal(imported.preorderCalled, 1);
  const called = s.orderDetail(user, order.id);
  assert.equal(called.stage, "called");
  assert.equal(called.amountDue, 7000);
  assert.equal(called.payBy, sqlTime(Date.parse(called.calledAt.replace(" ", "T") + "Z") + 24 * 3600 * 1000));
  assert.equal(held(order.id), 1);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND kind='preorder_called'").get(user.id).n, 1);
  // Nobody else can take the held unit (a full-mode deliver of another reservation fails).
  const free = s.db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL").get(variantId).n;
  assert.equal(free, 0);
  // Balance: delivered with the held unit, credentials for the owner.
  const done = payBalance(user, order.id);
  assert.equal(done.status, "DELIVERED");
  assert.equal(done.credentials.length, 1);
  assert.equal(done.credentials[0].loginId, "pre-unit-1@x.test");
  assert.equal(held(order.id), 0);
  assert.equal(reservation(order.id).stage, "delivered");
  assert.equal(balanceOf(user), -10000);
  const payments = s.db.prepare("SELECT purpose,amount FROM payments WHERE reservation_id=? ORDER BY rowid").all(order.id);
  assert.deepEqual(payments.map((p) => [p.purpose, p.amount]), [["deposit", 3000], ["balance", 7000]]);
  // Not double counted: gross grew by the balance only; nothing left as มัดจำค้าง.
  const summary = s.adminSummary(admin);
  assert.equal(summary.gross - grossBefore, 7000);
  assert.equal(summary.depositsHeld, 0);
  // Sales report: one order, one unit, revenue = total.
  const report = s.salesReport(admin);
  const line = report.byProduct.find((r) => r.variant_id === variantId);
  assert.deepEqual([line.orders, line.units, line.revenue], [1, 1, 10000]);
  // Paying again is a no-op.
  assert.equal(s.pay(user, order.id, { paymentToken: "x", outcome: "success" }).status, "DELIVERED");
});

test("calling: N = sellable units, queue order, quantity never skipped; admin button calls the rest", (t) => {
  const { s, admin, buyer, reserve, payNow, importUnits, reservation, held } = fixture(t);
  const users = [buyer(), buyer(), buyer()];
  const orders = users.map((u, i) => payNow(u, reserve(u, i === 1 ? 2 : 1)));
  // Two units: #1 (1 unit) is called; #2 wants 2 → only 1 left, stop (no skipping to #3).
  importUnits(2);
  assert.deepEqual(orders.map((o) => reservation(o.id).stage), ["called", "queued", "queued"]);
  assert.equal(held(orders[0].id), 1);
  // Staff "เรียกคิว" with nothing new: nobody else called.
  assert.equal(s.adminCallPreorders(admin, {}).called, 0);
  // One more unit: #2 now fits (2 units), #3 still waits.
  importUnits(1);
  assert.deepEqual(orders.map((o) => reservation(o.id).stage), ["called", "called", "queued"]);
  assert.equal(held(orders[1].id), 2);
  // Units added outside an import (e.g. restored): the admin button calls #3.
  s.db.prepare("INSERT INTO inventory(id,variant_id,fingerprint,login_id_enc,password_enc) SELECT ?,variant_id,?,login_id_enc,password_enc FROM inventory WHERE reservation_id=? LIMIT 1")
    .run(randomUUID(), "fp-" + randomUUID(), orders[0].id);
  const result = s.adminCallPreorders(admin, {});
  assert.equal(result.called, 1);
  assert.equal(reservation(orders[2].id).stage, "called");
});

test("paid-in-full reservations of the same option keep their units", (t) => {
  const { s, admin, product, buyer, reserve, payNow, importUnits, reservation } = fixture(t, { mode: "full" });
  const fullBuyer = buyer();
  const full = payNow(fullBuyer, reserve(fullBuyer));
  assert.equal(full.status, "PREORDER");
  assert.equal(full.preorderMode, "full");
  assert.equal(full.stage ?? null, null);
  s.adminSavePreorderSettings(admin, product.id, { mode: "free", payWindowHours: 24 });
  const freeBuyer = buyer();
  const free = reserve(freeBuyer);
  assert.equal(free.status, "PREORDER");
  importUnits(1);
  // The only unit belongs to the full-mode reservation ahead: free one stays queued.
  assert.equal(reservation(free.id).stage, "queued");
  // Staff deliver the full-mode one as before; deposit / free rows refuse manual delivery.
  assert.equal(s.deliverReservation(admin, full.id).status, "DELIVERED");
  assert.throws(() => s.deliverReservation(admin, free.id), status(409));
  importUnits(1);
  assert.equal(reservation(free.id).stage, "called");
});

test("lapse with refund_credit: unit released, deposit back as a REFUND row, next called", (t) => {
  const { s, admin, buyer, reserve, payNow, importUnits, reservation, held, balanceOf, advance } = fixture(t);
  const [a, b] = [buyer(), buyer()];
  const first = payNow(a, reserve(a));
  const second = payNow(b, reserve(b));
  importUnits(1);
  assert.equal(reservation(first.id).stage, "called");
  // ~2 hours before the deadline: one reminder (only once).
  advance(22.5 * HOUR);
  assert.equal(s.sweepPreorders().reminded, 1);
  assert.equal(s.sweepPreorders().reminded, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND kind='preorder_reminder'").get(a.id).n, 1);
  advance(2 * HOUR);
  const tick = s.sweepPreorders();
  assert.equal(tick.lapsed, 1);
  const lapsed = s.orderDetail(a, first.id);
  assert.equal(lapsed.status, "CANCELLED");
  assert.equal(lapsed.stage, "lapsed");
  assert.equal(lapsed.refundedTotal, 3000);
  assert.equal(held(first.id), 0);
  assert.equal(balanceOf(a), 0);
  const refund = s.db.prepare("SELECT kind,direction,amount FROM ledger WHERE order_id=? AND kind='REFUND'").all(first.id);
  assert.deepEqual(refund.map((r) => [r.kind, r.direction, r.amount]), [["REFUND", "in", 3000]]);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND kind='preorder_lapsed'").get(a.id).n, 1);
  // Next in queue gets the released unit.
  assert.equal(reservation(second.id).stage, "called");
  assert.equal(held(second.id), 1);
  // Too late to pay.
  assert.throws(() => s.pay(a, first.id, { paymentToken: "x", outcome: "success" }), status(409));
  assert.equal(s.adminSummary(admin).depositsHeld, 3000);
});

test("lapse with keep: deposit stays with the shop; customer was told before reserving", (t) => {
  const { s, buyer, reserve, payNow, importUnits, reservation, balanceOf, advance, product } = fixture(t, {
    settings: { lapsePolicy: "keep", payWindowHours: 2 },
  });
  assert.equal(s.productDetail(product.id).preorderTerms.lapsePolicy, "keep");
  const a = buyer();
  const order = payNow(a, reserve(a));
  assert.equal(order.lapsePolicy, "keep");
  importUnits(1);
  // A 2-hour window: the call itself is the reminder (no second notice).
  advance(1.5 * HOUR);
  assert.equal(s.sweepPreorders().reminded, 0);
  advance(1 * HOUR);
  assert.equal(s.sweepPreorders().lapsed, 1);
  assert.equal(reservation(order.id).stage, "lapsed");
  assert.equal(balanceOf(a), -3000);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE order_id=? AND kind='REFUND'").get(order.id).n, 0);
  const note = s.db.prepare("SELECT body FROM notifications WHERE user_id=? AND kind='preorder_lapsed'").get(a.id);
  assert.match(note.body, /ร้านเก็บมัดจำ ฿30\.00/);
});

test("free mode: queue number without paying, one per customer, pay full price when called, lapse calls next", (t) => {
  const { s, admin, buyer, reserve, payBalance, importUnits, reservation, held, balanceOf, advance, product } = fixture(t, {
    mode: "free",
    settings: { payWindowHours: 6, queueLimit: 3 },
  });
  const [a, b, c, d] = [buyer(), buyer(), buyer(), buyer()];
  const first = reserve(a);
  assert.equal(first.status, "PREORDER");
  assert.equal(first.stage, "queued");
  assert.equal(first.paymentToken, null);
  assert.ok(first.queueNumber);
  assert.equal(balanceOf(a), 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM payments WHERE reservation_id=?").get(first.id).n, 0);
  // Default limit for free mode: one open reservation per customer per product.
  assert.throws(() => reserve(a), (e) => e.status === 409 && /สูงสุด 1 คิว/.test(e.message));
  const second = reserve(b);
  reserve(c);
  // Queue limit 3.
  assert.throws(() => reserve(d), (e) => e.status === 409 && /เต็ม/.test(e.message));
  importUnits(1);
  assert.equal(reservation(first.id).stage, "called");
  assert.equal(s.orderDetail(a, first.id).amountDue, 10000);
  // a does not pay: lapse → b called; free mode has nothing to refund.
  advance(7 * HOUR);
  assert.equal(s.sweepPreorders().lapsed, 1);
  assert.equal(reservation(first.id).stage, "lapsed");
  assert.equal(reservation(second.id).stage, "called");
  assert.equal(held(second.id), 1);
  const done = payBalance(b, second.id);
  assert.equal(done.status, "DELIVERED");
  assert.equal(done.credentials.length, 1);
  assert.equal(balanceOf(b), -10000);
  // a may reserve again now (the lapsed one is closed).
  assert.equal(reserve(a).status, "PREORDER");
  assert.equal(s.adminPreorderSettings(admin, product.id).open, 2);
});

test("cancel: customer while queued (per policy), not once called; admin refunds in full and calls next", (t) => {
  const { s, admin, buyer, reserve, payNow, importUnits, reservation, held, balanceOf } = fixture(t, {
    settings: { lapsePolicy: "keep" },
  });
  const [a, b, c] = [buyer(), buyer(), buyer()];
  const first = payNow(a, reserve(a));
  const second = payNow(b, reserve(b));
  const third = payNow(c, reserve(c));
  // Customer cancel while queued, policy keep → deposit kept.
  const left = s.cancelMyPreorder(c, third.id, { reason: "เปลี่ยนใจ" });
  assert.deepEqual([left.status, left.refunded, left.kept], ["CANCELLED", 0, 3000]);
  assert.equal(reservation(third.id).stage, "cancelled");
  assert.equal(balanceOf(c), -3000);
  assert.throws(() => s.cancelMyPreorder(c, third.id), status(409));
  assert.throws(() => s.cancelMyPreorder(b, first.id), status(404));
  importUnits(1);
  assert.equal(reservation(first.id).stage, "called");
  assert.throws(() => s.cancelMyPreorder(a, first.id), status(409));
  // Shop cancel: ADMIN only, needs a reason, full deposit refund even under "keep".
  const staffAuth = s.register({ name: "Queue Staff", email: "queue-staff@example.invalid", password: "Queue-staff-Pass-123" });
  s.db.prepare("UPDATE users SET role='STAFF' WHERE id=?").run(staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  assert.throws(() => s.adminCancelPreorder(staff, first.id, { reason: "ของมีปัญหา" }), status(403));
  assert.throws(() => s.adminCancelPreorder(admin, first.id, { reason: "" }), status(400));
  const cancelled = s.adminCancelPreorder(admin, first.id, { reason: "สินค้ามีปัญหา" });
  assert.equal(cancelled.refunded, 3000);
  assert.equal(cancelled.calledNext, 1);
  assert.equal(reservation(first.id).stage, "shop_cancelled");
  assert.equal(held(first.id), 0);
  assert.equal(balanceOf(a), 0);
  assert.equal(reservation(second.id).stage, "called");
  const actions = s.db.prepare("SELECT action FROM audit WHERE action LIKE 'PREORDER_CANCEL%' ORDER BY rowid").all().map((r) => r.action);
  assert.deepEqual(actions, ["PREORDER_CANCEL_CUSTOMER", "PREORDER_CANCEL_SHOP"]);
  // Staff "เรียกคิว" is allowed (operational, no money).
  assert.equal(s.adminCallPreorders(staff, {}).called, 0);
  // Existing refund flow on a called reservation also releases the held unit.
  s.refundOrder(admin, second.id, { amount: 3000, reasonCode: "CANNOT_DELIVER", destination: "CREDIT", requestKey: "refund-called-0001" });
  assert.equal(reservation(second.id).status, "CANCELLED");
  assert.equal(held(second.id), 0);
});

test("price locked at reservation: a later price change never changes deposit or balance", (t) => {
  const { s, admin, buyer, reserve, payNow, payBalance, importUnits, variantId } = fixture(t);
  const a = buyer();
  const order = payNow(a, reserve(a));
  s.updateVariant(admin, variantId, { price: 25000 });
  importUnits(1);
  const detail = s.orderDetail(a, order.id);
  assert.deepEqual([detail.total, detail.depositPaid, detail.amountDue], [10000, 3000, 7000]);
  assert.equal(payBalance(a, order.id).total, 10000);
  assert.equal(s.publicUser(a).balance - a.start, -10000);
});

test("closed shop: no reserving or paying; deadlines do not lapse and move later by the closed time", (t) => {
  const { s, admin, buyer, reserve, payNow, importUnits, reservation, advance } = fixture(t);
  const a = buyer();
  const order = payNow(a, reserve(a));
  importUnits(1);
  const payBy = reservation(order.id).pay_by;
  advance(10 * HOUR);
  s.saveSettings(admin, { shopOpen: false });
  assert.throws(() => reserve(buyer()), (e) => e.status === 409 && e.message === SHOP_CLOSED_ORDER);
  const token = s.retry(a, order.id).paymentToken;
  assert.throws(() => s.pay(a, order.id, { paymentToken: token, outcome: "success" }), (e) => e.status === 409 && e.message === SHOP_CLOSED_PAY);
  // Past the original deadline while closed: nothing lapses, no reminder.
  advance(30 * HOUR);
  assert.deepEqual(s.sweepPreorders(), { reminded: 0, lapsed: 0, called: 0 });
  assert.equal(reservation(order.id).stage, "called");
  // Reopen: pay_by moves later by the 30 closed hours.
  s.saveSettings(admin, { shopOpen: true });
  const moved = reservation(order.id).pay_by;
  assert.equal(Date.parse(moved.replace(" ", "T") + "Z") - Date.parse(payBy.replace(" ", "T") + "Z"), 30 * HOUR);
  assert.equal(s.sweepPreorders().lapsed, 0);
  const paid = s.pay(a, order.id, { paymentToken: s.retry(a, order.id).paymentToken, outcome: "success" });
  assert.equal(paid.status, "DELIVERED");
});

test("full mode unchanged: pay in full → queue → staff deliver; no stage, no deposit", (t) => {
  const { s, admin, buyer, reserve, payNow, importUnits } = fixture(t, { mode: "full" });
  const a = buyer();
  const order = reserve(a);
  assert.equal(order.amountDue, 10000);
  const paid = payNow(a, order);
  assert.equal(paid.status, "PREORDER");
  assert.equal(s.db.prepare("SELECT purpose FROM payments WHERE reservation_id=?").get(order.id).purpose, null);
  importUnits(1);
  assert.equal(s.db.prepare("SELECT stage FROM reservations WHERE id=?").get(order.id).stage, null);
  assert.equal(s.deliverReservation(admin, order.id).status, "DELIVERED");
  assert.equal(s.orderDetail(a, order.id).credentials.length, 1);
  assert.equal(s.adminSummary(admin).depositsHeld, 0);
});

test("tax invoice of a delivered deposit preorder is on the full locked price", (t) => {
  const { s, admin, buyer, reserve, payNow, payBalance, importUnits } = fixture(t, { price: 10700 });
  s.adminSaveReceiptSettings(admin, COMPANY);
  const a = buyer();
  const order = payNow(a, reserve(a));
  assert.throws(() => s.requestTaxInvoice(a, order.id, BUYER), status(409));
  importUnits(1);
  payBalance(a, order.id);
  s.requestTaxInvoice(a, order.id, BUYER);
  const issued = s.adminIssueTaxInvoice(admin, order.id);
  const row = s.db.prepare("SELECT total,vat,net,subtotal FROM tax_invoices WHERE id=?").get(issued.invoice.id);
  assert.deepEqual([row.subtotal, row.total, row.vat, row.net], [10700, 10700, 700, 10000]);
});

test("HTTP: settings, call and cancel routes; the lazy order sweep lapses past deadlines", async (t) => {
  const { s, admin, product, variantId, importUnits, reservation, advance } = fixture(t, { mode: "full" });
  const handle = createAPIHandler(s);
  const adminToken = s.demoMerchant().token;
  const call = async (method, path, token, body) => {
    const response = await handle(
      new Request("http://127.0.0.1" + path, {
        method,
        headers: {
          ...(token ? { Cookie: "astra_session=" + token } : {}),
          "Content-Type": "application/json",
          "X-Astra-Request": "1",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, data: await response.json() };
  };
  const saved = await call("PATCH", "/api/admin/products/" + product.id + "/preorder", adminToken, {
    mode: "deposit",
    depositType: "percent",
    depositValue: 20,
    payWindowHours: 12,
    lapsePolicy: "refund_credit",
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal((await call("GET", "/api/admin/products/" + product.id + "/preorder", adminToken)).data.settings.depositValue, 20);
  const customer = (n) => {
    const auth = s.register({ name: "Http Buyer " + n, email: `http-pre-${n}@example.invalid`, password: "Http-preorder-Pass-" + n });
    const user = s.session(auth.token);
    s.adjustCustomerCredit(admin, user.id, { amount: 20000, reason: "ทดสอบ", requestKey: randomUUID() });
    return { token: auth.token, user };
  };
  const a = customer(1);
  const b = customer(2);
  assert.equal((await call("PATCH", "/api/admin/products/" + product.id + "/preorder", a.token, { mode: "free" })).status, 403);
  assert.equal((await call("POST", "/api/admin/preorders/call", a.token, {})).status, 403);
  const reserveVia = async (who) => {
    const created = await call("POST", "/api/orders", who.token, { variantId, quantity: 1, requestKey: randomUUID() });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.amountDue, 2000);
    const paid = await call("POST", "/api/orders/" + created.data.id + "/pay", who.token, {
      paymentToken: created.data.paymentToken,
      outcome: "success",
    });
    assert.equal(paid.data.stage, "queued");
    return created.data.id;
  };
  const first = await reserveVia(a);
  const second = await reserveVia(b);
  assert.equal((await call("POST", "/api/orders/" + second + "/cancel", a.token, {})).status, 404);
  // Customer cancel route while queued (policy refund_credit → deposit back).
  const c = customer(3);
  const third = await reserveVia(c);
  const left = await call("POST", "/api/orders/" + third + "/cancel", c.token, { reason: "ไม่เอาแล้ว" });
  assert.equal(left.status, 200, JSON.stringify(left.data));
  assert.equal(left.data.refunded, 2000);
  importUnits(1);
  assert.equal(reservation(first).stage, "called");
  assert.equal((await call("POST", "/api/admin/preorders/call", adminToken, {})).data.called, 0);
  // Past the deadline: any order read runs the sweep (at most once a minute) and lapses it.
  advance(13 * HOUR);
  s.db.prepare("DELETE FROM runtime_flags WHERE key='pending-expiry-sweep'").run();
  const seen = await call("GET", "/api/orders/" + first, a.token);
  assert.equal(seen.data.status, "CANCELLED");
  assert.equal(seen.data.stage, "lapsed");
  assert.equal(seen.data.refundedTotal, 2000);
  assert.equal(reservation(second).stage, "called");
  // Staff sessions are 12 h at most: sign in again after the clock jump.
  const freshAdmin = s.demoMerchant().token;
  const shopCancel = await call("POST", "/api/admin/preorders/" + second + "/cancel", freshAdmin, { reason: "ทดสอบยกเลิก" });
  assert.equal(shopCancel.status, 200, JSON.stringify(shopCancel.data));
  assert.equal(shopCancel.data.refunded, 2000);
  const queue = (await call("GET", "/api/queue", freshAdmin)).data.queue;
  const rows = queue.filter((r) => [first, second].includes(r.id)).map((r) => r.mode + ":" + r.stage).sort();
  assert.deepEqual(rows, ["deposit:lapsed", "deposit:shop_cancelled"]);
});
