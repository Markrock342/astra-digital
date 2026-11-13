// Shop switched off: no new orders and no payment for orders already waiting; reopening resumes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { SHOP_CLOSED_ORDER, SHOP_CLOSED_PAY } from "../server/domain.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const admin = s.session(s.demoMerchant().token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const buyer = s.session(s.register({ name: "Closed Buyer", email: "closed@example.invalid", password: "Closed-buyer-Pass-123" }).token);
  const ready = s.saveProduct(admin, { name: "Closed Stream", description: "ปิดร้าน", category: "streaming", price: 5000, active: true, firstLabel: "1 เดือน" });
  const readyVariant = s.adminProductVariants(admin, ready.id).variants[0].id;
  s.importCodes(admin, { variantId: readyVariant, items: [{ loginId: "closed-1@x.test", password: "p1" }] });
  const pre = s.saveProduct(admin, { name: "Closed Preorder", description: "พรีออเดอร์", category: "streaming", price: 5000, active: true, preorder: true, firstLabel: "1 เดือน" });
  const preVariant = s.adminProductVariants(admin, pre.id).variants[0].id;
  s.adjustCustomerCredit(admin, buyer.id, { amount: 20000, reason: "ทดสอบปิดร้าน", requestKey: randomUUID() });
  return { s, admin, buyer, readyVariant, preVariant };
}

test("closed shop: no new orders, and waiting orders and preorders cannot be paid until it reopens", (t) => {
  const { s, admin, buyer, readyVariant, preVariant } = fixture(t);
  const order = s.createOrder(buyer, { variantId: readyVariant, quantity: 1, requestKey: randomUUID() });
  const reservation = s.createOrder(buyer, { variantId: preVariant, quantity: 1, requestKey: randomUUID() });
  s.saveSettings(admin, { shopOpen: false });
  assert.throws(() => s.createOrder(buyer, { variantId: readyVariant, quantity: 1, requestKey: randomUUID() }), (e) => e.status === 409 && e.message === SHOP_CLOSED_ORDER);
  for (const o of [order, reservation])
    assert.throws(() => s.pay(buyer, o.id, { paymentToken: o.paymentToken, outcome: "success" }), (e) => e.status === 409 && e.message === SHOP_CLOSED_PAY);
  assert.equal(s.db.prepare("SELECT status FROM orders WHERE id=?").get(order.id).status, "PENDING_PAYMENT", "order kept");
  s.saveSettings(admin, { shopOpen: true });
  assert.equal(s.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" }).status, "DELIVERED");
  assert.equal(s.pay(buyer, reservation.id, { paymentToken: reservation.paymentToken, outcome: "success" }).status, "PREORDER");
});
