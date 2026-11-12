/**
 * Smoke deliver (+ replace when flag on) against wrangler dev --local.
 * Node unit tests do not catch DO cursor.changes bugs — run this after cloud:dev.
 *
 * Usage:
 *   npm run cloud:setup   # once — writes .dev.vars
 *   # ensure .dev.vars has ASTRA_ADMIN_PASSWORD (>=8 chars)
 *   npm run build && npm run cloud:dev
 *   npm run qa:wrangler-local
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:4332";

function loadAdminPassword() {
  if (process.env.ASTRA_ADMIN_PASSWORD?.length >= 8)
    return process.env.ASTRA_ADMIN_PASSWORD;
  if (!existsSync(".dev.vars"))
    throw new Error("Missing .dev.vars — run npm run cloud:setup first");
  const text = readFileSync(".dev.vars", "utf8");
  const match = /^ASTRA_ADMIN_PASSWORD=(.+)$/m.exec(text);
  if (!match?.[1] || match[1].trim().length < 8)
    throw new Error(
      "Add ASTRA_ADMIN_PASSWORD (>=8) to .dev.vars for wrangler local smoke",
    );
  return match[1].trim();
}

const adminPassword = loadAdminPassword();
const jar = new Map();

function storeCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  const list = raw.length
    ? raw
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const line of list) {
    const [pair] = String(line).split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}

async function api(method, path, body) {
  const headers = { "X-Astra-Request": "1", Origin: base };
  if (jar.size)
    headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    throw new Error(`${method} ${path} failed: ${error.name} ${error.message}`);
  }
  clearTimeout(timer);
  storeCookies(response);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? " — " + detail : ""));
  console.log("PASS", ++passed, name);
}

const health = await api("GET", "/api/health");
ok("health cloudflare-durable-sqlite", health.data?.storage === "cloudflare-durable-sqlite");

jar.clear();
const login = await api("POST", "/api/login", {
  email: "admin@astra.local",
  password: adminPassword,
});
ok("admin login", login.status === 200 && login.data?.user?.role === "ADMIN", JSON.stringify(login.data));

const product = await api("POST", "/api/admin/products", {
  name: "Wrangler Preorder QA",
  description: "wrangler --local deliver/replace smoke product",
  category: "streaming",
  price: 500,
  active: true,
  preorder: true,
});
ok("create preorder product", product.status === 200, JSON.stringify(product.data));
const variantId = product.data.id + "-30";

const imported = await api("POST", "/api/admin/inventory", {
  variantId,
  items: [
    { loginId: "wr-a-" + randomUUID().slice(0, 8) + "@example.invalid", password: "pass-a" },
    { loginId: "wr-b-" + randomUUID().slice(0, 8) + "@example.invalid", password: "pass-b" },
  ],
});
ok("import credential pairs", imported.status === 200 && imported.data?.imported === 2, JSON.stringify(imported.data));

await api("POST", "/api/admin/payment-channel", {
  provider: "sandbox",
  active: true,
});

jar.clear();
const buyer = await api("POST", "/api/register", {
  name: "Wrangler Buyer",
  email: `wr-buyer-${randomUUID()}@example.invalid`,
  password: "Buyer-only-Password-123",
});
ok("register buyer", buyer.status === 200, JSON.stringify(buyer.data));

const topup = await api("POST", "/api/topup", {
  amount: 500,
  requestKey: "wr-topup-" + randomUUID(),
});
ok("sandbox topup", topup.status === 200, JSON.stringify(topup.data));

const order = await api("POST", "/api/orders", {
  variantId,
  quantity: 1,
  requestKey: "wr-deliver-" + randomUUID(),
});
ok(
  "create preorder",
  order.status === 200 || order.status === 201,
  JSON.stringify(order.data),
);
const paid = await api("POST", `/api/orders/${order.data.id}/pay`, {
  paymentToken: order.data.paymentToken,
  outcome: "success",
});
ok("pay preorder", paid.status === 200 && paid.data?.status === "PREORDER", JSON.stringify(paid.data));

jar.clear();
await api("POST", "/api/login", {
  email: "admin@astra.local",
  password: adminPassword,
});
const delivered = await api(
  "POST",
  `/api/admin/reservations/${order.data.id}/deliver`,
  {},
);
ok(
  "deliver preorder on wrangler local (must not 409 สต็อกไม่พอ)",
  delivered.status === 200 && delivered.data?.status === "DELIVERED",
  JSON.stringify(delivered.data),
);

const me = await api("GET", "/api/me");
const features = me.data?.features ?? health.data?.features ?? {};
if (features.adminReplaceCredential) {
  const detail = await api("GET", `/api/admin/orders/${order.data.id}`);
  const unitId =
    detail.data?.units?.[0]?.id ??
    detail.data?.units?.[0] ??
    detail.data?.inventory?.[0]?.id;
  ok(
    "admin order detail units[] has inventory id",
    !!unitId,
    JSON.stringify({ units: detail.data?.units, status: detail.status }),
  );
  const replace = await api("POST", `/api/admin/orders/${order.data.id}/replace`, {
    inventoryId: unitId,
    reason: "wrangler local replace smoke",
  });
  ok(
    "replace credential on wrangler local",
    replace.status === 200 && replace.data?.newInventoryId,
    JSON.stringify(replace.data),
  );
} else {
  console.log(
    "SKIP replace — features.adminReplaceCredential off (merge FR-O5 / #35 first)",
  );
}

console.log("\nwrangler local ops smoke:", passed, "passed");
