// Back-office orders for customers who paid outside the site (server/manual-orders.mjs):
// permissions + password, idempotency, stock races, preorder queue, reports / finance /
// dashboard inclusion, test-money scope, no wallet change, price override rules, coupon,
// FEFO + warranty snapshot, slip upload, markers on every order view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { walletRowSql } from "../server/money.mjs";
import { emailVerificationOff } from "./fixtures/email-verification-off.mjs";

const ADMIN_PASSWORD = "manual-admin-pass-" + randomBytes(6).toString("hex");
const BUYER_PASSWORD = "Manual-buyer-Password-123";
let keySeq = 0;
const key = () => "manual-test-" + String(++keySeq).padStart(6, "0");

function fixture(t, options = {}) {
  const s = emailVerificationOff(createCommerce({ adminPassword: ADMIN_PASSWORD, ...options }));
  t.after(() => s.db.close());
  // Demo catalog: make every seeded product buyable so tests can pick any option.
  s.db.prepare("UPDATE products SET hidden_seed=0").run();
  const admin = s.session(s.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token);
  const buyerAuth = s.register({ name: "Manual Buyer", email: "manual-buyer@example.invalid", password: BUYER_PASSWORD });
  const buyer = s.session(buyerAuth.token);
  const staffAuth = s.register({ name: "Manual Staff", email: "manual-staff@example.invalid", password: "Staff-only-Password-123" });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  const create = (input = {}, user = admin) =>
    s.adminCreateManualOrder(user, {
      customerId: buyer.id,
      variantId: "stream-plus-30",
      quantity: 1,
      requestKey: key(),
      reference: "KBANK-REF-001",
      currentPassword: ADMIN_PASSWORD,
      ...input,
    });
  return { s, admin, buyer, staff, buyerToken: buyerAuth.token, staffToken: staffAuth.token, create };
}

const status = (fn) => {
  try {
    fn();
    return 200;
  } catch (error) {
    return error.status ?? 500;
  }
};
const count = (s, sql, ...params) => s.db.prepare(sql).get(...params).n;
const available = (s, variantId) =>
  count(
    s,
    "SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0",
    variantId,
  );
/** Leave exactly `n` sellable units of a variant (the others are marked defective). */
function keepStock(s, variantId, n) {
  const ids = s.db
    .prepare(
      "SELECT id FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0 ORDER BY rowid",
    )
    .all(variantId)
    .map((r) => r.id);
  for (const id of ids.slice(n)) s.db.prepare("UPDATE inventory SET defective=1 WHERE id=?").run(id);
  assert.equal(available(s, variantId), n);
}
const walletRows = (s, userId) =>
  s.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(net),0) AS sum FROM ledger WHERE user_id=? AND ${walletRowSql()}`).get(userId);

function http(s) {
  const handle = createAPIHandler(s);
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const response = await handle(
      new Request("http://127.0.0.1" + path, {
        method,
        headers: {
          ...(method === "GET" ? {} : { "X-Astra-Request": "1" }),
          ...(body !== undefined && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Cookie: "astra_session=" + token } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
      }),
    );
    const type = response.headers.get("Content-Type") ?? "";
    return { status: response.status, headers: response.headers, body: type.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer()) };
  };
  return call;
}
const tinyPng = () =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]);

test("only an ADMIN with the right password can create; nothing is written otherwise", (t) => {
  const { s, admin, buyer, staff, create } = fixture(t);
  const orders = () => count(s, "SELECT COUNT(*) AS n FROM orders WHERE user_id=?", buyer.id);
  const before = orders();
  assert.equal(status(() => create({}, null)), 401);
  assert.equal(status(() => create({}, buyer)), 403);
  assert.equal(status(() => create({}, staff)), 403);
  assert.equal(status(() => create({ currentPassword: undefined })), 403);
  assert.equal(status(() => create({ currentPassword: "wrong-password-123" })), 403);
  assert.equal(status(() => s.adminManualOrderQuote(staff, { customerId: buyer.id, variantId: "stream-plus-30", quantity: 1 })), 403);
  assert.equal(orders(), before);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM manual_orders"), 0);
  // The failed password attempt is recorded (lockout counts it) even though nothing else is.
  assert.ok(count(s, "SELECT COUNT(*) AS n FROM audit WHERE user_id=? AND action='REAUTH_FAILED'", admin.id) >= 1);
  const ok = create();
  assert.equal(ok.order.status, "DELIVERED");
  assert.equal(orders(), before + 1);
  const audit = s.db.prepare("SELECT * FROM audit WHERE action='MANUAL_ORDER_CREATE' AND entity_id=?").get(ok.order.id);
  assert.equal(audit.user_id, admin.id);
  const detail = JSON.parse(audit.detail);
  assert.equal(detail.customerId, buyer.id);
  assert.equal(detail.method, "OFFSITE_TRANSFER");
  assert.equal(detail.reference, "KBANK-REF-001");
});

test("required fields: reference, customer must be an active customer, product must exist", (t) => {
  const { s, admin, staff, buyer, create } = fixture(t);
  assert.equal(status(() => create({ reference: "" })), 400);
  assert.equal(status(() => create({ method: "CARD" })), 400);
  assert.equal(status(() => create({ quantity: 0 })), 400);
  assert.equal(status(() => create({ quantity: 11 })), 400);
  assert.equal(status(() => create({ customerId: staff.id })), 404, "staff accounts are not customers");
  assert.equal(status(() => create({ customerId: admin.id })), 404);
  assert.equal(status(() => create({ variantId: "no-such-variant" })), 404);
  s.db.prepare("UPDATE users SET status='SUSPENDED' WHERE id=?").run(buyer.id);
  assert.equal(status(() => create()), 409);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM manual_orders"), 0);
});

test("idempotency: the same request key returns the first order, a different payload is refused", (t) => {
  const { s, buyer, create } = fixture(t);
  const requestKey = key();
  const first = create({ requestKey, quantity: 2 });
  const again = create({ requestKey, quantity: 2 });
  assert.equal(first.replayed, false);
  assert.equal(again.replayed, true);
  assert.equal(again.order.id, first.order.id);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM manual_orders WHERE request_key=?", requestKey), 1);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM payments WHERE order_id=?", first.order.id), 1);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM ledger WHERE order_id=? AND kind='PAYMENT_IN'", first.order.id), 1);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM inventory WHERE order_id=?", first.order.id), 2);
  assert.equal(status(() => create({ requestKey, quantity: 1 })), 409);
  assert.equal(status(() => create({ requestKey, quantity: 2, unitPrice: 5000, priceReason: "ลูกค้าประจำ" })), 409);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND request_key LIKE 'manual:%'", buyer.id), 1);
});

test("double click over HTTP creates one order", async (t) => {
  const { s, buyer } = fixture(t);
  const call = http(s);
  const adminToken = s.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token;
  const body = {
    customerId: buyer.id,
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: key(),
    reference: "LINE slip 0042",
    currentPassword: ADMIN_PASSWORD,
  };
  const [a, b] = await Promise.all([
    call("POST", "/api/admin/manual-orders", { token: adminToken, body }),
    call("POST", "/api/admin/manual-orders", { token: adminToken, body }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.body.order.id, b.body.order.id);
  assert.deepEqual([a.body.replayed, b.body.replayed].sort(), [false, true]);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM manual_orders"), 1);
  // Anonymous and customer calls are refused by the same route.
  assert.equal((await call("POST", "/api/admin/manual-orders", { body: { ...body, requestKey: key() } })).status, 401);
  const buyerToken = s.login({ email: "manual-buyer@example.invalid", password: BUYER_PASSWORD }).token;
  assert.equal((await call("POST", "/api/admin/manual-orders", { token: buyerToken, body: { ...body, requestKey: key() } })).status, 403);
  const quote = await call("POST", "/api/admin/manual-orders/quote", { token: adminToken, body });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.total, 10000);
});

test("stock: refuse when short, the last unit is sold once, a waiting storefront order gets OUT_OF_STOCK", (t) => {
  const { s, buyer, create } = fixture(t);
  s.setPaymentChannel(s.session(s.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token), {
    provider: "sandbox",
    active: true,
  });
  keepStock(s, "screen-club-30", 1);
  const writes = () => [
    count(s, "SELECT COUNT(*) AS n FROM orders"),
    count(s, "SELECT COUNT(*) AS n FROM payments"),
    count(s, "SELECT COUNT(*) AS n FROM ledger"),
    count(s, "SELECT COUNT(*) AS n FROM manual_orders"),
  ];
  const before = writes();
  assert.equal(status(() => create({ variantId: "screen-club-30", quantity: 2 })), 409);
  assert.deepEqual(writes(), before, "a refused order leaves no rows behind");
  // A customer has an unpaid order for the same last unit (unpaid orders hold no stock).
  const pending = s.createOrder(buyer, { variantId: "screen-club-30", quantity: 1, requestKey: key() });
  const sold = create({ variantId: "screen-club-30" });
  assert.equal(sold.order.status, "DELIVERED");
  assert.equal(available(s, "screen-club-30"), 0);
  // Second admin attempt for the same unit: refused, not oversold.
  assert.equal(status(() => create({ variantId: "screen-club-30" })), 409);
  s.topup(buyer, { amount: 300, requestKey: key() });
  const paid = s.pay(buyer, pending.id, { paymentToken: pending.paymentToken, outcome: "success" });
  assert.equal(paid.status, "OUT_OF_STOCK");
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM inventory WHERE order_id=?", sold.order.id), 1);
});

test("preorder product: creates a paid queue entry, staff delivers it later", (t) => {
  const { s, admin, buyer, create } = fixture(t);
  s.db.prepare("UPDATE products SET preorder=1 WHERE id='screen-club'").run();
  const result = create({ variantId: "screen-club-30", quantity: 2 });
  assert.equal(result.order.preorder, true);
  assert.equal(result.order.status, "PREORDER");
  assert.ok(result.order.queueNumber >= 1);
  const row = s.db.prepare("SELECT * FROM reservations WHERE id=?").get(result.order.id);
  assert.equal(row.total, 14900 * 2);
  const payment = s.db.prepare("SELECT * FROM payments WHERE reservation_id=?").get(result.order.id);
  assert.equal(payment.status, "SUCCEEDED");
  assert.equal(payment.amount, 14900 * 2);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM ledger WHERE order_id=? AND kind='PAYMENT_IN'", result.order.id), 1);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM inventory WHERE reservation_id=?", result.order.id), 0, "no stock taken yet");
  const queue = s.myQueue(buyer);
  assert.ok(JSON.stringify(queue).includes(result.order.id));
  const notes = s.notifications(buyer).map((n) => n.kind);
  assert.ok(notes.includes("preorder_queue"));
  const delivered = s.deliverReservation(admin, result.order.id);
  assert.equal(delivered.status, "DELIVERED");
  const mine = s.orderDetail(buyer, result.order.id);
  assert.equal(mine.codes.length + mine.credentials.length, 2);
  assert.equal(mine.createdByAdmin, true);
  // The free preorder variant (price 0) needs a real price with a reason.
  assert.equal(status(() => create({ variantId: "cinema-max-30" })), 400);
  const priced = create({ variantId: "cinema-max-30", unitPrice: 12900, priceReason: "ลูกค้าโอนราคาเต็มมาแล้ว" });
  assert.equal(priced.order.total, 12900);
});

test("money: counted in dashboard, reports and finance like a paid order; wallet untouched", (t) => {
  const { s, admin, buyer, create } = fixture(t);
  const wallet = walletRows(s, buyer.id);
  const balance = s.publicUser(buyer).balance;
  const summary = s.adminSummary(admin);
  const overview = s.adminOverview(admin);
  const sales = s.salesReport(admin);
  const txns = s.adminTransactions(admin, {});
  const made = create({ quantity: 2 });
  const id = made.order.id;
  assert.deepEqual(walletRows(s, buyer.id), wallet, "no wallet row added");
  assert.equal(s.publicUser(buyer).balance, balance);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM ledger WHERE order_id=? AND kind IN ('DEMO_CREDIT','PURCHASE')", id), 0);
  const summaryAfter = s.adminSummary(admin);
  assert.equal(summaryAfter.revenue - summary.revenue, 20000);
  assert.equal(summaryAfter.paidOrders - summary.paidOrders, 1);
  assert.equal(summaryAfter.customerCredit, summary.customerCredit, "credit liability unchanged");
  const overviewAfter = s.adminOverview(admin);
  assert.equal(overviewAfter.revenue - overview.revenue, 20000);
  assert.equal(overviewAfter.delivered - overview.delivered, 2);
  const recent = overviewAfter.orders.find((o) => o.id === id);
  assert.equal(recent.createdByAdmin, true);
  const salesAfter = s.salesReport(admin);
  assert.equal(salesAfter.totals.revenue - sales.totals.revenue, 20000);
  assert.equal(salesAfter.totals.units - sales.totals.units, 2);
  const txnsAfter = s.adminTransactions(admin, {});
  assert.ok(txnsAfter.transactions.length > txns.transactions.length);
  const paymentIn = txnsAfter.transactions.find((x) => x.order_id === id);
  assert.ok(paymentIn, "PAYMENT_IN row listed in finance");
  assert.equal(paymentIn.kind, "PAYMENT_IN");
  assert.match(paymentIn.label, /โอนนอกเว็บ/);
  const detail = s.adminTransactionDetail(admin, paymentIn.id);
  assert.equal(detail.actor.id, admin.id);
  assert.equal(detail.order.id, id);
  // Test mode: scoped like every other test payment.
  const payment = s.db.prepare("SELECT * FROM payments WHERE order_id=?").get(id);
  assert.equal(payment.provider, "sandbox");
  assert.equal(payment.provider_ref, "sandbox:offsite:" + id);
  assert.equal(detail.transaction.test, true);
  assert.equal(s.db.prepare("SELECT test FROM manual_orders WHERE id=?").get(id).test, 1);
  // Admin payment summary for the order: fully paid, refundable.
  const money = s.adminOrderPaymentSummary(admin, id);
  assert.equal(money.paid, 20000);
  assert.equal(money.outstanding, 0);
  assert.equal(money.refundable, 20000);
});

test("live mode: off-site money is real money (counted), refundable outside the system", (t) => {
  const { s, admin, buyer, create } = fixture(t, { allowSandbox: false });
  // A live shop has no demo catalog: one real product with one unit.
  const product = s.saveProduct(admin, { name: "Live Item", description: "ของจริง", category: "streaming", price: 10000, active: true });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  s.importCodes(admin, { variantId, items: [{ loginId: "live-1@example.invalid", password: "Live-pass-1" }] });
  const before = s.adminSummary(admin);
  const made = create({ quantity: 1, variantId });
  const payment = s.db.prepare("SELECT * FROM payments WHERE order_id=?").get(made.order.id);
  assert.equal(payment.provider, "offsite");
  assert.equal(payment.provider_ref, "offsite:" + made.order.id);
  assert.equal(s.db.prepare("SELECT test FROM manual_orders WHERE id=?").get(made.order.id).test, 0);
  const after = s.adminSummary(admin);
  assert.equal(after.mode, "live");
  assert.equal(after.revenue - before.revenue, 10000);
  const sales = s.salesReport(admin);
  assert.ok(sales.totals.revenue >= 10000);
  const row = s.adminTransactions(admin, {}).transactions.find((x) => x.order_id === made.order.id);
  assert.ok(row, "listed in live finance");
  assert.equal(s.adminTransactionDetail(admin, row.id).transaction.test, false);
  const refund = s.refundOrder(admin, made.order.id, {
    amount: 10000,
    reasonCode: "CUSTOMER_CANCEL",
    destination: "EXTERNAL",
    externalRef: "KBANK-BACK-1",
    requestKey: key(),
  });
  assert.equal(refund.summary.refundStatus, "REFUNDED");
  assert.equal(s.adminSummary(admin).revenue, before.revenue);
  assert.equal(s.publicUser(buyer).balance, 0);
});

test("price override: lower or higher needs a reason, never 0 or less; receipt shows the charged price", (t) => {
  const { s, admin, buyer, create } = fixture(t);
  assert.equal(status(() => create({ unitPrice: 8000 })), 400, "lower without reason");
  assert.equal(status(() => create({ unitPrice: 8000, priceReason: "ab" })), 400, "reason too short");
  assert.equal(status(() => create({ unitPrice: 12000 })), 400, "higher without reason");
  assert.equal(status(() => create({ unitPrice: 0, priceReason: "แจกฟรี" })), 400);
  assert.equal(status(() => create({ unitPrice: -100, priceReason: "ติดลบ" })), 400);
  assert.equal(status(() => create({ unitPrice: 99.5, priceReason: "ทศนิยม" })), 400);
  assert.equal(status(() => create({ unitPrice: "8000", priceReason: "ข้อความ" })), 400);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM manual_orders"), 0);
  // Same as the normal price: no reason needed.
  assert.equal(create({ unitPrice: 10000 }).order.total, 10000);
  const quote = s.adminManualOrderQuote(admin, {
    customerId: buyer.id,
    variantId: "stream-plus-30",
    quantity: 3,
    unitPrice: 8000,
    priceReason: "ลูกค้าประจำ ลดพิเศษ",
  });
  assert.equal(quote.normalUnitPrice, 10000);
  assert.equal(quote.total, 24000);
  assert.equal(quote.priceChanged, true);
  const made = create({ quantity: 3, unitPrice: 8000, priceReason: "ลูกค้าประจำ ลดพิเศษ" });
  assert.equal(made.order.total, 24000);
  const manual = s.adminOrderDetail(admin, made.order.id).manual;
  assert.equal(manual.normalUnitPrice, 10000);
  assert.equal(manual.unitPrice, 8000);
  assert.equal(manual.priceReason, "ลูกค้าประจำ ลดพิเศษ");
  const audit = JSON.parse(s.db.prepare("SELECT detail FROM audit WHERE action='MANUAL_ORDER_CREATE' AND entity_id=?").get(made.order.id).detail);
  assert.equal(audit.reason, "ลูกค้าประจำ ลดพิเศษ");
  assert.equal(audit.normalUnitPrice, 10000);
  s.requestOrderReceipt(buyer, made.order.id, {
    type: "PERSON",
    name: "Manual Buyer",
    taxId: "1234567890121",
    address: "10 หมู่ 2 ต.บางพลี อ.บางพลี สมุทรปราการ 10540",
  });
  s.adminApproveOrderReceipt(admin, made.order.id);
  const receipt = s.orderReceipt(buyer, made.order.id);
  assert.equal(receipt.item.unitPrice, 8000);
  assert.equal(receipt.total, 24000);
  assert.equal(receipt.paymentStatus, "PAID");
  assert.equal(receipt.paymentMethodLabel, "โอนนอกเว็บ");
});

test("coupon: uses the customer's own limits and the shared discount rules", (t) => {
  const { s, admin, buyer, create } = fixture(t);
  s.adminCreateCoupon(admin, { code: "OFFSITE10", type: "PERCENT", value: 10, perUserLimit: 1 });
  const quote = s.adminManualOrderQuote(admin, { customerId: buyer.id, variantId: "stream-plus-30", quantity: 1, couponCode: "offsite10" });
  assert.equal(quote.discount, 1000);
  assert.equal(quote.total, 9000);
  const made = create({ couponCode: "offsite10" });
  assert.equal(made.order.total, 9000);
  const row = s.db.prepare("SELECT discount,coupon_code FROM orders WHERE id=?").get(made.order.id);
  assert.deepEqual({ ...row }, { discount: 1000, coupon_code: "OFFSITE10" });
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM coupon_redemptions WHERE order_id=? AND user_id=?", made.order.id, buyer.id), 1);
  // Per-customer limit now reached: the preview says why, the order is refused.
  const second = s.adminManualOrderQuote(admin, { customerId: buyer.id, variantId: "stream-plus-30", quantity: 1, couponCode: "OFFSITE10" });
  assert.ok(second.couponError);
  assert.equal(second.discount, 0);
  assert.equal(status(() => create({ couponCode: "OFFSITE10" })), 400);
  assert.equal(status(() => create({ couponCode: "NOPE-NOPE" })), 400);
});

test("delivery path: FEFO + warranty snapshot, encrypted credentials, notifications, email", async (t) => {
  const sent = [];
  const mailer = {
    enabled: true,
    provider: "test",
    from: "shop@mail.example.com",
    async send(message) {
      sent.push(message);
      return { id: "msg-" + sent.length };
    },
  };
  const { s, admin, buyer, staff, create } = fixture(t, { email: mailer });
  // Placeholder .invalid addresses are never mailed; give the buyer a real-looking one.
  s.db.prepare("UPDATE users SET email=? WHERE id=?").run("manual-buyer@mail.example.com", buyer.id);
  s.db.prepare("UPDATE variants SET warranty_days=30 WHERE id='documentary-30'").run();
  s.importCodes(admin, {
    variantId: "documentary-30",
    items: [
      { loginId: "late@example.invalid", password: "Late-pass-1", expiresAt: "2099-12-31" },
      { loginId: "soon@example.invalid", password: "Soon-pass-1", expiresAt: "2098-01-31" },
    ],
  });
  // Units that run out before the warranty ends are never sold.
  const ids = s.db.prepare("SELECT id FROM inventory WHERE variant_id='documentary-30' AND legacy_single_secret=1").all();
  for (const { id } of ids) s.db.prepare("UPDATE inventory SET expires_at=datetime('now','+5 days') WHERE id=?").run(id);
  const made = create({ variantId: "documentary-30" });
  const order = s.db.prepare("SELECT * FROM orders WHERE id=?").get(made.order.id);
  assert.equal(order.warranty_days, 30);
  assert.ok(order.warranty_until, "warranty starts at delivery");
  const unit = s.db.prepare("SELECT * FROM inventory WHERE order_id=?").get(made.order.id);
  assert.ok(!unit.login_id_enc.includes("soon@"), "stored encrypted");
  const mine = s.orderDetail(buyer, made.order.id);
  assert.deepEqual(mine.credentials, [{ loginId: "soon@example.invalid", password: "Soon-pass-1" }], "earliest expiry first");
  assert.equal(mine.createdByAdmin, true);
  assert.equal(mine.paymentMethodLabel, "โอนนอกเว็บ");
  assert.ok(s.notifications(buyer).some((n) => n.kind === "code_delivery" && n.link === "/orders/" + made.order.id));
  assert.ok(s.notifications(staff).some((n) => n.kind === "order_new" && /สร้างโดยแอดมิน/.test(n.body)));
  await s.emailIdle();
  assert.equal(sent.length, 1, "order confirmation email queued once");
  assert.match(JSON.stringify(sent[0]), new RegExp(made.order.id.slice(0, 8).toUpperCase()));
  // Replay does not send a second email.
  create({ requestKey: s.db.prepare("SELECT request_key FROM manual_orders WHERE id=?").get(made.order.id).request_key, variantId: "documentary-30" });
  await s.emailIdle();
  assert.equal(sent.length, 1);
});

test("markers: history, detail, receipts, admin list and detail; staff sees no price reason", (t) => {
  const { s, admin, buyer, staff, create } = fixture(t);
  const made = create({ unitPrice: 9000, priceReason: "ส่วนลดเพราะโอนช้า", note: "ลูกค้าแจ้งทาง LINE" });
  const id = made.order.id;
  const history = s.orders(buyer);
  const listed = history.find((o) => o.id === id);
  assert.equal(listed.createdByAdmin, true);
  assert.equal(listed.paymentMethod, "OFFSITE_TRANSFER");
  assert.equal(listed.status, "DELIVERED");
  assert.equal(s.orderDetail(buyer, id).admin_note, undefined);
  assert.equal(s.orderDetail(buyer, id).priceReason, undefined, "reason never reaches the customer");
  assert.equal(s.adminOrderReceipt(admin, id).createdByAdmin, true);
  const page = s.adminOrders(admin, {});
  assert.equal(page.orders.find((o) => o.id === id).createdByAdmin, true);
  const adminDetail = s.adminOrderDetail(admin, id);
  assert.equal(adminDetail.manual.note, "ลูกค้าแจ้งทาง LINE");
  assert.equal(adminDetail.manual.adminName, "ผู้ดูแลร้าน");
  assert.equal(adminDetail.timeline[0].actorRole, "ADMIN");
  const staffDetail = s.adminOrderDetail(staff, id);
  assert.equal(staffDetail.manual.createdByAdmin, true);
  assert.equal(staffDetail.manual.priceReason, undefined);
  assert.equal(staffDetail.paymentSummary, undefined);
  const customer = s.adminCustomerDetail(admin, buyer.id);
  assert.ok(customer.orders.some((o) => o.id === id && o.createdByAdmin));
  // A normal storefront order carries no marker.
  const normal = s.createOrder(buyer, { variantId: "stream-plus-30", quantity: 1, requestKey: key() });
  assert.equal(s.orderDetail(buyer, normal.id).createdByAdmin, undefined);
});

test("slip: optional image upload, ADMIN only, never public", async (t) => {
  const { s, buyer, create } = fixture(t);
  const call = http(s);
  const adminToken = s.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token;
  const staffToken = s.login({ email: "manual-staff@example.invalid", password: "Staff-only-Password-123" }).token;
  const made = create();
  const path = "/api/admin/orders/" + made.order.id + "/slip";
  assert.equal((await call("GET", path, { token: adminToken })).status, 404, "no slip yet");
  const wrongType = await call("POST", path, { token: adminToken, body: tinyPng(), headers: { "Content-Type": "image/jpeg" } });
  assert.equal(wrongType.status, 415);
  const staffUpload = await call("POST", path, { token: staffToken, body: tinyPng(), headers: { "Content-Type": "image/png" } });
  assert.equal(staffUpload.status, 403);
  const up = await call("POST", path, { token: adminToken, body: tinyPng(), headers: { "Content-Type": "image/png" } });
  assert.equal(up.status, 200);
  const slipKey = s.db.prepare("SELECT slip_key FROM manual_orders WHERE id=?").get(made.order.id).slip_key;
  assert.match(slipKey, /^slip-/);
  const got = await call("GET", path, { token: adminToken });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("Content-Type"), "image/png");
  assert.match(got.headers.get("Cache-Control"), /no-store/);
  assert.equal(got.body.byteLength, tinyPng().byteLength);
  assert.equal((await call("GET", path, { token: staffToken })).status, 403);
  assert.equal((await call("GET", "/api/files/" + slipKey)).status, 404, "public file route never serves slips");
  assert.equal(s.adminOrderDetail(s.session(adminToken), made.order.id).manual.hasSlip, true);
  // Not a manual order: no slip.
  const normal = s.createOrder(buyer, { variantId: "stream-plus-30", quantity: 1, requestKey: key() });
  const refused = await call("POST", "/api/admin/orders/" + normal.id + "/slip", {
    token: adminToken,
    body: tinyPng(),
    headers: { "Content-Type": "image/png" },
  });
  assert.equal(refused.status, 404);
});

test("schema helper is idempotent", (t) => {
  const { s } = fixture(t);
  return import("../server/manual-orders.mjs").then(({ ensureManualOrders }) => {
    ensureManualOrders(s.db);
    ensureManualOrders(s.db);
    const cols = s.db.prepare("PRAGMA table_info(manual_orders)").all().map((c) => c.name);
    for (const c of ["method", "reference", "slip_key", "normal_unit_price", "unit_price", "price_reason", "payment_id", "test"])
      assert.ok(cols.includes(c), c);
  });
});

test("purchase limit: manual order without confirm is 409; confirm+reason passes and audits", (t) => {
  const { s, admin, buyer, create } = fixture(t);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  s.adminSetVariantPricing(admin, "stream-plus-30", { maxPerCustomer: 1 });
  keepStock(s, "stream-plus-30", 3);
  const paid = s.createOrder(buyer, { variantId: "stream-plus-30", quantity: 1, requestKey: key() });
  s.pay(buyer, paid.id, { paymentToken: paid.paymentToken, outcome: "success" });
  assert.equal(
    status(() => create()),
    409,
    "admin create without confirm must hit the same limit",
  );
  assert.throws(
    () => create(),
    (e) => e.status === 409 && /จำกัด 1 ชิ้นต่อบัญชี/.test(e.message),
  );
  assert.equal(
    status(() => create({ confirmOverLimit: true })),
    400,
    "confirm without a reason is refused",
  );
  const made = create({
    confirmOverLimit: true,
    overLimitReason: "ลูกค้าโอนเพิ่มนอกเว็บตามตกลง",
  });
  assert.equal(made.order.status, "DELIVERED");
  const createAudit = s.db
    .prepare("SELECT detail FROM audit WHERE action='MANUAL_ORDER_CREATE' AND entity_id=?")
    .get(made.order.id);
  assert.equal(JSON.parse(createAudit.detail).confirmOverLimit, true);
  assert.equal(JSON.parse(createAudit.detail).overLimitReason, "ลูกค้าโอนเพิ่มนอกเว็บตามตกลง");
  const overAudit = s.db
    .prepare("SELECT detail FROM audit WHERE action='MANUAL_ORDER_OVER_LIMIT' AND entity_id=?")
    .get(made.order.id);
  assert.equal(JSON.parse(overAudit.detail).reason, "ลูกค้าโอนเพิ่มนอกเว็บตามตกลง");
});

test("fraud paid_orders counts admin-created manual orders for the customer", (t) => {
  const { s, admin, buyer, create } = fixture(t);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  s.adminSaveFraudSettings(admin, { rules: { paid_orders: { enabled: true, threshold: 1, windowHours: 1 } } });
  keepStock(s, "stream-plus-30", 2);
  create();
  const signals = s.db
    .prepare("SELECT * FROM fraud_signals WHERE rule='paid_orders' AND user_id=? ORDER BY at_ms")
    .all(buyer.id);
  assert.equal(signals.length, 1, "manual paid order must raise paid_orders for the customer");
  assert.ok(signals[0].value >= 1);
});
