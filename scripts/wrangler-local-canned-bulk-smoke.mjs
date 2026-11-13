/**
 * Chat ข้อความสำเร็จรูป + bulk order actions against wrangler dev --local (Durable Object SQLite):
 * - canned_replies exists with the seeded defaults; placeholders filled from a thread;
 *   ADMIN create / edit / reorder / delete; customers are refused;
 * - bulk cancel (dry run first) gives a result per order, skips paid ones, releases the coupon;
 * - bulk resend for delivered orders, bulk export by filter, the 100-order cap.
 *
 * Usage:
 *   npm run build
 *   npx wrangler dev --local --port 4335 --persist-to <scratch dir> \
 *     --var ASTRA_ADMIN_PASSWORD:<8+ chars> --var INVENTORY_KEY:<32 hex> --var ASTRA_TEST_PAYMENTS:on
 *   ASTRA_ADMIN_PASSWORD=<same> node scripts/wrangler-local-canned-bulk-smoke.mjs http://127.0.0.1:4335
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:4335";
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

const seeded = await admin("GET", "/api/admin/canned-replies");
ok("canned_replies table has the formal defaults", seeded.status === 200 && seeded.data.replies.length >= 4, seeded.text);

// Product with stock, a buyer with one paid and two unpaid orders (one with a coupon).
const product = await admin("POST", "/api/admin/products", {
  name: "Bulk Smoke " + randomUUID().slice(0, 6),
  description: "canned + bulk smoke product",
  category: "streaming",
  price: 500,
  active: true,
  preorder: false,
});
ok("create product", product.status === 200, product.text);
const variantId = product.data.id + "-30";
const imported = await admin("POST", "/api/admin/inventory", {
  variantId,
  items: Array.from({ length: 3 }, (_, i) => ({ loginId: `bulk-${i}-${randomUUID().slice(0, 6)}@example.invalid`, password: "pw-" + i })),
});
ok("import accounts", imported.status === 200 && imported.data?.imported === 3, imported.text);
const couponCode = "SMOKE-" + randomUUID().slice(0, 6).toUpperCase();
const coupon = await admin("POST", "/api/admin/coupons", { code: couponCode, type: "FIXED", value: 100, usageLimit: 1 });
ok("create coupon", coupon.status === 201, coupon.text);

const buyer = client();
const reg = await buyer("POST", "/api/register", {
  name: "Smoke Buyer",
  email: `bulk-buyer-${randomUUID()}@example.invalid`,
  password: "Buyer-only-Password-123",
});
ok("register buyer", reg.status === 200, reg.text);
const order = (extra = {}) => buyer("POST", "/api/orders", { variantId, quantity: 1, requestKey: "bulk-" + randomUUID(), ...extra });
const paidOrder = await order();
const paid = await buyer("POST", `/api/orders/${paidOrder.data.id}/pay`, { paymentToken: paidOrder.data.paymentToken, outcome: "success" });
ok("paid order delivered", paid.status === 200 && paid.data.status === "DELIVERED", paid.text);
const withCoupon = await order({ couponCode });
ok("unpaid order with coupon", withCoupon.status === 201 && withCoupon.data.status === "PENDING_PAYMENT", withCoupon.text);
const plain = await order();
ok("unpaid order", plain.status === 201, plain.text);

// Canned replies filled from the thread.
const chat = await buyer("POST", "/api/chat/threads", { body: "สอบถามครับ" });
ok("customer opens chat", chat.status === 201, chat.text);
const filled = await admin("GET", "/api/admin/canned-replies?thread=" + chat.data.thread.id);
const login1 = filled.data.replies?.find((r) => r.body.includes("{เลขออเดอร์}"));
ok(
  "placeholders filled from the thread",
  filled.status === 200 && login1?.text.includes("Smoke Buyer") && login1.text.includes("#" + plain.data.id.slice(0, 8).toUpperCase()),
  filled.text.slice(0, 300),
);
ok("customer cannot read canned replies", (await buyer("GET", "/api/admin/canned-replies")).status === 403);
ok("customer cannot add one", (await buyer("POST", "/api/admin/canned-replies", { title: "x", body: "y" })).status === 403);
const made = await admin("POST", "/api/admin/canned-replies", { title: "Smoke", body: "สวัสดี {ชื่อลูกค้า}" });
ok("admin adds a reply", made.status === 201, made.text);
const edited = await admin("PATCH", "/api/admin/canned-replies/" + made.data.reply.id, { title: "Smoke 2", body: "แก้แล้ว {ชื่อลูกค้า}" });
ok("admin edits it", edited.status === 200 && edited.data.reply.title === "Smoke 2", edited.text);
const ids = (await admin("GET", "/api/admin/canned-replies")).data.replies.map((r) => r.id);
const reordered = await admin("POST", "/api/admin/canned-replies/reorder", { ids: [...ids].reverse() });
ok("admin reorders", reordered.status === 200 && reordered.data.replies[0].id === ids.at(-1), reordered.text);
const removed = await admin("DELETE", "/api/admin/canned-replies/" + made.data.reply.id);
ok("admin deletes it", removed.status === 200, removed.text);
ok("too long body refused", (await admin("POST", "/api/admin/canned-replies", { title: "x", body: "ก".repeat(1001) })).status === 400);

// Bulk cancel: dry run, then the real run with a result per order.
const picked = [withCoupon.data.id, paid.data.id, plain.data.id];
const dry = await admin("POST", "/api/admin/orders/bulk", { action: "cancel", dryRun: true, ids: picked });
ok("dry run counts", dry.status === 200 && dry.data.ok === 2 && dry.data.skipped === 1, dry.text);
ok("dry run changes nothing", (await admin("GET", "/api/admin/orders/" + plain.data.id)).data.status === "PENDING_PAYMENT");
ok("customer cannot bulk cancel", (await buyer("POST", "/api/admin/orders/bulk", { action: "cancel", ids: picked })).status === 403);
const cancelled = await admin("POST", "/api/admin/orders/bulk", { action: "cancel", ids: picked, reason: "smoke bulk cancel" });
ok(
  "bulk cancel reports each order",
  cancelled.status === 200 &&
    cancelled.data.ok === 2 &&
    cancelled.data.results.find((r) => r.id === paid.data.id)?.result === "skipped",
  cancelled.text,
);
for (const id of [withCoupon.data.id, plain.data.id])
  ok("cancelled " + id.slice(0, 8), (await admin("GET", "/api/admin/orders/" + id)).data.status === "CANCELLED");
ok("paid order untouched", (await admin("GET", "/api/admin/orders/" + paid.data.id)).data.status === "DELIVERED");
const audit = await admin("GET", "/api/admin/audit?action=CANCEL_ORDER&limit=20");
const couponAudit = audit.data.entries?.find((e) => e.entity_id === withCoupon.data.id);
ok("coupon use released on bulk cancel", couponAudit?.detail?.couponReleased === couponCode && couponAudit.detail.bulk === true, audit.text.slice(0, 400));
const again = await buyer("POST", "/api/coupons/check", { code: couponCode, variantId, quantity: 1 });
ok("coupon usable again", again.status === 200 && again.data.valid === true, again.text);

// Resend + export + cap.
const resend = await admin("POST", "/api/admin/orders/bulk", { action: "resend", ids: [paid.data.id, plain.data.id] });
ok("bulk resend: delivered sent, cancelled skipped", resend.status === 200 && resend.data.ok === 1 && resend.data.skipped === 1, resend.text);
const exported = await admin("POST", "/api/admin/orders/bulk", { action: "export", filter: { group: "failed", q: product.data.name } });
ok(
  "bulk export by filter",
  exported.status === 200 && exported.data.rows.length === 2 && exported.data.rows.every((r) => r.status === "CANCELLED"),
  exported.text.slice(0, 300),
);
const tooMany = await admin("POST", "/api/admin/orders/bulk", {
  action: "cancel",
  dryRun: true,
  ids: Array.from({ length: 101 }, () => randomUUID()),
});
ok("more than 100 ids refused", tooMany.status === 400, tooMany.text);

console.log("\nwrangler local canned + bulk smoke:", passed, "passed");
