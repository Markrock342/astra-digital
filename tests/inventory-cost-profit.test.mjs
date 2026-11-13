import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createCommerceCore } from "../server/domain.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { applyMigration009, MIGRATION_009_NAME } from "../server/migrate-009.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const buyerAuth = s.register({
    name: "Cost Buyer",
    email: "cost-buyer@example.invalid",
    password: "Buyer-only-Password-123",
  });
  const user = s.session(buyerAuth.token);
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  const staffAuth = s.register({
    name: "Cost Staff",
    email: "cost-staff@example.invalid",
    password: "Staff-only-Password-123",
  });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  const product = s.saveProduct(admin, {
    name: "Cost Item",
    description: "ทดสอบต้นทุน",
    category: "streaming",
    price: 10000,
    active: true,
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  return { s, user, admin, staff, product, variantId, adminToken: adminAuth.token, staffToken: staffAuth.token };
}

const call = async (s, method, path, token) => {
  const handle = createAPIHandler(s);
  const response = await handle(
    new Request("http://127.0.0.1" + path, {
      method,
      headers: {
        Cookie: "astra_session=" + token,
        "Content-Type": "application/json",
        "X-Astra-Request": "1",
      },
    }),
  );
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data };
};

test("MIG-009 adds inventory.cost idempotently", (t) => {
  const { s } = fixture(t);
  const cols = () =>
    s.db.prepare("PRAGMA table_info(inventory)").all().map((c) => c.name);
  assert.ok(cols().includes("cost"));
  assert.ok(
    s.db.prepare("SELECT name FROM schema_migrations WHERE name=?").get(MIGRATION_009_NAME),
  );
  assert.equal(applyMigration009(s.db).skipped, true);
  assert.ok(cols().includes("cost"));
});

test("import stores optional cost for pairs and codes; omit stays null", (t) => {
  const { s, admin, variantId } = fixture(t);
  s.importCodes(admin, {
    variantId,
    items: [
      { loginId: "with-cost@ex.invalid", password: "pw1", cost: 2500 },
      { loginId: "no-cost@ex.invalid", password: "pw2" },
    ],
  });
  s.importCodes(admin, {
    variantId,
    codes: "GIFTCOST0001,900\nGIFTCOST0002",
  });
  const rows = s.db
    .prepare(
      `SELECT login_key, cost FROM inventory WHERE variant_id=? ORDER BY rowid`,
    )
    .all(variantId);
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((r) => r.cost === 2500).length, 1);
  assert.equal(rows.filter((r) => r.cost === 900).length, 1);
  assert.equal(rows.filter((r) => r.cost == null).length, 2);
  const bad = s.importCodes(admin, {
    variantId,
    dryRun: true,
    items: [{ loginId: "bad2@ex.invalid", password: "pw", cost: -1 }],
  });
  assert.equal(bad.lines[0].status, "invalid");
  assert.match(bad.lines[0].reason, /ต้นทุน/);
});

test("profit report = revenue - refunds - cost; STAFF 403; live excludes sandbox", async (t) => {
  const { s, user, admin, staff, variantId, adminToken, staffToken } = fixture(t);
  s.importCodes(admin, {
    variantId,
    items: [
      { loginId: "sold-a@ex.invalid", password: "pw", cost: 3000 },
      { loginId: "sold-b@ex.invalid", password: "pw", cost: 2000 },
    ],
  });
  const order = s.createOrder(user, {
    variantId,
    quantity: 1,
    requestKey: "cost-profit-001",
  });
  const paid = s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.throws(() => s.profitReport(staff), (e) => e.status === 403);
  assert.equal((await call(s, "GET", "/api/admin/reports/profit", staffToken)).status, 403);

  const report = s.profitReport(admin);
  assert.equal(report.totals.revenue, paid.total);
  assert.equal(report.totals.cost, 3000);
  assert.equal(report.totals.refunds, 0);
  assert.equal(report.totals.profit, paid.total - 3000);
  assert.ok(report.byProduct.some((r) => r.variant_id === variantId && r.cost === 3000));

  const http = await call(s, "GET", "/api/admin/reports/profit", adminToken);
  assert.equal(http.status, 200);
  assert.equal(http.data.totals.profit, paid.total - 3000);

  const csv = s.profitReport(admin, { format: "csv" });
  assert.match(csv.csv, /กำไร/);

  s.db.prepare("INSERT OR IGNORE INTO runtime_flags(key,value) VALUES('template-ready','1')").run();
  const live = createCommerceCore({ db: s.db, allowSandbox: false, seed: false });
  const liveAdmin = live.session(s.demoMerchant().token);
  const liveReport = live.profitReport(liveAdmin);
  assert.equal(liveReport.totals.revenue, 0);
  assert.equal(liveReport.totals.cost, 0);
  assert.equal(liveReport.totals.profit, 0);
});

test("CSV pairs: a numeric or date-like password is never read as cost or expiry", (t) => {
  const { s, admin, variantId } = fixture(t);
  const preview = s.importCodes(admin, {
    variantId,
    dryRun: true,
    csv: "num-pw@ex.invalid,123456\ndate-pw@ex.invalid,2026-12-31\nwith-cost@ex.invalid,pw9,2500\nboth@ex.invalid,778899,1500,2027-01-31",
  });
  assert.deepEqual(
    preview.lines.map((l) => l.status),
    ["ok", "ok", "ok", "ok"],
    JSON.stringify(preview.lines),
  );
  s.importCodes(admin, {
    variantId,
    csv: "num-pw@ex.invalid,123456\ndate-pw@ex.invalid,2026-12-31\nwith-cost@ex.invalid,pw9,2500\nboth@ex.invalid,778899,1500,2027-01-31",
  });
  const rows = s.db
    .prepare("SELECT cost, expires_at FROM inventory WHERE variant_id=? ORDER BY rowid")
    .all(variantId);
  assert.deepEqual(
    rows.map((r) => [r.cost, r.expires_at == null ? null : String(r.expires_at).slice(0, 10)]),
    [
      [null, null],
      [null, null],
      [2500, null],
      [1500, "2027-01-31"],
    ],
  );
});
