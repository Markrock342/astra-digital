import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
// applyMigration006 imported inside W3 test to keep sync fixtures light

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
  assert.equal(
    customers.customers.find((c) => c.id === user.id).spentSatang,
    undefined,
    "STAFF must not see spentSatang",
  );
  assert.equal(s.adminCustomers(staff, { status: "BANNED" }).customers.length, 0);

  // NFR-3: STAFF gets no money figures; ADMIN does.
  assert.equal(customers.customers.find((c) => c.id === user.id).spentSatang, undefined);
  assert.throws(() => s.adminCustomers(staff, { sort: "spent" }), (e) => e.status === 403);
  assert.throws(() => s.adminCustomers(staff, { minSpent: "1" }), (e) => e.status === 403);
  const spent = s
    .adminCustomers(merchant, { q: "QA Buyer" })
    .customers.find((c) => c.id === user.id).spentSatang;
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

test("ADMIN-FR-P3: saveProduct accepts preorder create/update; staff forbidden", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  assert.throws(
    () =>
      s.saveProduct(staff, {
        name: "Staff Product",
        description: "ห้ามสร้างโดยพนักงาน",
        category: "streaming",
        price: 10000,
        preorder: true,
      }),
    (e) => e.status === 403,
  );
  assert.throws(
    () =>
      s.saveProduct(user, {
        name: "Buyer Product",
        description: "ห้ามสร้างโดยลูกค้า",
        category: "streaming",
        price: 10000,
        preorder: true,
      }),
    (e) => e.status === 403,
  );

  const created = s.saveProduct(merchant, {
    name: "Preorder Form Item",
    description: "สินค้าพรีออเดอร์จากฟอร์มแอดมิน",
    category: "streaming",
    price: 19900,
    preorder: true,
    active: true,
  });
  assert.equal(created.preorder, true);
  assert.equal(
    s.db.prepare("SELECT preorder FROM products WHERE id=?").get(created.id)
      .preorder,
    1,
  );
  const variant = s.db
    .prepare("SELECT id FROM variants WHERE product_id=? LIMIT 1")
    .get(created.id);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const order = s.createOrder(user, {
    variantId: variant.id,
    quantity: 1,
    requestKey: "p3-preorder-order",
  });
  assert.equal(order.preorder, true);
  assert.ok(
    s.db.prepare("SELECT id FROM reservations WHERE id=?").get(order.id),
  );

  const cleared = s.saveProduct(merchant, {
    id: created.id,
    name: "Preorder Form Item",
    description: "สินค้าพรีออเดอร์จากฟอร์มแอดมิน",
    category: "streaming",
    price: 19900,
    preorder: false,
    active: true,
  });
  assert.equal(cleared.preorder, false);
  assert.equal(
    s.db.prepare("SELECT preorder FROM products WHERE id=?").get(created.id)
      .preorder,
    0,
  );

  const untouched = s.saveProduct(merchant, {
    id: "cinema-max",
    name: "MONOMAX",
    description: "wrgwreg3g34g43rtq34twefq24t",
    category: "streaming",
    price: 10000,
    active: true,
  });
  assert.equal(untouched.preorder, true, "omit preorder keeps existing value");
  assert.equal(s.features.productPreorderForm, true);
});

test("ADMIN-FR-W3: bangkok day bounds, sold includes preorder, LIKE escape", (t) => {
  const { s, user, staff, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  // 02:00 Asia/Bangkok = previous calendar day in naive UTC cutoff
  const bangkokDay = "2026-06-15";
  const createdAtThaiNight = "2026-06-14 19:00:00"; // 02:00+7
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "w3-bkk-bounds",
  });
  s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  s.db
    .prepare("UPDATE orders SET created_at=? WHERE id=?")
    .run(createdAtThaiNight, order.id);
  const utcWrong = s.adminOrders(staff, {
    from: bangkokDay,
    to: bangkokDay,
  });
  assert.ok(
    utcWrong.orders.some((o) => o.id === order.id),
    "Bangkok day must include 02:00 Thailand order",
  );

  const pre = s.createOrder(user, {
    variantId: "cinema-max-90",
    quantity: 1,
    requestKey: "w3-sold-pre",
  });
  s.pay(user, pre.id, {
    paymentToken: pre.paymentToken,
    outcome: "success",
  });
  const products = s.adminProducts(merchant, { type: "preorder" });
  const cinema = products.products.find((p) => p.id === "cinema-max");
  assert.ok(cinema.sold >= 1, "sold must count paid preorder reservations");

  s.saveProduct(merchant, {
    name: "Percent%Wild_Card",
    description: "สินค้าทดสอบ LIKE escape",
    category: "gift",
    price: 15000,
    active: true,
  });
  const hit = s.adminProducts(staff, { q: "Percent%Wild" });
  assert.ok(hit.products.some((p) => p.name === "Percent%Wild_Card"));
  const miss = s.adminProducts(staff, { q: "PercentXWild" });
  assert.ok(!miss.products.some((p) => p.name === "Percent%Wild_Card"));
});

test("ADMIN-FR-W3: ledger 006 + transactions exclude DEMO; STAFF 403", async (t) => {
  const { s, user, staff, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  assert.ok(
    s.db.prepare("SELECT name FROM schema_migrations WHERE name=?").get(
      "006_ledger_money.sql",
    ),
  );
  assert.ok(
    s.db
      .prepare("PRAGMA table_info(ledger)")
      .all()
      .some((c) => c.name === "direction"),
  );
  const { applyMigration006 } = await import("../server/migrate-006.mjs");
  const again = applyMigration006(s.db);
  assert.equal(again.skipped, true);

  assert.throws(() => s.adminTransactions(staff), (e) => e.status === 403);
  assert.throws(() => s.adminTransactions(user), (e) => e.status === 403);

  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "w3-tx-pay",
  });
  const paid = s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  const page = s.adminTransactions(merchant, { limit: 50 });
  assert.ok(page.transactions.every((row) => row.kind !== "DEMO_CREDIT"));
  assert.ok(page.transactions.some((row) => row.kind === "PAYMENT_IN"));
  assert.ok(page.summary.in >= paid.total);
  assert.equal(s.features.adminFinance, true);

  const csvPage = s.adminTransactions(merchant, { format: "csv", limit: 10 });
  assert.match(csvPage.csv, /^id,kind,direction/);
});

test("ADMIN-FR-W2 fixes: Bangkok day filter, literal search, preorder sold", (t) => {
  const { s, user, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "w2-fix-tz",
  });
  // 02:00 Bangkok on 12 Nov = 19:00 UTC on 11 Nov.
  s.db.prepare("UPDATE orders SET created_at='2026-11-11 19:00:00' WHERE id=?").run(order.id);
  const on12 = s.adminOrders(merchant, { from: "2026-11-12", to: "2026-11-12" });
  assert.ok(on12.orders.some((o) => o.id === order.id));
  const on11 = s.adminOrders(merchant, { from: "2026-11-11", to: "2026-11-11" });
  assert.ok(!on11.orders.some((o) => o.id === order.id));
  assert.throws(
    () => s.adminOrders(merchant, { from: "2026/11/12", to: "2026-11-12" }),
    (e) => e.status === 400,
  );
  // % and _ are literal, not wildcards.
  assert.equal(s.adminCustomers(merchant, { q: "%" }).customers.length, 0);
  assert.equal(s.adminProducts(merchant, { q: "_" }).products.length, 0);
  // A paid preorder counts as sold.
  const before = s.adminProducts(merchant, { type: "preorder" }).products.find((p) => p.id === "cinema-max");
  const reservation = s.createOrder(user, {
    variantId: "cinema-max-90",
    quantity: 1,
    requestKey: "w2-fix-sold",
  });
  s.pay(user, reservation.id, { paymentToken: reservation.paymentToken, outcome: "success" });
  const after = s.adminProducts(merchant, { type: "preorder" }).products.find((p) => p.id === "cinema-max");
  assert.equal(after.sold, before.sold + 1);
});

test("FR-C3–C6: admin views, edits, bans and signs out a customer", async (t) => {
  const { s, user, staff, merchant, token, merchantToken } = fixture(t);
  s.topup(user, { amount: 300, requestKey: "fr-c-topup-0001" });
  // Staff can look but not change, and sees no money.
  const staffView = s.adminCustomerDetail(staff, user.id);
  assert.equal(staffView.creditSatang, undefined);
  assert.throws(() => s.adminUpdateCustomer(staff, user.id, { firstName: "X", email: "x@example.invalid" }), (e) => e.status === 403);
  assert.throws(() => s.adminCustomerDetail(user, user.id), (e) => e.status === 403);
  assert.throws(() => s.adminCustomerDetail(merchant, merchant.id), (e) => e.status === 404);
  const view = s.adminCustomerDetail(merchant, user.id);
  assert.equal(view.customer.firstName, "QA");
  assert.equal(view.customer.lastName, "Buyer");
  assert.ok(view.creditSatang >= 30000);

  const updated = s.adminUpdateCustomer(merchant, user.id, {
    firstName: "สมชาย",
    lastName: "ใจดี",
    email: "Somchai@Example.invalid",
    phone: "081-234-5678",
    note: "ลูกค้าประจำ",
  });
  assert.equal(updated.customer.name, "สมชาย ใจดี");
  assert.equal(updated.customer.email, "somchai@example.invalid");
  assert.throws(
    () => s.adminUpdateCustomer(merchant, user.id, { firstName: "A", email: "staff@example.invalid" }),
    (e) => e.status === 409,
  );
  const history = s.adminCustomerDetail(merchant, user.id).history;
  assert.equal(history[0].action, "CUSTOMER_UPDATE");
  assert.equal(history[0].detail.lastName.to, "ใจดี");

  // Ban: reason required, sessions dropped, login refused, list filter works.
  assert.throws(() => s.adminSetCustomerStatus(merchant, user.id, { status: "BANNED" }), (e) => e.status === 400);
  s.adminSetCustomerStatus(merchant, user.id, { status: "BANNED", reason: "โกงคืนเงิน" });
  assert.equal(s.session(token), null);
  assert.throws(
    () => s.login({ email: "somchai@example.invalid", password: "Test-only-Password-123" }),
    (e) => e.status === 403,
  );
  assert.ok(s.adminCustomers(merchant, { status: "BANNED" }).customers.some((c) => c.id === user.id));
  assert.ok(!s.adminCustomers(merchant, { status: "ACTIVE" }).customers.some((c) => c.id === user.id));
  assert.throws(() => s.adminSetCustomerStatus(merchant, merchant.id, { status: "BANNED", reason: "ทดสอบแบนแอดมิน" }), (e) => e.status === 404);
  s.adminSetCustomerStatus(merchant, user.id, { status: "ACTIVE" });
  const again = s.login({ email: "somchai@example.invalid", password: "Test-only-Password-123" });
  assert.ok(s.session(again.token));
  assert.equal(s.adminSignOutCustomer(merchant, user.id).removed, 1);
  assert.equal(s.session(again.token), null);

  // HTTP routes.
  const handle = createAPIHandler(s);
  const res = await handle(
    new Request("http://local.test/api/admin/customers/" + user.id + "/status", {
      method: "POST",
      headers: {
        Cookie: "astra_session=" + merchantToken,
        "Content-Type": "application/json",
        "X-Astra-Request": "1",
      },
      body: JSON.stringify({ status: "SUSPENDED", reason: "ตรวจสอบบัญชี" }),
    }),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).customer.status, "SUSPENDED");
});

test("wallet and customer credit exclude shop-side PAYMENT_IN rows", (t) => {
  const { s, user, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const before = s.adminCustomerDetail(merchant, user.id).creditSatang;
  const order = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "wallet-payin-0001" });
  s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  assert.ok(!s.ledger(user).some((l) => l.label.startsWith("รับชำระ")));
  const after = s.adminCustomerDetail(merchant, user.id);
  assert.equal(after.creditSatang, before - order.total);
  assert.ok(after.ledger.every((l) => !l.reference.startsWith("payment-in:")));
});

test("transactions summary works with a date range and a cursor", (t) => {
  const { s, user, merchant } = fixture(t);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  for (const key of ["txn-range-0001", "txn-range-0002"]) {
    const order = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: key });
    s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const first = s.adminTransactions(merchant, { from: today, to: today, limit: 1 });
  assert.equal(first.transactions.length, 1);
  assert.equal(first.summary.count, 2);
  const second = s.adminTransactions(merchant, { from: today, to: today, limit: 1, cursor: first.nextCursor });
  assert.equal(second.transactions.length, 1);
  assert.equal(second.summary.count, 2);
  assert.equal(second.summary.in, first.summary.in);
});
