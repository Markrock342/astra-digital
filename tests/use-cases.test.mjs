// End-to-end customer, staff and admin use cases through the HTTP API.
// Each test drives the same handler the Worker uses, against an in-memory DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";

const BASE = "http://127.0.0.1:4331";

function shop(t, options = { allowDemoAdmin: true }) {
  const s = createCommerce(options);
  t.after(() => s.db.close());
  const handle = createAPIHandler(s);
  async function call(method, path, cookie, body) {
    const headers = { Cookie: cookie ?? "" };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers["X-Astra-Request"] = "1";
    }
    const res = await handle(
      new Request(BASE + path, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      }),
    );
    const cookieOut = /astra_session=([a-f0-9]+)/.exec(
      res.headers.get("Set-Cookie") ?? "",
    )?.[1];
    return { status: res.status, body: await res.json(), cookieOut };
  }
  const get = (path, cookie) => call("GET", path, cookie);
  const post = (path, cookie, body) => call("POST", path, cookie, body);
  let n = 0;
  async function register(name, role) {
    const email = `uc-${++n}-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.invalid`;
    const r = await post("/api/register", null, {
      name,
      email,
      password: "Use-case-only-Password-123",
    });
    assert.equal(r.status, 200, "register " + name);
    if (role)
      s.db.prepare("UPDATE users SET role=? WHERE id=?").run(role, r.body.user.id);
    return { id: r.body.user.id, email, cookie: "astra_session=" + r.cookieOut };
  }
  async function admin() {
    const r = await post("/api/demo-merchant", null, {});
    assert.equal(r.status, 200);
    return { cookie: "astra_session=" + r.cookieOut };
  }
  return { s, get, post, register, admin };
}

let keySeq = 0;
const key = (label) => `${label}-${++keySeq}-request-key`;

async function enableSandbox(api, boss) {
  const r = await api.post("/api/admin/payment-channel", boss.cookie, {
    provider: "sandbox",
    active: true,
  });
  assert.equal(r.status, 200);
}

async function buy(api, who, variantId, quantity = 1) {
  const order = await api.post("/api/orders", who.cookie, {
    variantId,
    quantity,
    requestKey: key(variantId),
  });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const paid = await api.post(`/api/orders/${order.body.id}/pay`, who.cookie, {
    paymentToken: order.body.paymentToken,
    outcome: "success",
  });
  return { order: order.body, paid };
}

test("UC1 customer buys an in-stock item and only the owner sees the delivered code", async (t) => {
  const api = shop(t);
  const boss = await api.admin();
  await enableSandbox(api, boss);
  const buyer = await api.register("Buyer");
  const stranger = await api.register("Stranger");
  const staff = await api.register("Staff", ROLES.STAFF);

  const { order, paid } = await buy(api, buyer, "stream-plus-30");
  assert.equal(paid.status, 200);
  assert.equal(paid.body.status, "DELIVERED");
  assert.equal(paid.body.codes.length, 1);

  const again = await api.get(`/api/orders/${order.id}`, buyer.cookie);
  assert.deepEqual(again.body.codes, paid.body.codes, "owner can reread codes");
  assert.equal((await api.get(`/api/orders/${order.id}`, stranger.cookie)).status, 404);
  const staffView = await api.get(`/api/orders/${order.id}`, staff.cookie);
  assert.equal(staffView.status, 200);
  assert.deepEqual(staffView.body.codes, [], "staff never sees codes");
  const list = await api.get("/api/staff/orders", staff.cookie);
  assert.ok(!JSON.stringify(list.body).includes(paid.body.codes[0]));

  const notes = await api.get("/api/notifications", buyer.cookie);
  assert.ok(notes.body.notifications.some((n) => n.kind === "code_delivery"));
});

test("UC2 preorder gets a queue number only after payment, in payment order", async (t) => {
  const api = shop(t);
  const boss = await api.admin();
  await enableSandbox(api, boss);
  const staff = await api.register("Staff", ROLES.STAFF);
  const first = await api.register("First");
  const second = await api.register("Second");
  const variant = "cinema-max-90";

  const early = await api.post("/api/orders", first.cookie, {
    variantId: variant,
    quantity: 1,
    requestKey: key("pre-early"),
  });
  assert.equal(early.status, 201);
  assert.equal(early.body.queueNumber, null, "no queue before payment");

  // Second customer reserves later but pays first, so they are first in the queue.
  const late = await buy(api, second, variant);
  assert.equal(late.paid.body.status, "PREORDER");
  assert.equal(late.paid.body.queueNumber, 1);

  let board = await api.get("/api/queue", staff.cookie);
  assert.deepEqual(
    board.body.queue.map((q) => q.queue_number),
    [1],
    "unpaid reservation is not on the staff board",
  );

  const paidEarly = await api.post(`/api/orders/${early.body.id}/pay`, first.cookie, {
    paymentToken: early.body.paymentToken,
    outcome: "success",
  });
  assert.equal(paidEarly.body.queueNumber, 2);
  const repeat = await api.post(`/api/orders/${early.body.id}/pay`, first.cookie, {
    paymentToken: early.body.paymentToken,
    outcome: "success",
  });
  assert.equal(repeat.body.queueNumber ?? 2, 2, "paying twice keeps the same number");

  board = await api.get("/api/queue", staff.cookie);
  assert.deepEqual(board.body.queue.map((q) => q.queue_number), [1, 2]);
  const mine = await api.get("/api/queue/me", first.cookie);
  assert.deepEqual(mine.body.queue.map((q) => q.queueNumber), [2]);
  assert.equal((await api.get("/api/queue", first.cookie)).status, 403);
});

test("UC3 public catalog hides exact stock but keeps it for admin", async (t) => {
  const api = shop(t);
  const boss = await api.admin();
  const codes = Array.from({ length: 15 }, (_, i) => `UC3-STOCK-${1000 + i}`).join("\n");
  const imported = await api.post("/api/admin/inventory", boss.cookie, {
    variantId: "stream-plus-30",
    codes,
  });
  assert.equal(imported.status, 200);

  const pub = await api.get("/api/products/stream-plus");
  const v = pub.body.product.variants.find((x) => x.id === "stream-plus-30");
  assert.equal(v.stock, 10, "public stock is capped at the per-order max");
  assert.equal(v.stockStatus, "in");
  assert.ok(!JSON.stringify(pub.body).includes("UC3-STOCK"), "codes never public");

  const adminView = await api.get("/api/admin", boss.cookie);
  const exact = adminView.body.products
    .flatMap((p) => p.variants)
    .find((x) => x.id === "stream-plus-30");
  assert.ok(exact.stock > 10, "admin sees the exact count");

  const all = await api.get("/api/products");
  for (const p of all.body.products)
    for (const x of p.variants) {
      assert.ok(x.stock <= 10);
      assert.equal(x.stockStatus, x.stock === 0 ? "out" : x.stock <= 3 ? "low" : "in");
    }
});

test("UC4 out-of-stock and low-stock items behave correctly", async (t) => {
  const api = shop(t);
  const boss = await api.admin();
  await enableSandbox(api, boss);
  const buyer = await api.register("Buyer");
  for (let i = 0; i < 5; i++) {
    const top = await api.post("/api/topup", buyer.cookie, { amount: 1000, requestKey: key("topup") });
    assert.equal(top.status, 200);
  }
  const product = (await api.get("/api/products")).body.products.find(
    (p) => !p.preorder && p.variants.some((v) => v.stock > 0),
  );
  const variant = product.variants.find((v) => v.stock > 0);
  const real = api.s.db
    .prepare("SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND order_id IS NULL")
    .get(variant.id).n;
  for (let left = real; left > 0; ) {
    const take = Math.min(left, 10);
    const r = await buy(api, buyer, variant.id, take);
    assert.equal(r.paid.body.status, "DELIVERED");
    left -= take;
    const now = (await api.get("/api/products/" + product.id)).body.product.variants.find(
      (v) => v.id === variant.id,
    );
    assert.equal(now.stockStatus, left === 0 ? "out" : left <= 3 ? "low" : "in");
  }
  const sold = await api.post("/api/orders", buyer.cookie, {
    variantId: variant.id,
    quantity: 1,
    requestKey: key("sold-out"),
  });
  assert.equal(sold.status, 409, "cannot order a sold-out item");
});

test("UC5 notifications and chats stay private to their owner", async (t) => {
  const api = shop(t);
  const alice = await api.register("Alice");
  const bob = await api.register("Bob");
  const staff = await api.register("Staff", ROLES.STAFF);

  const opened = await api.post("/api/chat/threads", alice.cookie, { body: "ช่วยด้วย" });
  assert.equal(opened.status, 201);
  const thread = opened.body.thread.id;
  assert.equal((await api.get(`/api/chat/threads/${thread}/messages`, bob.cookie)).status, 403);
  assert.equal(
    (await api.post(`/api/chat/threads/${thread}/messages`, bob.cookie, { body: "แอบ" })).status,
    403,
  );

  await api.post(`/api/chat/threads/${thread}/messages`, alice.cookie, { body: "รายละเอียดเพิ่ม" });
  const staffNotes = await api.get("/api/notifications", staff.cookie);
  assert.ok(staffNotes.body.notifications.some((n) => n.kind === "chat"), "staff told about customer message");
  const reply = await api.post(`/api/chat/threads/${thread}/messages`, staff.cookie, {
    body: "ทีมงานรับเรื่องแล้ว",
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.messages.at(-1).sender_type, "STAFF");

  const aliceNotes = (await api.get("/api/notifications", alice.cookie)).body.notifications;
  assert.ok(aliceNotes.some((n) => n.title.includes("ทีมงาน")));
  const bobNotes = (await api.get("/api/notifications", bob.cookie)).body.notifications;
  assert.equal(bobNotes.length, 0, "Bob sees none of Alice's notifications");
  assert.equal(
    (await api.post(`/api/notifications/${aliceNotes[0].id}/read`, bob.cookie, {})).status,
    404,
    "Bob cannot mark Alice's notification",
  );
  assert.equal(
    (await api.post(`/api/notifications/${aliceNotes[0].id}/read`, alice.cookie, {})).status,
    200,
  );

  const closed = await api.post(`/api/chat/threads/${thread}/close`, alice.cookie, {});
  assert.equal(closed.body.thread.status, "CLOSED");
  assert.equal(
    (await api.post(`/api/chat/threads/${thread}/messages`, alice.cookie, { body: "x" })).status,
    409,
  );
});

test("UC6 buyer ranking is for the admin only", async (t) => {
  const api = shop(t);
  const boss = await api.admin();
  await enableSandbox(api, boss);
  const buyer = await api.register("Ranker");
  await buy(api, buyer, "stream-plus-30");

  assert.equal((await api.get("/api/rankings/buyers")).status, 401);
  assert.equal((await api.get("/api/rankings/buyers", buyer.cookie)).status, 403);
  for (const period of ["day", "week", "month", "all"]) {
    const r = await api.get(`/api/rankings/buyers?period=${period}`, boss.cookie);
    assert.equal(r.status, 200, period);
    assert.ok(r.body.buyers.some((b) => b.email === buyer.email), period);
  }
  assert.equal((await api.get("/api/rankings/buyers?limit=2.5", boss.cookie)).status, 400);
});

test("UC7 live shop refuses demo accounts, demo credit and sandbox payment", async (t) => {
  const api = shop(t, { allowDemoAdmin: false, allowSandbox: false, seed: false });
  const health = await api.get("/api/health");
  assert.equal(health.body.mode, "live");
  assert.equal(health.body.features.credentialPair, true);
  assert.equal(health.body.features.preorderDelivery, true);
  assert.equal(health.body.features.adminChatInbox, true);
  assert.equal(health.body.features.adminOpsNotifications, true);
  assert.equal(health.body.features.salesRevenueFromPayments, true);
  assert.equal(health.body.features.adminOrdersApi, true);
  assert.equal(health.body.features.adminCustomersApi, true);
  assert.equal(health.body.features.adminProductsApi, true);
  assert.equal(health.body.features.adminSummaryApi, true);
  assert.equal(health.body.features.productPreorderForm, true);
  assert.equal((await api.get("/api/products")).body.products.length, 0, "starts empty");
  assert.equal((await api.post("/api/demo", null, {})).status, 403);
  assert.equal((await api.post("/api/demo-merchant", null, {})).status, 403);

  const buyer = await api.register("Live Buyer");
  const me = await api.get("/api/me", buyer.cookie);
  assert.equal(me.body.user.balance, 0, "no welcome credit in live mode");
  assert.equal(
    (await api.post("/api/topup", buyer.cookie, { amount: 100, requestKey: key("topup") })).status,
    501,
  );
  assert.equal((await api.get("/api/rankings/buyers", buyer.cookie)).status, 403);
  assert.equal(
    (await api.post("/api/admin/payment-channel", buyer.cookie, { provider: "sandbox", active: true }))
      .status,
    403,
    "a customer cannot open the payment channel",
  );
});

test("UC5b staff is notified when a customer opens a chat", async (t) => {
  const api = shop(t);
  const alice = await api.register("Alice");
  const staff = await api.register("Staff", ROLES.STAFF);
  await api.post("/api/chat/threads", alice.cookie, { body: "เปิดแชทครั้งแรก" });
  const notes = (await api.get("/api/notifications", staff.cookie)).body.notifications;
  assert.ok(notes.some((n) => n.kind === "chat"));
});
