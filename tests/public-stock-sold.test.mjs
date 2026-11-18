import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";

test("public stock excludes held, defective and expired units; sales update per variant", (t) => {
  const password = randomUUID();
  const s = createCommerce({ adminPassword: password });
  t.after(() => s.db.close());
  const admin = s.session(s.login({ email: "admin@astra.local", password }).token);
  const p = s.saveProduct(admin, { name: "Round2 Stock", description: "Sellable stock test", category: "software", price: 9900, active: true });
  const v = s.adminProductVariants(admin, p.id).variants[0].id;
  s.importCodes(admin, { variantId: v, codes: ["R2-GOOD1", "R2-GOOD2", "R2-BAD", "R2-EXPIRED"].join("\n") });
  const ids = s.db.prepare("SELECT id FROM inventory WHERE variant_id=? ORDER BY rowid").all(v);
  s.db.prepare("UPDATE inventory SET defective=1 WHERE id=?").run(ids[2].id);
  s.db.prepare("UPDATE inventory SET expires_at='2000-01-01 00:00:00' WHERE id=?").run(ids[3].id);
  const pub = () => s.productDetail(p.id).variants[0];
  assert.equal(pub().stockRemaining, 2);
  assert.equal(pub().sold, 0);
  assert.equal(pub().stock, undefined);
  const buyer = s.session(s.register({ name: "Round2 Buyer", email: "r2-unit@example.invalid", password: randomUUID() }).token);
  const order = s.createOrder(buyer, { variantId: v, quantity: 1, requestKey: randomUUID() });
  assert.equal(pub().stockRemaining, 2, "stock is assigned only after payment");
  assert.equal(pub().sold, 0, "unpaid order is not a sale");
  s.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  assert.equal(pub().stockRemaining, 1);
  assert.equal(pub().sold, 1);
  assert.equal(s.productDetail(p.id).sold, 1);
});

test("preorder sold counts paid reservations once and never exposes ready stock", (t) => {
  const password = randomUUID();
  const s = createCommerce({ adminPassword: password });
  t.after(() => s.db.close());
  const admin = s.session(s.login({ email: "admin@astra.local", password }).token);
  const p = s.saveProduct(admin, { name: "Round2 Preorder", description: "Preorder sales test", category: "software", price: 9900, active: true, preorder: true });
  const v = s.adminProductVariants(admin, p.id).variants[0].id;
  const buyer = s.session(s.register({ name: "Round2 Buyer", email: "r2-pre@example.invalid", password: randomUUID() }).token);
  const pub = () => s.productDetail(p.id).variants[0];
  const order = s.createOrder(buyer, { variantId: v, quantity: 2, requestKey: randomUUID() });
  assert.equal(pub().stockRemaining, null);
  assert.equal(pub().sold, 0);
  s.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  assert.equal(pub().sold, 2);
  s.importCodes(admin, { variantId: v, codes: "R2-PRE1\nR2-PRE2" });
  s.deliverReservation(admin, order.id);
  assert.equal(pub().sold, 2);
  assert.equal(s.productDetail(p.id).sold, 2);
});
