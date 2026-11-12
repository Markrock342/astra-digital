// Order history: replacement history (B2), activity timeline, append-only notes
// and status tab counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ensureOrderHistory } from "../server/ensure-admin-fr.mjs";
import { ROLES } from "../server/auth-policy.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const auth = s.register({ name: "History Buyer", email: "history-buyer@example.invalid", password: "Test-only-Password-123" });
  const user = s.session(auth.token);
  const merchantAuth = s.demoMerchant();
  const merchant = s.session(merchantAuth.token);
  const staffAuth = s.register({ name: "History Staff", email: "history-staff@example.invalid", password: "Staff-only-Password-123" });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  return { s, user, merchant, staff, token: auth.token, staffToken: staffAuth.token };
}

function product(s, merchant, { name, preorder = false, logins = [] }) {
  const p = s.saveProduct(merchant, { name, description: "ทดสอบประวัติออเดอร์", category: "streaming", price: 15000, preorder, active: true });
  const variantId = s.adminProductVariants(merchant, p.id).variants[0].id;
  if (logins.length)
    s.importCodes(merchant, { variantId, items: logins.map((loginId) => ({ loginId, password: "pw-" + loginId })) });
  return variantId;
}

function buy(s, user, variantId, key) {
  const order = s.createOrder(user, { variantId, quantity: 1, requestKey: key });
  return s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
}

test("replacing an account keeps the old one linked and records who, when, why", (t) => {
  const { s, user, merchant, staff } = fixture(t);
  const variantId = product(s, merchant, { name: "History Ready", logins: ["first-login", "second-login", "third-login"] });
  const order = buy(s, user, variantId, "hist-ready-001");
  const firstUnit = s.db.prepare("SELECT id FROM inventory WHERE order_id=?").get(order.id).id;
  const one = s.replaceOrderCredential(merchant, order.id, { inventoryId: firstUnit, reason: "บัญชีถูกล็อก" });
  const two = s.replaceOrderCredential(merchant, order.id, { inventoryId: one.newInventoryId, reason: "รหัสผิด" });

  // Every unit the order ever had is still linked; only the current one is live.
  const linked = s.db.prepare("SELECT id, defective FROM inventory WHERE order_id=? ORDER BY rowid").all(order.id);
  assert.equal(linked.length, 3);
  assert.deepEqual(linked.map((u) => u.defective), [1, 1, 0]);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM order_replacements WHERE order_id=?").get(order.id).n, 2);

  // The customer still sees exactly one account: the newest.
  const mine = s.orderDetail(user, order.id);
  assert.equal(mine.credentials.length, 1);
  assert.equal(mine.credentials[0].loginId, "third-login");
  assert.ok(!JSON.stringify(mine).includes("first-login"));
  assert.ok(!("replacements" in mine));

  // Admin and staff see the history with masked logins only.
  for (const viewer of [merchant, staff]) {
    const detail = s.adminOrderDetail(viewer, order.id);
    assert.equal(detail.replacements.length, 2);
    assert.deepEqual(
      detail.replacements.map((r) => [r.oldLogin, r.newLogin, r.reason, r.actor]),
      [
        ["fi***", "se***", "บัญชีถูกล็อก", merchant.name],
        ["se***", "th***", "รหัสผิด", merchant.name],
      ],
    );
    const blob = JSON.stringify(detail);
    for (const secret of ["first-login", "second-login", "third-login", "pw-"]) assert.ok(!blob.includes(secret), secret);
    // Only the live unit can be replaced again.
    assert.deepEqual(detail.units.map((u) => u.id), [two.newInventoryId]);
    const replaced = detail.timeline.filter((e) => e.event === "replaced");
    assert.deepEqual(replaced.map((e) => e.reason), ["บัญชีถูกล็อก", "รหัสผิด"]);
    assert.equal(replaced[0].actor, merchant.name);
  }

  // Stock view: old units are "defective", never back on sale.
  const stock = s.adminVariantInventory(merchant, variantId, { status: "defective" });
  assert.equal(stock.inventory.length, 2);

  // Out of stock: refused, and no history row is written (same transaction).
  assert.throws(
    () => s.replaceOrderCredential(merchant, order.id, { inventoryId: two.newInventoryId, reason: "ของหมด" }),
    (e) => e.status === 409,
  );
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM order_replacements WHERE order_id=?").get(order.id).n, 2);
  assert.equal(s.db.prepare("SELECT defective FROM inventory WHERE id=?").get(two.newInventoryId).defective, 0);
});

test("timeline merges system events with audit: who delivered, revealed, cancelled and why, plus notes", (t) => {
  const { s, user, merchant, staff } = fixture(t);
  const variantId = product(s, merchant, { name: "History Preorder", preorder: true, logins: ["queue-login"] });
  const pre = buy(s, user, variantId, "hist-pre-001");
  s.deliverReservation(staff, pre.id);
  s.adminRevealOrderCredentials(merchant, pre.id, { reason: "ลูกค้าแจ้งว่าเข้าใช้งานไม่ได้" });
  s.adminAddOrderNote(staff, pre.id, { body: "โทรแจ้งลูกค้าแล้ว" });

  const detail = s.adminOrderDetail(merchant, pre.id);
  const events = detail.timeline.map((e) => e.event);
  assert.deepEqual(events, ["created", "paid", "delivered", "revealed", "note"]);
  const at = (name) => detail.timeline.find((e) => e.event === name);
  assert.equal(at("created").actor, "History Buyer");
  assert.equal(at("delivered").actor, staff.name);
  assert.equal(at("revealed").actor, merchant.name);
  assert.equal(at("revealed").reason, "ลูกค้าแจ้งว่าเข้าใช้งานไม่ได้");
  assert.equal(at("note").actor, staff.name);
  assert.equal(at("note").body, "โทรแจ้งลูกค้าแล้ว");
  const times = detail.timeline.map((e) => e.at);
  assert.deepEqual([...times].sort(), times);

  // Staff gets the same activity (no money in it) and no payment rows.
  const staffView = s.adminOrderDetail(staff, pre.id);
  assert.deepEqual(staffView.payments, []);
  assert.deepEqual(staffView.timeline.map((e) => e.event), events);

  // Cancel shows once, with who and why.
  const unpaid = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "hist-cancel-001" });
  s.adminCancelOrder(merchant, unpaid.id, { reason: "ลูกค้าขอยกเลิก" });
  const cancelled = s.adminOrderDetail(staff, unpaid.id).timeline.filter((e) => e.event === "cancelled");
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].actor, merchant.name);
  assert.equal(cancelled[0].reason, "ลูกค้าขอยกเลิก");

  // Ready orders are delivered by the system: no actor.
  const ready = buy(s, user, "stream-plus-30", "hist-ready-002");
  const delivered = s.adminOrderDetail(merchant, ready.id).timeline.find((e) => e.event === "delivered");
  assert.equal(delivered.actor, null);
});

test("notes are append-only, capped at 1000 characters and never reach the customer", async (t) => {
  const { s, user, merchant, staff, token, staffToken } = fixture(t);
  const order = buy(s, user, "stream-plus-30", "hist-notes-001");
  s.adminAddOrderNote(staff, order.id, { body: "หมายเหตุแรก-ลับ" });
  s.adminAddOrderNote(merchant, order.id, { body: "หมายเหตุที่สอง-ลับ" });
  assert.throws(() => s.adminAddOrderNote(staff, order.id, { body: "ก".repeat(1001) }), (e) => e.status === 400);
  assert.throws(() => s.adminAddOrderNote(staff, order.id, { body: "   " }), (e) => e.status === 400);
  s.adminAddOrderNote(staff, order.id, { body: "ข".repeat(1000) });

  const notes = s.adminOrderDetail(merchant, order.id).notes;
  assert.deepEqual(
    notes.map((n) => [n.body, n.author]),
    [
      ["หมายเหตุแรก-ลับ", staff.name],
      ["หมายเหตุที่สอง-ลับ", merchant.name],
      ["ข".repeat(1000), staff.name],
    ],
  );
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='ORDER_NOTE' AND entity_id=?").get(order.id).n, 3);

  // Customer payloads: service and HTTP, single order and list.
  const customerViews = [s.orderDetail(user, order.id), s.orders(user)];
  const handle = createAPIHandler(s);
  const get = async (path, cookie) => {
    const res = await handle(new Request("http://local.test" + path, { headers: { Cookie: `astra_session=${cookie}` } }));
    return { status: res.status, body: await res.json() };
  };
  customerViews.push((await get("/api/orders/" + order.id, token)).body, (await get("/api/orders", token)).body);
  for (const view of customerViews) {
    const blob = JSON.stringify(view);
    assert.ok(!blob.includes("ลับ"), "note body leaked");
    assert.ok(!blob.includes('"notes"'), "notes key leaked");
    assert.ok(!blob.includes("admin_note"), "admin_note leaked");
  }
  // Customers cannot add notes or read the admin detail.
  assert.throws(() => s.adminAddOrderNote(user, order.id, { body: "แอบเขียน" }), (e) => e.status === 403);
  assert.equal((await get("/api/admin/orders/" + order.id, token)).status, 403);

  // HTTP append for staff (POST /notes and the legacy /note path both append).
  for (const path of ["/notes", "/note"]) {
    const res = await handle(
      new Request("http://local.test/api/admin/orders/" + order.id + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Astra-Request": "1", Cookie: `astra_session=${staffToken}` },
        body: JSON.stringify({ body: "ผ่าน HTTP " + path }),
      }),
    );
    assert.equal(res.status, 200);
  }
  assert.equal(s.adminOrderDetail(staff, order.id).notes.length, 5);
});

test("legacy admin_note becomes the first note once (idempotent)", (t) => {
  const { s, user, merchant, staff } = fixture(t);
  const order = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "hist-legacy-001" });
  s.db.prepare("UPDATE orders SET admin_note=? WHERE id=?").run("โน้ตเก่าแบบช่องเดียว", order.id);
  s.db
    .prepare("INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)")
    .run(staff.id, "ORDER_NOTE", order.id, JSON.stringify({ length: 19 }));
  ensureOrderHistory(s.db);
  ensureOrderHistory(s.db);
  s.adminAddOrderNote(merchant, order.id, { body: "โน้ตใหม่" });
  ensureOrderHistory(s.db);
  const notes = s.adminOrderDetail(merchant, order.id).notes;
  assert.equal(notes.length, 2);
  assert.equal(notes[0].body, "โน้ตเก่าแบบช่องเดียว");
  assert.equal(notes[0].legacy, true);
  assert.equal(notes[0].author, staff.name);
  assert.equal(notes[1].legacy, false);
  assert.ok(!JSON.stringify(s.orderDetail(user, order.id)).includes("โน้ตเก่า"));
});

test("status tabs: server counts follow every filter except status", async (t) => {
  const { s, user, merchant, staff, staffToken } = fixture(t);
  const preVariant = product(s, merchant, { name: "Tabs Preorder", preorder: true });
  buy(s, user, "stream-plus-30", "tabs-delivered-1");
  buy(s, user, "stream-plus-30", "tabs-delivered-2");
  s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "tabs-pending-1" });
  const cancel = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "tabs-cancel-1" });
  s.adminCancelOrder(merchant, cancel.id, { reason: "ทดสอบแท็บ" });
  buy(s, user, preVariant, "tabs-pre-1");
  s.createOrder(user, { variantId: preVariant, quantity: 1, requestKey: "tabs-pre-pending" });

  // Seed data has its own orders; scope every query to this buyer.
  const mine = { customer: "history-buyer@" };
  const all = s.adminOrders(staff, mine);
  assert.deepEqual(all.counts, { all: 6, pending: 2, preorder: 1, delivered: 2, failed: 1, todo: 1 });
  assert.ok(s.adminOrders(staff, {}).counts.all > 6);
  for (const [group, n] of Object.entries({ pending: 2, preorder: 1, delivered: 2, failed: 1, todo: 1, all: 6 })) {
    const page = s.adminOrders(staff, { ...mine, group });
    assert.equal(page.orders.length, n, group);
    // Counts ignore the selected tab.
    assert.deepEqual(page.counts, all.counts);
  }
  assert.ok(s.adminOrders(staff, { ...mine, group: "todo" }).orders.every((o) => o.status === "PREORDER"));
  // Other filters narrow the counts.
  assert.deepEqual(s.adminOrders(staff, { ...mine, type: "preorder" }).counts, { all: 2, pending: 1, preorder: 1, delivered: 0, failed: 0, todo: 1 });
  assert.equal(s.adminOrders(staff, { ...mine, q: "Tabs Preorder", group: "delivered" }).counts.all, 2);
  assert.throws(() => s.adminOrders(staff, { group: "nope" }), (e) => e.status === 400);
  // Later pages skip the count query.
  const first = s.adminOrders(staff, { ...mine, limit: 2 });
  assert.ok(first.nextCursor);
  assert.equal(s.adminOrders(staff, { ...mine, limit: 2, cursor: first.nextCursor }).counts, undefined);

  const handle = createAPIHandler(s);
  const res = await handle(
    new Request("http://local.test/api/admin/orders?group=pending&customer=history-buyer%40", { headers: { Cookie: `astra_session=${staffToken}` } }),
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.orders.length, 2);
  assert.equal(body.counts.all, 6);
});
