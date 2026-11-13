/**
 * Fraud signals + email templates smoke against `wrangler dev --local` (Durable Object
 * SQLite, real workerd). Node unit tests run on node:sqlite; this checks the same flows on
 * the DO adapter (rowsWritten → changes, julianday(), transactions). Nothing is deployed.
 *
 * Usage:
 *   npm run build
 *   npx wrangler dev --local --port 4340 --persist-to <tmp dir> \
 *     --var ASTRA_ADMIN_PASSWORD:smoketest-pass-123 \
 *     --var INVENTORY_KEY:0123456789abcdef0123456789abcdef --var ASTRA_TEST_PAYMENTS:on
 *   ASTRA_ADMIN_PASSWORD=smoketest-pass-123 node scripts/wrangler-local-fraud-templates-smoke.mjs http://127.0.0.1:4340
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:4332";
const adminPassword = process.env.ASTRA_ADMIN_PASSWORD;
if (!adminPassword || adminPassword.length < 8) throw new Error("Set ASTRA_ADMIN_PASSWORD (same as wrangler --var)");

function session() {
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
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
}
let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? " — " + JSON.stringify(detail).slice(0, 400) : ""));
  console.log("PASS", ++passed, name);
}

const admin = session();
const health = await admin("GET", "/api/health");
ok("health on the Durable Object", health.data?.storage === "cloudflare-durable-sqlite", health.data);
ok("features flags", health.data?.features?.fraudSignals === true && health.data?.features?.emailTemplates === true, health.data?.features);
const login = await admin("POST", "/api/login", { email: "admin@astra.local", password: adminPassword });
ok("admin login", login.status === 200, login.data);

// ---------------------------------------------------------------- email templates
const list = await admin("GET", "/api/admin/email-templates");
ok("template list", list.status === 200 && list.data.templates.length === 6, list.data);
const saved = await admin("PATCH", "/api/admin/email-templates/order_confirmed", {
  subject: "ขอบคุณ {ชื่อลูกค้า} #{เลขออเดอร์}",
  heading: "ได้รับเงินแล้ว",
  body: "สวัสดี {ชื่อลูกค้า} ดูคำสั่งซื้อ {ลิงก์ออเดอร์}",
});
ok("save template", saved.status === 200 && saved.data.template.customized === true, saved.data);
const bad = await admin("PATCH", "/api/admin/email-templates/password_reset", { subject: "s", heading: "h", body: "ไม่มีลิงก์" });
ok("reset template needs {ลิงก์รีเซ็ต}", bad.status === 400, bad.data);
const preview = await admin("POST", "/api/admin/email-templates/order_confirmed/preview", {});
ok(
  "preview uses the saved text with sample data",
  preview.status === 200 && preview.data.preview.subject === "ขอบคุณ สมชาย ใจดี #A1B2C3D4" && preview.data.preview.html.includes("<a href="),
  preview.data,
);
const test = await admin("POST", "/api/admin/email-templates/order_confirmed/test", {});
ok("send test explains when email is off", test.status === 409, test.data);
const reset = await admin("DELETE", "/api/admin/email-templates/order_confirmed");
ok("reset to default", reset.status === 200 && reset.data.template.customized === false, reset.data);

// ---------------------------------------------------------------- fraud signals
const fraud0 = await admin("GET", "/api/admin/fraud?status=all");
ok("fraud page data", fraud0.status === 200 && fraud0.data.settings.rules.length === 5, fraud0.data);
const product = await admin("POST", "/api/admin/products", {
  name: "Wrangler Fraud QA",
  description: "fraud smoke",
  category: "streaming",
  price: 500,
  active: true,
});
ok("create product", product.status === 200, product.data);
const variantId = product.data.id + "-30";
const imported = await admin("POST", "/api/admin/inventory", {
  variantId,
  items: Array.from({ length: 3 }, (_, i) => ({ loginId: "wr-fraud-" + i + "-" + randomUUID().slice(0, 6) + "@example.invalid", password: "pw-" + i })),
});
ok("import stock", imported.status === 200, imported.data);

const buyer = session();
const buyerEmail = "wr-fraud-" + randomUUID().slice(0, 8) + "@mail.example.com";
const registered = await buyer("POST", "/api/register", { name: "Wrangler Fraud Buyer", email: buyerEmail, password: "Buyer-only-Password-123" });
ok("register buyer", registered.status === 200, registered.data);
for (let i = 0; i < 5; i += 1) {
  const order = await buyer("POST", "/api/orders", { variantId, quantity: 1, requestKey: "wr-fraud-" + randomUUID() });
  const failed = await buyer("POST", `/api/orders/${order.data.id}/pay`, { paymentToken: order.data.paymentToken, outcome: "failure" });
  assert.equal(failed.data?.status, "FAILED", JSON.stringify(failed.data));
}
ok("5 failed payments", true);
const order = await buyer("POST", "/api/orders", { variantId, quantity: 1, requestKey: "wr-fraud-ok-" + randomUUID() });
const paid = await buyer("POST", `/api/orders/${order.data.id}/pay`, { paymentToken: order.data.paymentToken, outcome: "success" });
ok("a paid order still works (paid rules run on the DO)", paid.status === 200 && paid.data.status === "DELIVERED", paid.data);

const fraud1 = await admin("GET", "/api/admin/fraud?status=open");
const signal = fraud1.data.signals?.find((s) => s.rule === "failed_payments");
ok("failed_payments signal for the buyer", signal && signal.customer?.id === registered.data.user.id && signal.value === 5, fraud1.data);
const notices = await admin("GET", "/api/notifications");
ok("admin notification", JSON.stringify(notices.data).includes("สัญญาณผิดปกติ"), notices.data);

const block = await admin("POST", "/api/admin/fraud/blocks", { kind: "EMAIL", value: buyerEmail, hours: 1, reason: "smoke" });
ok("block email", block.status === 201 && block.data.block.active === true, block.data);
const blocked = await session()("POST", "/api/login", { email: buyerEmail, password: "Buyer-only-Password-123" });
ok("blocked email cannot log in", blocked.status === 403, blocked.data);
const lifted = await admin("DELETE", "/api/admin/fraud/blocks/" + block.data.block.id);
ok("lift block", lifted.status === 200 && lifted.data.block.active === false, lifted.data);
const back = await session()("POST", "/api/login", { email: buyerEmail, password: "Buyer-only-Password-123" });
ok("login works again", back.status === 200, back.data);

const reviewed = await admin("POST", `/api/admin/fraud/signals/${signal.id}/review`, { note: "smoke ok" });
ok("review signal", reviewed.status === 200 && reviewed.data.signal.status === "REVIEWED", reviewed.data);
const settings = await admin("POST", "/api/admin/fraud/settings", { rules: { paid_orders: { threshold: 9 } } });
ok(
  "save rule threshold",
  settings.status === 200 && settings.data.settings.rules.find((r) => r.key === "paid_orders").threshold === 9,
  settings.data,
);
const staffTry = await buyer("GET", "/api/admin/fraud");
ok("customers get 403", staffTry.status === 403, staffTry.data);

console.log(`\nwrangler-local fraud + templates smoke: ${passed} checks passed`);
