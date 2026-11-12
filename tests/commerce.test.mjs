import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommerce, ApiError } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES, withoutClientPrivileges } from "../server/auth-policy.mjs";
function fixture(t) {
  const s = createCommerce();
  t.after(() => s.db.close());
  const auth = s.register({
    name: "QA Customer",
    email: "qa@example.invalid",
    password: "Test-only-Password-123",
  });
  const user = s.session(auth.token);
  const other = s.session(
    s.register({
      name: "Other Customer",
      email: "other@example.invalid",
      password: "Another-test-only-123",
    }).token,
  );
  return { s, user, other, token: auth.token };
}
const checkout = (
  s,
  user,
  key = "checkout-request-1",
  variantId = "stream-plus-30",
  quantity = 1,
) => s.createOrder(user, { variantId, quantity, requestKey: key });
const approve = (s, user, order) =>
  s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
test("reference catalog exposes two products and 25 available units; archived keys stay encrypted", (t) => {
  const { s } = fixture(t);
  assert.equal(s.products().length, 2);
  assert.equal(s.overview().products, 25);
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM inventory").get().n,
    119,
  );
  assert.equal(
    s.db.prepare("SELECT COUNT(DISTINCT fingerprint) AS n FROM inventory").get()
      .n,
    119,
  );
  assert.ok(
    !s.db
      .prepare("SELECT login_id_enc FROM inventory LIMIT 1")
      .get()
      .login_id_enc.includes("DEMO-"),
  );
  assert.ok(!JSON.stringify(s.products()).includes("secret"));
  assert.ok(!JSON.stringify(s.products()).includes("login_id_enc"));
  assert.ok(!JSON.stringify(s.products()).includes("DEMO-KEY"));
});
test("purchase delivers exactly one key per unit and deducts once", (t) => {
  const { s, user } = fixture(t);
  const before = s.publicUser(user).balance;
  const order = checkout(s, user);
  assert.equal(order.status, "PENDING_PAYMENT");
  assert.deepEqual(order.codes, []);
  assert.ok(!("payment_hash" in order));
  const paid = approve(s, user, order);
  assert.equal(paid.status, "DELIVERED");
  assert.equal(paid.codes.length, 1);
  assert.match(paid.codes[0], /^DEMO-KEY-NOT-VALID-/);
  assert.equal(s.publicUser(user).balance, before - order.total);
  assert.deepEqual(s.orderDetail(user, order.id).codes, paid.codes);
  assert.equal(
    s
      .products()
      .find((p) => p.id === "stream-plus")
      .variants.find((v) => v.id === "stream-plus-30").stock,
    7,
  );
});
test("payment retries are idempotent and allocate no additional inventory", (t) => {
  const { s, user } = fixture(t);
  const order = checkout(s, user);
  const first = approve(s, user, order);
  const second = approve(s, user, order);
  assert.deepEqual(second.codes, first.codes);
  assert.equal(
    s.db
      .prepare("SELECT COUNT(*) AS n FROM ledger WHERE reference=?")
      .get(order.id).n,
    1,
  );
  assert.equal(
    s.db
      .prepare("SELECT COUNT(*) AS n FROM inventory WHERE order_id=?")
      .get(order.id).n,
    1,
  );
});
test("failed payment does not expose codes or charge wallet", (t) => {
  const { s, user } = fixture(t);
  const order = checkout(s, user);
  const balance = s.publicUser(user).balance;
  const stock = s
    .products()
    .find((p) => p.id === "stream-plus")
    .variants.find((v) => v.id === "stream-plus-30").stock;
  const result = s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "failure",
  });
  assert.equal(result.status, "FAILED");
  assert.deepEqual(result.codes, []);
  assert.equal(s.publicUser(user).balance, balance);
  assert.equal(
    s
      .products()
      .find((p) => p.id === "stream-plus")
      .variants.find((v) => v.id === "stream-plus-30").stock,
    stock,
  );
  assert.throws(
    () => approve(s, user, order),
    (e) => e.status === 409,
  );
});
test("last key can only be purchased by one customer", (t) => {
  const { s, user, other } = fixture(t);
  s.db
    .prepare(
      "DELETE FROM inventory WHERE variant_id=? AND order_id IS NULL AND id != (SELECT id FROM inventory WHERE variant_id=? AND order_id IS NULL LIMIT 1)",
    )
    .run("stream-plus-30", "stream-plus-30");
  const first = checkout(s, user, "first-request");
  const second = checkout(s, other, "second-request");
  const one = approve(s, user, first);
  const balance = s.publicUser(other).balance;
  const two = approve(s, other, second);
  assert.equal(one.status, "DELIVERED");
  assert.equal(two.status, "OUT_OF_STOCK");
  assert.deepEqual(two.codes, []);
  assert.equal(s.publicUser(other).balance, balance);
  assert.equal(
    s
      .products()
      .find((p) => p.id === "stream-plus")
      .variants.find((v) => v.id === "stream-plus-30").stock,
    0,
  );
  assert.throws(
    () => checkout(s, other, "third-request"),
    (e) => e.status === 409,
  );
});
test("wallet cannot become negative, invalid confirmations do not deliver", (t) => {
  const { s, user } = fixture(t);
  const order = checkout(s, user);
  assert.throws(
    () => s.pay(user, order.id, { paymentToken: "forged", outcome: "success" }),
    (e) => e.status === 403,
  );
  s.db
    .prepare(
      `INSERT INTO ledger(
        id,user_id,amount,reference,label,kind,direction,fee,net,status,finalized_at,created_at
      ) VALUES(?,?,?,?,?,'DEMO_CREDIT','out',0,?,'SUCCEEDED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    )
    .run("drain", user.id, -50000, "test-drain", "test", -50000);
  assert.throws(
    () => approve(s, user, order),
    (e) => e.status === 409,
  );
  assert.equal(s.publicUser(user).balance, 0);
  assert.equal(s.orderDetail(user, order.id).status, "PENDING_PAYMENT");
  assert.deepEqual(s.orderDetail(user, order.id).codes, []);
});
test("customers cannot read other customers orders or administer inventory", (t) => {
  const { s, user, other } = fixture(t);
  const order = checkout(s, user);
  approve(s, user, order);
  assert.throws(
    () => s.orderDetail(other, order.id),
    (e) => e.status === 404,
  );
  assert.throws(
    () =>
      s.pay(other, order.id, {
        paymentToken: order.paymentToken,
        outcome: "success",
      }),
    (e) => e.status === 404,
  );
  assert.throws(
    () => s.adminOverview(other),
    (e) => e.status === 403,
  );
  assert.throws(
    () =>
      s.importCodes(other, {
        variantId: "stream-plus-30",
        codes: "DEMO-QA-1234",
      }),
    (e) => e.status === 403,
  );
  assert.throws(
    () => s.orders(null),
    (e) => e.status === 401,
  );
});
test("topup and order request keys are idempotent, conflicting payload rejected", (t) => {
  const { s, user } = fixture(t);
  const body = { amount: 100, requestKey: "topup-key-001" };
  s.topup(user, body);
  s.topup(user, body);
  assert.equal(s.publicUser(user).balance, 60000);
  assert.throws(
    () => s.topup(user, { ...body, amount: 300 }),
    (e) => e.status === 409,
  );
  assert.throws(
    () => s.topup(user, { ...body, amount: -100 }),
    (e) => e.status === 400,
  );
  const first = checkout(s, user, "same-request-key");
  const second = checkout(s, user, "same-request-key");
  assert.equal(first.id, second.id);
  assert.throws(
    () => checkout(s, user, "same-request-key", "cinema-max-30"),
    (e) => e.status === 409,
  );
});
test("admin import rejects duplicate codes atomically", (t) => {
  const { s, user } = fixture(t);
  s.db.prepare("UPDATE users SET role='ADMIN' WHERE id=?").run(user.id);
  const admin = s.session(
    s.login({ email: user.email, password: "Test-only-Password-123" }).token,
  );
  const before = s.db.prepare("SELECT COUNT(*) AS n FROM inventory").get().n;
  s.importCodes(admin, {
    variantId: "stream-plus-30",
    codes: "DEMO-QA-IMPORT-0001",
  });
  assert.throws(
    () =>
      s.importCodes(admin, {
        variantId: "stream-plus-30",
        codes: "DEMO-QA-IMPORT-0002\nDEMO-QA-IMPORT-0001",
      }),
    (e) => e.status === 409,
  );
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM inventory").get().n,
    before + 1,
  );
  assert.ok(!JSON.stringify(s.adminOverview(admin)).includes("DEMO-QA-IMPORT"));
  s.importCodes(admin, {
    variantId: "stream-plus-30",
    codes: "REAL-KEY-123",
  });
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM inventory").get().n,
    before + 2,
  );
  assert.throws(
    () =>
      s.importCodes(admin, {
        variantId: "stream-plus-30",
        codes: "bad key",
      }),
    (e) => e.status === 400,
  );
});
test("passwords are hashed, roles cannot be injected, password change revokes sessions", (t) => {
  const { s, user, token } = fixture(t);
  assert.notEqual(
    s.db.prepare("SELECT password_hash FROM users WHERE id=?").get(user.id)
      .password_hash,
    "Test-only-Password-123",
  );
  assert.throws(
    () => s.login({ email: user.email, password: "wrong" }),
    (e) => e.status === 401,
  );
  s.profile(user, {
    name: "New Name",
    newPassword: "Replacement-Test-123",
    currentPassword: "Test-only-Password-123",
    role: "ADMIN",
  });
  assert.equal(s.session(token), null);
  const auth = s.login({ email: user.email, password: "Replacement-Test-123" });
  assert.equal(auth.user.name, "New Name");
  assert.equal(auth.user.role, "CUSTOMER");
  assert.equal(s.publicUser(null), null);
});
test("encrypted delivery and accounts persist after server restart with same key", () => {
  const dir = mkdtempSync(join(tmpdir(), "astra-db-test-"));
  const key = randomBytes(32),
    path = join(dir, "test.sqlite");
  try {
    let s = createCommerce({ path, key });
    const auth = s.register({
      name: "Persistent User",
      email: "persist@example.invalid",
      password: "Persist-only-test-123",
    });
    const user = s.session(auth.token);
    const order = checkout(s, user);
    const paid = approve(s, user, order);
    s.db.close();
    s = createCommerce({ path, key });
    try {
      assert.deepEqual(
        s.orderDetail(s.session(auth.token), order.id).codes,
        paid.codes,
      );
      assert.equal(s.products().length, 2);
    } finally {
      s.db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP concurrent confirmations and CSRF/owner guards", async (t) => {
  const { s, user, other, token } = fixture(t);
  const server = createApp(s);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = "http://127.0.0.1:" + server.address().port;
  const order = checkout(s, user);
  const headers = {
    "Content-Type": "application/json",
    "X-Astra-Request": "1",
    Cookie: "astra_session=" + token,
  };
  const post = (path, body, h = headers) =>
    fetch(base + "/api" + path, {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
    });
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      post("/orders/" + order.id + "/pay", {
        paymentToken: order.paymentToken,
        outcome: "success",
      }).then((r) => r.json()),
    ),
  );
  assert.ok(results.every((r) => r.status === "DELIVERED"));
  assert.equal(new Set(results.map((r) => r.codes[0])).size, 1);
  assert.equal(s.publicUser(user).balance, 40000);
  assert.equal(
    (
      await post(
        "/topup",
        { amount: 100, requestKey: "csrf-guard" },
        { ...headers, Origin: "https://other.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        "/topup",
        { amount: 100, requestKey: "csrf-guard" },
        {
          Cookie: "astra_session=" + token,
          "Content-Type": "application/json",
        },
      )
    ).status,
    403,
  );
  const otherAuth = s.login({
    email: other.email,
    password: "Another-test-only-123",
  });
  assert.equal(
    (
      await fetch(base + "/api/orders/" + order.id, {
        headers: { Cookie: "astra_session=" + otherAuth.token },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(base + "/api/admin", {
        headers: { Cookie: "astra_session=" + token },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(base + "/api/products")).headers.get("x-content-type-options"),
    "nosniff",
  );
});
test("only delivered-order owners can review, one review per order", (t) => {
  const { s, user, other } = fixture(t);
  const order = checkout(s, user);
  assert.throws(
    () =>
      s.addReview(user, {
        orderId: order.id,
        rating: 5,
        comment: "test review",
      }),
    (e) => e.status === 403,
  );
  approve(s, user, order);
  assert.throws(
    () =>
      s.addReview(other, {
        orderId: order.id,
        rating: 5,
        comment: "test review",
      }),
    (e) => e.status === 403,
  );
  assert.throws(
    () =>
      s.addReview(user, {
        orderId: order.id,
        rating: 6,
        comment: "test review",
      }),
    (e) => e.status === 400,
  );
  s.addReview(user, {
    orderId: order.id,
    rating: 5,
    comment: "Great demo purchase",
  });
  assert.equal(s.reviews().length, 2);
  assert.equal(s.orderDetail(user, order.id).reviewed, true);
  assert.equal(s.products()[0].rating.average, 5);
  assert.throws(
    () =>
      s.addReview(user, {
        orderId: order.id,
        rating: 5,
        comment: "duplicate review",
      }),
    (e) => e.status === 409,
  );
  assert.ok(!JSON.stringify(s.reviews()).includes(user.email));
  assert.ok(!JSON.stringify(s.reviews()).includes(user.id));
});
test("demo merchant role is only granted when the runtime explicitly enables it", (t) => {
  const s = createCommerce();
  const demo = createCommerce({ allowDemoAdmin: true });
  t.after(() => {
    s.db.close();
    demo.db.close();
  });
  assert.throws(
    () => s.demoMerchant(),
    (e) => e.status === 403,
  );
  const result = demo.demoMerchant();
  assert.equal(result.user.role, "ADMIN");
  assert.equal(result.user.balance, 50000);
  assert.equal(demo.session(result.token).role, "ADMIN");
  assert.equal(demo.adminOverview(demo.session(result.token)).stock, 25);
});

test("preorders reserve without fabricated delivery, deduct once, and enforce ownership", (t) => {
  const { s, user, other } = fixture(t);
  const before = s.publicUser(user).balance;
  const free = checkout(s, user, "free-preorder-001", "cinema-max-30");
  assert.equal(free.total, 0);
  assert.equal(free.preorder, true);
  assert.deepEqual(free.codes, []);
  assert.equal(
    checkout(s, user, "free-preorder-001", "cinema-max-30").id,
    free.id,
  );
  const accepted = approve(s, user, free);
  assert.equal(accepted.status, "PREORDER");
  assert.deepEqual(accepted.codes, []);
  assert.equal(s.publicUser(user).balance, before);
  const paid = checkout(s, user, "paid-preorder-001", "cinema-max-90", 2);
  assert.equal(paid.total, 25800);
  approve(s, user, paid);
  approve(s, user, paid);
  assert.equal(s.publicUser(user).balance, before - 25800);
  assert.deepEqual(s.orderDetail(user, paid.id).codes, []);
  assert.ok(
    s.orders(user).some((o) => o.id === paid.id && o.status === "PREORDER"),
  );
  assert.throws(
    () => s.orderDetail(other, paid.id),
    (e) => e.status === 404,
  );
  assert.throws(
    () => approve(s, other, paid),
    (e) => e.status === 404,
  );
  const failed = checkout(s, user, "failed-preorder-001", "cinema-max-90");
  s.pay(user, failed.id, {
    paymentToken: failed.paymentToken,
    outcome: "failure",
  });
  assert.equal(s.publicUser(user).balance, before - 25800);
});
test("username registration supports optional email and validates confirmation and uniqueness", (t) => {
  const { s } = fixture(t);
  const auth = s.register({
    username: "demo_buyer",
    password: "Test-Password-123",
    confirmPassword: "Test-Password-123",
  });
  assert.equal(auth.user.name, "demo_buyer");
  assert.ok(
    s.login({ username: "demo_buyer", password: "Test-Password-123" }).token,
  );
  assert.throws(
    () =>
      s.register({
        username: "demo_buyer",
        password: "Test-Password-123",
        confirmPassword: "Test-Password-123",
      }),
    (e) => [400, 409].includes(e.status),
  );
  assert.throws(
    () =>
      s.register({
        username: "other_buyer",
        password: "Test-Password-123",
        confirmPassword: "different-password",
      }),
    (e) => e.status === 400,
  );
});
test("merchant settings persist and closed shop rejects new purchases; draft publishing is explicit", (t) => {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const admin = s.session(s.demoMerchant().token);
  const customer = s.session(s.demo().token);
  assert.throws(
    () => s.saveSettings(customer, { shopName: "Intruder" }),
    (e) => e.status === 403,
  );
  s.saveSettings(admin, {
    shopName: "QA STORE",
    shopOpen: false,
    stockOrder: "newest",
  });
  assert.equal(s.overview().shop.shopName, "QA STORE");
  assert.throws(
    () => checkout(s, customer),
    (e) => e.status === 409,
  );
  s.saveSettings(admin, { shopOpen: true });
  assert.ok(checkout(s, customer).id);
  assert.throws(
    () => s.saveSettings(admin, { stockOrder: "SQL injection" }),
    (e) => e.status === 400,
  );
  const product = s.saveProduct(admin, {
    name: "Draft test",
    description: "Private draft test",
    category: "streaming",
    price: 12300,
    active: false,
  });
  assert.ok(!s.products().some((p) => p.id === product.id));
  assert.ok(
    s
      .adminOverview(admin)
      .products.some((p) => p.id === product.id && !p.active),
  );
  s.saveProduct(admin, {
    id: product.id,
    name: "Draft test",
    description: "Private draft test",
    category: "streaming",
    price: 12300,
    active: true,
  });
  assert.ok(s.products().some((p) => p.id === product.id));
});

test("review eligibility expires after seven days even for a delivered-order owner", (t) => {
  const { s, user } = fixture(t);
  const o = checkout(s, user);
  approve(s, user, o);
  s.db
    .prepare(
      "UPDATE orders SET created_at=datetime('now','-8 days') WHERE id=?",
    )
    .run(o.id);
  assert.throws(
    () =>
      s.addReview(user, {
        orderId: o.id,
        rating: 5,
        comment: "Too late review",
      }),
    (e) => e.status === 403,
  );
});

test("auth policy strips client privilege fields and register ignores role injection", (t) => {
  const s = createCommerce();
  t.after(() => s.db.close());
  assert.deepEqual(
    withoutClientPrivileges({
      name: "Buyer",
      role: "ADMIN",
      roles: ["ADMIN"],
      isAdmin: true,
      permissions: ["*"],
      password: "Test-Password-123",
    }),
    { name: "Buyer", password: "Test-Password-123" },
  );
  const auth = s.register({
    name: "Role Inject",
    email: "role-inject@example.invalid",
    password: "Test-Password-123",
    role: "ADMIN",
    isAdmin: true,
  });
  assert.equal(auth.user.role, ROLES.CUSTOMER);
  const row = s.db
    .prepare("SELECT role FROM users WHERE id=?")
    .get(auth.user.id);
  assert.equal(row.role, ROLES.CUSTOMER);
  assert.throws(
    () => s.adminOverview(s.session(auth.token)),
    (e) => e.status === 403,
  );
});

test("expired session and anonymous callers cannot use protected commerce APIs", (t) => {
  const { s, user, token } = fixture(t);
  assert.throws(
    () => s.orders(null),
    (e) => e.status === 401,
  );
  assert.throws(
    () => s.ledger(null),
    (e) => e.status === 401,
  );
  assert.throws(
    () => s.adminOverview(null),
    (e) => e.status === 401,
  );
  s.db
    .prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?")
    .run(Date.now() - 1000, createHash("sha256").update(token).digest("hex"));
  assert.equal(s.session(token), null);
  assert.throws(
    () =>
      s.createOrder(null, {
        variantId: "stream-plus-30",
        quantity: 1,
        requestKey: "expired",
      }),
    (e) => e.status === 401,
  );
  void user;
});

test("POST origin check allows local dev ports but still blocks other sites", async (t) => {
  const s = createCommerce();
  t.after(() => s.db.close());
  const handle = createAPIHandler(s);
  const post = (url, origin) =>
    handle(
      new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Astra-Request": "1",
          Origin: origin,
        },
        body: "{}",
      }),
    ).then((r) => r.status);
  // Vite on :4330 proxies to the API on :4331 with Host rewritten.
  assert.equal(await post("http://127.0.0.1:4331/api/logout", "http://127.0.0.1:4330"), 200);
  assert.equal(await post("http://127.0.0.1:4331/api/logout", "http://localhost:4330"), 200);
  assert.equal(await post("http://127.0.0.1:4331/api/logout", "https://other.invalid"), 403);
  assert.equal(await post("https://shop.example/api/logout", "http://localhost:4330"), 403);
  assert.equal(await post("https://shop.example/api/logout", "not a url"), 403);
});

test("FR-P3: admin switches a product between ready stock and preorder", (t) => {
  const { s, user, other } = fixture(t);
  s.db.prepare("UPDATE users SET role='ADMIN' WHERE id=?").run(other.id);
  const admin = s.session(
    s.login({ email: other.email, password: "Another-test-only-123" }).token,
  );
  const base = {
    name: "Preorder test",
    description: "Ships later from the queue",
    category: "streaming",
    price: 15000,
    active: true,
  };
  const { id } = s.saveProduct(admin, { ...base, preorder: true });
  const created = s.adminOverview(admin).products.find((p) => p.id === id);
  assert.equal(Number(created.preorder), 1);
  // Paying for a preorder product gives a queue number, not stock.
  const reservation = s.createOrder(user, {
    variantId: id + "-30",
    quantity: 1,
    requestKey: "fr-p3-preorder-0001",
  });
  s.topup(user, { amount: 500, requestKey: "fr-p3-topup-0001" });
  const paid = s.pay(user, reservation.id, {
    paymentToken: reservation.paymentToken,
    outcome: "success",
  });
  assert.equal(paid.status, "PREORDER");
  assert.ok(paid.queueNumber >= 1);
  // Saving without a type keeps the current mode.
  s.saveProduct(admin, { ...base, id });
  assert.equal(Number(s.adminOverview(admin).products.find((p) => p.id === id).preorder), 1);
  s.saveProduct(admin, { ...base, id, preorder: false });
  assert.equal(Number(s.adminOverview(admin).products.find((p) => p.id === id).preorder), 0);
  const actions = s.db
    .prepare("SELECT action FROM audit WHERE entity_id=? ORDER BY rowid")
    .all(id)
    .map((r) => r.action);
  assert.ok(actions.includes("PRODUCT_SET_READY"));
});
