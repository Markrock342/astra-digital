// Pricing rules (server/pricing.mjs): compare-at + scheduled sale (Bangkok window edges),
// per-account purchase limit (incl. the last unit on two connections), customer tags +
// reseller tag prices (lowest of normal / sale / tag), coupons on top of the effective
// price, receipts + payments consistent, ADMIN-only writes and the HTTP routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { ensurePricing, resolvePrice, saleActive } from "../server/pricing.mjs";

// stream-plus-30 = ฿100 ready stock (8 units), stream-plus-90 = ฿110 (same product),
// cinema-max-90 = ฿129 preorder.
const READY = "stream-plus-30";
const READY_90 = "stream-plus-90";
const PREORDER = "cinema-max-90";
const PASSWORD = "Test-only-Password-123";

let keySeq = 0;
const key = () => "price-" + String(++keySeq).padStart(6, "0");
const at = (iso) => Date.parse(iso);

function fixture(t, options = {}) {
  const s = createCommerce({ allowDemoAdmin: true, ...options });
  t.after(() => s.db.close());
  const customer = (name) => {
    const auth = s.register({
      name,
      email: name.toLowerCase().replace(/\s+/g, "-") + "@example.invalid",
      password: PASSWORD,
    });
    return { user: s.session(auth.token), token: auth.token };
  };
  const merchant = s.demoMerchant();
  const admin = s.session(merchant.token);
  const staffAuth = customer("Price Staff");
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const buyer = customer("Price Buyer");
  return { s, admin, adminToken: merchant.token, staff, staffToken: staffAuth.token, customer, ...buyer };
}
const variantOf = (s, user, id = READY) =>
  s.products(user).flatMap((p) => p.variants).find((v) => v.id === id);

test("sale window: Bangkok start and end edges, compare-at and -X% badge", (t) => {
  let now = at("2026-11-30T16:00:00Z"); // 23:00 Bangkok, the day before
  const { s, admin, user } = fixture(t, { clock: () => now });
  const saved = s.adminSetVariantPricing(admin, READY, {
    compareAt: 15000,
    salePrice: 7000,
    saleStartsAt: "2026-12-01T00:00", // Bangkok = 2026-11-30 17:00 UTC
    saleEndsAt: "2026-12-01T23:59", // whole minute: until 16:59:59 UTC
  });
  assert.equal(saved.saleStartsAt, "2026-11-30 17:00:00");
  assert.equal(saved.saleEndsAt, "2026-12-01 16:59:59");
  assert.equal(saved.saleStartsAtLocal, "2026-12-01T00:00");
  assert.equal(saved.saleStatus, "scheduled");

  // Before the start: normal price, compare-at struck through, raw sale data never public.
  let v = variantOf(s, null);
  assert.equal(v.price, 10000);
  assert.equal(v.priceKind, "regular");
  assert.equal(v.compareAt, 15000);
  assert.equal(v.discountPercent, 33);
  for (const hidden of ["sale_price", "sale_starts_at", "sale_ends_at", "compare_at", "max_per_customer"])
    assert.equal(hidden in v, false, hidden + " must stay internal");

  now = at("2026-11-30T16:59:59.999Z");
  assert.equal(variantOf(s, null).price, 10000);
  assert.equal(s.checkCoupon(user, { code: "NOPE", variantId: READY, quantity: 1 }).valid, false);

  now = at("2026-11-30T17:00:00Z"); // exactly 00:00 Bangkok
  v = variantOf(s, null);
  assert.equal(v.price, 7000);
  assert.equal(v.priceKind, "sale");
  assert.equal(v.regularPrice, 10000);
  assert.equal(v.compareAt, 15000);
  assert.equal(v.discountPercent, 53);
  assert.equal(v.saleEndsAt, "2026-12-01 16:59:59");
  const first = s.createOrder(user, { variantId: READY, quantity: 2, requestKey: key() });
  assert.equal(first.total, 14000);

  now = at("2026-12-01T16:59:59.999Z"); // 23:59:59 Bangkok, last moment of the sale
  assert.equal(variantOf(s, null).price, 7000);
  assert.equal(s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() }).total, 7000);

  now = at("2026-12-01T17:00:00Z"); // 00:00 next day: back to normal
  v = variantOf(s, null);
  assert.equal(v.price, 10000);
  assert.equal(v.priceKind, "regular");
  assert.equal(s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() }).total, 10000);
  assert.equal(s.adminProductPricing(admin, "stream-plus").variants[READY].saleStatus, "ended");

  // Without compare-at, an active sale strikes through the normal price.
  s.adminSetVariantPricing(admin, READY, { compareAt: null, saleStartsAt: null, saleEndsAt: null });
  v = variantOf(s, null);
  assert.equal(v.price, 7000);
  assert.equal(v.compareAt, 10000);
  assert.equal(v.discountPercent, 30);
  // Clearing the sale price also clears the window.
  const cleared = s.adminSetVariantPricing(admin, READY, { salePrice: null, saleStartsAt: "2026-12-05" });
  assert.equal(cleared.salePrice, null);
  assert.equal(cleared.saleStartsAt, null);
  assert.equal(variantOf(s, null).compareAt, null);
});

test("pure price rules: lowest of normal / sale / tag, never above normal", () => {
  const v = { compare_at: null, sale_price: 8000, sale_starts_at: null, sale_ends_at: null };
  const nowSql = "2026-12-01 00:00:00";
  assert.equal(saleActive(v, nowSql), true);
  assert.equal(saleActive({ ...v, sale_starts_at: "2026-12-01 00:00:01" }, nowSql), false);
  assert.equal(saleActive({ ...v, sale_ends_at: "2026-12-01 00:00:00" }, nowSql), true);
  assert.equal(saleActive({ ...v, sale_ends_at: "2026-11-30 23:59:59" }, nowSql), false);
  assert.equal(resolvePrice(v, { base: 10000, nowSql }).unitPrice, 8000);
  const tag = resolvePrice(v, { base: 10000, nowSql, tagPrice: 7000, tagName: "ตัวแทน" });
  assert.deepEqual([tag.unitPrice, tag.priceKind, tag.priceTag, tag.compareAt], [7000, "tag", "ตัวแทน", 10000]);
  const saleWins = resolvePrice(v, { base: 10000, nowSql, tagPrice: 9000, tagName: "VIP" });
  assert.deepEqual([saleWins.unitPrice, saleWins.priceKind, saleWins.priceTag], [8000, "sale", null]);
  // Normal price lowered under a stored sale / tag price: the normal price wins.
  const lowered = resolvePrice(v, { base: 5000, nowSql, tagPrice: 6000, tagName: "VIP" });
  assert.deepEqual([lowered.unitPrice, lowered.priceKind, lowered.compareAt], [5000, "regular", null]);
  // Legacy free preorder option (base 0) stays 0.
  assert.equal(resolvePrice(v, { base: 0, nowSql, tagPrice: 100 }).unitPrice, 0);
});

test("pricing input rules and ADMIN-only writes (STAFF can read)", (t) => {
  const { s, admin, staff, user } = fixture(t);
  const bad = (input, re) =>
    assert.throws(() => s.adminSetVariantPricing(admin, READY, input), (e) => e.status === 400 && re.test(e.message));
  bad({ compareAt: 10000 }, /ราคาก่อนลดต้องมากกว่าราคาขาย/);
  bad({ salePrice: 10000 }, /ราคาโปรต้องต่ำกว่าราคาปกติ/);
  bad({ salePrice: 50 }, /ราคาโปรไม่ถูกต้อง/);
  bad({ salePrice: 9000, saleStartsAt: "2026-12-02T00:00", saleEndsAt: "2026-12-01T00:00" }, /วันจบโปรต้องหลังวันเริ่ม/);
  bad({ salePrice: 9000, saleStartsAt: "tomorrow" }, /วันเริ่มโปรไม่ถูกต้อง/);
  bad({ maxPerCustomer: 0.5 }, /1–1000/);
  bad({ tagPrices: [{ tag: "ตัวแทน", price: 10000 }] }, /ต้องต่ำกว่าราคาปกติ/);
  bad({ tagPrices: [{ tag: "VIP", price: 9000 }, { tag: "vip", price: 8000 }] }, /ซ้ำ/);
  bad({ tagPrices: [{ tag: "x".repeat(25), price: 9000 }] }, /1–24/);
  // Nothing was half-saved by the rejected calls.
  assert.deepEqual(
    { ...s.db.prepare("SELECT compare_at,sale_price,max_per_customer FROM variants WHERE id=?").get(READY) },
    { compare_at: null, sale_price: null, max_per_customer: null },
  );
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM customer_tag_defs").get().n, 0);

  // STAFF and customers are both refused (403).
  for (const actor of [staff, user]) {
    const status = 403;
    assert.throws(() => s.adminSetVariantPricing(actor, READY, { salePrice: 100 }), (e) => e.status === status);
    assert.throws(() => s.adminSetProductLimit(actor, "stream-plus", { maxPerCustomer: 1 }), (e) => e.status === status);
    assert.throws(() => s.adminSetCustomerTags(actor, user.id, { tags: ["VIP"] }), (e) => e.status === status);
    assert.throws(() => s.adminSaveCustomerTag(actor, { tag: "VIP", color: "red" }), (e) => e.status === status);
    assert.throws(() => s.adminDeleteCustomerTag(actor, "VIP"), (e) => e.status === status);
  }
  assert.throws(() => s.adminProductPricing(user, "stream-plus"), (e) => e.status === 403);
  assert.throws(() => s.adminCustomerTags(user), (e) => e.status === 403);

  s.adminSetVariantPricing(admin, READY, { compareAt: 12000, tagPrices: [{ tag: " ตัวแทน ", price: 8500 }] });
  s.adminSetCustomerTags(admin, user.id, { tags: ["ตัวแทน", "VIP"] });
  // STAFF sees pricing and tags, read-only.
  const pricing = s.adminProductPricing(staff, "stream-plus");
  assert.equal(pricing.variants[READY].compareAt, 12000);
  assert.deepEqual(pricing.variants[READY].tagPrices.map((r) => [r.tag, r.price]), [["ตัวแทน", 8500]]);
  assert.deepEqual(s.adminCustomerDetail(staff, user.id).customer.tags.map((x) => x.tag), ["VIP", "ตัวแทน"]);
  const tags = s.adminCustomerTags(staff).tags;
  assert.deepEqual(tags.map((x) => [x.tag, x.customers, x.prices]), [["VIP", 1, 0], ["ตัวแทน", 1, 1]]);
  // Audit trail for each write.
  const actions = s.db.prepare("SELECT action FROM audit WHERE action IN ('UPDATE_VARIANT_PRICING','SET_CUSTOMER_TAGS')").all();
  assert.equal(actions.length, 2);
});

test("customer tags: case-insensitive, colours, list filter, delete", (t) => {
  const { s, admin, staff, user, customer } = fixture(t);
  const other = customer("Plain Customer").user;
  assert.deepEqual(
    s.adminSetCustomerTags(admin, user.id, { tags: ["VIP", "vip", " VIP  ", "ตัวแทน"] }).tags.map((x) => x.tag),
    ["VIP", "ตัวแทน"],
  );
  s.adminSaveCustomerTag(admin, { tag: "vip", color: "red" });
  assert.deepEqual(s.adminCustomerDetail(admin, user.id).customer.tags, [
    { tag: "VIP", color: "red" },
    { tag: "ตัวแทน", color: "gray" },
  ]);
  assert.throws(() => s.adminSaveCustomerTag(admin, { tag: "VIP", color: "beige" }), (e) => e.status === 400);
  assert.throws(
    () => s.adminSetCustomerTags(admin, user.id, { tags: Array.from({ length: 11 }, (_, i) => "t" + i) }),
    (e) => e.status === 400,
  );
  assert.throws(() => s.adminSetCustomerTags(admin, admin.id, { tags: ["VIP"] }), (e) => e.status === 404);

  const listed = s.adminCustomers(staff, { tag: "vip", limit: "50" }).customers;
  assert.deepEqual(listed.map((c) => c.id), [user.id]);
  assert.deepEqual(listed[0].tags.map((x) => x.tag), ["VIP", "ตัวแทน"]);
  const all = s.adminCustomers(staff, { limit: "50" }).customers;
  assert.deepEqual(all.find((c) => c.id === other.id).tags, []);

  const removed = s.adminDeleteCustomerTag(admin, "vip");
  assert.equal(removed.customers, 1);
  assert.deepEqual(s.adminCustomerDetail(admin, user.id).customer.tags.map((x) => x.tag), ["ตัวแทน"]);
  assert.equal(s.adminCustomers(staff, { tag: "VIP" }).customers.length, 0);
});

test("tag price: lowest of tag / sale / normal, shown to that customer only; coupon on top", (t) => {
  const { s, admin, staff, user, customer } = fixture(t);
  const plain = customer("Plain Buyer").user;
  s.adminSetVariantPricing(admin, READY, {
    tagPrices: [
      { tag: "ตัวแทน", price: 8000 },
      { tag: "VIP", price: 9000 },
    ],
  });
  s.adminSetCustomerTags(admin, user.id, { tags: ["VIP", "ตัวแทน"] });

  // Two tags: the cheaper one applies, struck-through normal price.
  let v = variantOf(s, user);
  assert.deepEqual([v.price, v.priceKind, v.priceTag, v.compareAt, v.discountPercent], [8000, "tag", "ตัวแทน", 10000, 20]);
  // Everyone else sees and pays the normal price; staff too.
  for (const viewer of [null, plain, staff, admin]) {
    v = variantOf(s, viewer);
    assert.deepEqual([v.price, v.priceKind, v.priceTag, v.compareAt], [10000, "regular", null, null]);
  }
  assert.equal(s.productDetail("stream-plus", user).variants.find((x) => x.id === READY).price, 8000);
  assert.equal(s.productDetail("stream-plus", null).variants.find((x) => x.id === READY).price, 10000);

  // Active sale below the tag price wins; sale above the tag price does not.
  s.adminSetVariantPricing(admin, READY, { salePrice: 7500 });
  assert.equal(variantOf(s, user).price, 7500);
  assert.equal(variantOf(s, user).priceKind, "sale");
  assert.equal(variantOf(s, plain).price, 7500);
  s.adminSetVariantPricing(admin, READY, { salePrice: 9500 });
  assert.equal(variantOf(s, user).price, 8000);
  assert.equal(variantOf(s, plain).price, 9500);

  // Coupon applies on the effective price; order, payment and receipt agree.
  s.adminCreateCoupon(admin, { code: "TAG10", type: "PERCENT", value: 10 });
  assert.deepEqual(s.checkCoupon(user, { code: "TAG10", variantId: READY, quantity: 2 }), {
    valid: true,
    code: "TAG10",
    subtotal: 16000,
    discount: 1600,
    total: 14400,
  });
  const order = s.createOrder(user, { variantId: READY, quantity: 2, requestKey: key(), couponCode: "TAG10" });
  assert.deepEqual([order.total, order.discount, order.subtotal], [14400, 1600, 16000]);
  const paid = s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  assert.equal(paid.status, "DELIVERED");
  assert.equal(
    s.db.prepare("SELECT SUM(amount) AS n FROM payments WHERE order_id=? AND status='SUCCEEDED'").get(order.id).n,
    14400,
  );
  const receipt = s.orderReceipt(user, order.id);
  assert.deepEqual(
    [receipt.item.unitPrice, receipt.item.subtotal, receipt.item.discount, receipt.total],
    [8000, 16000, 1600, 14400],
  );
  // Plain customer: coupon on the sale price.
  const plainOrder = s.createOrder(plain, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "TAG10" });
  assert.deepEqual([plainOrder.total, plainOrder.discount], [8550, 950]);

  // Tag removed: back to the public price on the next order.
  s.adminSetCustomerTags(admin, user.id, { tags: [] });
  assert.equal(variantOf(s, user).price, 9500);
  assert.equal(s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() }).total, 9500);
});

test("purchase limit per option: pending + delivered count, cancelled / failed free the slot", (t) => {
  const { s, admin, user, customer } = fixture(t);
  s.adminSetVariantPricing(admin, READY, { maxPerCustomer: 1 });
  assert.deepEqual(
    [variantOf(s, null).maxPerCustomer, variantOf(s, null).remainingForYou, variantOf(s, user).remainingForYou],
    [1, null, 1],
  );
  assert.throws(
    () => s.createOrder(user, { variantId: READY, quantity: 2, requestKey: key() }),
    (e) => e.status === 409 && e.message === "สินค้านี้จำกัด 1 ชิ้นต่อบัญชี สั่งเพิ่มได้อีก 1 ชิ้น",
  );
  const first = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
  assert.equal(variantOf(s, user).remainingForYou, 0);
  // Pending (unpaid) order already counts.
  assert.throws(
    () => s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() }),
    (e) => e.status === 409 && e.message === "สินค้านี้จำกัด 1 ชิ้นต่อบัญชี คุณมีคำสั่งซื้อแล้ว 1 ชิ้น ครบจำนวนแล้ว",
  );
  // Cancelled frees the slot.
  s.adminCancelOrder(admin, first.id, { reason: "ลูกค้าขอยกเลิก" });
  const second = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
  // Failed payment frees the slot too.
  s.pay(user, second.id, { paymentToken: second.paymentToken, outcome: "failure" });
  const third = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
  s.pay(user, third.id, { paymentToken: third.paymentToken, outcome: "success" });
  // Delivered counts.
  assert.throws(() => s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() }), (e) => e.status === 409);
  // Other options of the product and other customers are not affected.
  s.createOrder(user, { variantId: READY_90, quantity: 3, requestKey: key() });
  const other = customer("Other Buyer").user;
  s.createOrder(other, { variantId: READY, quantity: 1, requestKey: key() });
  // Limit removed: buying works again.
  s.adminSetVariantPricing(admin, READY, { maxPerCustomer: null });
  s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
});

test("purchase limit per product covers all options and preorder reservations", (t) => {
  const { s, admin, user } = fixture(t);
  assert.deepEqual(s.adminSetProductLimit(admin, "stream-plus", { maxPerCustomer: 2 }), {
    productId: "stream-plus",
    maxPerCustomer: 2,
  });
  assert.equal(s.adminProductPricing(admin, "stream-plus").maxPerCustomer, 2);
  assert.equal(variantOf(s, user, READY_90).maxPerCustomer, 2);
  s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
  assert.equal(variantOf(s, user, READY_90).remainingForYou, 1);
  s.createOrder(user, { variantId: READY_90, quantity: 1, requestKey: key() });
  assert.throws(
    () => s.createOrder(user, { variantId: READY_90, quantity: 1, requestKey: key() }),
    (e) => e.status === 409 && /จำกัด 2 ชิ้นต่อบัญชี/.test(e.message),
  );
  // Stricter option limit wins over the product limit.
  s.adminSetProductLimit(admin, "stream-plus", { maxPerCustomer: null });
  s.adminSetVariantPricing(admin, READY_90, { maxPerCustomer: 1 });
  assert.throws(() => s.createOrder(user, { variantId: READY_90, quantity: 1, requestKey: key() }), (e) => e.status === 409);

  // Preorder: a paid reservation (PREORDER) counts against the limit.
  s.adminSetProductLimit(admin, "cinema-max", { maxPerCustomer: 1 });
  const reservation = s.createOrder(user, { variantId: PREORDER, quantity: 1, requestKey: key() });
  assert.equal(reservation.preorder, true);
  assert.equal(s.pay(user, reservation.id, { paymentToken: reservation.paymentToken, outcome: "success" }).status, "PREORDER");
  assert.throws(() => s.createOrder(user, { variantId: PREORDER, quantity: 1, requestKey: key() }), (e) => e.status === 409);
});

test("two connections on one database file cannot both take the last allowed unit", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-limit-"));
  const path = join(dir, "shop.sqlite");
  const k = randomBytes(32);
  const a = createCommerce({ path, key: k, allowDemoAdmin: true });
  const b = createCommerce({ path, key: k, allowDemoAdmin: true, seed: false });
  t.after(() => {
    for (const s of [a, b])
      try {
        s.db.close();
      } catch {
        /* already closed */
      }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may keep a WAL lock briefly */
    }
  });
  const admin = a.session(a.demoMerchant().token);
  a.adminSetVariantPricing(admin, READY, { maxPerCustomer: 1 });
  const token = a.register({ name: "Race Buyer", email: "race@example.invalid", password: PASSWORD }).token;
  const onA = a.session(token);
  const onB = b.session(token);
  // Both previews still see one left.
  assert.equal(variantOf(a, onA).remainingForYou, 1);
  assert.equal(variantOf(b, onB).remainingForYou, 1);
  a.createOrder(onA, { variantId: READY, quantity: 1, requestKey: key() });
  assert.throws(() => b.createOrder(onB, { variantId: READY, quantity: 1, requestKey: key() }), (e) => e.status === 409);
  assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id=?").get(onA.id).n, 1);
});

test("HTTP: per-viewer catalog prices and the admin pricing / tag routes", async (t) => {
  const { s, admin, adminToken, staffToken, token, user } = fixture(t);
  const handle = createAPIHandler(s);
  const call = async (method, path, cookie, body) => {
    const headers = cookie ? { Cookie: "astra_session=" + cookie } : {};
    if (method !== "GET") headers["X-Astra-Request"] = "1";
    if (body) headers["Content-Type"] = "application/json";
    const res = await handle(
      new Request("http://local.test" + path, { method, headers, body: body ? JSON.stringify(body) : undefined }),
    );
    return { status: res.status, body: await res.json() };
  };
  // Staff cannot write; admin can.
  assert.equal((await call("PATCH", "/api/admin/variants/" + READY + "/pricing", staffToken, { compareAt: 20000 })).status, 403);
  let res = await call("PATCH", "/api/admin/variants/" + READY + "/pricing", adminToken, {
    compareAt: 20000,
    tagPrices: [{ tag: "ตัวแทน", price: 6000 }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.compareAt, 20000);
  assert.equal((await call("PATCH", "/api/admin/products/stream-plus/limit", adminToken, { maxPerCustomer: 3 })).status, 200);
  assert.equal((await call("PATCH", "/api/admin/customers/" + user.id + "/tags", staffToken, { tags: ["ตัวแทน"] })).status, 403);
  res = await call("PATCH", "/api/admin/customers/" + user.id + "/tags", adminToken, { tags: ["ตัวแทน"] });
  assert.deepEqual(res.body.tags, [{ tag: "ตัวแทน", color: "gray" }]);
  assert.equal((await call("POST", "/api/admin/customer-tags", adminToken, { tag: "ตัวแทน", color: "green" })).status, 200);
  res = await call("GET", "/api/admin/customer-tags", staffToken);
  assert.deepEqual(res.body.tags.map((x) => [x.tag, x.color, x.customers]), [["ตัวแทน", "green", 1]]);
  res = await call("GET", "/api/admin/customers?tag=" + encodeURIComponent("ตัวแทน"), staffToken);
  assert.deepEqual(res.body.customers.map((c) => c.id), [user.id]);
  res = await call("GET", "/api/admin/products/stream-plus/pricing", staffToken);
  assert.equal(res.body.maxPerCustomer, 3);

  // Catalog: tagged customer sees the reseller price; signed-out visitors do not.
  const ready = (b) => b.products.flatMap((p) => p.variants).find((v) => v.id === READY);
  const mine = ready((await call("GET", "/api/products", token)).body);
  assert.deepEqual([mine.price, mine.priceKind, mine.priceTag, mine.compareAt, mine.remainingForYou], [6000, "tag", "ตัวแทน", 20000, 3]);
  const anon = ready((await call("GET", "/api/products")).body);
  assert.deepEqual([anon.price, anon.priceTag, anon.compareAt, anon.remainingForYou, anon.maxPerCustomer], [10000, null, 20000, null, 3]);
  const detail = (await call("GET", "/api/products/stream-plus", token)).body.product;
  assert.equal(detail.variants.find((v) => v.id === READY).price, 6000);

  // A client-sent price is ignored: the order uses the server price.
  res = await call("POST", "/api/orders", token, { variantId: READY, quantity: 1, requestKey: key(), price: 1, total: 1 });
  assert.equal(res.status, 201);
  assert.equal(res.body.total, 6000);

  // Delete the tag: the price goes back to normal for that customer.
  res = await call("DELETE", "/api/admin/customer-tags/" + encodeURIComponent("ตัวแทน"), adminToken);
  assert.deepEqual([res.status, res.body.customers, res.body.prices], [200, 1, 1]);
  assert.equal(ready((await call("GET", "/api/products", token)).body).price, 10000);
  assert.equal(s.adminProductPricing(admin, "stream-plus").variants[READY].tagPrices.length, 0);
});

test("ensurePricing is idempotent and PDPA deletion drops the customer's tags", (t) => {
  const { s, admin: boss, adminToken, user } = fixture(t);
  s.adminSetCustomerTags(boss, user.id, { tags: ["VIP"] });
  // Re-running the ensure on the same database changes nothing.
  ensurePricing(s.db);
  ensurePricing(s.db);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM customer_tags").get().n, 1);
  const cols = s.db.prepare("PRAGMA table_info(variants)").all().map((c) => c.name);
  for (const c of ["compare_at", "sale_price", "sale_starts_at", "sale_ends_at", "max_per_customer"])
    assert.ok(cols.includes(c), c);
  // PDPA: approving the deletion request removes the tags of that account.
  const salt = randomBytes(16).toString("hex");
  s.db
    .prepare("UPDATE users SET password_hash=? WHERE id=?")
    .run(salt + ":" + scryptSync("Boss-Pricing-Pass-123", salt, 64).toString("hex"), boss.id);
  const admin = s.session(adminToken);
  const req = s.requestAccountDeletion(user, { reason: "ขอลบบัญชี" });
  s.approvePrivacyDeletion(admin, req.id, { currentPassword: "Boss-Pricing-Pass-123" });
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM customer_tags WHERE user_id=?").get(user.id).n, 0);
});

test("duplicate product copies sale/compare/limit/tag prices; editing the copy leaves the source alone", (t) => {
  const { s, admin } = fixture(t);
  s.adminSetProductLimit(admin, "stream-plus", { maxPerCustomer: 3 });
  s.adminSetVariantPricing(admin, READY, {
    compareAt: 15000,
    salePrice: 7900,
    saleStartsAt: "2025-12-31T17:00",
    saleEndsAt: "2026-12-31T23:59",
    maxPerCustomer: 2,
    tagPrices: [{ tag: "ตัวแทน", price: 7000 }],
  });
  const sourcePricing = (id) =>
    s.db
      .prepare(
        "SELECT compare_at,sale_price,sale_starts_at,sale_ends_at,max_per_customer FROM variants WHERE id=?",
      )
      .get(id);
  const before = sourcePricing(READY);
  const copy = s.duplicateProduct(admin, "stream-plus");
  assert.equal(
    s.db.prepare("SELECT max_per_customer FROM products WHERE id=?").get(copy.id).max_per_customer,
    3,
  );
  const copyVariants = s.db
    .prepare("SELECT id,label FROM variants WHERE product_id=? ORDER BY sort_order,id")
    .all(copy.id);
  const sourceVariants = s.db
    .prepare("SELECT id,label FROM variants WHERE product_id=? ORDER BY sort_order,id")
    .all("stream-plus");
  assert.equal(copyVariants.length, sourceVariants.length);
  const copyReady = copyVariants.find((v) => v.label === sourceVariants.find((x) => x.id === READY).label);
  assert.ok(copyReady);
  assert.notEqual(copyReady.id, READY);
  assert.deepEqual({ ...sourcePricing(copyReady.id) }, { ...before });
  const tags = (variantId) =>
    s.db
      .prepare("SELECT tag,price FROM variant_tag_prices WHERE variant_id=? ORDER BY tag")
      .all(variantId)
      .map((r) => ({ ...r }));
  assert.deepEqual(tags(copyReady.id), tags(READY));
  // Edit the copy: source pricing stays the same.
  s.adminSetVariantPricing(admin, copyReady.id, {
    compareAt: 20000,
    salePrice: 5000,
    maxPerCustomer: 9,
    tagPrices: [{ tag: "ตัวแทน", price: 4500 }],
  });
  assert.deepEqual({ ...sourcePricing(READY) }, { ...before });
  assert.deepEqual(tags(READY), [{ tag: "ตัวแทน", price: 7000 }]);
  assert.equal(s.db.prepare("SELECT max_per_customer FROM products WHERE id=?").get("stream-plus").max_per_customer, 3);
  const audit = s.db.prepare("SELECT detail FROM audit WHERE action='DUPLICATE_PRODUCT' AND entity_id=?").get(copy.id);
  assert.ok(JSON.parse(audit.detail).tagPrices >= 1);
});
