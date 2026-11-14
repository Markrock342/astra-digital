// Server-side order history: pagination, status filter, search, copy (server/orders-list.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";

function setup() {
  const adminPassword = randomBytes(16).toString("hex");
  const service = createCommerce({ adminPassword });
  const admin = service.session(service.login({ email: "admin@astra.local", password: adminPassword }).token);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const make = (name, price, units, loginPrefix) => {
    const p = service.saveProduct(admin, {
      name,
      description: name + " บัญชี",
      category: "streaming",
      price,
      active: true,
      firstLabel: "30 วัน",
    });
    const variantId = service.adminProductVariants(admin, p.id).variants[0].id;
    if (units)
      service.importCodes(admin, {
        variantId,
        items: Array.from({ length: units }, (_, i) => ({
          loginId: (loginPrefix || name) + i + "@t.test",
          password: "SecretPw-" + name + i,
        })),
      });
    return variantId;
  };
  const reg = (email) =>
    service.session(service.register({ name: "Buyer", email, password: "Buyer-Pass-12345" }).token);
  return { service, admin, adminPassword, make, reg };
}

async function http(service, method, path, token, body) {
  const handler = createAPIHandler(service);
  const headers = { "X-Astra-Request": "1", Origin: "http://127.0.0.1" };
  if (token) headers.Cookie = "astra_session=" + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await handler(
    new Request("http://127.0.0.1" + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    {},
  );
  const type = res.headers.get("Content-Type") ?? "";
  const data = type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data };
}

test("legacy GET /api/orders without page still returns full { orders }", async () => {
  const { service, make, reg } = setup();
  const v = make("Leg", 1000, 2);
  const user = reg("leg@example.invalid");
  const auth = service.login({ email: "leg@example.invalid", password: "Buyer-Pass-12345" });
  const o = service.createOrder(user, { variantId: v, quantity: 1, requestKey: "leg-order-key-01" });
  service.pay(user, o.id, { paymentToken: o.paymentToken, outcome: "success" });
  const r = await http(service, "GET", "/api/orders", auth.token);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.orders));
  assert.equal(r.data.orders.length, 1);
  assert.equal(r.data.page, undefined);
});

test("pagination merges checkout lines as one row; status and q filters", async () => {
  const { service, make, reg } = setup();
  const a = make("AlphaPage", 1000, 20);
  const b = make("BetaPage", 2000, 10);
  const user = reg("page@example.invalid");
  const auth = service.login({ email: "page@example.invalid", password: "Buyer-Pass-12345" });
  // Multi-line checkout → 1 merged row when paginated.
  const c = service.createCheckout(user, {
    requestKey: "page-co-1",
    lines: [
      { variantId: a, quantity: 1 },
      { variantId: b, quantity: 1 },
    ],
  });
  const tokens = Object.fromEntries(c.orders.map((o) => [o.id, o.paymentToken]));
  service.payCheckout(user, c.id, { tokens, outcome: "success" });
  // Solo orders for paging.
  for (let i = 0; i < 5; i++) {
    const o = service.createOrder(user, { variantId: a, quantity: 1, requestKey: "solo-order-key-" + i });
    service.pay(user, o.id, { paymentToken: o.paymentToken, outcome: "success" });
  }
  const full = service.orders(user);
  assert.ok(full.length >= 7); // 2 checkout lines + 5 solos
  const p1 = await http(service, "GET", "/api/orders?page=1&limit=3", auth.token);
  assert.equal(p1.status, 200);
  assert.equal(p1.data.orders.length, 3);
  assert.equal(p1.data.page, 1);
  assert.ok(p1.data.total >= 6); // merged checkout counts as 1
  assert.ok(p1.data.pages >= 2);
  const delivered = await http(service, "GET", "/api/orders?page=1&limit=50&status=delivered", auth.token);
  assert.equal(delivered.status, 200);
  assert.ok(delivered.data.orders.every((o) => o.status === "DELIVERED" || o.lines));
  const byName = await http(service, "GET", "/api/orders?page=1&limit=20&q=BetaPage", auth.token);
  assert.equal(byName.status, 200, JSON.stringify(byName.data));
  assert.ok(byName.data.total >= 1, "q=BetaPage should hit merged checkout searchBlob");
  assert.ok(
    byName.data.orders.some(
      (o) =>
        (o.name || "").includes("Beta") ||
        (o.name || "").includes("Alpha") ||
        (o.lines || []).some((l) => (l.name || "").includes("Beta")),
    ),
  );
  const byLogin = await http(
    service,
    "GET",
    "/api/orders?page=1&limit=20&q=" + encodeURIComponent("AlphaPage0@t.test"),
    auth.token,
  );
  assert.equal(byLogin.status, 200);
  assert.ok(byLogin.data.total >= 1);
  const byPass = await http(
    service,
    "GET",
    "/api/orders?page=1&limit=20&q=" + encodeURIComponent("SecretPw-AlphaPage0"),
    auth.token,
  );
  assert.equal(byPass.status, 200);
  assert.ok(byPass.data.total >= 1);
  const byId = await http(
    service,
    "GET",
    "/api/orders?page=1&limit=20&q=" + encodeURIComponent("#" + c.orders[0].id.slice(0, 8)),
    auth.token,
  );
  assert.equal(byId.status, 200);
  assert.ok(byId.data.total >= 1);
});

test("copy is owner-only and capped; foreign order 404", async () => {
  const { service, make, reg } = setup();
  const v = make("CopyMe", 1500, 2);
  const user = reg("copy@example.invalid");
  const other = reg("other-copy@example.invalid");
  const auth = service.login({ email: "copy@example.invalid", password: "Buyer-Pass-12345" });
  const otherAuth = service.login({ email: "other-copy@example.invalid", password: "Buyer-Pass-12345" });
  const o = service.createOrder(user, { variantId: v, quantity: 1, requestKey: "copy-order-key-1" });
  service.pay(user, o.id, { paymentToken: o.paymentToken, outcome: "success" });
  const ok = await http(service, "POST", "/api/orders/copy", auth.token, { ids: [o.id] });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.lines.length >= 1);
  assert.ok(ok.data.lines.some((l) => l.includes("CopyMe") || l.includes("SecretPw") || l.includes("|")));
  const denied = await http(service, "POST", "/api/orders/copy", otherAuth.token, { ids: [o.id] });
  assert.equal(denied.status, 404);
  const tooMany = await http(
    service,
    "POST",
    "/api/orders/copy",
    auth.token,
    { ids: Array.from({ length: 501 }, () => o.id) },
  );
  assert.equal(tooMany.status, 400);
  void other;
});

test("1000 orders paginated list stays under 2s without full decrypt", () => {
  const { service, admin, make, reg } = setup();
  const p = service.saveProduct(admin, {
    name: "Bulk",
    description: "bulk stock",
    category: "streaming",
    price: 500,
    active: true,
    firstLabel: "30 วัน",
  });
  const variantId = service.adminProductVariants(admin, p.id).variants[0].id;
  for (let batch = 0; batch < 12; batch++) {
    service.importCodes(admin, {
      variantId,
      items: Array.from({ length: 100 }, (_, i) => ({
        loginId: "bulk" + batch + "-" + i + "@t.test",
        password: "BulkPw-" + batch + "-" + i,
      })),
    });
  }
  const user = reg("bulk@example.invalid");
  // Sandbox top-ups: 5 × ฿1000 covers 1000 × ฿5 (register may already hold some demo credit).
  for (let i = 0; i < 5; i++)
    service.topup(user, { amount: 1000, requestKey: "bulk-topup-credit-" + String(i).padStart(2, "0") });
  for (let i = 0; i < 1000; i++) {
    const o = service.createOrder(user, { variantId, quantity: 1, requestKey: "bulk-order-key-" + i });
    service.pay(user, o.id, { paymentToken: o.paymentToken, outcome: "success" });
  }
  const t0 = Date.now();
  const page = service.listOrders(user, { page: 1, limit: 20 });
  const ms = Date.now() - t0;
  assert.equal(page.orders.length, 20);
  assert.equal(page.total, 1000);
  assert.ok(ms < 2000, "list 1000 orders page1 took " + ms + "ms");
  console.log("PERF listOrders 1000 rows page1:", ms, "ms");
  void make;
});
