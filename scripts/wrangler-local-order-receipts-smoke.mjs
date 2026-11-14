/**
 * Wrangler --local smoke: profile → request → approve → GET receipt.
 * Usage: ASTRA_ADMIN_PASSWORD=... node scripts/wrangler-local-order-receipts-smoke.mjs http://127.0.0.1:4350
 */
import assert from "node:assert/strict";

const base = (process.argv[2] || "http://127.0.0.1:4350").replace(/\/$/, "");
const ADMIN_PASSWORD = process.env.ASTRA_ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error("Set ASTRA_ADMIN_PASSWORD");

const BUYER = {
  type: "PERSON",
  name: "ลูกค้า Smoke",
  taxId: "1234567890121",
  address: "10 หมู่ 2 ต.บางพลี อ.บางพลี สมุทรปราการ 10540",
};

function session() {
  const jar = new Map();
  return async function api(method, path, body) {
    const headers = { "X-Astra-Request": "1", Origin: base };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const type = res.headers.get("Content-Type") ?? "";
    const data = type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data };
  };
}

const admin = session();
const buyer = session();
let n = 0;
const ok = (label, cond, extra) => {
  assert.ok(cond, label + " " + JSON.stringify(extra)?.slice(0, 200));
  console.log("PASS", ++n, label);
};

ok("health", (await admin("GET", "/api/health")).status === 200);
ok(
  "admin login",
  (await admin("POST", "/api/login", { email: "admin@astra.local", password: ADMIN_PASSWORD })).status === 200,
);

const prod = await admin("POST", "/api/admin/products", {
  name: "Receipt Smoke",
  description: "smoke",
  category: "streaming",
  price: 4500,
  active: true,
});
ok("create product", prod.status === 200, prod.data);
const productId = prod.data.id;
const variants = await admin("GET", "/api/admin/products/" + productId + "/variants");
const variantId = variants.data.variants[0].id;
ok(
  "import",
  (
    await admin("POST", "/api/admin/inventory", {
      variantId,
      items: [{ loginId: "smoke-rcp@t.invalid", password: "Pw" }],
    })
  ).status === 200,
);

const email = "rcp-smoke-" + Date.now() + "@ex.invalid";
ok(
  "register",
  (await buyer("POST", "/api/register", { name: "Smoke Buyer", email, password: "Smoke-Buyer-Pass-99" })).status ===
    200,
);
const me = await buyer("GET", "/api/me");
const buyerId = me.data.user?.id || me.data.id;

await admin("POST", "/api/login", { email: "admin@astra.local", password: ADMIN_PASSWORD });
// Buy via sandbox as customer
await buyer("POST", "/api/login", { email, password: "Smoke-Buyer-Pass-99" });
const order = await buyer("POST", "/api/orders", { variantId, quantity: 1, requestKey: "rcp-smoke-" + Date.now() });
ok("create order", order.status === 200 || order.status === 201, order.data);
const orderId = order.data.id || order.data.order?.id;
const paid = await buyer("POST", "/api/orders/" + orderId + "/pay", {
  paymentToken: order.data.paymentToken,
  outcome: "success",
});
ok("pay", paid.status === 200, paid.data);

ok(
  "gated receipt",
  (await buyer("GET", "/api/orders/" + orderId + "/receipt")).status === 403,
);

const profile = await buyer("POST", "/api/account/receipt-profiles", { ...BUYER, label: "บ้าน" });
ok("profile", profile.status === 200, profile.data);
const req = await buyer("POST", "/api/orders/" + orderId + "/order-receipt", { profileId: profile.data.id });
ok("request", req.status === 200 && req.data.request?.status === "PENDING", req.data);

await admin("POST", "/api/login", { email: "admin@astra.local", password: ADMIN_PASSWORD });
const approve = await admin("POST", "/api/admin/orders/" + orderId + "/order-receipt/approve", {});
ok("approve", approve.status === 200, approve.data);

const receipt = await buyer("GET", "/api/orders/" + orderId + "/receipt");
ok("download", receipt.status === 200 && receipt.data.receipt?.paymentMethodLabel === "ชำระทดลอง", receipt.data);
ok("buyer on paper", receipt.data.receipt?.buyer?.name === BUYER.name, receipt.data.receipt?.buyer);
void buyerId;
console.log("order-receipts smoke OK", n, "checks");
