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
  assert.ok(
    s.notifications(staff).some((n) => n.title.includes("เปิดแชท")),
    "opening chat should notify staff",
  );
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

test("API-FIX-01: inactive sandbox blocks pay; openChat rate+throttle; ranking decimal", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "inactive-channel-pay",
  });
  s.setPaymentChannel(merchant, { provider: "sandbox", active: false });
  assert.throws(
    () =>
      s.pay(user, order.id, {
        paymentToken: order.paymentToken,
        outcome: "success",
      }),
    (e) => e.status === 403,
  );

  assert.throws(
    () => s.buyerRanking(merchant, { limit: 1.5 }),
    (e) => e.status === 400,
  );

  const first = s.openChatThread(user, { body: "เปิดครั้งแรก" });
  const afterOpen = s.notifications(staff).filter((n) => n.kind === "chat")
    .length;
  assert.ok(afterOpen >= 1, "staff should be notified on open");
  s.openChatThread(user, { body: "เปิดซ้ำห้องเดิม" });
  assert.equal(
    s.notifications(staff).filter((n) => n.kind === "chat").length,
    afterOpen,
    "re-open same thread within throttle must not fan-out again",
  );
  s.closeChatThread(user, first.thread.id);
  let limited = null;
  for (let i = 0; i < 40; i++) {
    try {
      const opened = s.openChatThread(user, { body: "flood-open-" + i });
      s.closeChatThread(user, opened.thread.id);
    } catch (e) {
      limited = e;
      break;
    }
  }
  assert.equal(limited?.status, 429);
});

test("API-FIX-05: staffOrders pages in SQL without repeating rows", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const order = s.createOrder(user, {
      variantId: "stream-plus-30",
      quantity: 1,
      requestKey: "sql-page-" + i + "-" + Date.now(),
    });
    s.pay(user, order.id, {
      paymentToken: order.paymentToken,
      outcome: "success",
    });
    ids.push(order.id);
  }
  const page1 = s.staffOrders(staff, { limit: 2 });
  assert.equal(page1.orders.length, 2);
  assert.ok(page1.nextCursor);
  const page2 = s.staffOrders(staff, {
    limit: 2,
    cursor: page1.nextCursor,
  });
  assert.equal(page2.orders.length, 2);
  const seen = new Set(page1.orders.map((o) => o.id));
  for (const row of page2.orders) assert.equal(seen.has(row.id), false);
  const page3 = s.staffOrders(staff, {
    limit: 2,
    cursor: page2.nextCursor,
  });
  assert.ok(page3.orders.length >= 1);
  for (const row of page3.orders) {
    assert.equal(seen.has(row.id), false);
    assert.equal(page2.orders.some((o) => o.id === row.id), false);
  }
});

test("ISSUE-18 DB-005: import pairs, deliver, owner credentials, queue, index", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });

  // K1 — product API has no secrets
  const product = s.productDetail("cinema-max");
  const blob = JSON.stringify(product);
  assert.ok(!blob.includes("_enc"));
  assert.ok(!/"password"/.test(blob));
  assert.ok(!/"loginId"/.test(blob));
  assert.ok(!/"login_id"/.test(blob));

  // Drop seed DEMO keys so deliver binds the imported pairs.
  s.db
    .prepare(
      "DELETE FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL",
    )
    .run("cinema-max-90");

  const imported = s.importCodes(merchant, {
    variantId: "cinema-max-90",
    items: [
      { loginId: "  pair-a@example.invalid  ", password: " pass with spaces " },
      { loginId: "pair-b@example.invalid", password: "plain" },
    ],
  });
  assert.equal(imported.imported, 2);
  const freePairs = s.db
    .prepare(
      "SELECT legacy_single_secret FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL",
    )
    .all("cinema-max-90");
  assert.equal(freePairs.length, 2);
  assert.ok(freePairs.every((r) => r.legacy_single_secret === 0));
  assert.throws(
    () =>
      s.importCodes(merchant, {
        variantId: "cinema-max-90",
        items: [
          {
            loginId: "pair-a@example.invalid",
            password: " pass with spaces ",
          },
        ],
      }),
    (e) => e.status === 409,
  );
  assert.throws(
    () =>
      s.importCodes(merchant, {
        variantId: "cinema-max-90",
        codes: "LEGACY1",
        items: [{ loginId: "x", password: "y" }],
      }),
    (e) => e.status === 400,
  );

  const reservation = s.createOrder(user, {
    variantId: "cinema-max-90",
    quantity: 1,
    requestKey: "issue18-deliver-1",
  });
  const paid = s.pay(user, reservation.id, {
    paymentToken: reservation.paymentToken,
    outcome: "success",
  });
  assert.equal(paid.status, "PREORDER");
  assert.ok(s.queueBoard(staff).some((q) => q.id === reservation.id));

  // P3 — CUSTOMER/STAFF cannot deliver
  assert.throws(
    () => s.deliverReservation(user, reservation.id),
    (e) => e.status === 403,
  );
  assert.throws(
    () => s.deliverReservation(staff, reservation.id),
    (e) => e.status === 403,
  );

  // P1 — ADMIN deliver binds reservation_id
  const delivered = s.deliverReservation(merchant, reservation.id);
  assert.equal(delivered.status, "DELIVERED");
  assert.equal(delivered.delivered, true);
  assert.match(delivered.delivered_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.equal(delivered.delivered_by, merchant.id);
  assert.equal(delivered.loginId, undefined);
  assert.equal(delivered.password, undefined);
  assert.equal(delivered.codes, undefined);
  assert.equal(delivered.credentials, undefined);
  assert.equal(
    s.db
      .prepare("SELECT COUNT(*) AS n FROM inventory WHERE reservation_id=?")
      .get(reservation.id).n,
    1,
  );
  assert.ok(!s.queueBoard(staff).some((q) => q.id === reservation.id));

  // K3/P2 — idempotent; no extra allocate
  const again = s.deliverReservation(merchant, reservation.id);
  assert.equal(again.status, "DELIVERED");
  assert.equal(again.delivered_at, delivered.delivered_at);
  assert.equal(
    s.db
      .prepare("SELECT COUNT(*) AS n FROM inventory WHERE reservation_id=?")
      .get(reservation.id).n,
    1,
  );

  // K2/K4/P5 — owner credentials; staff empty; stranger 404
  const ownerView = s.orderDetail(user, reservation.id);
  assert.equal(ownerView.status, "DELIVERED");
  assert.deepEqual(ownerView.codes, []);
  assert.equal(ownerView.credentials.length, 1);
  assert.equal(ownerView.credentials[0].loginId, "pair-a@example.invalid");
  assert.equal(ownerView.credentials[0].password, " pass with spaces ");
  const staffView = s.orderDetail(staff, reservation.id);
  assert.deepEqual(staffView.codes, []);
  assert.deepEqual(staffView.credentials, []);
  const other = s.register({
    name: "Other",
    email: "other-issue18@example.invalid",
    password: "Other-only-Password-123",
  });
  assert.throws(
    () => s.orderDetail(s.session(other.token), reservation.id),
    (e) => e.status === 404,
  );

  assert.equal(s.features.credentialPair, true);
  assert.equal(s.features.preorderDelivery, true);
  assert.equal(s.features.adminChatInbox, true);
  const cols = s.db
    .prepare("PRAGMA index_info(inventory_available)")
    .all()
    .map((r) => r.name);
  assert.ok(cols.includes("reservation_id"));
});

test("ISSUE-18 DB-005: deliver refuses when stock is short (P4)", (t) => {
  const { s, user, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const reservation = s.createOrder(user, {
    variantId: "cinema-max-90",
    quantity: 2,
    requestKey: "issue18-short-stock",
  });
  s.pay(user, reservation.id, {
    paymentToken: reservation.paymentToken,
    outcome: "success",
  });
  s.db
    .prepare(
      "DELETE FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL",
    )
    .run("cinema-max-90");
  s.importCodes(merchant, {
    variantId: "cinema-max-90",
    items: [{ loginId: "only-one@example.invalid", password: "x" }],
  });
  assert.throws(
    () => s.deliverReservation(merchant, reservation.id),
    (e) => e.status === 409,
  );
  assert.equal(
    s.db
      .prepare("SELECT status FROM reservations WHERE id=?")
      .get(reservation.id).status,
    "PREORDER",
  );
});

test("owner signs in as 'admin' with the configured password", () => {
  const s = createCommerce({ adminPassword: "admin1234", seed: false, allowSandbox: false, allowDemoAdmin: false });
  try {
    const auth = s.login({ username: "admin", password: "admin1234" });
    assert.equal(s.session(auth.token).role, "ADMIN");
    assert.throws(() => s.login({ username: "admin", password: "wrong-pass" }));
    assert.throws(() =>
      s.register({ name: "imposter", username: "admin", password: "Imposter-password-1" }),
    );
  } finally {
    s.db.close();
  }
});

test("ADMIN-FR-W1: chat inbox sorts by last message and tracks unread", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  const older = s.openChatThread(user, { body: "ห้องเก่า" });
  const newerBuyer = s.register({
    name: "Chat Buyer 2",
    email: "chat2@example.invalid",
    password: "Chat-buyer-Password-123",
  });
  const buyer2 = s.session(newerBuyer.token);
  const newer = s.openChatThread(buyer2, { body: "ห้องใหม่กว่า" });
  s.postChatMessage(user, older.thread.id, { body: "ข้อความล่าสุดในห้องเก่า" });
  s.db
    .prepare(
      "UPDATE chat_messages SET created_at=datetime('now','+2 seconds') WHERE thread_id=? AND body=?",
    )
    .run(older.thread.id, "ข้อความล่าสุดในห้องเก่า");
  const inbox = s.chatThreads(staff);
  assert.ok(inbox.length >= 2);
  assert.equal(inbox[0].id, older.thread.id, "thread with newest message first");
  for (let i = 1; i < inbox.length; i++)
    assert.ok(inbox[i - 1].lastMessageAt >= inbox[i].lastMessageAt);
  const unreadRow = inbox.find((r) => r.id === older.thread.id);
  assert.ok(unreadRow.unreadCount >= 1);
  s.chatMessages(staff, older.thread.id);
  const afterRead = s.chatThreads(staff).find((r) => r.id === older.thread.id);
  assert.equal(afterRead.unreadCount, 0);
  assert.ok(s.chatThreads(merchant).some((r) => r.id === newer.thread.id));
});

test("ADMIN-FR-W1: admin gets order/preorder/stock notifications; me exposes features", async (t) => {
  const { s, user, staff, merchant, token, merchantToken } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const handle = createAPIHandler(s);
  const me = await handle(
    new Request("http://local.test/api/me", {
      headers: { Cookie: "astra_session=" + token },
    }),
  );
  const meBody = await me.json();
  assert.equal(me.status, 200);
  assert.equal(meBody.features.adminChatInbox, true);
  assert.equal(meBody.features.salesRevenueFromPayments, true);

  s.db
    .prepare(
      "DELETE FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL AND id NOT IN (SELECT id FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL LIMIT 3)",
    )
    .run("stream-plus-30", "stream-plus-30");

  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "w1-order-notify",
  });
  s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.ok(
    s.notifications(staff).some((n) => n.kind === "order_new"),
    "staff notified of new paid order",
  );
  assert.ok(
    s.notifications(merchant).some((n) => n.kind === "order_new"),
    "admin notified of new paid order",
  );
  assert.ok(
    s.notifications(staff).some((n) => n.kind === "stock_low"),
    "staff notified when stock is low after sale",
  );

  const pre = s.createOrder(user, {
    variantId: "cinema-max-90",
    quantity: 1,
    requestKey: "w1-preorder-notify",
  });
  s.pay(user, pre.id, {
    paymentToken: pre.paymentToken,
    outcome: "success",
  });
  assert.ok(
    s.notifications(merchant).some((n) => n.kind === "preorder_queue_admin"),
  );

  const adminMe = await handle(
    new Request("http://local.test/api/me", {
      headers: { Cookie: "astra_session=" + merchantToken },
    }),
  );
  assert.equal((await adminMe.json()).features.adminOpsNotifications, true);
});

test("ADMIN-FR-W1: revenue uses payments SUCCEEDED not delivered orders only (FR-F10)", (t) => {
  const { s, user, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const before = s.adminOverview(merchant).revenue;
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "w1-revenue-f10",
  });
  const paid = s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  const after = s.adminOverview(merchant).revenue;
  const succeeded = s.db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE status='SUCCEEDED'",
    )
    .get().n;
  assert.equal(after, succeeded);
  assert.equal(after, before + paid.total);
  assert.equal(s.salesRevenueSatang(), after);
});
test("ADMIN-FR-W2: admin orders list filters, cursor, RBAC", async (t) => {
  const { s, user, staff, merchant, token, staffToken, merchantToken } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const ready = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "w2-orders-ready",
  });
  s.pay(user, ready.id, { paymentToken: ready.paymentToken, outcome: "success" });
  const pre = s.createOrder(user, {
    variantId: "cinema-max-90",
    quantity: 1,
    requestKey: "w2-orders-pre",
  });
  s.pay(user, pre.id, { paymentToken: pre.paymentToken, outcome: "success" });

  assert.throws(() => s.adminOrders(user), (e) => e.status === 403);
  const listed = s.adminOrders(staff, { type: "preorder", limit: 10 });
  assert.ok(listed.orders.every((o) => o.type === "preorder"));
  assert.ok(listed.orders.some((o) => o.id === pre.id));
  assert.ok(!listed.orders.some((o) => o.id === ready.id));

  const byStatus = s.adminOrders(merchant, { status: "DELIVERED" });
  assert.ok(byStatus.orders.some((o) => o.id === ready.id));

  const page1 = s.adminOrders(staff, { limit: 1 });
  assert.equal(page1.orders.length, 1);
  assert.ok(page1.nextCursor);
  const page2 = s.adminOrders(staff, { limit: 1, cursor: page1.nextCursor });
  assert.equal(page2.orders.length, 1);
  assert.notEqual(page1.orders[0].id, page2.orders[0].id);

  const handle = createAPIHandler(s);
  const denied = await handle(
    new Request("http://local.test/api/admin/orders", {
      headers: { Cookie: "astra_session=" + token },
    }),
  );
  assert.equal(denied.status, 403);
  const ok = await handle(
    new Request("http://local.test/api/admin/orders?type=ready", {
      headers: { Cookie: "astra_session=" + staffToken },
    }),
  );
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.ok(body.orders.some((o) => o.id === ready.id));

  const me = await handle(
    new Request("http://local.test/api/me", {
      headers: { Cookie: "astra_session=" + merchantToken },
    }),
  );
  const features = (await me.json()).features;
  assert.equal(features.adminOrdersApi, true);
  assert.equal(features.adminCustomersApi, true);
  assert.equal(features.adminProductsApi, true);
});

test("ADMIN-FR-W2: order detail masks credentials; reveal audits", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "w2-reveal",
  });
  const paid = s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.ok(paid.codes.length >= 1 || paid.credentials?.length >= 1);

  const detail = s.adminOrderDetail(staff, order.id);
  assert.equal(detail.credentialsMasked, true);
  assert.ok(detail.customer.email);
  assert.ok(detail.product.name);
  assert.ok(detail.payments.some((p) => p.status === "SUCCEEDED"));
  assert.ok(detail.timeline.some((e) => e.event === "paid"));
  assert.ok(detail.timeline.some((e) => e.event === "delivered"));
  const blob = JSON.stringify(detail);
  for (const code of paid.codes ?? []) assert.ok(!blob.includes(code));
  for (const cred of paid.credentials ?? []) {
    assert.ok(!blob.includes(cred.password));
  }

  assert.throws(() => s.adminRevealOrderCredentials(user, order.id), (e) => e.status === 403);
  const revealed = s.adminRevealOrderCredentials(staff, order.id);
  assert.equal(revealed.credentialsMasked, false);
  if (paid.codes?.length) assert.deepEqual(revealed.codes, paid.codes);
  const audit = s.db
    .prepare(
      "SELECT action,entity_id,user_id FROM audit WHERE action=? AND entity_id=? ORDER BY id DESC LIMIT 1",
    )
    .get("REVEAL_ORDER_CREDENTIALS", order.id);
  assert.equal(audit.user_id, staff.id);
});

test("ADMIN-FR-W2: customers and products list filters + RBAC", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "w2-cust-prod",
  });
  s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });

  assert.throws(() => s.adminCustomers(user), (e) => e.status === 403);
  const customers = s.adminCustomers(staff, { q: "QA Buyer", hasOrders: "true" });
  assert.ok(customers.customers.some((c) => c.id === user.id));
  assert.ok(customers.customers.every((c) => c.status === "ACTIVE"));
  assert.equal(s.adminCustomers(staff, { status: "BANNED" }).customers.length, 0);

  const spent = customers.customers.find((c) => c.id === user.id).spentSatang;
  assert.ok(spent > 0);

  assert.throws(() => s.adminProducts(user), (e) => e.status === 403);
  const products = s.adminProducts(staff, { q: "DISNEY", type: "ready", status: "active" });
  assert.ok(products.products.some((p) => p.id === "stream-plus"));
  assert.ok(products.products.every((p) => p.type === "ready" && p.status === "active"));
  const pre = s.adminProducts(merchant, { type: "preorder" });
  assert.ok(pre.products.every((p) => p.preorder === true));
});

test("ADMIN-FR-W2: admin summary uses Bangkok range and FR-F10 revenue", async (t) => {
  const { s, user, staff, merchant, token, staffToken, merchantToken } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "w2-summary",
  });
  const paid = s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  const bangkokToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  assert.throws(() => s.adminSummary(user), (e) => e.status === 403);
  assert.throws(() => s.adminSummary(staff), (e) => e.status === 403);
  const allTime = s.adminSummary(merchant);
  assert.equal(allTime.timezone, "Asia/Bangkok");
  assert.equal(allTime.revenue, s.salesRevenueSatang());
  assert.ok(allTime.orderCount >= 1);
  assert.ok(allTime.newCustomers >= 1);
  const day = s.adminSummary(merchant, { from: bangkokToday, to: bangkokToday });
  assert.equal(day.from, bangkokToday);
  assert.equal(day.to, bangkokToday);
  assert.equal(day.revenue, paid.total);
  assert.ok(day.orderCount >= 1);
  assert.ok(day.newCustomers >= 1);
  const empty = s.adminSummary(merchant, {
    from: "2000-01-01",
    to: "2000-01-02",
  });
  assert.equal(empty.revenue, 0);
  assert.equal(empty.orderCount, 0);
  assert.throws(
    () => s.adminSummary(merchant, { from: bangkokToday }),
    (e) => e.status === 400,
  );
  const handle = createAPIHandler(s);
  const http = await handle(
    new Request(
      "http://local.test/api/admin/summary?from=" +
        bangkokToday +
        "&to=" +
        bangkokToday,
      { headers: { Cookie: "astra_session=" + merchantToken } },
    ),
  );
  assert.equal(http.status, 200);
  assert.equal((await http.json()).revenue, paid.total);
  const staffDenied = await handle(
    new Request("http://local.test/api/admin/summary", {
      headers: { Cookie: "astra_session=" + staffToken },
    }),
  );
  assert.equal(staffDenied.status, 403);
  const customerDenied = await handle(
    new Request("http://local.test/api/admin/summary", {
      headers: { Cookie: "astra_session=" + token },
    }),
  );
  assert.equal(customerDenied.status, 403);
  assert.equal(s.features.adminSummaryApi, true);
});
