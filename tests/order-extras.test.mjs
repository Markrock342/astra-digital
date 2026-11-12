// Order extras: usage instructions after delivery, "แจ้งปัญหาบัญชีนี้" chat reports,
// order receipt, and the first option label on product create.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ensureOrderExtras } from "../server/ensure-admin-fr.mjs";
import { normalizeUsageInstructions } from "../server/order-extras.mjs";
import { ROLES } from "../server/auth-policy.mjs";

const USAGE = "1. เปิดแอป แล้วกดเข้าสู่ระบบ\n- ใช้ ID และรหัสผ่านจากหน้าออเดอร์\n\n<b>ห้ามเปลี่ยนรหัส</b>";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const auth = s.register({ name: "Extras Buyer", email: "extras-buyer@example.invalid", password: "Extras-buyer-Pass-123" });
  const user = s.session(auth.token);
  const otherAuth = s.register({ name: "Other Buyer", email: "other-buyer@example.invalid", password: "Other-buyer-Pass-123" });
  const other = s.session(otherAuth.token);
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  const staffAuth = s.register({ name: "Extras Staff", email: "extras-staff@example.invalid", password: "Staff-only-Password-123" });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const product = s.saveProduct(admin, {
    name: "Extras Stream",
    description: "บัญชีทดสอบวิธีใช้งาน",
    category: "streaming",
    price: 9900,
    active: true,
    firstLabel: "1 เดือน",
    firstWarrantyDays: 30,
    usageInstructions: USAGE,
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  s.importCodes(admin, {
    variantId,
    items: ["acc-1", "acc-2", "acc-3"].map((loginId) => ({ loginId, password: "pw-" + loginId })),
  });
  return { s, user, other, admin, staff, product, variantId, token: auth.token, adminToken: adminAuth.token, staffToken: staffAuth.token, otherToken: otherAuth.token };
}

const call = async (s, method, path, token, body) => {
  const handle = createAPIHandler(s);
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

function buy(s, user, variantId, key, pay = true) {
  const order = s.createOrder(user, { variantId, quantity: 1, requestKey: key });
  return pay ? s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" }) : order;
}

test("ensureOrderExtras is idempotent and adds its columns", (t) => {
  const { s } = fixture(t);
  ensureOrderExtras(s.db);
  ensureOrderExtras(s.db);
  const cols = (table) => s.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  assert.ok(cols("products").includes("usage_instructions"));
  assert.ok(cols("chat_messages").includes("order_id"));
  assert.ok(cols("chat_messages").includes("report_reason"));
  assert.ok(cols("chat_threads").includes("order_id"));
});

test("usage instructions are plain text, max 2000 chars, and saved from the editor", (t) => {
  const { s, admin, product } = fixture(t);
  const fail = (status, message) => {
    throw Object.assign(new Error(message), { status });
  };
  assert.equal(normalizeUsageInstructions("  a\r\nb \n\n\n\nc\u0007 ", fail), "a\nb\n\nc");
  assert.equal(normalizeUsageInstructions("   ", fail), null);
  assert.throws(() => normalizeUsageInstructions("x".repeat(2001), fail), (e) => e.status === 400);
  assert.equal(normalizeUsageInstructions("x".repeat(2000), fail).length, 2000);
  assert.throws(() => normalizeUsageInstructions({ html: "<b>" }, fail), (e) => e.status === 400);

  const stored = () => s.db.prepare("SELECT usage_instructions AS u FROM products WHERE id=?").get(product.id).u;
  assert.equal(stored(), USAGE);
  // An update without the field leaves it alone (bulk/other editors).
  s.saveProduct(admin, { id: product.id, name: "Extras Stream", description: "บัญชีทดสอบวิธีใช้งาน", category: "streaming", active: true });
  assert.equal(stored(), USAGE);
  s.saveProduct(admin, { id: product.id, name: "Extras Stream", description: "บัญชีทดสอบวิธีใช้งาน", category: "streaming", active: true, usageInstructions: "" });
  assert.equal(stored(), null);
  assert.throws(
    () => s.saveProduct(admin, { id: product.id, name: "Extras Stream", description: "บัญชีทดสอบวิธีใช้งาน", category: "streaming", usageInstructions: "y".repeat(2001) }),
    (e) => e.status === 400,
  );
  // The admin editor reads it back; a duplicate keeps it.
  s.saveProduct(admin, { id: product.id, name: "Extras Stream", description: "บัญชีทดสอบวิธีใช้งาน", category: "streaming", active: true, usageInstructions: USAGE });
  assert.equal(s.adminOverview(admin).products.find((p) => p.id === product.id).usage_instructions, USAGE);
  const copy = s.duplicateProduct(admin, product.id);
  assert.equal(s.db.prepare("SELECT usage_instructions AS u FROM products WHERE id=?").get(copy.id).u, USAGE);
});

test("public product APIs never include usage instructions", async (t) => {
  const { s, product, token } = fixture(t);
  for (const who of [undefined, token]) {
    const list = await call(s, "GET", "/api/products", who);
    assert.equal(list.status, 200);
    const listed = list.data.products.find((p) => p.id === product.id);
    assert.ok(listed, "product is public");
    assert.ok(!("usage_instructions" in listed));
    assert.ok(!JSON.stringify(list.data).includes("ห้ามเปลี่ยนรหัส"));
    const one = await call(s, "GET", "/api/products/" + product.id, who);
    assert.equal(one.status, 200);
    assert.ok(!("usage_instructions" in one.data.product));
    assert.ok(!JSON.stringify(one.data).includes("ห้ามเปลี่ยนรหัส"));
  }
  const overview = await call(s, "GET", "/api/overview");
  assert.ok(!JSON.stringify(overview.data).includes("ห้ามเปลี่ยนรหัส"));
});

test("the buyer sees usage instructions only once the order is delivered", async (t) => {
  const { s, user, other, admin, variantId, token, otherToken } = fixture(t);
  const pending = buy(s, user, variantId, "extras-pending-01", false);
  assert.equal(s.orderDetail(user, pending.id).usageInstructions, undefined);
  const pendingApi = await call(s, "GET", "/api/orders/" + pending.id, token);
  assert.ok(!JSON.stringify(pendingApi.data).includes("ห้ามเปลี่ยนรหัส"));

  const delivered = buy(s, user, variantId, "extras-ready-0001");
  assert.equal(delivered.status, "DELIVERED");
  const mine = await call(s, "GET", "/api/orders/" + delivered.id, token);
  assert.equal(mine.data.usageInstructions, USAGE);
  assert.ok(mine.data.deliveredAt);
  // Not for another customer, and the admin view of the customer API carries no copy.
  assert.equal((await call(s, "GET", "/api/orders/" + delivered.id, otherToken)).status, 404);
  assert.equal(s.orderDetail(admin, delivered.id).usageInstructions, undefined);
  assert.throws(() => s.orderDetail(other, delivered.id), (e) => e.status === 404);
});

test("preorder delivery also reveals the instructions to the buyer", (t) => {
  const { s, user, admin } = fixture(t);
  const pre = s.saveProduct(admin, {
    name: "Extras Preorder",
    description: "พรีออเดอร์ทดสอบวิธีใช้งาน",
    category: "streaming",
    price: 5000,
    preorder: true,
    active: true,
    firstLabel: "3 เดือน",
    usageInstructions: "ล็อกอินผ่านเว็บเท่านั้น",
  });
  const variantId = s.adminProductVariants(admin, pre.id).variants[0].id;
  const reservation = buy(s, user, variantId, "extras-pre-00001");
  assert.equal(reservation.status, "PREORDER");
  assert.equal(s.orderDetail(user, reservation.id).usageInstructions, undefined);
  s.importCodes(admin, { variantId, items: [{ loginId: "pre-acc", password: "pre-pw" }] });
  s.deliverReservation(admin, reservation.id);
  const after = s.orderDetail(user, reservation.id);
  assert.equal(after.usageInstructions, "ล็อกอินผ่านเว็บเท่านั้น");
  assert.ok(after.deliveredAt);
});

test("report issue: linked to the order, delivered only, owner only, 3 per order per day", async (t) => {
  const { s, user, other, staff, variantId, token, staffToken, otherToken } = fixture(t);
  const order = buy(s, user, variantId, "extras-report-001");
  const pending = buy(s, user, variantId, "extras-report-002", false);
  const body = "แจ้งปัญหาบัญชี\nออเดอร์: #" + order.id.slice(0, 8).toUpperCase() + "\nอาการ: เข้าไม่ได้";

  // Validation first: reason, delivered, owner.
  assert.equal((await call(s, "POST", "/api/chat/threads", token, { body, orderId: order.id })).status, 400);
  assert.equal((await call(s, "POST", "/api/chat/threads", token, { body, orderId: order.id, reportReason: "bogus" })).status, 400);
  assert.equal((await call(s, "POST", "/api/chat/threads", token, { body, orderId: pending.id, reportReason: "cannot_login" })).status, 409);
  assert.equal((await call(s, "POST", "/api/chat/threads", otherToken, { body, orderId: order.id, reportReason: "cannot_login" })).status, 404);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE order_id IS NOT NULL").get().n, 0);

  const opened = await call(s, "POST", "/api/chat/threads", token, { body, orderId: order.id, reportReason: "cannot_login" });
  assert.equal(opened.status, 201);
  const threadId = opened.data.thread.id;
  const first = opened.data.messages.at(-1);
  assert.equal(first.order_id, order.id);
  assert.equal(first.report_reason, "cannot_login");
  for (const reason of ["wrong_password", "password_changed"]) {
    const sent = await call(s, "POST", "/api/chat/threads/" + threadId + "/messages", token, { body, orderId: order.id, reportReason: reason });
    assert.equal(sent.status, 201);
  }
  const fourth = await call(s, "POST", "/api/chat/threads/" + threadId + "/messages", token, { body, orderId: order.id, reportReason: "other" });
  assert.equal(fourth.status, 429);
  assert.match(fourth.data.error, /3 ครั้ง/);
  // Ordinary chat keeps working.
  assert.equal((await call(s, "POST", "/api/chat/threads/" + threadId + "/messages", token, { body: "ขอบคุณครับ" })).status, 201);

  // Admin inbox: thread carries the order, messages carry the link + reason.
  const inbox = await call(s, "GET", "/api/chat/threads", staffToken);
  assert.equal(inbox.data.threads.find((x) => x.id === threadId).order_id, order.id);
  const messages = s.chatMessages(staff, threadId);
  assert.equal(messages.filter((m) => m.order_id === order.id).length, 3);
  assert.deepEqual(
    messages.filter((m) => m.report_reason).map((m) => m.report_reason),
    ["cannot_login", "wrong_password", "password_changed"],
  );
  // Staff replies never become reports, even if they pass an order id.
  assert.equal((await call(s, "POST", "/api/chat/threads/" + threadId + "/messages", staffToken, { body: "กำลังตรวจสอบ", orderId: order.id, reportReason: "other" })).status, 201);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE report_reason IS NOT NULL").get().n, 3);
  assert.ok(s.notifications(staff).some((n) => n.title === "ลูกค้าแจ้งปัญหาบัญชี"));

  // After 24 hours the order can be reported again.
  s.db.prepare("UPDATE chat_messages SET created_at=datetime('now','-25 hours') WHERE order_id=?").run(order.id);
  assert.equal((await call(s, "POST", "/api/chat/threads/" + threadId + "/messages", token, { body, orderId: order.id, reportReason: "other" })).status, 201);
  void other;
});

test("receipt: customer and admin views, no credentials, discount and refund fields", async (t) => {
  const { s, user, admin, staff, variantId, token, adminToken, staffToken, otherToken } = fixture(t);
  s.saveSettings(admin, { shopName: "ร้านทดสอบใบเสร็จ", email: "shop@example.invalid", phone: "02-000-0000" });
  const order = buy(s, user, variantId, "extras-receipt-01");
  const mine = await call(s, "GET", "/api/orders/" + order.id + "/receipt", token);
  assert.equal(mine.status, 200);
  const r = mine.data.receipt;
  assert.equal(r.number, order.id.slice(0, 8).toUpperCase());
  assert.equal(r.shop.name, "ร้านทดสอบใบเสร็จ");
  assert.equal(r.shop.email, "shop@example.invalid");
  assert.equal(r.shop.vatRegistered, false);
  assert.equal(r.customer.name, "Extras Buyer");
  assert.equal(r.customer.email, "extras-buyer@example.invalid");
  assert.deepEqual(
    [r.item.product, r.item.option, r.item.quantity, r.item.unitPrice, r.item.discount, r.total],
    ["Extras Stream", "1 เดือน", 1, 9900, 0, 9900],
  );
  assert.equal(r.paymentStatus, "PAID");
  assert.ok(r.paidAt && r.deliveredAt && r.createdAt);
  assert.equal(r.refundStatus, null);
  const blob = JSON.stringify(mine.data);
  for (const secret of ["acc-1", "pw-acc-1", "acc-2", "ห้ามเปลี่ยนรหัส", "payment_hash", "request_key", "admin_note"])
    assert.ok(!blob.includes(secret), secret);

  // Only the owner; admin and staff use the admin endpoint.
  assert.equal((await call(s, "GET", "/api/orders/" + order.id + "/receipt", otherToken)).status, 404);
  assert.equal((await call(s, "GET", "/api/orders/" + order.id + "/receipt")).status, 401);
  assert.equal((await call(s, "GET", "/api/admin/orders/" + order.id + "/receipt", token)).status, 403);
  const adminView = await call(s, "GET", "/api/admin/orders/" + order.id + "/receipt", adminToken);
  assert.equal(adminView.status, 200);
  assert.equal(adminView.data.receipt.total, 9900);
  assert.ok(!JSON.stringify(adminView.data).includes("pw-acc-1"));
  assert.equal((await call(s, "GET", "/api/admin/orders/" + order.id + "/receipt", staffToken)).status, 200);

  // A refund shows for the customer and the admin, not for staff.
  s.refundOrder(admin, order.id, { amount: 9900, reasonCode: "ACCOUNT_BROKEN", destination: "CREDIT", requestKey: "refund-extras-0001" });
  const refunded = s.orderReceipt(user, order.id);
  assert.equal(refunded.refundStatus, "REFUNDED");
  assert.equal(refunded.refundedTotal, 9900);
  assert.equal(s.adminOrderReceipt(admin, order.id).refundStatus, "REFUNDED");
  assert.equal(s.adminOrderReceipt(staff, order.id).refundStatus, null);

  // A discount written by another feature (coupons) is read when present.
  const cols = s.db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  if (!cols.includes("discount")) s.db.exec("ALTER TABLE orders ADD COLUMN discount INTEGER");
  const discounted = buy(s, user, variantId, "extras-receipt-02");
  s.db.prepare("UPDATE orders SET discount=1000 WHERE id=?").run(discounted.id);
  const d = s.orderReceipt(user, discounted.id);
  assert.deepEqual([d.item.subtotal, d.item.discount, d.item.unitPrice, d.total], [10900, 1000, 10900, 9900]);

  // Unpaid orders still get an order confirmation with the payment state.
  const pending = buy(s, user, variantId, "extras-receipt-03", false);
  assert.equal(s.orderReceipt(user, pending.id).paymentStatus, "PENDING");
});

test("new product: first option label and warranty from the form; old callers keep the default", (t) => {
  const { s, admin } = fixture(t);
  const withLabel = s.saveProduct(admin, {
    name: "Label Item",
    description: "ตัวเลือกแรกจากฟอร์ม",
    category: "streaming",
    price: 12900,
    firstLabel: "  1 เดือน  ",
    firstWarrantyDays: 7,
  });
  const [v] = s.adminProductVariants(admin, withLabel.id).variants;
  assert.equal(v.label, "1 เดือน");
  assert.equal(v.warranty_days, 7);
  assert.equal(v.price, 12900);

  const legacy = s.saveProduct(admin, { name: "Legacy Item", description: "เรียกแบบเดิม", category: "streaming", price: 12900 });
  const [lv] = s.adminProductVariants(admin, legacy.id).variants;
  assert.equal(lv.label, "โค้ดดิจิทัล");
  assert.equal(lv.warranty_days, 0);

  for (const bad of [{ firstLabel: "" }, { firstLabel: "x".repeat(81) }, { firstLabel: "1 เดือน", firstWarrantyDays: 366 }, { firstLabel: "1 เดือน", firstWarrantyDays: -1 }])
    assert.throws(
      () => s.saveProduct(admin, { name: "Bad Item", description: "ข้อมูลไม่ถูกต้อง", category: "streaming", price: 12900, ...bad }),
      (e) => e.status === 400,
      JSON.stringify(bad),
    );

  // Editing an existing product never touches its options.
  s.saveProduct(admin, { id: withLabel.id, name: "Label Item", description: "ตัวเลือกแรกจากฟอร์ม", category: "streaming", firstLabel: "อย่าเปลี่ยน", firstWarrantyDays: 99 });
  const [after] = s.adminProductVariants(admin, withLabel.id).variants;
  assert.equal(after.label, "1 เดือน");
  assert.equal(after.warranty_days, 7);
});
