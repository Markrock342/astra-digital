// Multi-item checkout (server/checkouts.mjs): one order number for several basket lines.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { emailVerificationOff } from "./fixtures/email-verification-off.mjs";

function fakeMailer() {
  const sent = [];
  return {
    sent,
    enabled: true,
    provider: "test",
    from: "shop@mail.example.com",
    async send(message) {
      sent.push(message);
      return { id: "msg-" + sent.length };
    },
  };
}

function setup(extra = {}) {
  const adminPassword = randomBytes(16).toString("hex");
  const mailer = extra.mailer || null;
  const service = emailVerificationOff(
    createCommerce({ adminPassword, ...(mailer ? { email: mailer } : {}) }),
  );
  const admin = service.session(service.login({ email: "admin@astra.local", password: adminPassword }).token);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const make = (name, price, units) => {
    const p = service.saveProduct(admin, { name, description: name + " บัญชีสตรีมมิ่งรายเดือน", category: "streaming", price, active: true, firstLabel: "30 วัน" });
    const variantId = service.adminProductVariants(admin, p.id).variants[0].id;
    if (units)
      service.importCodes(admin, {
        variantId,
        items: Array.from({ length: units }, (_, i) => ({ loginId: name + i + "@t.test", password: "Pw-" + i })),
      });
    return variantId;
  };
  const reg = (email) => service.session(service.register({ name: "Buyer", email, password: "Buyer-Pass-12345" }).token);
  return { service, admin, make, reg, mailer };
}
const err = (fn, status) => assert.throws(fn, (e) => e.status === status);

test("two lines → one checkout, one payment delivers both", () => {
  const { service, make, reg } = setup();
  const a = make("Alpha", 1000, 3);
  const b = make("Beta", 2000, 3);
  const user = reg("multi@example.invalid");
  const c = service.createCheckout(user, { requestKey: "checkout-key-1", lines: [{ variantId: a, quantity: 2 }, { variantId: b, quantity: 1 }] });
  assert.equal(c.orders.length, 2);
  assert.deepEqual(c.orders.map((o) => o.name), ["Alpha", "Beta"]);
  assert.ok(c.orders.every((o) => o.status === "PENDING_PAYMENT" && o.checkout_id === c.id && o.paymentToken));
  // Same request key: same checkout, no new orders.
  const again = service.createCheckout(user, { requestKey: "checkout-key-1", lines: [{ variantId: a, quantity: 2 }, { variantId: b, quantity: 1 }] });
  assert.equal(again.id, c.id);
  assert.equal(service.orders(user).length, 2);
  const tokens = Object.fromEntries(c.orders.map((o) => [o.id, o.paymentToken]));
  const paid = service.payCheckout(user, c.id, { tokens, outcome: "success" });
  assert.ok(paid.orders.every((o) => o.status === "DELIVERED"));
  assert.equal(paid.orders[0].credentials.length, 2);
  assert.equal(paid.orders[1].credentials.length, 1);
  assert.equal(service.ledger(user).filter((e) => e.amount < 0).reduce((n, e) => n + e.amount, 0), -4000);
  // Paying again changes nothing.
  assert.equal(service.payCheckout(user, c.id, { tokens, outcome: "success" }).orders.length, 2);
  assert.equal(service.ledger(user).filter((e) => e.amount < 0).length, 2);
});

test("not enough credit pays nothing; a bad line creates nothing", () => {
  const { service, make, reg } = setup();
  const a = make("Big", 40000, 2);
  const b = make("Bigger", 40000, 2);
  const user = reg("poor@example.invalid");
  const c = service.createCheckout(user, { requestKey: "checkout-key-2", lines: [{ variantId: a, quantity: 1 }, { variantId: b, quantity: 1 }] });
  const tokens = Object.fromEntries(c.orders.map((o) => [o.id, o.paymentToken]));
  err(() => service.payCheckout(user, c.id, { tokens, outcome: "success" }), 409);
  assert.ok(service.checkout(user, c.id).orders.every((o) => o.status === "PENDING_PAYMENT"));
  // Missing token for one line: refused before anything is paid.
  err(() => service.payCheckout(user, c.id, { tokens: { [c.orders[0].id]: tokens[c.orders[0].id] }, outcome: "failure" }), 403);
  assert.ok(service.checkout(user, c.id).orders.every((o) => o.status === "PENDING_PAYMENT"));

  const ordersBefore = service.orders(user).length;
  err(() => service.createCheckout(user, { requestKey: "checkout-key-3", lines: [{ variantId: a, quantity: 1 }, { variantId: "nope", quantity: 1 }] }), 404);
  assert.equal(service.orders(user).length, ordersBefore);
});

test("rules: no duplicates, owner only", () => {
  const { service, make, reg } = setup();
  const a = make("One", 1000, 2);
  const b = make("Two", 1000, 2);
  const user = reg("rules@example.invalid");
  const other = reg("other@example.invalid");
  err(() => service.createCheckout(user, { requestKey: "checkout-key-4", lines: [] }), 400);
  err(() => service.createCheckout(user, { requestKey: "checkout-key-5", lines: [{ variantId: a, quantity: 1 }, { variantId: a, quantity: 1 }] }), 400);
  err(() => service.createCheckout(user, { requestKey: "checkout-key-6", couponCode: "NOPE", lines: [{ variantId: a, quantity: 1 }, { variantId: b, quantity: 1 }] }), 400);
  assert.equal(service.orders(user).length, 0);
  const c = service.createCheckout(user, { requestKey: "checkout-key-7", lines: [{ variantId: a, quantity: 1 }, { variantId: b, quantity: 1 }] });
  err(() => service.checkout(other, c.id), 404);
  err(() => service.payCheckout(other, c.id, { tokens: {}, outcome: "success" }), 404);
});

test("summary page pays in one step; short credit leaves no order behind", () => {
  const { service, make, reg } = setup();
  const a = make("Quick", 1000, 3);
  const big = make("Pricey", 90000, 1);
  const user = reg("quick@example.invalid");
  const one = service.createCheckout(user, { requestKey: "checkout-key-8", pay: "success", lines: [{ variantId: a, quantity: 1 }] });
  assert.equal(one.orders.length, 1);
  assert.equal(one.orders[0].status, "DELIVERED");
  assert.equal(one.orders[0].credentials.length, 1);
  err(
    () => service.createCheckout(user, { requestKey: "checkout-key-9", pay: "success", lines: [{ variantId: a, quantity: 1 }, { variantId: big, quantity: 1 }] }),
    409,
  );
  assert.equal(service.orders(user).length, 1);
});

test("basket coupon: min_total across lines, proportional split, one redemption", () => {
  const { service, admin, make, reg } = setup();
  // ฿300 + ฿300 = ฿600 ≥ min ฿500 → 10% = ฿60 (6000 satang * 10% = 600)
  const a = make("A300", 30000, 2);
  const b = make("B300", 30000, 2);
  service.adminCreateCoupon(admin, {
    code: "BASKET10",
    type: "PERCENT",
    value: 10,
    minTotal: 50000,
  });
  const user = reg("basket-coupon@example.invalid");
  service.topup(user, { amount: 1000, requestKey: "basket-topup-01" });
  const lines = [{ variantId: a, quantity: 1 }, { variantId: b, quantity: 1 }];
  assert.equal(service.checkoutCoupon(user, { code: "BASKET10", lines: [{ variantId: a, quantity: 1 }] }).valid, false);
  const quote = service.checkoutCoupon(user, { code: "BASKET10", lines });
  assert.equal(quote.valid, true);
  assert.equal(quote.discount, 6000);
  assert.equal(quote.lines.length, 2);
  assert.equal(quote.lines.reduce((n, l) => n + l.discount, 0), 6000);
  const c = service.createCheckout(user, {
    requestKey: "checkout-key-10",
    couponCode: "BASKET10",
    pay: "success",
    lines,
  });
  assert.equal(c.orders.reduce((n, o) => n + o.discount, 0), 6000);
  assert.ok(c.orders.every((o) => o.coupon_code === "BASKET10"));
  const redemptions = service.db
    .prepare("SELECT checkout_id, amount FROM coupon_redemptions WHERE code=? AND released_at IS NULL")
    .all("BASKET10");
  assert.equal(redemptions.length, 1);
  assert.equal(redemptions[0].checkout_id, c.id);
  assert.equal(redemptions[0].amount, 6000);
  assert.equal(service.checkoutCoupon(user, { code: "NOPE", lines }).valid, false);
});

test("3-line payCheckout: one customer email, one customer notify, one staff notify batch", async () => {
  const mailer = fakeMailer();
  const { service, admin, make, reg } = setup({ mailer });
  const a = make("N1", 1000, 2);
  const b = make("N2", 1000, 2);
  const c = make("N3", 1000, 2);
  const user = reg("notify3@mail.example.com");
  const checkout = service.createCheckout(user, {
    requestKey: "checkout-notify-3",
    lines: [
      { variantId: a, quantity: 1 },
      { variantId: b, quantity: 1 },
      { variantId: c, quantity: 1 },
    ],
  });
  const tokens = Object.fromEntries(checkout.orders.map((o) => [o.id, o.paymentToken]));
  service.payCheckout(user, checkout.id, { tokens, outcome: "success" });
  await service.emailIdle();
  assert.equal(mailer.sent.length, 1, "one checkout email");
  assert.ok(mailer.sent[0].text.includes("/checkouts/" + checkout.id));
  assert.ok(!/Pw-|password/i.test(JSON.stringify(mailer.sent[0])), "no secrets in email");
  const kinds = service.db.prepare("SELECT kind FROM email_log ORDER BY rowid").all().map((r) => r.kind);
  assert.deepEqual(kinds, ["checkout_confirmed"]);
  const customerNotes = service.notifications(user).filter((n) => n.kind === "code_delivery");
  assert.equal(customerNotes.length, 1);
  assert.equal(customerNotes[0].link, "/checkouts/" + checkout.id);
  const staffNotes = service
    .notifications(admin)
    .filter((n) => n.kind === "order_new" && n.body.includes(checkout.id.slice(0, 8)));
  assert.equal(staffNotes.length, 1);
});

test("1-line checkout keeps /orders/ notify and order email", async () => {
  const mailer = fakeMailer();
  const { service, make, reg } = setup({ mailer });
  const a = make("Solo", 1000, 2);
  const user = reg("notify1@mail.example.com");
  const checkout = service.createCheckout(user, {
    requestKey: "checkout-notify-1",
    lines: [{ variantId: a, quantity: 1 }],
  });
  const orderId = checkout.orders[0].id;
  const tokens = { [orderId]: checkout.orders[0].paymentToken };
  service.payCheckout(user, checkout.id, { tokens, outcome: "success" });
  await service.emailIdle();
  assert.equal(mailer.sent.length, 1);
  assert.ok(mailer.sent[0].text.includes("/orders/" + orderId));
  const note = service.notifications(user).find((n) => n.kind === "code_delivery");
  assert.ok(note);
  assert.equal(note.link, "/orders/" + orderId);
});

test("multi-line OOS at pay: email mentions unpaid line; paid lines still one notify", async () => {
  const mailer = fakeMailer();
  const { service, make, reg } = setup({ mailer });
  const a = make("OkA", 1000, 2);
  const b = make("OkB", 1000, 2);
  const c = make("Gone", 1000, 1);
  const user = reg("notify-oos@mail.example.com");
  const checkout = service.createCheckout(user, {
    requestKey: "checkout-notify-oos",
    lines: [
      { variantId: a, quantity: 1 },
      { variantId: b, quantity: 1 },
      { variantId: c, quantity: 1 },
    ],
  });
  service.db.prepare("DELETE FROM inventory WHERE variant_id=?").run(c);
  const tokens = Object.fromEntries(checkout.orders.map((o) => [o.id, o.paymentToken]));
  const paid = service.payCheckout(user, checkout.id, { tokens, outcome: "success" });
  assert.equal(paid.orders.filter((o) => o.status === "DELIVERED").length, 2);
  assert.equal(paid.orders.filter((o) => o.status === "OUT_OF_STOCK").length, 1);
  await service.emailIdle();
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0].text, /Gone|ของหมด|ไม่ได้ตัดเงิน/);
  assert.equal(service.notifications(user).filter((n) => n.kind === "code_delivery").length, 1);
});

test("basket coupon max_discount cap and leftover satang on last line", () => {
  const { service, admin, make, reg } = setup();
  const a = make("CapA", 10000, 2); // ฿100
  const b = make("CapB", 20000, 2); // ฿200
  service.adminCreateCoupon(admin, {
    code: "CAP50",
    type: "PERCENT",
    value: 50,
    maxDiscount: 5000, // ฿50 cap on ฿150 → 50% would be ฿75
  });
  const user = reg("cap-coupon@example.invalid");
  const lines = [{ variantId: a, quantity: 1 }, { variantId: b, quantity: 1 }];
  const quote = service.checkoutCoupon(user, { code: "CAP50", lines });
  assert.equal(quote.valid, true);
  assert.equal(quote.discount, 5000);
  assert.equal(quote.lines.reduce((n, l) => n + l.discount, 0), 5000);
  // Proportional: floor(5000*10000/30000)=1666, last gets remainder 3334
  assert.equal(quote.lines[0].discount, 1666);
  assert.equal(quote.lines[1].discount, 3334);
});
