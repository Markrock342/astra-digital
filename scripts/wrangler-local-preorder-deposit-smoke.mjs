/**
 * Preorder deposit mode against wrangler dev --local (Durable Object SQLite):
 * admin sets วิธีจอง = มัดจำ → customer reserves and pays the deposit → stock import calls
 * the queue (one unit held) → customer pays the balance → delivered with the credentials.
 * Usage: node scripts/wrangler-local-preorder-deposit-smoke.mjs [baseUrl]   (ASTRA_ADMIN_PASSWORD set,
 * wrangler started with --var ASTRA_TEST_PAYMENTS:on)
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:8797";
const adminPassword = process.env.ASTRA_ADMIN_PASSWORD;
if (!adminPassword) throw new Error("Set ASTRA_ADMIN_PASSWORD");

function client() {
  const jar = new Map();
  return async function api(method, path, body) {
    const headers = { "X-Astra-Request": "1", Origin: base };
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    let data = {};
    try {
      data = await response.json();
    } catch {
      /* not JSON */
    }
    return { status: response.status, data };
  };
}
let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? " — " + JSON.stringify(detail).slice(0, 300) : ""));
  console.log("PASS", ++passed, name);
}

const admin = client();
ok("admin login", (await admin("POST", "/api/login", { email: "admin@astra.local", password: adminPassword })).status === 200);
const health = await admin("GET", "/api/health");
ok("test payments on", health.data.mode === "sandbox", health.data);
const product = await admin("POST", "/api/admin/products", {
  name: "Deposit Smoke " + randomUUID().slice(0, 6),
  description: "พรีออเดอร์แบบมัดจำ",
  category: "streaming",
  price: 20000,
  active: true,
  preorder: true,
  firstLabel: "1 เดือน",
});
ok("create preorder product", (product.status === 200 || product.status === 201) && product.data.preorder, product.data);
const productId = product.data.id;
const variantId = (await admin("GET", "/api/admin/products/" + productId + "/variants")).data.variants[0].id;
const saved = await admin("PATCH", "/api/admin/products/" + productId + "/preorder", {
  mode: "deposit",
  depositType: "percent",
  depositValue: 25,
  payWindowHours: 24,
  lapsePolicy: "refund_credit",
});
ok("set deposit mode", saved.status === 200 && saved.data.settings.mode === "deposit", saved.data);
const terms = (await client()("GET", "/api/products/" + productId)).data.product?.preorderTerms;
ok("storefront shows the terms", terms?.mode === "deposit" && terms.depositValue === 25, terms);

const buyer = client();
ok(
  "register buyer",
  (await buyer("POST", "/api/register", { name: "Deposit Smoke Buyer", email: `dep-${randomUUID()}@example.invalid`, password: "Buyer-only-Password-123" })).status === 200,
);
ok("top up test credit", (await buyer("POST", "/api/topup", { amount: 300, requestKey: "dep-" + randomUUID() })).status === 200);
const order = await buyer("POST", "/api/orders", { variantId, quantity: 1, requestKey: "dep-" + randomUUID() });
ok("reserve: deposit due", order.status === 201 && order.data.status === "PENDING_PAYMENT" && order.data.amountDue === 5000, order.data);
const id = order.data.id;
const deposit = await buyer("POST", "/api/orders/" + id + "/pay", { paymentToken: order.data.paymentToken, outcome: "success" });
ok("deposit paid → queued", deposit.status === 200 && deposit.data.stage === "queued" && deposit.data.depositPaid === 5000 && deposit.data.queueNumber > 0, deposit.data);
const summary = await admin("GET", "/api/admin/transactions?limit=1");
ok("finance shows มัดจำค้าง", summary.data.summary?.depositsHeld >= 5000, summary.data.summary);

const imported = await admin("POST", "/api/admin/inventory", {
  variantId,
  items: [{ loginId: `dep-${randomUUID().slice(0, 6)}@example.invalid`, password: "pw-deposit" }],
});
ok("import stock calls the queue", imported.status === 200 && imported.data.preorderCalled === 1, imported.data);
const called = await buyer("GET", "/api/orders/" + id);
ok("customer called with a deadline", called.data.stage === "called" && called.data.amountDue === 15000 && !!called.data.payBy, called.data);
const queue = await admin("GET", "/api/queue");
ok("queue board shows called", queue.data.queue.some((q) => q.id === id && q.stage === "called" && q.mode === "deposit"));

const token = await buyer("POST", "/api/orders/" + id + "/retry", {});
ok("balance token", token.status === 200 && !!token.data.paymentToken, token.data);
const paid = await buyer("POST", "/api/orders/" + id + "/pay", { paymentToken: token.data.paymentToken, outcome: "success" });
ok(
  "balance paid → delivered with credentials",
  paid.status === 200 && paid.data.status === "DELIVERED" && paid.data.credentials?.length === 1 && paid.data.credentials[0].password === "pw-deposit",
  paid.data,
);
const after = await admin("GET", "/api/admin/orders/" + id + "/payment-summary");
ok("paid in full, not double counted", after.status === 200 && after.data.paid === 20000, after.data);
console.log(`OK ${passed} checks`);
