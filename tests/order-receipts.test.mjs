// ใบเสร็จคำสั่งซื้อ: profiles, 7-day window, approve gate, reject re-request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ensureOrderReceipts } from "../server/ensure-admin-fr.mjs";
import { RECEIPT_REQUEST_WINDOW_MS } from "../server/order-receipts.mjs";
import { ROLES } from "../server/auth-policy.mjs";

const PERSON_TAX_ID = "1234567890121";
const BUYER = {
  type: "PERSON",
  name: "สมชาย ใจดี",
  taxId: PERSON_TAX_ID,
  address: "10 หมู่ 2 ต.บางพลี อ.บางพลี สมุทรปราการ 10540",
};

const status = (code) => (e) => e.status === code;

function fixture(t, { clock } = {}) {
  const s = createCommerce({ allowDemoAdmin: true, ...(clock ? { clock } : {}) });
  t.after(() => s.db.close());
  const auth = s.register({
    name: "Receipt Buyer",
    email: "receipt-buyer@example.invalid",
    password: "Receipt-buyer-Pass-123",
  });
  const user = s.session(auth.token);
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const product = s.saveProduct(admin, {
    name: "Receipt Stream",
    description: "ทดสอบใบเสร็จ",
    category: "streaming",
    price: 5000,
    active: true,
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  s.importCodes(admin, {
    variantId,
    items: Array.from({ length: 5 }, (_, i) => ({ loginId: "r" + i, password: "pw" + i })),
  });
  return { s, user, admin, variantId, token: auth.token, adminToken: adminAuth.token };
}

function buy(s, user, variantId, key) {
  const order = s.createOrder(user, { variantId, quantity: 1, requestKey: key });
  return s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
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

test("ensureOrderReceipts is idempotent", (t) => {
  const { s } = fixture(t);
  ensureOrderReceipts(s.db);
  ensureOrderReceipts(s.db);
  const tables = s.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  assert.ok(tables.includes("receipt_profiles"));
  assert.ok(tables.includes("order_receipt_requests"));
});

test("account receipt profiles: create many, update, delete; other user blocked", (t) => {
  const { s, user, admin } = fixture(t);
  const a = s.createReceiptProfile(user, { ...BUYER, label: "บ้าน" });
  const b = s.createReceiptProfile(user, {
    ...BUYER,
    label: "ที่ทำงาน",
    name: "สมชาย ใจดี (ที่ทำงาน)",
  });
  assert.equal(s.listReceiptProfiles(user).profiles.length, 2);
  const updated = s.updateReceiptProfile(user, a.id, { ...BUYER, label: "บ้านใหม่", name: "สมชาย แก้ไข" });
  assert.equal(updated.label, "บ้านใหม่");
  s.deleteReceiptProfile(user, b.id);
  assert.equal(s.listReceiptProfiles(user).profiles.length, 1);
  const other = s.session(
    s.register({ name: "Other", email: "other-rcp@example.invalid", password: "Other-rcp-Pass-123" }).token,
  );
  assert.throws(() => s.updateReceiptProfile(other, a.id, { ...BUYER, label: "ขโมย" }), status(404));
  assert.throws(() => s.deleteReceiptProfile(admin, a.id), status(404));
});

test("request → gate download → approve → download with payment channel; reject → re-request; approve locks", (t) => {
  const { s, user, admin, variantId } = fixture(t);
  const order = buy(s, user, variantId, "rcp-flow-0001");
  assert.throws(() => s.orderReceipt(user, order.id), status(403));
  const profile = s.createReceiptProfile(user, { ...BUYER, label: "หลัก" });
  const pending = s.requestOrderReceipt(user, order.id, { profileId: profile.id });
  assert.equal(pending.request.status, "PENDING");
  assert.equal(pending.canDownload, false);
  assert.throws(() => s.orderReceipt(user, order.id), status(403));
  assert.throws(() => s.requestOrderReceipt(user, order.id, { profileId: profile.id }), status(409));

  const queue = s.adminOrderReceipts(admin, { status: "PENDING" });
  assert.ok(queue.requests.some((r) => r.orderId === order.id));

  s.adminRejectOrderReceipt(admin, order.id, { reason: "ข้อมูลไม่ครบถ้วน" });
  assert.throws(() => s.orderReceipt(user, order.id), status(403));
  const again = s.requestOrderReceipt(user, order.id, { ...BUYER, label: "ส่งใหม่" });
  assert.equal(again.request.status, "PENDING");

  s.adminApproveOrderReceipt(admin, order.id);
  const receipt = s.orderReceipt(user, order.id);
  assert.equal(receipt.buyer.name, BUYER.name);
  assert.equal(receipt.paymentMethodLabel, "ชำระทดลอง");
  assert.throws(() => s.requestOrderReceipt(user, order.id, BUYER), status(409));
});

test("7-day window blocks first request and re-request after expiry", (t) => {
  const { s, user, admin, variantId } = fixture(t);
  const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  const backdate = (orderId) => {
    const old = sqlTime(Date.now() - RECEIPT_REQUEST_WINDOW_MS - 60_000);
    s.db
      .prepare("UPDATE payments SET finalized_at=?, created_at=? WHERE order_id=? OR reservation_id=?")
      .run(old, old, orderId, orderId);
  };

  const order = buy(s, user, variantId, "rcp-window-0001");
  backdate(order.id);
  assert.throws(() => s.requestOrderReceipt(user, order.id, BUYER), status(409));

  const order2 = buy(s, user, variantId, "rcp-window-0002");
  s.requestOrderReceipt(user, order2.id, BUYER);
  s.adminRejectOrderReceipt(admin, order2.id, { reason: "ไม่ผ่านการตรวจสอบ" });
  backdate(order2.id);
  assert.throws(() => s.requestOrderReceipt(user, order2.id, BUYER), status(409));
});

test("HTTP routes: profiles + request + admin approve; foreign order 404", async (t) => {
  const { s, user, admin, variantId, token, adminToken } = fixture(t);
  const otherAuth = s.register({
    name: "Other Receipt User",
    email: "x-rcp@example.invalid",
    password: "X-rcp-Pass-12345",
  });
  const order = buy(s, user, variantId, "rcp-http-0001");
  const created = await call(s, "POST", "/api/account/receipt-profiles", token, { ...BUYER, label: "API" });
  assert.equal(created.status, 200);
  const listed = await call(s, "GET", "/api/account/receipt-profiles", token);
  assert.equal(listed.status, 200);
  assert.equal(listed.data.profiles.length, 1);

  const req = await call(s, "POST", "/api/orders/" + order.id + "/order-receipt", token, {
    profileId: created.data.id,
  });
  assert.equal(req.status, 200);
  assert.equal(req.data.request.status, "PENDING");
  assert.equal((await call(s, "GET", "/api/orders/" + order.id + "/receipt", token)).status, 403);

  assert.equal(
    (await call(s, "POST", "/api/orders/" + order.id + "/order-receipt", otherAuth.token, BUYER)).status,
    404,
  );

  const approve = await call(s, "POST", "/api/admin/orders/" + order.id + "/order-receipt/approve", adminToken);
  assert.equal(approve.status, 200);
  const receipt = await call(s, "GET", "/api/orders/" + order.id + "/receipt", token);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.data.receipt.paymentMethodLabel, "ชำระทดลอง");

  const staffAuth = s.register({
    name: "Staff R",
    email: "staff-rcp@example.invalid",
    password: "Staff-rcp-Pass-123",
  });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  assert.equal(
    (await call(s, "POST", "/api/admin/orders/" + order.id + "/order-receipt/reject", staffAuth.token, {
      reason: "staff cannot",
    })).status,
    403,
  );
  void admin;
});
