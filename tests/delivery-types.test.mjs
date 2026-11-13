// Delivery type per product (server/delivery.mjs): shared-account seats, invite links with a
// use limit, shop-fulfilled ("manual") orders with checkout fields, plus encryption, masking,
// audited reveal, stock counts, replacement, preorder holds, launch cleanup and PDPA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { parseSharedLines, parseInviteLines, parseSeatSpec } from "../server/delivery.mjs";

const status = (code) => (e) => e.status === code;
const ADMIN_PASSWORD = "delivery-admin-" + randomUUID().slice(0, 8);

function fixture(t, { allowSandbox = true } = {}) {
  const s = createCommerce({ adminPassword: ADMIN_PASSWORD, allowSandbox });
  t.after(() => s.db.close());
  const admin = s.session(s.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const product = (name, type, extra = {}) => {
    const p = s.saveProduct(admin, {
      name,
      description: "สินค้าทดสอบวิธีส่งมอบ",
      category: "streaming",
      price: 10000,
      active: true,
      firstLabel: "30 วัน",
      firstWarrantyDays: 30,
    });
    if (type) s.adminSetDelivery(admin, p.id, { type, ...extra });
    const variantId = s.adminProductVariants(admin, p.id).variants[0].id;
    return { id: p.id, variantId };
  };
  let n = 0;
  const buyer = (credit = 100000) => {
    n++;
    const auth = s.register({ name: "Buyer " + n, email: `dt-buyer-${n}@example.invalid`, password: "Delivery-buyer-Pass-" + n });
    const user = s.session(auth.token);
    s.adjustCustomerCredit(admin, user.id, { amount: credit, reason: "ทดสอบ", requestKey: randomUUID() });
    return s.session(auth.token);
  };
  const buy = (user, variantId, extra = {}) => {
    const o = s.createOrder(user, { variantId, quantity: 1, requestKey: randomUUID(), ...extra });
    return s.pay(user, o.id, { paymentToken: o.paymentToken, outcome: "success" });
  };
  const stock = (productId, variantId) =>
    s.adminProductVariants(admin, productId).variants.find((v) => v.id === variantId).stock;
  return { s, admin, product, buyer, buy, stock };
}

test("parsers: seat spec, shared lines, invite lines", () => {
  assert.equal(parseSeatSpec("5").seats.length, 5);
  assert.deepEqual(parseSeatSpec("จอ1:1234|จอ2").seats, [
    { label: "จอ1", pin: "1234" },
    { label: "จอ2", pin: null },
  ]);
  assert.ok(parseSeatSpec("0").error);
  assert.ok(parseSeatSpec("99").error);
  const [a, b, c, d] = parseSharedLines(
    "fam@x.test,pa,ss,5\nfam2@x.test,pw,A:1|B:2,150.00,2030-01-01\nbad,line\n\nx@y,pw,0",
  );
  assert.equal(a.password, "pa,ss");
  assert.equal(a.seats.length, 5);
  assert.equal(b.seats[1].pin, "2");
  assert.equal(b.cost, 15000);
  assert.equal(b.expiresAt, "2030-01-01 23:59:59");
  assert.ok(c.error);
  assert.equal(d.line, 5);
  assert.ok(d.error);
  const [l1, l2, l3] = parseInviteLines("https://inv.test/a,3\nhttps://inv.test/b\nnot-a-link");
  assert.equal(l1.uses, 3);
  assert.equal(l2.uses, 1);
  assert.ok(l3.error);
});

test("shared seats: import, stock = free seats, sale gives seat + profile + PIN, masked + audited reveal", (t) => {
  const { s, admin, product, buyer, buy, stock } = fixture(t);
  const p = product("Family Plan", "shared");
  assert.equal(s.adminDelivery(admin, p.id).type, "shared");
  // Dry run reports seats; nothing is written.
  const dry = s.importCodes(admin, { variantId: p.variantId, seats: "fam@x.test,Secret-1,จอ1:1111|จอ2:2222|จอ3", dryRun: true });
  assert.equal(dry.lines[0].status, "ok");
  assert.equal(dry.lines[0].seats, 3);
  assert.equal(stock(p.id, p.variantId), 0);
  const imported = s.importCodes(admin, { variantId: p.variantId, seats: "fam@x.test,Secret-1,จอ1:1111|จอ2:2222|จอ3" });
  assert.equal(imported.imported, 1);
  assert.equal(imported.units, 3);
  assert.equal(stock(p.id, p.variantId), 3);
  // Same account again (any case) is a duplicate.
  const again = s.importCodes(admin, { variantId: p.variantId, seats: "FAM@x.test,other,2", dryRun: true });
  assert.equal(again.lines[0].status, "existing");
  assert.throws(() => s.importCodes(admin, { variantId: p.variantId, items: [{ loginId: "a", password: "b" }] }), status(400));
  // Secrets are encrypted at rest.
  const rows = s.db.prepare("SELECT * FROM inventory WHERE variant_id=?").all(p.variantId);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((r) => r.group_id)).size, 1);
  for (const r of rows) {
    assert.ok(!r.login_id_enc.includes("fam@"));
    assert.ok(!String(r.seat_pin_enc ?? "").includes("1111"));
  }
  // Public catalog: status only.
  const pub = s.productDetail(p.id).variants[0];
  assert.equal(pub.available, true);
  assert.equal(pub.stock, undefined);
  assert.equal(s.productDetail(p.id).deliveryType, "shared");

  const u = buyer();
  const order = buy(u, p.variantId);
  assert.equal(order.status, "DELIVERED");
  assert.equal(order.credentials.length, 1);
  const seat = order.credentials[0];
  assert.equal(seat.loginId, "fam@x.test");
  assert.equal(seat.password, "Secret-1");
  assert.equal(seat.seat, 1);
  assert.equal(seat.profile, "จอ1");
  assert.equal(seat.pin, "1111");
  assert.equal(stock(p.id, p.variantId), 2);

  // Admin views: masked (PIN too), reveal is audited.
  const detail = s.adminOrderDetail(admin, order.id);
  assert.equal(detail.credentials[0].pin, "••••");
  assert.equal(detail.credentials[0].profile, "จอ1");
  assert.ok(!JSON.stringify(detail).includes("Secret-1"));
  assert.equal(detail.units[0].kind, "seat");
  const inv = s.adminVariantInventory(admin, p.variantId, { status: "available" });
  assert.equal(inv.inventory.length, 2);
  assert.equal(inv.inventory[0].unitKind, "seat");
  assert.ok(!JSON.stringify(inv).includes("2222"));
  const revealed = s.revealInventoryUnit(admin, inv.inventory.find((x) => x.seatNo === 2).id);
  assert.equal(revealed.pin, "2222");
  assert.equal(revealed.profile, "จอ2");
  assert.ok(s.db.prepare("SELECT 1 FROM audit WHERE action='INVENTORY_REVEAL'").get());
  const shown = s.adminRevealOrderCredentials(admin, order.id, { reason: "ลูกค้าขอดู" });
  assert.equal(shown.credentials[0].pin, "1111");
  // A seat's ID cannot be edited alone (it is shared with the other seats).
  assert.throws(() => s.updateInventoryUnit(admin, inv.inventory[0].id, { loginId: "x@y.test" }), status(409));
});

test("shared seats: raise / lower seats, edit seat + account login, replacement moves to another account", (t) => {
  const { s, admin, product, buyer, buy, stock } = fixture(t);
  const p = product("Family Plan 2", "shared");
  s.importCodes(admin, { variantId: p.variantId, seats: "one@x.test,pw-1,2\ntwo@x.test,pw-2,2" });
  assert.equal(stock(p.id, p.variantId), 4);
  const u = buyer();
  const order = buy(u, p.variantId);
  const groupId = s.adminOrderDetail(admin, order.id).units[0].groupId;
  let group = s.adminSeatGroup(admin, groupId);
  assert.equal(group.seats.length, 2);
  assert.equal(group.seats.filter((x) => x.status === "sold").length, 1);
  // Raise to 5 → 4 free on this account.
  group = s.adminSetSeatCount(admin, groupId, { seats: 5 });
  assert.equal(group.added, 3);
  assert.equal(stock(p.id, p.variantId), 6);
  // Lower: cannot drop below the sold seat.
  assert.throws(() => s.adminSetSeatCount(admin, groupId, { seats: 0 }), status(400));
  group = s.adminSetSeatCount(admin, groupId, { seats: 1 });
  assert.equal(group.removed, 4);
  assert.equal(group.seats.length, 1);
  assert.equal(stock(p.id, p.variantId), 2);
  // Seat profile / PIN edit tells the buyer.
  const seatId = group.seats[0].id;
  s.adminUpdateSeat(admin, seatId, { label: "Kids", pin: "4321" });
  let mine = s.orderDetail(u, order.id).credentials[0];
  assert.equal(mine.profile, "Kids");
  assert.equal(mine.pin, "4321");
  // New password for the whole account reaches the buyer too.
  const changed = s.adminUpdateGroupLogin(admin, groupId, { password: "pw-new" });
  assert.deepEqual(changed.changed, ["password"]);
  assert.equal(s.orderDetail(u, order.id).credentials[0].password, "pw-new");
  assert.throws(() => s.adminUpdateGroupLogin(admin, groupId, { loginId: "two@x.test" }), status(409));
  // Warranty replacement: the customer moves to a seat on the other account.
  const replaced = s.replaceOrderCredential(admin, order.id, { inventoryId: seatId, reason: "บัญชีโดนล็อก" });
  const newUnit = s.db.prepare("SELECT group_id FROM inventory WHERE id=?").get(replaced.newInventoryId);
  assert.notEqual(newUnit.group_id, groupId);
  mine = s.orderDetail(u, order.id).credentials;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].loginId, "two@x.test");
  assert.equal(stock(p.id, p.variantId), 1);
});

test("shared seats work with preorder deposit holds (one seat held per reservation)", (t) => {
  const { s, admin, buyer } = fixture(t);
  const pr = s.saveProduct(admin, {
    name: "Seat Preorder",
    description: "พรีออเดอร์บัญชีแชร์",
    category: "streaming",
    price: 10000,
    active: true,
    preorder: true,
    firstLabel: "1 เดือน",
  });
  s.adminSetDelivery(admin, pr.id, { type: "shared" });
  s.adminSavePreorderSettings(admin, pr.id, { mode: "free", payWindowHours: 24, lapsePolicy: "refund_credit" });
  const variantId = s.adminProductVariants(admin, pr.id).variants[0].id;
  const u1 = buyer();
  const u2 = buyer();
  const r1 = s.createOrder(u1, { variantId, quantity: 1, requestKey: randomUUID() });
  const r2 = s.createOrder(u2, { variantId, quantity: 1, requestKey: randomUUID() });
  // One shared account with 1 seat: only the first in the queue is called and holds it.
  const res = s.importCodes(admin, { variantId, seats: "pre@x.test,pw,1" });
  assert.equal(res.preorderCalled, 1);
  const held = s.db.prepare("SELECT reservation_id FROM inventory WHERE variant_id=?").all(variantId);
  assert.equal(held.length, 1);
  assert.equal(held[0].reservation_id, r1.id);
  // Raising the seats calls the next one.
  const groupId = s.db.prepare("SELECT group_id FROM inventory WHERE variant_id=?").get(variantId).group_id;
  s.adminSetSeatCount(admin, groupId, { seats: 2 });
  assert.equal(s.db.prepare("SELECT stage FROM reservations WHERE id=?").get(r2.id).stage, "called");
  // Paying the balance delivers the held seat.
  const token = s.retry(u1, r1.id).paymentToken;
  const done = s.pay(u1, r1.id, { paymentToken: token, outcome: "success" });
  assert.equal(done.status, "DELIVERED");
  assert.equal(done.credentials[0].loginId, "pre@x.test");
  assert.equal(done.credentials[0].seat, 1);
});

test("invite links: use limit per link, customer gets the link, masked in admin", (t) => {
  const { s, admin, product, buyer, buy, stock } = fixture(t);
  const p = product("Team Invite", "invite");
  const r = s.importCodes(admin, { variantId: p.variantId, links: "https://invite.test/join/abc123,2\nhttps://invite.test/join/zzz999" });
  assert.equal(r.units, 3);
  assert.equal(stock(p.id, p.variantId), 3);
  const dup = s.importCodes(admin, { variantId: p.variantId, links: "https://invite.test/join/abc123", dryRun: true });
  assert.equal(dup.lines[0].status, "existing");
  const u1 = buyer();
  const u2 = buyer();
  const u3 = buyer();
  const o1 = buy(u1, p.variantId);
  const o2 = buy(u2, p.variantId);
  assert.deepEqual(o1.links, ["https://invite.test/join/abc123"]);
  assert.deepEqual(o2.links, ["https://invite.test/join/abc123"]);
  assert.equal(o1.codes.length, 0);
  assert.equal(stock(p.id, p.variantId), 1);
  const o3 = buy(u3, p.variantId);
  assert.deepEqual(o3.links, ["https://invite.test/join/zzz999"]);
  assert.equal(stock(p.id, p.variantId), 0);
  const u4 = buyer();
  assert.throws(
    () => s.createOrder(u4, { variantId: p.variantId, quantity: 1, requestKey: randomUUID() }),
    status(409),
  );
  const detail = s.adminOrderDetail(admin, o1.id);
  assert.ok(!JSON.stringify(detail).includes("abc123"));
  assert.equal(detail.links.length, 1);
  assert.equal(s.adminRevealOrderCredentials(admin, o1.id, { reason: "ตรวจสอบ" }).links[0], "https://invite.test/join/abc123");
  // Raising a link's uses adds stock.
  const groupId = detail.units[0].groupId;
  s.adminSetSeatCount(admin, groupId, { seats: 4 });
  assert.equal(stock(p.id, p.variantId), 2);
});

test("manual fulfilment: checkout fields, queue, deliver message, notify, warranty from delivery", (t) => {
  const { s, admin, product, buyer, buy, stock } = fixture(t);
  const p = product("Gmail Invite", "manual", {
    fields: [
      { label: "อีเมล Gmail ที่จะให้เชิญ", type: "email", required: true },
      { label: "หมายเหตุ", type: "text", required: false },
    ],
  });
  const pub = s.productDetail(p.id);
  assert.equal(pub.deliveryType, "manual");
  assert.equal(pub.checkoutFields.length, 2);
  assert.equal(pub.variants[0].available, true);
  assert.equal(stock(p.id, p.variantId), 0);
  // Stock import is refused.
  assert.throws(() => s.importCodes(admin, { variantId: p.variantId, codes: "CODE-1234" }), status(409));
  const u = buyer();
  const f1 = pub.checkoutFields[0].id;
  assert.throws(() => s.createOrder(u, { variantId: p.variantId, quantity: 1, requestKey: randomUUID() }), status(400));
  assert.throws(
    () => s.createOrder(u, { variantId: p.variantId, quantity: 1, requestKey: randomUUID(), deliveryInputs: { [f1]: "not-an-email" } }),
    status(400),
  );
  const paid = buy(u, p.variantId, { deliveryInputs: { [f1]: "me@gmail.com" } });
  assert.equal(paid.status, "DELIVERED");
  assert.equal(paid.fulfilment.state, "waiting");
  assert.equal(paid.fulfilment.inputs[0].value, "me@gmail.com");
  assert.equal(paid.warranty_until, null);
  // Answers are encrypted at rest.
  const row = s.db.prepare("SELECT * FROM order_fulfilment WHERE order_id=?").get(paid.id);
  assert.ok(!row.inputs_enc.includes("gmail"));
  // No low-stock alert for a product without stock.
  assert.ok(!s.db.prepare("SELECT 1 FROM notifications WHERE kind='stock_low' AND body LIKE '%Gmail Invite%'").get());
  // Queue + todo tab.
  const queue = s.fulfilmentQueue(admin).rows;
  assert.equal(queue.length, 1);
  assert.equal(queue[0].inputs[0].value, "me@gmail.com");
  const todo = s.adminOrders(admin, { group: "todo" });
  assert.ok(todo.orders.some((o) => o.id === paid.id && o.fulfil === "waiting"));
  assert.equal(s.adminOverview(admin).fulfilmentWaiting, 1);
  // Deliver.
  s.fulfilOrder(admin, paid.id, { message: "เชิญแล้ว เช็กอีเมลได้เลย" });
  const after = s.orderDetail(u, paid.id);
  assert.equal(after.fulfilment.state, "done");
  assert.equal(after.fulfilment.message, "เชิญแล้ว เช็กอีเมลได้เลย");
  assert.ok(after.warranty_until);
  assert.ok(s.db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND title='ร้านส่งมอบแล้ว'").get(u.id));
  assert.ok(!s.db.prepare("SELECT detail FROM audit WHERE action='FULFIL_ORDER'").get().detail.includes("เชิญแล้ว"));
  // Admin sees the message only through the audited reveal.
  const detail = s.adminOrderDetail(admin, paid.id);
  assert.equal(detail.fulfilment.hasMessage, true);
  assert.ok(!JSON.stringify(detail).includes("เชิญแล้ว"));
  assert.equal(s.adminRevealOrderCredentials(admin, paid.id, { reason: "ตรวจสอบ" }).message, "เชิญแล้ว เช็กอีเมลได้เลย");
  assert.equal(s.fulfilmentQueue(admin).rows.filter((r) => r.state === "waiting").length, 0);
  // Manual + preorder cannot be combined.
  assert.throws(() => s.saveProduct(admin, { id: p.id, name: "Gmail Invite", description: "สินค้าทดสอบวิธีส่งมอบ", category: "streaming", preorder: true }), status(409));
});

test("manual fulfilment: unpaid order expires as normal; switching type is guarded", (t) => {
  const { s, admin, product, buyer } = fixture(t);
  const p = product("Manual Two", "manual", { fields: [{ label: "ชื่อผู้ใช้", type: "text", required: true }] });
  const f = s.productDetail(p.id).checkoutFields[0].id;
  const u = buyer();
  const o = s.createOrder(u, { variantId: p.variantId, quantity: 1, requestKey: randomUUID(), deliveryInputs: { [f]: "player1" } });
  assert.equal(o.fulfilment.state, "input");
  assert.equal(s.fulfilmentQueue(admin).rows.length, 0);
  // A product with free stock cannot become manual.
  const q = product("Has Stock", null);
  s.importCodes(admin, { variantId: q.variantId, codes: "CODE-ABCD-1" });
  assert.throws(() => s.adminSetDelivery(admin, q.id, { type: "manual" }), status(409));
  // Paid + waiting orders block switching a manual product away.
  const paid = s.pay(u, o.id, { paymentToken: o.paymentToken, outcome: "success" });
  assert.equal(paid.fulfilment.state, "waiting");
  assert.throws(() => s.adminSetDelivery(admin, p.id, { type: "code" }), status(409));
  assert.throws(() => s.adminSetDelivery(admin, p.id, { type: "nope" }), status(400));
});

test("duplicate copies delivery type + fields; launch cleanup frees test seats; PDPA clears checkout answers", (t) => {
  const { s, admin, product, buyer, buy, stock } = fixture(t);
  const m = product("Manual Dup", "manual", { fields: [{ label: "อีเมล", type: "email", required: true }] });
  const copy = s.duplicateProduct(admin, m.id);
  const copied = s.adminDelivery(admin, copy.id);
  assert.equal(copied.type, "manual");
  assert.equal(copied.fields[0].label, "อีเมล");

  const p = product("Seats Clean", "shared");
  s.importCodes(admin, { variantId: p.variantId, seats: "clean@x.test,pw,3" });
  const u = buyer();
  const o = buy(u, p.variantId);
  const f = s.productDetail(m.id).checkoutFields[0].id;
  const mo = buy(u, m.variantId, { deliveryInputs: { [f]: "pdpa@gmail.com" } });
  assert.equal(stock(p.id, p.variantId), 2);

  // PDPA export lists the answers; deletion clears them.
  const exported = s.exportMyData(u);
  assert.equal(exported.deliveryInputs[0].inputs[0].value, "pdpa@gmail.com");
  const req = s.requestAccountDeletion(u, { reason: "ลบข้อมูล" });
  s.approvePrivacyDeletion(admin, req.id, { currentPassword: ADMIN_PASSWORD });
  assert.equal(s.db.prepare("SELECT inputs_enc FROM order_fulfilment WHERE order_id=?").get(mo.id).inputs_enc, null);

  const plan = s.adminLaunchCleanup(admin, { dryRun: true, currentPassword: ADMIN_PASSWORD });
  assert.equal(plan.remove.seatsReleased, 1);
  assert.ok(plan.remove.fulfilment >= 1);
  s.adminLaunchCleanup(admin, { dryRun: false, currentPassword: ADMIN_PASSWORD });
  // The sold seat is free again; the account keeps its 3 seats.
  assert.equal(stock(p.id, p.variantId), 3);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM order_fulfilment").get().n, 0);
  assert.ok(!s.db.prepare("SELECT 1 FROM orders WHERE id=?").get(o.id));
});
