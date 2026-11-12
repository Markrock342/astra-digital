/**
 * Small UX round A against wrangler dev --local (Durable Object SQLite):
 * - /api/products and /api/products/:id carry no stock number;
 * - notifications carry a deep link (preorder queue → admin order, delivered →
 *   customer order, chat → admin chat thread);
 * - "ส่งรหัสให้ลูกค้าอีกครั้ง" works, never sends the password, and stops at 3/hour.
 *
 * Usage:
 *   npm run build
 *   npx wrangler dev --local --port 4334 --persist-to <scratch dir> \
 *     --var ASTRA_ADMIN_PASSWORD:<8+ chars> --var INVENTORY_KEY:<32 hex> --var ASTRA_TEST_PAYMENTS:on
 *   ASTRA_ADMIN_PASSWORD=<same> node scripts/wrangler-local-small-ux-smoke.mjs http://127.0.0.1:4334
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:4334";
const adminPassword = process.env.ASTRA_ADMIN_PASSWORD ?? "";
if (adminPassword.length < 8) throw new Error("Set ASTRA_ADMIN_PASSWORD (>=8 chars), same as the wrangler --var");

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
    const text = await response.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, data, text };
  };
}

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? " — " + detail : ""));
  console.log("PASS", ++passed, name);
}

const anon = client();
const health = await anon("GET", "/api/health");
ok("health is Durable Object SQLite", health.data?.storage === "cloudflare-durable-sqlite", health.text);

const admin = client();
const login = await admin("POST", "/api/login", { email: "admin@astra.local", password: adminPassword });
ok("admin login", login.status === 200 && login.data?.user?.role === "ADMIN", login.text);

// A ready product with 12 accounts (more than the old public cap of 10).
const ready = await admin("POST", "/api/admin/products", {
  name: "UXA Ready " + randomUUID().slice(0, 6),
  description: "small ux round A smoke product",
  category: "streaming",
  price: 500,
  active: true,
  preorder: false,
});
ok("create ready product", ready.status === 200, ready.text);
const readyVariant = ready.data.id + "-30";
const secret = "Wr-Secret-" + randomUUID().slice(0, 8);
const items = Array.from({ length: 12 }, (_, i) => ({
  loginId: `uxa-${i}-${randomUUID().slice(0, 6)}@example.invalid`,
  password: i === 0 ? secret : "pw-" + i,
}));
const imported = await admin("POST", "/api/admin/inventory", { variantId: readyVariant, items });
ok("import 12 accounts", imported.status === 200 && imported.data?.imported === 12, imported.text);

for (const path of ["/api/products", "/api/products/" + ready.data.id]) {
  const res = await anon("GET", path);
  ok("no stock number in " + path, res.status === 200 && !/"stock"\s*:/.test(res.text), res.text.slice(0, 200));
  const variants = (res.data.products ?? [res.data.product]).flatMap((p) => p.variants);
  ok(
    "status + available in " + path,
    variants.every((v) => ["in", "low", "out"].includes(v.stockStatus) && typeof v.available === "boolean"),
  );
}
const adminView = await admin("GET", "/api/admin");
const exact = adminView.data.products.flatMap((p) => p.variants).find((v) => v.id === readyVariant);
ok("admin overview keeps the exact count", exact?.stock === 12, JSON.stringify(exact));

// Preorder product for the queue / delivered links.
const pre = await admin("POST", "/api/admin/products", {
  name: "UXA Preorder " + randomUUID().slice(0, 6),
  description: "small ux round A preorder smoke",
  category: "streaming",
  price: 500,
  active: true,
  preorder: true,
});
ok("create preorder product", pre.status === 200, pre.text);
const preVariant = pre.data.id + "-30";
await admin("POST", "/api/admin/inventory", {
  variantId: preVariant,
  items: [{ loginId: "uxa-pre-" + randomUUID().slice(0, 6) + "@example.invalid", password: "pre-pass" }],
});

const buyer = client();
const reg = await buyer("POST", "/api/register", {
  name: "UXA Buyer",
  email: `uxa-buyer-${randomUUID()}@example.invalid`,
  password: "Buyer-only-Password-123",
});
ok("register buyer", reg.status === 200, reg.text);
await buyer("POST", "/api/topup", { amount: 2000, requestKey: "uxa-topup-" + randomUUID() });

async function buy(variantId) {
  const order = await buyer("POST", "/api/orders", { variantId, quantity: 1, requestKey: "uxa-" + randomUUID() });
  assert.ok(order.status === 200 || order.status === 201, order.text);
  const paid = await buyer("POST", `/api/orders/${order.data.id}/pay`, {
    paymentToken: order.data.paymentToken,
    outcome: "success",
  });
  assert.equal(paid.status, 200, paid.text);
  return paid.data;
}
const readyOrder = await buy(readyVariant);
ok("ready order delivered", readyOrder.status === "DELIVERED", JSON.stringify(readyOrder.status));
const preOrder = await buy(preVariant);
ok("preorder paid", preOrder.status === "PREORDER");

const adminNotes = (await admin("GET", "/api/notifications")).data.notifications;
ok(
  "admin new-order notification links to the admin order",
  adminNotes.some((n) => n.kind === "order_new" && n.link === "/admin/orders/" + readyOrder.id),
);
ok(
  "admin preorder-queue notification links to the admin order",
  adminNotes.some((n) => n.kind === "preorder_queue_admin" && n.link === "/admin/orders/" + preOrder.id),
);

const delivered = await admin("POST", `/api/admin/reservations/${preOrder.id}/deliver`, {});
ok("deliver preorder", delivered.status === 200 && delivered.data?.status === "DELIVERED", delivered.text);
let buyerNotes = (await buyer("GET", "/api/notifications")).data.notifications;
ok(
  "customer preorder-delivered notification links to the order",
  buyerNotes.some((n) => n.title === "พรีออเดอร์พร้อมใช้งานแล้ว" && n.link === "/orders/" + preOrder.id),
);
ok("every notification has a link field", buyerNotes.every((n) => "link" in n));

// Chat → admin chat thread link.
const chat = await buyer("POST", "/api/chat/threads", { body: "สอบถามครับ" });
ok("customer opens chat", chat.status === 201, chat.text);
const adminNotes2 = (await admin("GET", "/api/notifications")).data.notifications;
ok(
  "admin chat notification links to the thread",
  adminNotes2.some((n) => n.kind === "chat" && n.link === "/admin/chat?thread=" + chat.data.thread.id),
);

// Resend credentials.
const resendPath = `/api/admin/orders/${readyOrder.id}/resend-credentials`;
ok("customer cannot resend", (await buyer("POST", resendPath, {})).status === 403);
const first = await admin("POST", resendPath, {});
ok("resend works", first.status === 200 && first.data?.link === "/orders/" + readyOrder.id, first.text);
buyerNotes = (await buyer("GET", "/api/notifications")).data.notifications;
const resendNote = buyerNotes.find((n) => n.title === "ร้านส่งข้อมูลบัญชีให้อีกครั้ง");
ok("customer resend notification links to the order", resendNote?.link === "/orders/" + readyOrder.id);
const messages = await buyer("GET", `/api/chat/threads/${first.data.threadId}/messages`);
ok(
  "shop chat message has the order link and no password",
  messages.data.messages.some((m) => m.body.includes("/orders/" + readyOrder.id)) && !messages.text.includes(secret),
);
ok("notifications never carry the password", !JSON.stringify(buyerNotes).includes(secret));
await admin("POST", resendPath, {});
await admin("POST", resendPath, {});
const fourth = await admin("POST", resendPath, {});
ok("4th resend in an hour is refused (429)", fourth.status === 429, fourth.text);
const detail = await admin("GET", `/api/admin/orders/${readyOrder.id}`);
ok(
  "order activity shows 3 resends",
  detail.data.timeline.filter((e) => e.event === "resent").length === 3,
  JSON.stringify(detail.data.timeline?.map((e) => e.event)),
);

console.log("\nwrangler local small-ux smoke:", passed, "passed");
