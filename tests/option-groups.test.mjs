// Option groups (server/option-groups.mjs): up to 4 groups name the variants of a product.
// Variants stay the unit of price / stock / orders, so pricing rules, limits, preorder,
// stock-watch, receipts and duplicate keep working on them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { combinations } from "../server/option-groups.mjs";

const status = (code) => (e) => e.status === code;
const ADMIN_PASSWORD = "options-admin-" + randomUUID().slice(0, 8);

function fixture(t) {
  const s = createCommerce({ adminPassword: ADMIN_PASSWORD, allowSandbox: true });
  t.after(() => s.db.close());
  const admin = s.session(s.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  let n = 0;
  const buyer = (credit = 200000) => {
    n++;
    const auth = s.register({ name: "Opt " + n, email: `opt-${n}@example.invalid`, password: "Option-buyer-Pass-" + n });
    const user = s.session(auth.token);
    s.adjustCustomerCredit(admin, user.id, { amount: credit, reason: "ทดสอบ", requestKey: randomUUID() });
    return s.session(auth.token);
  };
  const product = (extra = {}) =>
    s.saveProduct(admin, {
      name: "Stream Max",
      description: "สินค้าหลายตัวเลือก",
      category: "streaming",
      price: 9900,
      active: true,
      firstLabel: "7 วัน",
      firstWarrantyDays: 7,
      ...extra,
    }).id;
  const variants = (productId) => s.adminProductVariants(admin, productId).variants;
  const byLabel = (productId, label) => variants(productId).find((v) => v.label === label);
  return { s, admin, buyer, product, variants, byLabel };
}

test("combinations: cartesian product in group order", () => {
  const combos = combinations([{ values: [1, 2] }, { values: ["a", "b", "c"] }]);
  assert.equal(combos.length, 6);
  assert.deepEqual(combos[0], [1, "a"]);
  assert.deepEqual(combos[5], [2, "c"]);
  assert.deepEqual(combinations([]), []);
});

test("switching to groups maps existing variants into one group (nothing lost)", (t) => {
  const { s, admin, product, variants } = fixture(t);
  const pid = product();
  s.createVariant(admin, pid, { label: "30 วัน", price: 29900, warranty_days: 30 });
  const before = variants(pid);
  const r = s.adminEnableOptionGroups(admin, pid);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].name, "ตัวเลือก");
  assert.deepEqual(r.groups[0].values.map((v) => v.label), ["7 วัน", "30 วัน"]);
  const after = variants(pid);
  assert.deepEqual(after.map((v) => [v.id, v.price, v.label]), before.map((v) => [v.id, v.price, v.label]));
  const pub = s.productDetail(pid);
  assert.equal(pub.optionGroups.length, 1);
  assert.equal(pub.variants.length, 2);
  assert.ok(pub.variants.every((v) => v.options[r.groups[0].id]));
  // Flat "add option" is refused while groups are on.
  assert.throws(() => s.createVariant(admin, pid, { label: "x", price: 100 }), status(409));
  // Back to the simple list: variants stay.
  s.adminDisableOptionGroups(admin, pid);
  assert.equal(variants(pid).length, 2);
  assert.equal(s.productDetail(pid).optionGroups.length, 0);
});

test("3 groups: grid generated, new combos start closed, labels are joined values, rename + remove", (t) => {
  const { s, admin, product, variants, byLabel } = fixture(t);
  const pid = product();
  const enabled = s.adminEnableOptionGroups(admin, pid, { name: "ระยะเวลา" });
  const dur = enabled.groups[0];
  const saved = s.adminSaveOptionGroups(admin, pid, {
    price: 15000,
    groups: [
      { name: "แพ็กเกจ", values: ["Basic", "Premium"] },
      { name: "ประเภทบัญชี", values: ["ส่วนตัว", "แชร์"] },
      { id: dur.id, name: "ระยะเวลา", values: [{ id: dur.values[0].id, label: "7 วัน" }, { label: "30 วัน" }] },
    ],
  });
  assert.equal(saved.groups.length, 3);
  const all = variants(pid);
  assert.equal(all.length, 8);
  // The old variant took the first value of each new group and stays on.
  const kept = all.find((v) => v.label === "Basic / ส่วนตัว / 7 วัน");
  assert.ok(kept.active);
  assert.equal(kept.price, 9900);
  assert.equal(saved.created, 7);
  // New combos are closed until the admin opens them; storefront only sees open ones.
  assert.equal(all.filter((v) => v.active).length, 1);
  assert.equal(s.productDetail(pid).variants.length, 1);
  // Sibling price: "Basic / ส่วนตัว / 30 วัน" copies the closest existing combo's price.
  assert.equal(byLabel(pid, "Basic / ส่วนตัว / 30 วัน").price, 9900);
  // Bulk: open + set price for every "30 วัน".
  const thirty = all.filter((v) => v.label.endsWith("30 วัน")).map((v) => v.id);
  assert.deepEqual(s.adminBulkVariants(admin, pid, { variantIds: thirty, price: 29900, active: true }), { changed: 4 });
  const pub = s.productDetail(pid);
  assert.equal(pub.variants.length, 5);
  assert.ok(pub.variants.filter((v) => v.label.endsWith("30 วัน")).every((v) => v.price === 29900));
  assert.equal(Object.keys(pub.variants[0].options).length, 3);
  // Rename a value: labels follow.
  const g = s.adminOptionGroups(admin, pid).groups;
  s.adminSaveOptionGroups(admin, pid, {
    groups: g.map((x) => ({
      id: x.id,
      name: x.name,
      values: x.values.map((v) => ({ id: v.id, label: v.label === "แชร์" ? "แชร์ 5 จอ" : v.label })),
    })),
  });
  assert.ok(byLabel(pid, "Premium / แชร์ 5 จอ / 30 วัน"));
  // Remove "Premium": its unused variants are deleted.
  const g2 = s.adminOptionGroups(admin, pid).groups;
  s.adminSaveOptionGroups(admin, pid, {
    groups: g2.map((x) => ({ id: x.id, name: x.name, values: x.values.filter((v) => v.label !== "Premium") })),
  });
  assert.equal(variants(pid).length, 4);
  assert.ok(variants(pid).every((v) => v.label.startsWith("Basic")));
  // Limits.
  assert.throws(
    () => s.adminSaveOptionGroups(admin, pid, { groups: [1, 2, 3, 4, 5].map((i) => ({ name: "g" + i, values: ["a"] })) }),
    status(400),
  );
  assert.throws(
    () => s.adminSaveOptionGroups(admin, pid, { groups: [{ name: "a", values: ["x", "X"] }] }),
    status(400),
  );
});

test("combo variants work with checkout, sale price, limits, stock-watch, receipts, removal of sold combos", (t) => {
  const { s, admin, buyer, product, variants, byLabel } = fixture(t);
  const pid = product();
  s.adminEnableOptionGroups(admin, pid, { name: "ระยะเวลา" });
  const g = s.adminOptionGroups(admin, pid).groups[0];
  s.adminSaveOptionGroups(admin, pid, {
    price: 19900,
    groups: [
      { name: "แพ็กเกจ", values: ["Basic", "Premium"] },
      { id: g.id, name: "ระยะเวลา", values: g.values },
    ],
  });
  const premium = byLabel(pid, "Premium / 7 วัน");
  s.adminBulkVariants(admin, pid, { variantIds: [premium.id], active: true, price: 19900 });
  // Sale price + per-customer limit on the combo.
  s.adminSetVariantPricing(admin, premium.id, { salePrice: 14900, maxPerCustomer: 1 });
  s.importCodes(admin, { variantId: premium.id, items: [{ loginId: "p1@x.test", password: "a" }, { loginId: "p2@x.test", password: "b" }] });
  const pub = s.productDetail(pid).variants.find((v) => v.id === premium.id);
  assert.equal(pub.price, 14900);
  assert.equal(pub.maxPerCustomer, 1);
  const u = buyer();
  const o = s.createOrder(u, { variantId: premium.id, quantity: 1, requestKey: randomUUID() });
  assert.equal(o.total, 14900);
  const paid = s.pay(u, o.id, { paymentToken: o.paymentToken, outcome: "success" });
  assert.equal(paid.status, "DELIVERED");
  // Receipt / order label = the joined values.
  assert.equal(paid.label, "Premium / 7 วัน");
  assert.throws(() => s.createOrder(u, { variantId: premium.id, quantity: 1, requestKey: randomUUID() }), status(409));
  // Stock-watch on an out-of-stock combo.
  const basic = byLabel(pid, "Basic / 7 วัน");
  assert.equal(s.productDetail(pid).variants.find((v) => v.id === basic.id).available, false);
  s.addStockWatch(u, { variantId: basic.id });
  // Removing a sold combo's value: the variant is closed (history kept), not deleted.
  const groups = s.adminOptionGroups(admin, pid).groups;
  s.adminSaveOptionGroups(admin, pid, {
    groups: groups.map((x) => ({ id: x.id, name: x.name, values: x.values.filter((v) => v.label !== "Premium") })),
  });
  const closed = variants(pid).find((v) => v.id === premium.id);
  assert.equal(closed.active, false);
  assert.equal(s.orderDetail(u, o.id).label, "Premium / 7 วัน");
  assert.ok(!s.productDetail(pid).variants.some((v) => v.id === premium.id));
  // Watched combo with no orders is kept (closed) instead of deleted? It still names a value: stays.
  assert.ok(variants(pid).some((v) => v.id === basic.id));
});

test("preorder product with groups: reservation on a combo variant", (t) => {
  const { s, admin, buyer, product, byLabel } = fixture(t);
  const pid = product({ preorder: true });
  s.adminEnableOptionGroups(admin, pid, { name: "ระยะเวลา" });
  const g = s.adminOptionGroups(admin, pid).groups[0];
  s.adminSaveOptionGroups(admin, pid, {
    groups: [{ name: "แพ็กเกจ", values: ["A", "B"] }, { id: g.id, name: g.name, values: g.values }],
  });
  const b = byLabel(pid, "B / 7 วัน");
  s.adminBulkVariants(admin, pid, { variantIds: [b.id], active: true });
  assert.equal(s.productDetail(pid).variants.find((v) => v.id === b.id).available, true);
  const u = buyer();
  const r = s.createOrder(u, { variantId: b.id, quantity: 1, requestKey: randomUUID() });
  const paid = s.pay(u, r.id, { paymentToken: r.paymentToken, outcome: "success" });
  assert.equal(paid.status, "PREORDER");
  assert.equal(paid.label, "B / 7 วัน");
});

test("duplicate copies groups, values, mapping, delivery type and pricing", (t) => {
  const { s, admin, product, variants } = fixture(t);
  const pid = product();
  s.adminSetDelivery(admin, pid, { type: "shared" });
  s.adminEnableOptionGroups(admin, pid, { name: "ระยะเวลา" });
  const g = s.adminOptionGroups(admin, pid).groups[0];
  s.adminSaveOptionGroups(admin, pid, {
    groups: [{ name: "จอ", values: ["1 จอ", "2 จอ"] }, { id: g.id, name: g.name, values: g.values }],
  });
  s.adminBulkVariants(admin, pid, { variantIds: variants(pid).map((v) => v.id), active: true });
  s.adminSetVariantPricing(admin, variants(pid)[0].id, { compareAt: 20000 });
  const copy = s.duplicateProduct(admin, pid);
  const og = s.adminOptionGroups(admin, copy.id);
  assert.equal(og.groups.length, 2);
  assert.deepEqual(og.groups.map((x) => x.name), ["จอ", "ระยะเวลา"]);
  assert.equal(Object.keys(og.options).length, 2);
  assert.ok(og.groups[0].id !== s.adminOptionGroups(admin, pid).groups[0].id);
  assert.equal(s.adminDelivery(admin, copy.id).type, "shared");
  const copied = variants(copy.id);
  assert.deepEqual(copied.map((v) => v.label).sort(), variants(pid).map((v) => v.label).sort());
  assert.ok(s.adminProductPricing(admin, copy.id).variants[copied[0].id]);
  // Stock never copies.
  assert.ok(copied.every((v) => v.stock === 0));
});
