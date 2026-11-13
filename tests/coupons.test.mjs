// Coupons / discount codes: discount maths, Bangkok date window, usage limits under
// back-to-back orders, first-order-only, product scope, pay == discounted total,
// release on cancel / failed payment, ADMIN-only admin APIs, guessing rate limit,
// live-mode exclusion of test money and the sales-report discount figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createCommerceCore } from "../server/domain.mjs";
import { createAPIHandler, COUPON_RATE_LIMIT } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";

// stream-plus-30 = ฿100 (ready stock), stream-plus-90 = ฿110, cinema-max-90 = ฿129 preorder.
const READY = "stream-plus-30";
const READY_90 = "stream-plus-90";
const PREORDER = "cinema-max-90";

let keySeq = 0;
const key = (label = "k") => label + "-" + String(++keySeq).padStart(6, "0");

function fixture(t, options = {}) {
  const s = createCommerce({ allowDemoAdmin: true, ...options });
  t.after(() => s.db.close());
  const customer = (name) => {
    const auth = s.register({
      name,
      email: name.toLowerCase().replace(/\s+/g, "-") + "@example.invalid",
      password: "Test-only-Password-123",
    });
    return { user: s.session(auth.token), token: auth.token };
  };
  const buyer = customer("Coupon Buyer");
  const merchantAuth = s.demoMerchant();
  const admin = s.session(merchantAuth.token);
  const staffAuth = customer("Coupon Staff");
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const coupon = (input) => s.adminCreateCoupon(admin, { type: "PERCENT", value: 10, ...input }).coupon;
  return {
    s,
    admin,
    adminToken: merchantAuth.token,
    staff,
    staffToken: staffAuth.token,
    user: buyer.user,
    token: buyer.token,
    customer,
    coupon,
  };
}
const redemptions = (s, code) =>
  s.db
    .prepare("SELECT * FROM coupon_redemptions WHERE code=? ORDER BY created_at, rowid")
    .all(code);

test("percent with a cap, fixed amount and minimum order total", (t) => {
  const { s, user, coupon } = fixture(t);
  coupon({ code: "TEN-CAP", type: "PERCENT", value: 10, maxDiscount: 1500 });
  coupon({ code: "FIFTY", type: "FIXED", value: 5000 });
  coupon({ code: "MIN300", type: "FIXED", value: 2000, minTotal: 30000 });

  // 10% of ฿100 = ฿10 (under the ฿15 cap); 10% of 3 × ฿110 = ฿33 → capped at ฿15.
  assert.deepEqual(s.checkCoupon(user, { code: "ten-cap", variantId: READY, quantity: 1 }), {
    valid: true,
    code: "TEN-CAP",
    subtotal: 10000,
    discount: 1000,
    total: 9000,
  });
  const capped = s.checkCoupon(user, { code: "TEN-CAP", variantId: READY_90, quantity: 3 });
  assert.equal(capped.discount, 1500);
  assert.equal(capped.total, 33000 - 1500);
  assert.equal(s.checkCoupon(user, { code: " fifty ", variantId: READY, quantity: 2 }).discount, 5000);

  const short = s.checkCoupon(user, { code: "MIN300", variantId: READY, quantity: 2 });
  assert.equal(short.valid, false);
  assert.match(short.reason, /ยอดสั่งซื้อขั้นต่ำ ฿300 \(ขาดอีก ฿100\)/);
  assert.equal(s.checkCoupon(user, { code: "MIN300", variantId: READY, quantity: 3 }).discount, 2000);

  const missing = s.checkCoupon(user, { code: "NOPE-123", variantId: READY, quantity: 1 });
  assert.deepEqual(missing, { valid: false, reason: "ไม่พบโค้ดส่วนลดนี้" });

  // A fixed discount never takes the order below ฿1 (orders.total CHECK > 0).
  coupon({ code: "HUGE", type: "FIXED", value: 50000 });
  const floor = s.checkCoupon(user, { code: "HUGE", variantId: READY, quantity: 1 });
  assert.equal(floor.discount, 9900);
  assert.equal(floor.total, 100);
  const order = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "HUGE" });
  assert.equal(order.total, 100);
  assert.equal(order.discount, 9900);
  assert.equal(order.subtotal, 10000);
  assert.equal(order.coupon_code, "HUGE");
});

test("admin validation: code format, percent 1–90, unique code (any case)", (t) => {
  const { s, admin, coupon } = fixture(t);
  for (const code of ["AB", "-ABC", "ABC-", "AB C", "ส่วนลด", "X".repeat(33)])
    assert.throws(() => coupon({ code }), (e) => e.status === 400, code);
  assert.throws(() => coupon({ code: "PCT91", value: 91 }), (e) => e.status === 400);
  assert.throws(() => coupon({ code: "PCT0", value: 0 }), (e) => e.status === 400);
  assert.throws(() => coupon({ code: "FIX0", type: "FIXED", value: 50 }), (e) => e.status === 400);
  assert.throws(
    () => coupon({ code: "BADWIN", startsAt: "2026-12-10T00:00", endsAt: "2026-12-01T00:00" }),
    (e) => e.status === 400,
  );
  assert.throws(() => coupon({ code: "SCOPE0", scope: "PRODUCTS", productIds: [] }), (e) => e.status === 400);
  const made = coupon({ code: "new-year-2027", type: "PERCENT", value: 90 });
  assert.equal(made.code, "NEW-YEAR-2027");
  assert.throws(() => coupon({ code: "New-Year-2027" }), (e) => e.status === 409);
  // FIXED ignores a cap.
  assert.equal(coupon({ code: "FIXCAP", type: "FIXED", value: 1000, maxDiscount: 500 }).maxDiscount, null);
  assert.equal(s.adminCoupons(admin).coupons.length, 2);
});

test("date window is Asia/Bangkok wall time", (t) => {
  let now = Date.parse("2026-11-30T16:30:00Z"); // 23:30 on 30 Nov in Bangkok
  const { s, user, coupon, admin } = fixture(t, { clock: () => now });
  const made = coupon({ code: "DEC-ONLY", startsAt: "2026-12-01T00:00", endsAt: "2026-12-31" });
  // Stored in UTC, shown back as Bangkok time for the form.
  const row = s.db.prepare("SELECT starts_at,ends_at FROM coupons WHERE id=?").get(made.id);
  assert.equal(row.starts_at, "2026-11-30 17:00:00");
  assert.equal(row.ends_at, "2026-12-31 16:59:59");
  assert.equal(made.startsAtLocal, "2026-12-01T00:00");
  assert.equal(made.endsAtLocal, "2026-12-31T23:59");
  assert.equal(made.status, "scheduled");

  const before = s.checkCoupon(user, { code: "DEC-ONLY", variantId: READY, quantity: 1 });
  assert.equal(before.valid, false);
  assert.match(before.reason, /ยังไม่เริ่มใช้/);
  now = Date.parse("2026-11-30T17:00:00Z"); // 00:00 on 1 Dec in Bangkok
  assert.equal(s.checkCoupon(user, { code: "DEC-ONLY", variantId: READY, quantity: 1 }).valid, true);
  now = Date.parse("2026-12-31T16:59:30Z"); // 23:59:30 on 31 Dec in Bangkok
  assert.equal(s.checkCoupon(user, { code: "DEC-ONLY", variantId: READY, quantity: 1 }).valid, true);
  now = Date.parse("2026-12-31T17:00:30Z"); // 00:00:30 on 1 Jan in Bangkok
  const after = s.checkCoupon(user, { code: "DEC-ONLY", variantId: READY, quantity: 1 });
  assert.deepEqual(after, { valid: false, reason: "โค้ดนี้หมดอายุแล้ว" });
  assert.equal(s.adminCoupon(admin, made.id).coupon.status, "expired");
});

test("total limit and per-customer limit hold across back-to-back orders", (t) => {
  const { s, user, customer, coupon, admin } = fixture(t);
  const second = customer("Second Buyer").user;
  const third = customer("Third Buyer").user;
  coupon({ code: "ONLY-TWO", type: "FIXED", value: 1000, usageLimit: 2, perUserLimit: 1 });

  const first = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "only-two" });
  assert.equal(first.total, 9000);
  // Per customer: the same account cannot use it twice, even before paying.
  assert.throws(
    () => s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "ONLY-TWO" }),
    (e) => e.status === 400 && e.message === "คุณใช้โค้ดนี้ไปแล้ว",
  );
  // Same request key replays the same order and does not take a second use.
  const replay = s.createOrder(user, {
    variantId: READY,
    quantity: 1,
    requestKey: s.db.prepare("SELECT request_key FROM orders WHERE id=?").get(first.id).request_key,
    couponCode: "ONLY-TWO",
  });
  assert.equal(replay.id, first.id);
  assert.equal(replay.paymentToken, null);

  // Two more customers back to back: the second takes the last use, the third is refused.
  s.createOrder(second, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "ONLY-TWO" });
  assert.throws(
    () => s.createOrder(third, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "ONLY-TWO" }),
    (e) => e.status === 400 && e.message === "โค้ดนี้ถูกใช้ครบจำนวนแล้ว",
  );
  assert.equal(redemptions(s, "ONLY-TWO").length, 2);
  // The refused order was rolled back entirely: no order, no redemption.
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id=?").get(third.id).n, 0);
  const listed = s.adminCoupons(admin, { status: "used_up" }).coupons;
  assert.deepEqual(listed.map((c) => [c.code, c.uses]), [["ONLY-TWO", 2]]);
});

test("two connections on one database file cannot both take the last use", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-coupon-"));
  const path = join(dir, "shop.sqlite");
  const k = randomBytes(32);
  const a = createCommerce({ path, key: k, allowDemoAdmin: true });
  const b = createCommerce({ path, key: k, allowDemoAdmin: true, seed: false });
  t.after(() => {
    try {
      a.db.close();
    } catch {
      /* already closed */
    }
    try {
      b.db.close();
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
  a.adminCreateCoupon(admin, { code: "LAST-ONE", type: "FIXED", value: 500, usageLimit: 1 });
  const u1 = a.session(a.register({ name: "Conn A", email: "conn-a@example.invalid", password: "Test-only-Password-123" }).token);
  const u2 = b.session(b.register({ name: "Conn B", email: "conn-b@example.invalid", password: "Test-only-Password-123" }).token);
  // Both previews see one use left.
  assert.equal(a.checkCoupon(u1, { code: "LAST-ONE", variantId: READY, quantity: 1 }).valid, true);
  assert.equal(b.checkCoupon(u2, { code: "LAST-ONE", variantId: READY, quantity: 1 }).valid, true);
  a.createOrder(u1, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "LAST-ONE" });
  assert.throws(
    () => b.createOrder(u2, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "LAST-ONE" }),
    (e) => e.status === 400 && /ใช้ครบจำนวน/.test(e.message),
  );
  assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM coupon_redemptions").get().n, 1);
});

test("first-order-only coupon", (t) => {
  const { s, user, customer, coupon } = fixture(t);
  coupon({ code: "WELCOME", type: "PERCENT", value: 20, firstOrderOnly: true });
  assert.equal(s.checkCoupon(user, { code: "WELCOME", variantId: READY, quantity: 1 }).discount, 2000);
  // After a paid order the account no longer qualifies.
  const plain = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
  s.pay(user, plain.id, { paymentToken: plain.paymentToken, outcome: "success" });
  assert.deepEqual(s.checkCoupon(user, { code: "WELCOME", variantId: READY, quantity: 1 }), {
    valid: false,
    reason: "โค้ดนี้ใช้ได้เฉพาะคำสั่งซื้อแรกของบัญชีเท่านั้น",
  });
  // An unpaid (cancelled) order does not count as a first order.
  const fresh = customer("Fresh Buyer").user;
  const pending = s.createOrder(fresh, { variantId: READY, quantity: 1, requestKey: key() });
  assert.equal(pending.status, "PENDING_PAYMENT");
  assert.equal(s.checkCoupon(fresh, { code: "WELCOME", variantId: READY, quantity: 1 }).valid, true);
});

test("product scope: only the chosen products", (t) => {
  const { s, user, coupon } = fixture(t);
  const made = coupon({ code: "CINEMA-ONLY", type: "FIXED", value: 2900, scope: "PRODUCTS", productIds: ["cinema-max"] });
  assert.deepEqual(made.products, [{ id: "cinema-max", name: made.products[0].name }]);
  assert.deepEqual(s.checkCoupon(user, { code: "CINEMA-ONLY", variantId: READY, quantity: 1 }), {
    valid: false,
    reason: "โค้ดนี้ใช้กับสินค้านี้ไม่ได้",
  });
  // Preorder: the discount and code are stored on the reservation.
  const reservation = s.createOrder(user, { variantId: PREORDER, quantity: 1, requestKey: key(), couponCode: "CINEMA-ONLY" });
  assert.equal(reservation.preorder, true);
  assert.equal(reservation.total, 12900 - 2900);
  assert.equal(reservation.discount, 2900);
  const row = s.db.prepare("SELECT total,discount,coupon_code FROM reservations WHERE id=?").get(reservation.id);
  assert.deepEqual({ ...row }, { total: 10000, discount: 2900, coupon_code: "CINEMA-ONLY" });
  assert.equal(redemptions(s, "CINEMA-ONLY")[0].reservation_id, reservation.id);
  const paid = s.pay(user, reservation.id, { paymentToken: reservation.paymentToken, outcome: "success" });
  assert.equal(paid.status, "PREORDER");
  const payment = s.db.prepare("SELECT amount FROM payments WHERE reservation_id=?").get(reservation.id);
  assert.equal(payment.amount, 10000);
});

test("pay charges exactly the discounted total; a client-sent price is ignored", (t) => {
  const { s, user, admin, coupon } = fixture(t);
  coupon({ code: "SAVE25", type: "PERCENT", value: 25 });
  const before = s.publicUser(user).balance;
  const order = s.createOrder(user, {
    variantId: READY_90,
    quantity: 2,
    requestKey: key(),
    couponCode: "SAVE25",
    // Never trusted:
    total: 1,
    discount: 21999,
    price: 1,
  });
  assert.equal(order.subtotal, 22000);
  assert.equal(order.discount, 5500);
  assert.equal(order.total, 16500);
  const paid = s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  assert.equal(paid.status, "DELIVERED");
  const payment = s.db.prepare("SELECT amount FROM payments WHERE order_id=? AND status='SUCCEEDED'").get(order.id);
  assert.equal(payment.amount, 16500);
  assert.equal(s.publicUser(user).balance, before - 16500);
  const inflow = s.db.prepare("SELECT amount FROM ledger WHERE order_id=? AND kind='PAYMENT_IN'").get(order.id);
  assert.equal(inflow.amount, 16500);

  // Admin money summary shows the discount; refunds cap at the discounted paid amount.
  const summary = s.adminOrderPaymentSummary(admin, order.id);
  assert.equal(summary.paid, 16500);
  assert.equal(summary.discount, 5500);
  assert.equal(summary.subtotal, 22000);
  assert.equal(summary.couponCode, "SAVE25");
  assert.equal(summary.refundable, 16500);
  assert.throws(
    () =>
      s.refundOrder(admin, order.id, {
        amount: 22000,
        reasonCode: "CUSTOMER_CANCEL",
        destination: "CREDIT",
        requestKey: key("refund"),
      }),
    (e) => e.status === 409,
  );
  const detail = s.adminOrderDetail(admin, order.id);
  assert.equal(detail.discount, 5500);
  assert.equal(detail.coupon_code, "SAVE25");
  // Customer view carries the same numbers.
  const mine = s.orderDetail(user, order.id);
  assert.equal(mine.discount, 5500);
  assert.equal(mine.coupon_code, "SAVE25");

  // Coupon list: one paid use and the discount given.
  const listed = s.adminCoupons(admin, { q: "save" }).coupons[0];
  assert.equal(listed.uses, 1);
  assert.equal(listed.paidUses, 1);
  assert.equal(listed.discountGiven, 5500);
});

test("cancel, failed payment and out of stock release the use; paid orders keep it", (t) => {
  const { s, user, admin, customer, coupon } = fixture(t);
  coupon({ code: "ONCE", type: "FIXED", value: 1000, usageLimit: 1 });
  const order = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "ONCE" });
  const other = customer("Other Buyer").user;
  assert.equal(s.checkCoupon(other, { code: "ONCE", variantId: READY, quantity: 1 }).valid, false);

  s.adminCancelOrder(admin, order.id, { reason: "ลูกค้าขอยกเลิก" });
  const [row] = redemptions(s, "ONCE");
  assert.ok(row.released_at, "released");
  assert.equal(row.released_reason, "CANCELLED");
  const audit = s.db.prepare("SELECT detail FROM audit WHERE action='CANCEL_ORDER' AND entity_id=?").get(order.id);
  assert.equal(JSON.parse(audit.detail).couponReleased, "ONCE");
  // Released → the use is free again; the cancelled order keeps its record.
  assert.equal(s.orderDetail(user, order.id).coupon_code, "ONCE");
  assert.equal(s.adminCoupons(admin).coupons[0].uses, 0);
  // Idempotent.
  assert.deepEqual(s.releaseCouponForOrder(order.id), { released: false, code: null, amount: 0 });

  // Failed payment releases too.
  const second = s.createOrder(other, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "ONCE" });
  s.pay(other, second.id, { paymentToken: second.paymentToken, outcome: "failure" });
  assert.equal(redemptions(s, "ONCE")[1].released_reason, "PAYMENT_FAILED");

  // Out of stock at pay time releases too.
  const third = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "ONCE" });
  s.db.prepare("UPDATE inventory SET defective=1 WHERE variant_id=? AND order_id IS NULL").run(READY);
  assert.equal(s.pay(user, third.id, { paymentToken: third.paymentToken, outcome: "success" }).status, "OUT_OF_STOCK");
  assert.equal(redemptions(s, "ONCE")[2].released_reason, "OUT_OF_STOCK");
  s.db.prepare("UPDATE inventory SET defective=0 WHERE variant_id=? AND order_id IS NULL").run(READY);

  // A paid order never gives its use back, even through the helper.
  const paid = s.createOrder(other, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "ONCE" });
  s.pay(other, paid.id, { paymentToken: paid.paymentToken, outcome: "success" });
  assert.equal(s.releaseCouponForOrder(paid.id, "EXPIRED").released, false);
  assert.equal(s.adminCoupons(admin).coupons[0].status, "used_up");
  // Unknown ids are a no-op.
  assert.equal(s.releaseCouponForOrder("no-such-order").released, false);
});

test("helper for auto-expiry releases an unpaid order's use", (t) => {
  const { s, user, coupon } = fixture(t);
  coupon({ code: "EXPIRE-ME", type: "FIXED", value: 1000, usageLimit: 1 });
  const order = s.createOrder(user, { variantId: PREORDER, quantity: 1, requestKey: key(), couponCode: "EXPIRE-ME" });
  // What an expiry job does: move the order to an unpaid terminal state and release.
  s.db.prepare("UPDATE reservations SET status='CANCELLED' WHERE id=?").run(order.id);
  assert.deepEqual(s.releaseCouponForOrder(order.id, "EXPIRED"), { released: true, code: "EXPIRE-ME", amount: 1000 });
  assert.equal(redemptions(s, "EXPIRE-ME")[0].released_reason, "EXPIRED");
});

test("admin edit, deactivate, duplicate and redemptions are audited", (t) => {
  const { s, admin, user, coupon } = fixture(t);
  const made = coupon({ code: "EDIT-ME", type: "PERCENT", value: 10, maxDiscount: 5000, perUserLimit: 1 });
  const updated = s.adminUpdateCoupon(admin, made.id, { value: 15, minTotal: 20000 }).coupon;
  assert.equal(updated.value, 15);
  assert.equal(updated.minTotal, 20000);
  assert.equal(updated.maxDiscount, 5000, "untouched fields stay");
  s.createOrder(user, { variantId: READY_90, quantity: 2, requestKey: key(), couponCode: "EDIT-ME" });
  const copy = s.adminDuplicateCoupon(admin, made.id).coupon;
  assert.equal(copy.code, "EDIT-ME-COPY");
  assert.equal(copy.active, false);
  assert.equal(copy.uses, 0);
  assert.equal(s.adminDuplicateCoupon(admin, made.id).coupon.code, "EDIT-ME-COPY2");
  const disabled = s.adminDisableCoupon(admin, made.id).coupon;
  assert.equal(disabled.status, "disabled");
  assert.deepEqual(s.checkCoupon(user, { code: "EDIT-ME", variantId: READY, quantity: 1 }), {
    valid: false,
    reason: "โค้ดนี้ถูกปิดใช้งานแล้ว",
  });
  const list = s.adminCouponRedemptions(admin, made.id).redemptions;
  assert.equal(list.length, 1);
  assert.equal(list[0].amount, 3300);
  assert.equal(list[0].customer_email, "coupon-buyer@example.invalid");
  assert.equal(list[0].paid, false);
  const actions = s.db
    .prepare("SELECT action,detail FROM audit WHERE action LIKE 'COUPON_%' ORDER BY id")
    .all()
    .map((r) => r.action);
  assert.deepEqual(actions, ["COUPON_CREATE", "COUPON_UPDATE", "COUPON_CREATE", "COUPON_CREATE", "COUPON_DISABLE"]);
  const updateDetail = JSON.parse(
    s.db.prepare("SELECT detail FROM audit WHERE action='COUPON_UPDATE'").get().detail,
  );
  assert.deepEqual(updateDetail.changed.value, { from: 10, to: 15 });
  // Audit rows stay append-only.
  assert.throws(() => s.db.prepare("DELETE FROM audit WHERE action='COUPON_CREATE'").run());
});

test("STAFF and customers are refused on every admin coupon endpoint", async (t) => {
  const { s, admin, staff, user, staffToken, token, coupon } = fixture(t);
  const made = coupon({ code: "SECRET" });
  for (const actor of [staff, user, null]) {
    for (const call of [
      () => s.adminCoupons(actor),
      () => s.adminCoupon(actor, made.id),
      () => s.adminCreateCoupon(actor, { code: "HACK", type: "PERCENT", value: 90 }),
      () => s.adminUpdateCoupon(actor, made.id, { value: 90 }),
      () => s.adminDisableCoupon(actor, made.id),
      () => s.adminDuplicateCoupon(actor, made.id),
      () => s.adminCouponRedemptions(actor, made.id),
    ])
      assert.throws(call, (e) => e.status === (actor ? 403 : 401));
  }
  const handle = createAPIHandler(s);
  const write = { "Content-Type": "application/json", "X-Astra-Request": "1" };
  for (const cookie of [staffToken, token]) {
    const headers = { Cookie: "astra_session=" + cookie };
    for (const [method, path, body] of [
      ["GET", "/api/admin/coupons"],
      ["GET", "/api/admin/coupons/" + made.id],
      ["GET", "/api/admin/coupons/" + made.id + "/redemptions"],
      ["POST", "/api/admin/coupons", { code: "HACK", type: "PERCENT", value: 90 }],
      ["PATCH", "/api/admin/coupons/" + made.id, { value: 90 }],
      ["POST", "/api/admin/coupons/" + made.id + "/disable", {}],
      ["POST", "/api/admin/coupons/" + made.id + "/duplicate", {}],
    ]) {
      const res = await handle(
        new Request("http://local.test" + path, {
          method,
          headers: body ? { ...headers, ...write } : headers,
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
      assert.equal(res.status, 403, method + " " + path);
    }
  }
  assert.equal(s.adminCoupon(admin, made.id).coupon.value, 10);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM coupons").get().n, 1);
});

test("coupon guessing is rate limited per account and per IP", async (t) => {
  const { s, token, customer, coupon } = fixture(t);
  coupon({ code: "REAL-CODE", type: "FIXED", value: 1000 });
  const handle = createAPIHandler(s);
  const post = (cookie, path, body, ip = "203.0.113.7") =>
    handle(
      new Request("http://local.test" + path, {
        method: "POST",
        headers: {
          Cookie: "astra_session=" + cookie,
          "Content-Type": "application/json",
          "X-Astra-Request": "1",
          "CF-Connecting-IP": ip,
        },
        body: JSON.stringify(body),
      }),
    );
  const guess = (cookie, code, ip) => post(cookie, "/api/coupons/check", { code, variantId: READY, quantity: 1 }, ip);
  const first = await guess(token, "GUESS-0");
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { valid: false, reason: "ไม่พบโค้ดส่วนลดนี้" });
  for (let i = 1; i < COUPON_RATE_LIMIT.perUser; i++) assert.equal((await guess(token, "GUESS-" + i)).status, 200);
  const blocked = await guess(token, "REAL-CODE");
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /บ่อยเกินไป/);
  // Placing an order with a code uses the same budget.
  const order = await post(token, "/api/orders", { variantId: READY, quantity: 1, requestKey: key(), couponCode: "REAL-CODE" });
  assert.equal(order.status, 429);
  // Without a code the order goes through.
  assert.equal((await post(token, "/api/orders", { variantId: READY, quantity: 1, requestKey: key() })).status, 201);
  // Another account from another IP is unaffected; many accounts from one IP are capped.
  const fresh = customer("Fresh Guesser");
  const ok = await guess(fresh.token, "REAL-CODE", "198.51.100.1");
  assert.equal((await ok.json()).valid, true);
  let ipBlocked = false;
  for (let i = 0; i < COUPON_RATE_LIMIT.perIp + 2 && !ipBlocked; i++) {
    const other = customer("Ip Guesser " + i);
    ipBlocked = (await guess(other.token, "X" + i + "-GUESS", "192.0.2.50")).status === 429;
  }
  assert.ok(ipBlocked, "one IP is capped across accounts");
  // Not signed in: no preview.
  const anon = await handle(
    new Request("http://local.test/api/coupons/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Astra-Request": "1" },
      body: JSON.stringify({ code: "REAL-CODE", variantId: READY, quantity: 1 }),
    }),
  );
  assert.equal(anon.status, 401);
});

test("sales report shows discounts given; test-mode coupon orders leave live revenue", (t) => {
  const { s, user, admin, coupon } = fixture(t);
  coupon({ code: "REPORT20", type: "PERCENT", value: 20 });
  const order = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "REPORT20" });
  s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  // Unpaid coupon orders do not count as discount given.
  s.createOrder(user, { variantId: READY_90, quantity: 1, requestKey: key(), couponCode: "REPORT20" });

  const sandbox = s.salesReport(admin);
  assert.equal(sandbox.totals.revenue, 8000, "revenue is what was actually paid");
  assert.equal(sandbox.totals.discounts, 2000);
  assert.equal(sandbox.totals.discountedOrders, 1);
  assert.equal(s.salesRevenueSatang(), 8000);
  const csv = s.salesReport(admin, { format: "csv" }).csv;
  assert.match(csv, /ส่วนลดคูปอง \(บาท\)/);
  assert.match(csv, /80\.00,0\.00,80\.00,20\.00/);
  assert.equal(s.adminCoupons(admin).coupons[0].discountGiven, 2000);

  // Same database in live mode: the sandbox-paid coupon order is test money.
  s.db.prepare("INSERT OR IGNORE INTO runtime_flags(key,value) VALUES('template-ready','1')").run();
  const live = createCommerceCore({ db: s.db, allowSandbox: false, seed: false });
  const liveAdmin = live.session(s.demoMerchant().token);
  const report = live.salesReport(liveAdmin);
  assert.equal(report.totals.revenue, 0);
  assert.equal(report.totals.discounts, 0);
  assert.equal(live.salesRevenueSatang(), 0);
  assert.equal(live.adminCoupons(liveAdmin).coupons[0].discountGiven, 0);
});
