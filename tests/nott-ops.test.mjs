import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const auth = s.register({
    name: "QA Buyer",
    email: "buyer@example.invalid",
    password: "Test-only-Password-123",
  });
  const user = s.session(auth.token);
  const merchantAuth = s.demoMerchant();
  const merchant = s.session(merchantAuth.token);
  const staffAuth = s.register({
    name: "QA Staff",
    email: "staff@example.invalid",
    password: "Staff-only-Password-123",
  });
  s.db
    .prepare("UPDATE users SET role=? WHERE id=?")
    .run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  return {
    s,
    user,
    merchant,
    staff,
    token: auth.token,
    staffToken: staffAuth.token,
    merchantToken: merchantAuth.token,
  };
}

test("product detail API omits inventory secrets", (t) => {
  const { s } = fixture(t);
  const product = s.productDetail("stream-plus");
  assert.equal(product.id, "stream-plus");
  assert.ok(product.variants.length >= 1);
  const blob = JSON.stringify(product);
  assert.ok(!blob.includes("secret"));
  assert.ok(!blob.includes("DEMO-KEY"));
  assert.throws(
    () => s.productDetail("missing-product"),
    (e) => e.status === 404,
  );
});

test("staff can list orders without codes; client role field is ignored", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "staff-view-1",
  });
  const paid = s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.equal(paid.codes.length, 1);
  const listed = s.staffOrders(staff);
  assert.ok(listed.orders.some((o) => o.id === order.id));
  assert.ok(listed.orders.every((o) => o.codes === undefined));
  assert.deepEqual(s.orderDetail(staff, order.id).codes, []);
  assert.throws(() => s.staffOrders(user), (e) => e.status === 403);
  const channel = s.setPaymentChannel(merchant, {
    provider: "sandbox",
    active: true,
    role: "ADMIN",
  });
  assert.equal(channel.provider, "sandbox");
  assert.equal(channel.active, true);
});

test("payment channel blocks slipok/gateway until client confirms", (t) => {
  const { s, merchant, user } = fixture(t);
  assert.equal(s.getPaymentChannel().provider, "unset");
  assert.throws(
    () => s.setPaymentChannel(merchant, { provider: "slipok", active: true }),
    (e) => e.status === 501,
  );
  assert.throws(
    () => s.setPaymentChannel(merchant, { provider: "gateway", active: 1 }),
    (e) => e.status === 501,
  );
  assert.equal(
    s.setPaymentChannel(merchant, { provider: "sandbox", active: true })
      .provider,
    "sandbox",
  );
  const prev = process.env.ASTRA_CLIENT_PAYMENT_PROVIDER;
  process.env.ASTRA_CLIENT_PAYMENT_PROVIDER = "slipok";
  try {
    assert.equal(
      s.setPaymentChannel(merchant, { provider: "slipok", active: false })
        .provider,
      "slipok",
    );
    const order = s.createOrder(user, {
      variantId: "stream-plus-30",
      quantity: 1,
      requestKey: "blocked-provider-pay",
    });
    assert.throws(
      () =>
        s.pay(user, order.id, {
          paymentToken: order.paymentToken,
          outcome: "success",
        }),
      (e) => e.status === 501,
    );
  } finally {
    if (prev === undefined) delete process.env.ASTRA_CLIENT_PAYMENT_PROVIDER;
    else process.env.ASTRA_CLIENT_PAYMENT_PROVIDER = prev;
    s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  }
});

test("successful pay delivers codes and records sandbox payment", (t) => {
  const { s, user, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "deliver-1",
  });
  const paid = s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.equal(paid.status, "DELIVERED");
  assert.equal(paid.codes.length, 1);
  const payment = s.db
    .prepare("SELECT status, provider FROM payments WHERE order_id=?")
    .get(order.id);
  assert.equal(payment.status, "SUCCEEDED");
  assert.equal(payment.provider, "sandbox");
  assert.ok(s.notifications(user).some((n) => n.kind === "code_delivery"));
});

test("preorder pay assigns queue number and notifies buyer", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const order = s.createOrder(user, {
    variantId: "cinema-max-90",
    quantity: 1,
    requestKey: "preorder-q-1",
  });
  assert.equal(order.preorder, true);
  const paid = s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.equal(paid.status, "PREORDER");
  assert.ok(paid.total > 0, "preorder has a price");
  assert.ok(paid.queueNumber >= 1);
  assert.deepEqual(paid.codes, []);
  assert.ok(
    s
      .myQueue(user)
      .some((q) => q.id === order.id && q.queueNumber === paid.queueNumber),
  );
  assert.ok(s.queueBoard(staff).some((q) => q.id === order.id));
  assert.throws(() => s.queueBoard(user), (e) => e.status === 403);
});

test("in-web chat and notifications stay scoped", (t) => {
  const { s, user, staff } = fixture(t);
  const opened = s.openChatThread(user, {
    body: "ต้องการช่วยเหลือเรื่องออเดอร์",
  });
  assert.ok(opened.thread.id);
  assert.equal(opened.messages.length, 1);
  const reply = s.postChatMessage(staff, opened.thread.id, {
    body: "รับทราบครับ กำลังตรวจให้",
  });
  assert.ok(reply.some((m) => m.sender_type === "STAFF"));
  const notes = s.notifications(user);
  assert.ok(notes.some((n) => n.kind === "chat"));
  const unread = notes.find((n) => n.kind === "chat" && !n.read_at);
  if (unread) assert.equal(s.markNotificationRead(user, unread.id).ok, true);
  assert.throws(
    () =>
      s.chatMessages(
        s.session(
          s.register({
            name: "Stranger",
            email: "stranger@example.invalid",
            password: "Test-only-Password-123",
          }).token,
        ),
        opened.thread.id,
      ),
    (e) => e.status === 403,
  );
});

test("buyer ranking is admin-only, filters by Bangkok period and validates limit", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "rank-order-001",
  });
  s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.throws(() => s.buyerRanking(user, {}), (e) => e.status === 403);
  assert.throws(() => s.buyerRanking(staff, {}), (e) => e.status === 403);
  assert.throws(() => s.buyerRanking(null, {}), (e) => e.status === 401);
  const all = s.buyerRanking(merchant, { limit: "5" });
  const mine = all.find((b) => b.email === "buyer@example.invalid");
  assert.ok(mine, "delivered buyer is ranked");
  assert.equal(mine.name, "QA Buyer");
  assert.equal(mine.spentSatang, order.total);
  assert.ok(all.every((b) => !("id" in b)), "user ids are not exposed");
  assert.ok(s.buyerRanking(merchant, { period: "day" }).some((b) => b.email === mine.email));
  s.db
    .prepare("UPDATE orders SET created_at='2020-01-01 00:00:00' WHERE id=?")
    .run(order.id);
  for (const period of ["day", "week", "month"])
    assert.ok(
      !s.buyerRanking(merchant, { period }).some((b) => b.email === mine.email),
      period + " excludes old spend",
    );
  assert.ok(s.buyerRanking(merchant, { period: "all" }).some((b) => b.email === mine.email));
  for (const limit of ["1.5", "0", "51", "abc"])
    assert.throws(
      () => s.buyerRanking(merchant, { limit }),
      (e) => e.status === 400,
      "limit " + limit,
    );
  assert.throws(
    () => s.buyerRanking(merchant, { period: "year" }),
    (e) => e.status === 400,
  );
});

test("buyer ranking counts paid preorders but not unpaid ones", (t) => {
  const { s, user, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const variant = s.db
    .prepare(
      "SELECT v.id FROM variants v JOIN products p ON p.id=v.product_id WHERE p.preorder=1 AND p.active=1 AND v.id<>'cinema-max-30' LIMIT 1",
    )
    .get();
  assert.ok(variant, "seed has a preorder variant");
  const unpaid = s.createOrder(user, {
    variantId: variant.id,
    quantity: 1,
    requestKey: "rank-preorder-unpaid",
  });
  const spent = () =>
    s.buyerRanking(merchant, {}).find((b) => b.email === "buyer@example.invalid")
      ?.spentSatang ?? 0;
  assert.equal(spent(), 0, "unpaid preorder is not counted");
  const paid = s.pay(user, unpaid.id, {
    paymentToken: unpaid.paymentToken,
    outcome: "success",
  });
  assert.equal(paid.status, "PREORDER");
  assert.ok(paid.total > 0, "preorder has a price");
  assert.equal(spent(), paid.total, "paid preorder is counted");
});

test("HTTP routes expose product detail, channel, queue, chat, rankings", async (t) => {
  const { s, token, staffToken, merchantToken } = fixture(t);
  const handle = createAPIHandler(s);
  const get = async (path, cookie) => {
    const res = await handle(
      new Request("http://local.test" + path, {
        headers: cookie ? { Cookie: `astra_session=${cookie}` } : {},
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  const post = async (path, cookie, body) => {
    const res = await handle(
      new Request("http://local.test" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Astra-Request": "1",
          Cookie: `astra_session=${cookie}`,
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  const product = await get("/api/products/stream-plus");
  assert.equal(product.status, 200);
  assert.equal(product.body.product.id, "stream-plus");
  assert.ok(!JSON.stringify(product.body).includes("DEMO-KEY"));
  const channel = await get("/api/payment-channel");
  assert.equal(channel.status, 200);
  assert.equal(channel.body.channel.provider, "unset");
  const rankings = await get("/api/rankings/buyers");
  assert.equal(rankings.status, 401);
  const customerRankings = await get("/api/rankings/buyers", token);
  assert.equal(customerRankings.status, 403);
  const adminRankings = await get("/api/rankings/buyers", merchantToken);
  assert.equal(adminRankings.status, 200);
  assert.equal(
    (await get("/api/rankings/buyers?period=week&limit=5", merchantToken)).status,
    200,
  );
  assert.equal(
    (await get("/api/rankings/buyers?limit=1.5", merchantToken)).status,
    400,
  );
  assert.ok(Array.isArray(adminRankings.body.buyers));
  const chat = await post("/api/chat/threads", token, {
    body: "สวัสดีจาก HTTP",
  });
  assert.equal(chat.status, 201);
  const staffOrders = await get("/api/staff/orders", staffToken);
  assert.equal(staffOrders.status, 200);
  assert.ok(Array.isArray(staffOrders.body.orders));
  const queue = await get("/api/queue", staffToken);
  assert.equal(queue.status, 200);
});

test("API-FIX-02: chat rate limit, staff notify throttle, and close thread", (t) => {
  const { s, user, staff } = fixture(t);
  const opened = s.openChatThread(user, { body: "เปิดเคสทดสอบแชท" });
  const before = s.notifications(staff).filter((n) => n.kind === "chat").length;
  s.postChatMessage(user, opened.thread.id, { body: "ข้อความที่ 1" });
  const afterFirst = s.notifications(staff).filter((n) => n.kind === "chat")
    .length;
  assert.ok(afterFirst >= before);
  s.postChatMessage(user, opened.thread.id, { body: "ข้อความที่ 2 ทันที" });
  const afterSecond = s.notifications(staff).filter((n) => n.kind === "chat")
    .length;
  assert.equal(
    afterSecond,
    afterFirst,
    "second message within throttle window should not fan-out again",
  );
  let limited = null;
  for (let i = 0; i < 40; i++) {
    try {
      s.postChatMessage(user, opened.thread.id, { body: "flood-" + i });
    } catch (e) {
      limited = e;
      break;
    }
  }
  assert.equal(limited?.status, 429);
  const closed = s.closeChatThread(user, opened.thread.id);
  assert.equal(closed.status, "CLOSED");
  assert.throws(
    () => s.postChatMessage(user, opened.thread.id, { body: "หลังปิด" }),
    (e) => e.status === 409,
  );
});

test("API-FIX-03: malformed product URI returns 400 not 500", async (t) => {
  const { s } = fixture(t);
  const handle = createAPIHandler(s);
  const res = await handle(
    new Request("http://local.test/api/products/%E0%A4"),
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test("API-FIX-04: staff orders support limit/cursor pagination", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  for (let i = 0; i < 3; i++) {
    const order = s.createOrder(user, {
      variantId: "stream-plus-30",
      quantity: 1,
      requestKey: "page-order-" + i + "-" + Date.now(),
    });
    s.pay(user, order.id, {
      paymentToken: order.paymentToken,
      outcome: "success",
    });
  }
  const page1 = s.staffOrders(staff, { limit: 2 });
  assert.equal(page1.orders.length, 2);
  assert.ok(page1.nextCursor);
  const page2 = s.staffOrders(staff, {
    limit: 2,
    cursor: page1.nextCursor,
  });
  assert.ok(page2.orders.length >= 1);
  assert.ok(
    !page2.orders.some((o) => o.id === page1.orders[0].id),
    "pages should not repeat first item",
  );
  assert.throws(
    () => s.staffOrders(staff, { limit: 1.5 }),
    (e) => e.status === 400,
  );
});
