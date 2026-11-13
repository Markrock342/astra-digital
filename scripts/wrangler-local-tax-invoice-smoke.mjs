/**
 * Receipts in the shop's company name + full tax invoices smoke against `wrangler dev --local`
 * (Durable Object SQLite): schema + append-only triggers on workerd, receipt settings, customer
 * request on a delivered order, admin issue (sequential number), reject, void, documents.
 *
 * Usage (scratch state, test payments on):
 *   npx wrangler dev --local --port 8799 --persist-to <scratch dir> \
 *     --var ASTRA_ADMIN_PASSWORD:<8+ chars> --var INVENTORY_KEY:<32 hex> --var ASTRA_TEST_PAYMENTS:on
 *   ASTRA_ADMIN_PASSWORD=<same> node scripts/wrangler-local-tax-invoice-smoke.mjs http://127.0.0.1:8799
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:8799";
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
      signal: AbortSignal.timeout(20000),
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
      // not JSON
    }
    return { status: response.status, data };
  };
}
let passed = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail ? " — " + JSON.stringify(detail) : ""));
  console.log("PASS", ++passed, name);
};

const health = await session()("GET", "/api/health");
ok("durable sqlite + taxInvoices feature", health.data.storage === "cloudflare-durable-sqlite" && health.data.features.taxInvoices === true, health.data);

const admin = session();
ok("admin login", (await admin("POST", "/api/login", { email: "admin@astra.local", password: adminPassword })).status === 200);
const system = await admin("GET", "/api/admin/health");
const appendOnly = system.data.checks.find((c) => c.id === "append_only");
ok("health: tax invoice triggers present on workerd", appendOnly.ok && /ครบ 18/.test(appendOnly.detail), appendOnly);

ok("VAT without company refused", (await admin("POST", "/api/admin/receipt-settings", { vatRegistered: true })).status === 400);
const settings = await admin("POST", "/api/admin/receipt-settings", {
  legalName: "บริษัท ทดสอบ วรังเลอร์ จำกัด",
  taxId: "0105556123453",
  branch: "HEAD",
  address: "1 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10000",
  vatRegistered: true,
});
ok("save receipt settings", settings.status === 200 && settings.data.mode === "TAX_INVOICE", settings.data);

const product = await admin("POST", "/api/admin/products", {
  name: "Invoice QA " + randomUUID().slice(0, 6),
  description: "wrangler tax invoice smoke",
  category: "streaming",
  price: 10700,
  active: true,
  preorder: false,
});
ok("create product", product.status === 200, product.data);
const variantId = product.data.id + "-30";
const stock = await admin("POST", "/api/admin/inventory", {
  variantId,
  items: [1, 2].map(() => ({ loginId: `inv-${randomUUID().slice(0, 8)}@example.invalid`, password: "pw" })),
});
ok("import stock", stock.status === 200, stock.data);

const buyer = session();
ok(
  "buyer register",
  (await buyer("POST", "/api/register", { name: "Invoice Buyer", email: `inv-${randomUUID().slice(0, 8)}@example.invalid`, password: "Invoice-buyer-Pass-123" })).status === 200,
);
const buy = async () => {
  const order = await buyer("POST", "/api/orders", { variantId, quantity: 1, requestKey: "inv-" + randomUUID() });
  const paid = await buyer("POST", `/api/orders/${order.data.id}/pay`, { paymentToken: order.data.paymentToken, outcome: "success" });
  ok("paid + delivered", paid.data.status === "DELIVERED", paid.data);
  return order.data.id;
};
const first = await buy();
const second = await buy();
const BUYER = { type: "COMPANY", name: "บริษัท ผู้ซื้อ จำกัด", taxId: "0105561000003", branch: "HEAD", address: "1 ถนนพระราม 4 แขวงสีลม เขตบางรัก กรุงเทพฯ 10500" };

const state = await buyer("GET", `/api/orders/${first}/tax-invoice`);
ok("customer state", state.status === 200 && state.data.mode === "TAX_INVOICE" && state.data.eligible, state.data);
ok("bad tax ID refused", (await buyer("POST", `/api/orders/${first}/tax-invoice`, { ...BUYER, taxId: "0105561000004" })).status === 400);
const requested = await buyer("POST", `/api/orders/${first}/tax-invoice`, BUYER);
ok("request sent", requested.status === 200 && requested.data.request.status === "PENDING", requested.data);
ok("buyer cannot issue", (await buyer("POST", `/api/admin/orders/${first}/tax-invoice/issue`, {})).status === 403);
const pending = await admin("GET", "/api/admin/tax-invoices?status=PENDING");
ok("admin sees pending", pending.data.requests.some((r) => r.orderId === first), pending.data);

const issued = await admin("POST", `/api/admin/orders/${first}/tax-invoice/issue`, {});
ok("issue", issued.status === 200 && /^TEST-INV\d{4}-000001$/.test(issued.data.invoice.number), issued.data);
ok("second issue refused", (await admin("POST", `/api/admin/orders/${first}/tax-invoice/issue`, {})).status === 409);
const doc = await buyer("GET", `/api/orders/${first}/tax-invoice/document`);
ok(
  "document VAT split",
  doc.status === 200 && doc.data.invoice.vat === 700 && doc.data.invoice.net === 10000 && doc.data.invoice.total === 10700,
  doc.data,
);

await buyer("POST", `/api/orders/${second}/tax-invoice`, BUYER);
ok("reject", (await admin("POST", `/api/admin/orders/${second}/tax-invoice/reject`, { reason: "ข้อมูลไม่ครบ" })).data.request.status === "REJECTED");
const direct = await admin("POST", `/api/admin/orders/${second}/tax-invoice/issue`, { buyer: { ...BUYER, branch: "3" } });
ok("admin issues directly, next number", /-000002$/.test(direct.data.invoice?.number ?? ""), direct.data);

const voided = await admin("POST", `/api/admin/tax-invoices/${issued.data.invoice.id}/void`, { reason: "ทดสอบยกเลิก" });
ok("void", voided.status === 200 && voided.data.request.status === "VOIDED", voided.data);
const reissued = await admin("POST", `/api/admin/orders/${first}/tax-invoice/issue`, {});
ok("reissue after void gets a new number", /-000003$/.test(reissued.data.invoice?.number ?? ""), reissued.data);
const list = await admin("GET", "/api/admin/tax-invoices?status=ISSUED");
ok("issued list keeps the voided one", list.data.invoices.length >= 3 && list.data.invoices.some((i) => i.voided), list.data);
const receipt = await buyer("GET", `/api/orders/${first}/receipt`);
ok("receipt links the active invoice", receipt.data.receipt.taxInvoice?.number === reissued.data.invoice.number, receipt.data);

console.log("\nwrangler local tax invoice smoke:", passed, "passed");
