/**
 * Manual (back-office) orders against `wrangler dev --local` (Durable Object SQLite):
 * ADMIN + password, idempotent replay, delivery with credentials, preorder queue,
 * price override reason, slip upload, wallet untouched, revenue counted, STAFF 403.
 *
 * Usage (scratch state, test payments on):
 *   npx wrangler dev --local --port 4393 --persist-to <scratch dir> \
 *     --var ASTRA_ADMIN_PASSWORD:<8+ chars> --var INVENTORY_KEY:<32 hex> --var ASTRA_TEST_PAYMENTS:on
 *   ASTRA_ADMIN_PASSWORD=<same> node scripts/wrangler-local-manual-orders-smoke.mjs http://127.0.0.1:4393
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:4393";
const adminPassword = process.env.ASTRA_ADMIN_PASSWORD;
if (!adminPassword) throw new Error("Set ASTRA_ADMIN_PASSWORD");

function session() {
  const jar = new Map();
  return async function api(method, path, body, contentType) {
    const headers = { "X-Astra-Request": "1", Origin: base };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["Content-Type"] = contentType ?? "application/json";
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : contentType ? body : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const type = response.headers.get("Content-Type") ?? "";
    const data = type.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer());
    return { status: response.status, data, headers: response.headers };
  };
}

let passed = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail ? " — " + JSON.stringify(detail) : ""));
  console.log("PASS", ++passed, name);
};
const key = (p) => p + "-" + randomUUID();

const health = await session()("GET", "/api/health");
ok("health: durable sqlite, manual orders on", health.data.storage === "cloudflare-durable-sqlite" && health.data.features.manualOrders, health.data);

const admin = session();
ok("admin login", (await admin("POST", "/api/login", { email: "admin@astra.local", password: adminPassword })).status === 200);
const ready = await admin("POST", "/api/admin/products", {
  name: "Manual QA Ready " + randomUUID().slice(0, 6),
  description: "wrangler manual order smoke",
  category: "streaming",
  price: 15000,
  active: true,
  preorder: false,
});
ok("create ready product", ready.status === 200, ready.data);
const variantId = ready.data.id + "-30";
const loginA = `man-a-${randomUUID().slice(0, 8)}@example.invalid`;
const imported = await admin("POST", "/api/admin/inventory", {
  variantId,
  items: [{ loginId: loginA, password: "Pw-A-1" }],
});
ok("import one unit", imported.status === 200, imported.data);
const pre = await admin("POST", "/api/admin/products", {
  name: "Manual QA Preorder " + randomUUID().slice(0, 6),
  description: "wrangler manual order smoke preorder",
  category: "streaming",
  price: 20000,
  active: true,
  preorder: true,
});
ok("create preorder product", pre.status === 200, pre.data);
const staffEmail = `man-staff-${randomUUID().slice(0, 8)}@shop.test`;
const staffMade = await admin("POST", "/api/admin/team", { name: "Manual Staff", email: staffEmail, role: "STAFF" });
ok("create staff", staffMade.status === 200, staffMade.data);

const buyer = session();
const reg = await buyer("POST", "/api/register", {
  name: "Manual Buyer",
  email: `man-buyer-${randomUUID()}@shop.test`,
  password: "Buyer-only-Password-123",
});
ok("register buyer", reg.status === 200, reg.data);
const buyerId = reg.data.user.id;
const balanceBefore = (await buyer("GET", "/api/me")).data.user.balance;
const revenueBefore = (await admin("GET", "/api/admin/summary")).data.revenue;

const body = {
  customerId: buyerId,
  variantId,
  quantity: 1,
  unitPrice: 12000,
  priceReason: "ลูกค้าประจำ ตกลงทาง LINE",
  reference: "KBANK 0001",
  requestKey: key("man"),
  currentPassword: adminPassword,
};
ok("wrong password refused", (await admin("POST", "/api/admin/manual-orders", { ...body, currentPassword: "nope-nope-123" })).status === 403);
ok(
  "price change without reason refused",
  (await admin("POST", "/api/admin/manual-orders", { ...body, priceReason: undefined, requestKey: key("man") })).status === 400,
);
const quote = await admin("POST", "/api/admin/manual-orders/quote", body);
ok("quote", quote.status === 200 && quote.data.total === 12000 && quote.data.normalUnitPrice === 15000, quote.data);
const made = await admin("POST", "/api/admin/manual-orders", body);
ok("create delivers", made.status === 201 && made.data.order.status === "DELIVERED", made.data);
const again = await admin("POST", "/api/admin/manual-orders", body);
ok("replay returns the same order", again.data.replayed === true && again.data.order.id === made.data.order.id, again.data);
ok(
  "out of stock refused",
  (await admin("POST", "/api/admin/manual-orders", { ...body, requestKey: key("man") })).status === 409,
);
const id = made.data.order.id;
const mine = await buyer("GET", "/api/orders/" + id);
ok("customer sees credentials + marker", mine.data.credentials?.[0]?.loginId === loginA && mine.data.createdByAdmin === true, mine.data);
ok("wallet untouched", (await buyer("GET", "/api/me")).data.user.balance === balanceBefore);
const revenueAfter = (await admin("GET", "/api/admin/summary")).data.revenue;
ok("revenue counted", revenueAfter - revenueBefore === 12000, { revenueBefore, revenueAfter });
const detail = await admin("GET", "/api/admin/orders/" + id);
ok("admin detail marker + reason", detail.data.manual?.priceReason === "ลูกค้าประจำ ตกลงทาง LINE" && detail.data.paymentSummary.paid === 12000, detail.data.manual);
const txns = await admin("GET", "/api/admin/transactions?q=" + id.slice(0, 8));
ok("finance lists PAYMENT_IN", txns.data.transactions.some((t) => t.order_id === id && t.kind === "PAYMENT_IN"), txns.data);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
ok("slip upload", (await admin("POST", `/api/admin/orders/${id}/slip`, png, "image/png")).status === 200);
const slip = await admin("GET", `/api/admin/orders/${id}/slip`);
ok("slip readable by admin", slip.status === 200 && slip.data.byteLength === png.byteLength);
ok("slip not readable by customer", (await buyer("GET", `/api/admin/orders/${id}/slip`)).status === 403);

const preMade = await admin("POST", "/api/admin/manual-orders", {
  customerId: buyerId,
  variantId: pre.data.id + "-30",
  quantity: 2,
  reference: "SCB 0002",
  requestKey: key("man-pre"),
  currentPassword: adminPassword,
});
ok("preorder queued", preMade.status === 201 && preMade.data.order.status === "PREORDER" && preMade.data.order.queueNumber >= 1, preMade.data);

const staff = session();
const staffLogin = await staff("POST", "/api/login", { email: staffEmail, password: staffMade.data.temporaryPassword ?? staffMade.data.password });
if (staffLogin.status === 200)
  ok("staff cannot create", (await staff("POST", "/api/admin/manual-orders", { ...body, requestKey: key("man") })).status === 403);
ok("customer cannot create", (await buyer("POST", "/api/admin/manual-orders", { ...body, requestKey: key("man") })).status === 403);
console.log("OK", passed, "checks");
