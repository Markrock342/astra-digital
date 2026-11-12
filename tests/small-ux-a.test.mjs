// Small UX round A: no public stock numbers, notification deep links and
// "ส่งรหัสให้ลูกค้าอีกครั้ง" (resend credentials) from the admin order detail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { ensureNotificationLinks } from "../server/ensure-admin-fr.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const auth = s.register({ name: "UX Buyer", email: "ux-buyer@example.invalid", password: "Test-only-Password-123" });
  const user = s.session(auth.token);
  const merchantAuth = s.demoMerchant();
  const merchant = s.session(merchantAuth.token);
  const staffAuth = s.register({ name: "UX Staff", email: "ux-staff@example.invalid", password: "Staff-only-Password-123" });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  return { s, user, merchant, staff, tokens: { user: auth.token, merchant: merchantAuth.token, staff: staffAuth.token } };
}

function http(s) {
  const handle = createAPIHandler(s);
  return async (path, token) => {
    const res = await handle(
      new Request("http://127.0.0.1:4331" + path, { headers: { Cookie: token ? "astra_session=" + token : "" } }),
    );
    return { status: res.status, text: await res.text() };
  };
}

/** Every key named `stock` anywhere in a JSON value. */
function stockKeys(value, path = "$", out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => stockKeys(v, path + "[" + i + "]", out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      if (k === "stock") out.push(path + "." + k + "=" + JSON.stringify(v));
      stockKeys(v, path + "." + k, out);
    }
  return out;
}

const buyReady = (s, user, key, variantId = "stream-plus-30") => {
  const order = s.createOrder(user, { variantId, quantity: 1, requestKey: key });
  return s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
};
const noticesOf = (s, userId) =>
  s.db.prepare("SELECT kind,title,body,link FROM notifications WHERE user_id=? ORDER BY rowid").all(userId);

// ---------------------------------------------------------------- public stock

test("public product JSON never contains a stock number, for any caller", async (t) => {
  const { s, merchant, tokens } = fixture(t);
  // A low variant (1 left) and a big one (> 10) so neither the real count nor the old cap shows.
  s.db
    .prepare("DELETE FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL AND id NOT IN (SELECT id FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL LIMIT 1)")
    .run("stream-plus-30", "stream-plus-30");
  s.importCodes(merchant, {
    variantId: "stream-plus-90",
    codes: Array.from({ length: 14 }, (_, i) => "UXA-STOCK-" + (2000 + i)).join("\n"),
  });
  const get = http(s);
  for (const token of [null, tokens.user, tokens.staff, tokens.merchant]) {
    for (const path of ["/api/products", "/api/products/stream-plus", "/api/products/cinema-max"]) {
      const res = await get(path, token);
      assert.equal(res.status, 200, path);
      const body = JSON.parse(res.text);
      assert.deepEqual(stockKeys(body), [], path + " leaks stock");
      assert.ok(!/"stock"\s*:/.test(res.text), path + " raw JSON has a stock key");
      for (const v of (body.products ?? [body.product]).flatMap((p) => p.variants)) {
        assert.ok(["in", "low", "out"].includes(v.stockStatus), v.id);
        assert.equal(typeof v.available, "boolean", v.id);
      }
    }
  }
  const detail = JSON.parse((await get("/api/products/stream-plus")).text).product;
  const low = detail.variants.find((v) => v.id === "stream-plus-30");
  assert.equal(low.stockStatus, "low");
  assert.equal(low.available, true);
  const big = detail.variants.find((v) => v.id === "stream-plus-90");
  assert.equal(big.stockStatus, "in");
  // Preorder products can always be ordered; they have no ready stock.
  const pre = JSON.parse((await get("/api/products/cinema-max")).text).product;
  assert.ok(pre.variants.every((v) => v.available === true));

  // Admin APIs keep the exact count.
  const adminView = s.adminOverview(merchant);
  const exact = adminView.products.flatMap((p) => p.variants).find((v) => v.id === "stream-plus-90");
  assert.ok(exact.stock > 10, "admin overview has the exact number");
  assert.equal(
    adminView.products.flatMap((p) => p.variants).find((v) => v.id === "stream-plus-30").stock,
    1,
  );
});

test("sold-out variant is out and not available, still without a number", (t) => {
  const { s } = fixture(t);
  s.db.prepare("DELETE FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL").run("stream-plus-30");
  const v = s.productDetail("stream-plus").variants.find((x) => x.id === "stream-plus-30");
  assert.equal(v.stockStatus, "out");
  assert.equal(v.available, false);
  assert.equal(v.stock, undefined);
});

// ---------------------------------------------------------------- notification links

test("ensureNotificationLinks is idempotent and keeps old rows without a link", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE notifications(id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,title TEXT,body TEXT,read_at TEXT,created_at TEXT)");
  db.exec("INSERT INTO notifications VALUES('old','u','order','t','b',NULL,'2026-01-01 00:00:00')");
  ensureNotificationLinks(db);
  ensureNotificationLinks(db);
  const cols = db.prepare("PRAGMA table_info(notifications)").all().map((c) => c.name);
  assert.equal(cols.filter((c) => c === "link").length, 1);
  assert.equal(db.prepare("SELECT link FROM notifications WHERE id='old'").get().link, null);
  db.close();
});

test("order and chat notifications carry a deep link for customers and the team", (t) => {
  const { s, user, merchant, staff } = fixture(t);
  // Ready order: customer → their order, team → admin order.
  const paid = buyReady(s, user, "uxa-link-ready-1");
  assert.equal(paid.status, "DELIVERED");
  assert.ok(noticesOf(s, user.id).some((n) => n.kind === "code_delivery" && n.link === "/orders/" + paid.id));
  assert.ok(noticesOf(s, staff.id).some((n) => n.kind === "order_new" && n.link === "/admin/orders/" + paid.id));

  // Preorder: new queue → admin order page; delivered → customer order page.
  const reservation = s.createOrder(user, { variantId: "cinema-max-90", quantity: 1, requestKey: "uxa-link-pre-1" });
  s.pay(user, reservation.id, { paymentToken: reservation.paymentToken, outcome: "success" });
  for (const who of [staff, merchant])
    assert.ok(
      noticesOf(s, who.id).some((n) => n.kind === "preorder_queue_admin" && n.link === "/admin/orders/" + reservation.id),
    );
  s.deliverReservation(merchant, reservation.id);
  assert.ok(
    noticesOf(s, user.id).some((n) => n.title === "พรีออเดอร์พร้อมใช้งานแล้ว" && n.link === "/orders/" + reservation.id),
  );

  // Refund → customer order page.
  s.refundOrder(merchant, paid.id, { amount: 100, reasonCode: "CUSTOMER_CANCEL", destination: "CREDIT", requestKey: "uxa-refund-0001" });
  assert.ok(noticesOf(s, user.id).some((n) => n.kind === "refund" && n.link === "/orders/" + paid.id));

  // Credential replaced → customer order page.
  const soldId = s.db.prepare("SELECT id FROM inventory WHERE order_id=?").get(paid.id).id;
  s.replaceOrderCredential(merchant, paid.id, { inventoryId: soldId, reason: "บัญชีล็อก" });
  assert.ok(noticesOf(s, user.id).some((n) => n.title === "บัญชีถูกเปลี่ยนแล้ว" && n.link === "/orders/" + paid.id));

  // Chat: a customer message → the admin chat page on that thread; assignment too.
  const opened = s.openChatThread(user, { body: "ช่วยด้วย" });
  const chatLink = "/admin/chat?thread=" + opened.thread.id;
  assert.ok(noticesOf(s, staff.id).some((n) => n.kind === "chat" && n.link === chatLink));
  s.assignChatThread(merchant, opened.thread.id, { assigneeId: staff.id });
  assert.ok(noticesOf(s, staff.id).some((n) => n.kind === "chat_assigned" && n.link === chatLink));

  // The API returns the link; rows written before this change come back as null.
  s.db
    .prepare("INSERT INTO notifications(id,user_id,kind,title,body,created_at) VALUES('legacy-n',?,'order','เก่า','ไม่มีลิงก์',CURRENT_TIMESTAMP)")
    .run(user.id);
  const listed = s.notifications(user);
  assert.ok(listed.every((n) => "link" in n));
  assert.equal(listed.find((n) => n.id === "legacy-n").link, null);
  assert.ok(listed.some((n) => n.link === "/orders/" + paid.id));
});

// ---------------------------------------------------------------- resend credentials

test("resend credentials: notification + chat with a link, never the password; audited and limited", (t) => {
  const { s, user, merchant, staff } = fixture(t);
  s.db.prepare("DELETE FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL").run("stream-plus-30");
  s.importCodes(merchant, {
    variantId: "stream-plus-30",
    items: [{ loginId: "resend-login@example.invalid", password: "Sup3r-Secret-Pass" }],
  });
  const paid = buyReady(s, user, "uxa-resend-1");
  assert.equal(paid.credentials[0].password, "Sup3r-Secret-Pass");

  // Customers cannot resend; undelivered orders cannot be resent.
  assert.throws(() => s.resendOrderCredentials(user, paid.id), (e) => e.status === 403);
  assert.throws(() => s.resendOrderCredentials(staff, "missing-order"), (e) => e.status === 404);
  const pending = s.createOrder(user, { variantId: "stream-plus-90", quantity: 1, requestKey: "uxa-resend-pending" });
  assert.throws(() => s.resendOrderCredentials(staff, pending.id), (e) => e.status === 409);

  const first = s.resendOrderCredentials(staff, paid.id);
  assert.equal(first.link, "/orders/" + paid.id);
  assert.equal(first.remaining, 2);

  const notice = noticesOf(s, user.id).find((n) => n.title === "ร้านส่งข้อมูลบัญชีให้อีกครั้ง");
  assert.ok(notice, "customer notified");
  assert.equal(notice.link, "/orders/" + paid.id);
  const messages = s.chatMessages(user, first.threadId);
  const last = messages.at(-1);
  assert.equal(last.sender_type, "STAFF");
  assert.ok(last.body.includes("/orders/" + paid.id));
  for (const text of [JSON.stringify(notice), JSON.stringify(messages)]) {
    assert.ok(!text.includes("Sup3r-Secret-Pass"), "password never in chat or notification");
    assert.ok(!text.includes("resend-login@example.invalid"), "login never in chat or notification");
  }
  const audit = s.db.prepare("SELECT user_id,detail FROM audit WHERE action='RESEND_CREDENTIALS' AND entity_id=?").all(paid.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].user_id, staff.id);
  assert.ok(!audit[0].detail.includes("Sup3r"));

  // Same open thread is reused; admin resends show as ADMIN.
  const second = s.resendOrderCredentials(merchant, paid.id);
  assert.equal(second.threadId, first.threadId);
  assert.equal(s.chatMessages(user, first.threadId).at(-1).sender_type, "ADMIN");
  s.resendOrderCredentials(staff, paid.id);
  // 3 per order per hour.
  assert.throws(() => s.resendOrderCredentials(merchant, paid.id), (e) => e.status === 429);
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='RESEND_CREDENTIALS' AND entity_id=?").get(paid.id).n,
    3,
  );
  // Resends older than an hour do not count (audit rows are append-only, so write old ones).
  const other = buyReady(s, user, "uxa-resend-2", "stream-plus-90");
  for (let i = 0; i < 3; i++)
    s.db
      .prepare("INSERT INTO audit(user_id,action,entity_id,created_at) VALUES(?,'RESEND_CREDENTIALS',?,datetime('now','-2 hours'))")
      .run(staff.id, other.id);
  assert.equal(s.resendOrderCredentials(staff, other.id).remaining, 2);
  // The activity timeline shows each resend with who did it.
  const timeline = s.adminOrderDetail(merchant, paid.id).timeline.filter((e) => e.event === "resent");
  assert.equal(timeline.length, 3);
  assert.equal(timeline[0].actor, "UX Staff");
});

test("resend credentials works for a delivered preorder and over HTTP", async (t) => {
  const { s, user, merchant, tokens } = fixture(t);
  const reservation = s.createOrder(user, { variantId: "cinema-max-90", quantity: 1, requestKey: "uxa-resend-pre" });
  s.pay(user, reservation.id, { paymentToken: reservation.paymentToken, outcome: "success" });
  const handle = createAPIHandler(s);
  const post = async (path, token) => {
    const res = await handle(
      new Request("http://127.0.0.1:4331" + path, {
        method: "POST",
        headers: { Cookie: "astra_session=" + token, "Content-Type": "application/json", "X-Astra-Request": "1" },
        body: "{}",
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  const path = "/api/admin/orders/" + reservation.id + "/resend-credentials";
  assert.equal((await post(path, tokens.staff)).status, 409, "not delivered yet");
  s.deliverReservation(merchant, reservation.id);
  assert.equal((await post(path, tokens.user)).status, 403);
  const ok = await post(path, tokens.staff);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.link, "/orders/" + reservation.id);
});
