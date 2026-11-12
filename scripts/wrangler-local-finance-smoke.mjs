/**
 * Finance smoke against `wrangler dev --local` (Durable Object SQLite, not node:sqlite):
 * refunds, credit adjustment, balance invariant, livemode fields, append-only ledger,
 * STAFF 403 on money endpoints.
 *
 * Usage (scratch state, test payments on):
 *   npx wrangler dev --local --port 4391 --persist-to <scratch dir> \
 *     --var ASTRA_ADMIN_PASSWORD:<8+ chars> --var INVENTORY_KEY:<32 hex> --var ASTRA_TEST_PAYMENTS:on
 *   ASTRA_ADMIN_PASSWORD=<same> node scripts/wrangler-local-finance-smoke.mjs http://127.0.0.1:4391
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:4391";
const adminPassword = process.env.ASTRA_ADMIN_PASSWORD;
if (!adminPassword) throw new Error("Set ASTRA_ADMIN_PASSWORD");

function session() {
  const jar = new Map();
  return async function api(method, path, body) {
    const headers = { "X-Astra-Request": "1", Origin: base };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await response.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      // CSV or empty body
    }
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
ok("health is durable sqlite in sandbox mode", health.data.storage === "cloudflare-durable-sqlite" && health.data.mode === "sandbox", health.data);
ok("finance features on", health.data.features.adminRefunds && health.data.features.creditAdjust && health.data.features.livemodeFinance);

const admin = session();
ok("admin login", (await admin("POST", "/api/login", { email: "admin@astra.local", password: adminPassword })).status === 200);
const ready = await admin("POST", "/api/admin/products", {
  name: "Finance QA Ready " + randomUUID().slice(0, 6),
  description: "wrangler finance smoke ready product",
  category: "streaming",
  price: 12000,
  active: true,
  preorder: false,
});
ok("create ready product", ready.status === 200, ready.data);
const readyVariant = ready.data.id + "-30";
const imported = await admin("POST", "/api/admin/inventory", {
  variantId: readyVariant,
  items: [1, 2].map((n) => ({ loginId: `fin-${n}-${randomUUID().slice(0, 8)}@example.invalid`, password: "pw-" + n })),
});
ok("import stock", imported.status === 200, imported.data);
const pre = await admin("POST", "/api/admin/products", {
  name: "Finance QA Preorder " + randomUUID().slice(0, 6),
  description: "wrangler finance smoke preorder product",
  category: "streaming",
  price: 15000,
  active: true,
  preorder: true,
});
ok("create preorder product", pre.status === 200, pre.data);
await admin("POST", "/api/admin/payment-channel", { provider: "sandbox", active: true });
const staffMade = await admin("POST", "/api/admin/team", {
  name: "Finance Staff",
  email: `fin-staff-${randomUUID().slice(0, 8)}@shop.test`,
  role: "STAFF",
});
ok("create staff", staffMade.status === 200, staffMade.data);

const buyer = session();
const reg = await buyer("POST", "/api/register", {
  name: "Finance Buyer",
  email: `fin-buyer-${randomUUID()}@shop.test`,
  password: "Buyer-only-Password-123",
});
ok("register buyer", reg.status === 200, reg.data);
const buyerId = reg.data.user.id;
ok("topup", (await buyer("POST", "/api/topup", { amount: 500, requestKey: key("fin-topup") })).status === 200);
const order = await buyer("POST", "/api/orders", { variantId: readyVariant, quantity: 1, requestKey: key("fin-ready") });
const paid = await buyer("POST", `/api/orders/${order.data.id}/pay`, { paymentToken: order.data.paymentToken, outcome: "success" });
ok("pay ready order", paid.data.status === "DELIVERED", paid.data);
const preOrder = await buyer("POST", "/api/orders", { variantId: pre.data.id + "-30", quantity: 1, requestKey: key("fin-pre") });
const prePaid = await buyer("POST", `/api/orders/${preOrder.data.id}/pay`, { paymentToken: preOrder.data.paymentToken, outcome: "success" });
ok("pay preorder", prePaid.data.status === "PREORDER", prePaid.data);

const detail = await admin("GET", `/api/admin/orders/${order.data.id}`);
ok("admin order detail has payment summary", detail.data.paymentSummary?.paid === order.data.total, detail.data.paymentSummary);
const total = order.data.total;
const partial = { amount: 2000, reasonCode: "ACCOUNT_BROKEN", destination: "CREDIT", requestKey: key("fin-refund-p") };
const r1 = await admin("POST", `/api/admin/orders/${order.data.id}/refund`, partial);
ok("partial refund to credit", r1.status === 200 && r1.data.summary.refundStatus === "PARTIALLY_REFUNDED", r1.data);
const replay = await admin("POST", `/api/admin/orders/${order.data.id}/refund`, partial);
ok("refund replay is idempotent", replay.data.replayed === true && replay.data.summary.refunded === 2000, replay.data);
const over = await admin("POST", `/api/admin/orders/${order.data.id}/refund`, { ...partial, amount: total, requestKey: key("fin-refund-over") });
ok("over-refund refused", over.status === 409, over.data);
const r2 = await admin("POST", `/api/admin/orders/${order.data.id}/refund`, {
  amount: total - 2000,
  reasonCode: "OTHER",
  note: "ลูกค้าซื้อผิด",
  destination: "EXTERNAL",
  externalRef: "KBANK-777",
  requestKey: key("fin-refund-f"),
});
ok("full refund outside the system", r2.status === 200 && r2.data.summary.refundStatus === "REFUNDED", r2.data);
const unitsAfter = await admin("GET", `/api/admin/variants/${readyVariant}/inventory`);
const defects = (unitsAfter.data.items ?? unitsAfter.data.inventory ?? unitsAfter.data.units ?? []).filter((u) => u.defective || u.status === "defective");
ok("sold unit retired (defective) after full refund", defects.length >= 1, unitsAfter.data);
const mine = await buyer("GET", `/api/orders/${order.data.id}`);
ok("customer sees REFUNDED", mine.data.refundStatus === "REFUNDED", mine.data);

const rp = await admin("POST", `/api/admin/orders/${preOrder.data.id}/refund`, {
  amount: preOrder.data.total,
  reasonCode: "CANNOT_DELIVER",
  destination: "CREDIT",
  requestKey: key("fin-refund-pre"),
});
ok("full refund of undelivered preorder", rp.status === 200 && rp.data.summary.refundStatus === "REFUNDED", rp.data);
const queue = await admin("GET", "/api/queue");
ok("preorder left the queue", !queue.data.queue.some((q) => q.id === preOrder.data.id), queue.data);

const balance0 = (await buyer("GET", "/api/me")).data.user.balance;
const neg = await admin("POST", `/api/admin/customers/${buyerId}/credit`, { amount: -(balance0 + 1), reason: "ติดลบ", requestKey: key("fin-adj-neg") });
ok("adjust below zero refused", neg.status === 409, neg.data);
const cap = await admin("POST", `/api/admin/customers/${buyerId}/credit`, { amount: 1_000_001, reason: "เกินเพดาน", requestKey: key("fin-adj-cap") });
ok("adjust over 10,000 THB refused", cap.status === 400, cap.data);
const adj = await admin("POST", `/api/admin/customers/${buyerId}/credit`, { amount: -1500, reason: "แก้ยอดผิด", requestKey: key("fin-adj") });
ok("adjust credit down", adj.status === 200 && adj.data.balance === balance0 - 1500, adj.data);

const me = (await buyer("GET", "/api/me")).data.user.balance;
const ledger = (await buyer("GET", "/api/ledger")).data.entries;
const sum = ledger.reduce((n, e) => n + e.amount, 0);
const customer = await admin("GET", `/api/admin/customers/${buyerId}`);
ok("balance == SUM(ledger net) == admin view == running balance", me === sum && me === customer.data.creditSatang && ledger[0].balanceAfter === me, { me, sum, admin: customer.data.creditSatang, after: ledger[0].balanceAfter });
ok("history types", ["TOPUP", "PURCHASE", "REFUND", "ADJUSTMENT"].every((t) => ledger.some((e) => e.type === t)), ledger.map((e) => e.type));

const summary = await admin("GET", "/api/admin/summary");
ok("summary has refunds, AOV, success rate, sandbox mode", summary.data.mode === "sandbox" && summary.data.refunds >= total && summary.data.paidOrders >= 2 && summary.data.paymentSuccessRate != null, summary.data);
const txns = await admin("GET", `/api/admin/transactions?q=${order.data.id}`);
const payIn = txns.data.transactions.find((t) => t.kind === "PAYMENT_IN");
const td = await admin("GET", `/api/admin/transactions/${payIn.id}`);
ok("transaction detail", td.status === 200 && td.data.order.id === order.data.id && td.data.events.length >= 2, td.data);
const csv = await admin("GET", "/api/admin/transactions?format=csv");
ok("transactions CSV", csv.status === 200 && String(csv.data).startsWith("id,kind,direction"));
const reportCsv = await admin("GET", "/api/admin/reports/sales?format=csv");
ok("report CSV", reportCsv.status === 200 && /text\/csv/.test(reportCsv.headers.get("content-type")));

const staff = session();
const staffLogin = await staff("POST", "/api/login", { email: staffMade.data.member.email, password: staffMade.data.temporaryPassword });
if (staffLogin.status === 200) {
  const codes = [
    (await staff("GET", `/api/admin/transactions/${payIn.id}`)).status,
    (await staff("GET", `/api/admin/orders/${order.data.id}/payment-summary`)).status,
    (await staff("GET", "/api/admin/reports/sales?format=csv")).status,
    (await staff("POST", `/api/admin/orders/${order.data.id}/refund`, { ...partial, requestKey: key("fin-staff") })).status,
    (await staff("POST", `/api/admin/customers/${buyerId}/credit`, { amount: 100, reason: "staff", requestKey: key("fin-staff-adj") })).status,
  ];
  ok("STAFF 403 on every money endpoint", codes.every((c) => c === 403), codes);
} else console.log("SKIP staff 403 — staff login needs a password change first:", staffLogin.status, staffLogin.data);

console.log("\nwrangler local finance smoke:", passed, "passed");
