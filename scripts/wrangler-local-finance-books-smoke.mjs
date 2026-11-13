/**
 * การเงิน › ปิดยอดรายวัน / ถอนเงิน / กระทบยอด smoke against `wrangler dev --local`
 * (Durable Object SQLite): schema + append-only triggers on workerd, withdrawal with proof
 * and reversal, daily close + changed-after-close + adjustment, CSV reconciliation with
 * manual match / complete, CSV escaping, STAFF 403.
 *
 * Usage (scratch state, test payments on):
 *   npx wrangler dev --local --port 4393 --persist-to <scratch dir> \
 *     --var ASTRA_ADMIN_PASSWORD:<8+ chars> --var INVENTORY_KEY:<32 hex> --var ASTRA_TEST_PAYMENTS:on
 *   ASTRA_ADMIN_PASSWORD=<same> node scripts/wrangler-local-finance-books-smoke.mjs http://127.0.0.1:4393
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:4393";
const adminPassword = process.env.ASTRA_ADMIN_PASSWORD;
if (!adminPassword) throw new Error("Set ASTRA_ADMIN_PASSWORD");

function session() {
  const jar = new Map();
  return async function api(method, path, body, raw) {
    const headers = { "X-Astra-Request": "1", Origin: base };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (raw) headers["Content-Type"] = raw;
    else if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
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
      // CSV or bytes
    }
    return { status: response.status, data, headers: response.headers };
  };
}

let passed = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail ? " — " + JSON.stringify(detail) : ""));
  console.log("PASS", ++passed, name);
};
const bangkokDay = (offset = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(Date.now() - offset * 86400000));
const today = bangkokDay(0);
const yesterday = bangkokDay(1);

const health = await session()("GET", "/api/health");
ok("durable sqlite, sandbox, financeClose feature", health.data.storage === "cloudflare-durable-sqlite" && health.data.features.financeClose, health.data);

const admin = session();
ok("admin login", (await admin("POST", "/api/login", { email: "admin@astra.local", password: adminPassword })).status === 200);
const system = await admin("GET", "/api/admin/health");
const appendOnly = system.data.checks.find((c) => c.id === "append_only");
ok("health: all append-only triggers present on workerd", appendOnly.ok && /ครบ 18/.test(appendOnly.detail), appendOnly);

// A paid order today (sandbox payment) for reconciliation.
const product = await admin("POST", "/api/admin/products", {
  name: "Books QA " + randomUUID().slice(0, 6),
  description: "wrangler finance books smoke",
  category: "streaming",
  price: 12345,
  active: true,
  preorder: false,
});
ok("create product", product.status === 200, product.data);
const variantId = product.data.id + "-30";
ok("import stock", (await admin("POST", "/api/admin/inventory", { variantId, items: [{ loginId: `books-${randomUUID().slice(0, 8)}@example.invalid`, password: "pw" }] })).status === 200);
const buyer = session();
ok(
  "buyer register",
  (await buyer("POST", "/api/register", { name: "Books Buyer", email: `books-${randomUUID().slice(0, 8)}@example.invalid`, password: "Books-buyer-Pass-123" })).status === 200,
);
const order = await buyer("POST", "/api/orders", { variantId, quantity: 1, requestKey: "books-" + randomUUID() });
ok("create order", !!order.data.id && !!order.data.paymentToken, order.data);
const paid = await buyer("POST", `/api/orders/${order.data.id}/pay`, { paymentToken: order.data.paymentToken, outcome: "success" });
ok("pay order", paid.data.status === "DELIVERED", paid.data);

// STAFF 403 on every new endpoint.
const staff = session();
const staffEmail = `books-staff-${randomUUID().slice(0, 8)}@example.invalid`;
const staffReg = await staff("POST", "/api/register", { name: "Books Staff", email: staffEmail, password: "Books-staff-Pass-123" });
for (const path of ["/api/admin/finance/days", "/api/admin/finance/withdrawals", "/api/admin/finance/reconciliations"]) {
  const r = await staff("GET", path);
  ok("non-admin refused " + path, r.status === 403, r.status);
}

// Withdrawal with proof, then reversal.
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const proof = await admin("POST", "/api/admin/finance/withdrawals/proof", png, "image/png");
ok("proof upload", proof.status === 200 && /^proof-/.test(proof.data.proofKey), proof.data);
ok("proof never public", (await session()("GET", "/api/files/" + proof.data.proofKey)).status === 404);
const wd = await admin("POST", "/api/admin/finance/withdrawals", {
  amount: 50000,
  day: yesterday,
  bank: "กสิกรไทย",
  account: "123-4-56789-0",
  reference: "=cmd|calc",
  proofKey: proof.data.proofKey,
  requestKey: "wd-" + randomUUID(),
  currentPassword: adminPassword,
});
ok("record withdrawal", wd.status === 200 && wd.data.withdrawal.account === "••••7890", wd.data);
ok("wrong password refused", (await admin("POST", "/api/admin/finance/withdrawals", { amount: 1, day: today, bank: "SCB", account: "1234", requestKey: "wd-" + randomUUID(), currentPassword: "nope-nope" })).status === 403);
const proofGet = await admin("GET", `/api/admin/finance/withdrawals/${wd.data.withdrawal.id}/proof`);
ok("admin reads proof", proofGet.status === 200 && proofGet.headers.get("content-type") === "image/png");
const wcsv = await admin("GET", "/api/admin/finance/withdrawals?format=csv");
ok("withdrawal CSV escaped", wcsv.status === 200 && wcsv.data.includes("\"'=cmd|calc\"") && !/(^|,)=cmd/m.test(wcsv.data));

// Daily close of yesterday, then the reversal changes it → adjustment.
const close = await admin("POST", "/api/admin/finance/days/close", { day: yesterday, note: "smoke", currentPassword: adminPassword });
ok("close yesterday", close.status === 200 && close.data.closed.at(-1).day === yesterday, close.data);
ok("close today refused", (await admin("POST", "/api/admin/finance/days/close", { day: today, currentPassword: adminPassword })).status === 409);
const rev = await admin("POST", `/api/admin/finance/withdrawals/${wd.data.withdrawal.id}/reverse`, { reason: "บันทึกซ้ำ", currentPassword: adminPassword });
ok("reverse withdrawal", rev.status === 200 && rev.data.closedDay === true, rev.data);
let days = await admin("GET", `/api/admin/finance/days?from=${yesterday}&to=${today}`);
let y = days.data.days.find((d) => d.day === yesterday);
ok("changed after close", y.status === "CHANGED" && y.diff === 50000 && days.data.summary.changedDays.includes(yesterday), y);
const adj = await admin("POST", "/api/admin/finance/days/adjust", { day: yesterday, note: "ยกเลิกการถอนซ้ำ", currentPassword: adminPassword });
ok("adjust closed day", adj.status === 200 && adj.data.delta === 50000, adj.data);
days = await admin("GET", `/api/admin/finance/days?from=${yesterday}&to=${today}`);
y = days.data.days.find((d) => d.day === yesterday);
const t = days.data.days.find((d) => d.day === today);
ok("closed again; today opens from it", y.status === "CLOSED" && t.opening === y.closing && t.paymentsIn >= 12345, { y, t });
const dcsv = await admin("GET", `/api/admin/finance/days?from=${yesterday}&to=${today}&format=csv`);
ok("daily close CSV", dcsv.status === 200 && dcsv.data.startsWith("day,status,opening"));

// Reconciliation: one auto match by provider ref, one manual match, complete.
const payments = await admin("GET", "/api/admin/transactions?kind=PAYMENT_IN&limit=5");
const ref = payments.data.transactions.find((x) => x.order_id === order.data.id)?.provider_ref;
ok("payment ref found", !!ref, payments.data.transactions);
const csv = ["Date,Amount,Reference", `${today},123.45,${ref}`, `${today},77.00,=HYPERLINK("x")`].join("\n");
const preview = await admin("POST", "/api/admin/finance/reconciliations/preview", { csv });
ok("preview + guess", preview.status === 200 && preview.data.guess.date === 0 && preview.data.guess.amount === 1, preview.data);
const runRes = await admin("POST", "/api/admin/finance/reconciliations", { filename: "smoke.csv", csv, mapping: { date: 0, amount: 1, reference: 2 } });
ok("run created, auto match", runRes.status === 200 && runRes.data.run.counts.MATCHED.count === 1 && runRes.data.run.counts.STATEMENT_ONLY.count === 1, runRes.data.run);
const runId = runRes.data.run.id;
const unmatched = runRes.data.rows.find((r) => r.status === "STATEMENT_ONLY");
const matchedRow = runRes.data.rows.find((r) => r.status === "MATCHED");
ok("unmatch with note", (await admin("POST", `/api/admin/finance/reconciliations/${runId}/unmatch`, { rowId: matchedRow.id, note: "ตรวจใหม่" })).status === 200);
const manual = await admin("POST", `/api/admin/finance/reconciliations/${runId}/match`, { rowId: unmatched.id, paymentId: order.data.id, note: "จับคู่เอง" });
ok("manual match by order id", manual.status === 200, manual.data);
const detail = await admin("GET", `/api/admin/finance/reconciliations/${runId}`);
ok("mismatch shown", detail.data.run.counts.MISMATCH.count === 1, detail.data.run.counts);
ok("complete", (await admin("POST", `/api/admin/finance/reconciliations/${runId}/complete`, {})).status === 200);
ok("no edits after complete", (await admin("POST", `/api/admin/finance/reconciliations/${runId}/unmatch`, { rowId: unmatched.id, note: "หลังปิด" })).status === 409);
const rcsv = await admin("GET", `/api/admin/finance/reconciliations/${runId}?format=csv`);
ok("recon CSV escaped", rcsv.status === 200 && rcsv.data.includes("\"'=HYPERLINK") && !/(^|,)=HYPERLINK/m.test(rcsv.data));
const after = await buyer("GET", "/api/orders/" + order.data.id);
ok("order untouched by reconciliation", after.data.status === "DELIVERED", after.data.status);
console.log("finance books smoke: " + passed + " checks passed");
