/**
 * Live chat attachments against wrangler dev --local (Durable Object SQLite, no R2):
 * image upload → message with image + product + order cards → private file route.
 * Usage: node scripts/wrangler-local-chat-attach-smoke.mjs [baseUrl]   (ASTRA_ADMIN_PASSWORD set)
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:4340";
const adminPassword = process.env.ASTRA_ADMIN_PASSWORD;
if (!adminPassword) throw new Error("Set ASTRA_ADMIN_PASSWORD");
const webp = Uint8Array.from(Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=", "base64"));

function client() {
  const jar = new Map();
  return async function api(method, path, body, raw) {
    const headers = { "X-Astra-Request": "1", Origin: base };
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (raw) headers["Content-Type"] = "image/webp";
    else if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(base + path, {
      method,
      headers,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(20000),
    });
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const buf = new Uint8Array(await response.arrayBuffer());
    let data = {};
    try {
      data = JSON.parse(new TextDecoder().decode(buf));
    } catch {
      /* binary */
    }
    return { status: response.status, data, buf, headers: response.headers };
  };
}
let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? " — " + JSON.stringify(detail).slice(0, 300) : ""));
  console.log("PASS", ++passed, name);
}

const admin = client();
ok("admin login", (await admin("POST", "/api/login", { email: "admin@astra.local", password: adminPassword })).status === 200);
const product = await admin("POST", "/api/admin/products", {
  name: "Chat Smoke " + randomUUID().slice(0, 6),
  description: "แชทแนบรูป",
  category: "streaming",
  price: 5900,
  active: true,
  firstLabel: "1 เดือน",
});
ok("create product", product.status === 200 || product.status === 201, product.data);
const productId = product.data.id;
const variants = await admin("GET", "/api/admin/products/" + productId + "/variants");
const variantId = variants.data.variants[0].id;
const imported = await admin("POST", "/api/admin/inventory", {
  variantId,
  items: [{ loginId: `chat-${randomUUID().slice(0, 6)}@example.invalid`, password: "pw-chat" }],
});
ok("import stock", imported.status === 200, imported.data);

const buyer = client();
ok(
  "register buyer",
  (await buyer("POST", "/api/register", { name: "Chat Smoke Buyer", email: `chat-${randomUUID()}@example.invalid`, password: "Buyer-only-Password-123" })).status === 200,
);
const order = await buyer("POST", "/api/orders", { variantId, quantity: 1, requestKey: "chat-" + randomUUID() });
ok("buyer order", order.status === 200 || order.status === 201, order.data);

const up = await buyer("POST", "/api/chat/images", undefined, webp);
ok("upload chat image", up.status === 201 && /^chat-/.test(up.data.imageId), up.data);
const opened = await buyer("POST", "/api/chat/threads", { imageId: up.data.imageId, attachOrderId: order.data.id });
const first = opened.data.messages?.at(-1);
ok("open thread with image + order", opened.status === 201 && first?.imageUrl && first?.order?.id === order.data.id, opened.data);
const threadId = opened.data.thread.id;

const file = await buyer("GET", first.imageUrl);
ok("owner reads image", file.status === 200 && file.buf.length === webp.length && /private/.test(file.headers.get("Cache-Control")));
ok("public route refuses chat key", (await client()("GET", "/api/files/" + up.data.imageId)).status === 404);
const stranger = client();
await stranger("POST", "/api/register", { name: "Stranger", email: `s-${randomUUID()}@example.invalid`, password: "Stranger-Pass-12345" });
ok("other customer cannot read", (await stranger("GET", first.imageUrl)).status === 404);
ok("admin reads image", (await admin("GET", first.imageUrl)).status === 200);

const reply = await admin("POST", `/api/chat/threads/${threadId}/messages`, { productId });
const last = reply.data.messages?.at(-1);
ok("admin replies with product card", reply.status === 201 && last?.product?.id === productId && last.body === "", reply.data);
const list = await admin("GET", "/api/chat/threads");
ok("thread carries customer + order", list.data.threads.some((t) => t.id === threadId && t.user_id && t.order_id === order.data.id));
console.log(`OK ${passed} checks`);
