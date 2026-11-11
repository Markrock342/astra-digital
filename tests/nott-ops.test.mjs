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
  assert.ok(listed.some((o) => o.id === order.id));
  assert.ok(listed.every((o) => o.codes === undefined));
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

test("buyer ranking uses delivered spend only and masks names", (t) => {
  const { s, user, merchant } = fixture(t);
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
  const buyers = s.buyerRanking(5);
  assert.ok(buyers.length >= 1);
  assert.equal(buyers[0].rank, 1);
  assert.match(buyers[0].name, /\*\*\*/);
  assert.ok(buyers[0].spentSatang > 0);
});

test("HTTP routes expose product detail, channel, queue, chat, rankings", async (t) => {
  const { s, token, staffToken } = fixture(t);
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
  assert.equal(rankings.status, 200);
  assert.ok(Array.isArray(rankings.body.buyers));
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
