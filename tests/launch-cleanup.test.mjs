// Launch cleanup API (server/launch-cleanup.mjs): dryRun counts, execute wipe of
// CUSTOMER commerce in sandbox, keep catalog/admin/audit, refuse live + bad password.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { LAUNCH_CLEANUP_AUDIT } from "../server/launch-cleanup.mjs";

const ADMIN_PASSWORD = "launch-admin-" + randomBytes(6).toString("hex");
const BUYER_PASSWORD = "Launch-buyer-Password-123";

function fixture(t, options = {}) {
  const s = createCommerce({ adminPassword: ADMIN_PASSWORD, allowSandbox: true, ...options });
  t.after(() => s.db.close());
  s.db.prepare("UPDATE products SET hidden_seed=0").run();
  const admin = s.session(s.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token);
  const buyerAuth = s.register({
    name: "Launch Buyer",
    email: "launch-buyer@example.invalid",
    password: BUYER_PASSWORD,
  });
  const buyer = s.session(buyerAuth.token);
  const staffAuth = s.register({
    name: "Launch Staff",
    email: "launch-staff@example.invalid",
    password: "Staff-only-Password-123",
  });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  return { s, admin, buyer, staff: s.session(staffAuth.token) };
}

const status = (fn) => {
  try {
    fn();
    return 200;
  } catch (error) {
    return error.status ?? 500;
  }
};
const count = (s, sql, ...params) => s.db.prepare(sql).get(...params).n;

test("dryRun defaults and changes nothing; wrong password / live mode refuse", (t) => {
  const { s, admin, buyer } = fixture(t);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const order = s.createOrder(buyer, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "launch-dry-" + Date.now(),
  });
  s.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  assert.equal(status(() => s.adminLaunchCleanup(admin, {})), 403); // missing password
  assert.equal(
    status(() => s.adminLaunchCleanup(admin, { currentPassword: "wrong-password-xx" })),
    403,
  );

  const beforeCustomers = count(s, "SELECT COUNT(*) AS n FROM users WHERE role='CUSTOMER'");
  const beforeOrders = count(s, "SELECT COUNT(*) AS n FROM orders");
  const beforeAudit = count(s, "SELECT COUNT(*) AS n FROM audit");
  const dry = s.adminLaunchCleanup(admin, { currentPassword: ADMIN_PASSWORD });
  assert.equal(dry.dryRun, true);
  assert.ok(dry.remove.customers >= 1);
  assert.ok(dry.remove.orders >= 1);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM users WHERE role='CUSTOMER'"), beforeCustomers);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM orders"), beforeOrders);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM audit"), beforeAudit, "dryRun must not write audit");

  const live = createCommerce({ adminPassword: ADMIN_PASSWORD, allowSandbox: false });
  t.after(() => live.db.close());
  const liveAdmin = live.session(live.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token);
  assert.equal(
    status(() => live.adminLaunchCleanup(liveAdmin, { currentPassword: ADMIN_PASSWORD, dryRun: false })),
    403,
  );
});

test("execute removes customers and test commerce; keeps catalog, staff, unsold stock, audit + LAUNCH_CLEANUP", (t) => {
  const { s, admin, buyer } = fixture(t);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const productsBefore = count(s, "SELECT COUNT(*) AS n FROM products WHERE hidden_seed=0");
  const order = s.createOrder(buyer, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "launch-run-" + Date.now(),
  });
  s.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  assert.ok(
    count(s, "SELECT COUNT(*) AS n FROM inventory WHERE order_id=?", order.id) >= 1,
    "sold unit linked",
  );
  const unsoldAfterSale = count(
    s,
    `SELECT COUNT(*) AS n FROM inventory WHERE order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0`,
  );

  const dry = s.adminLaunchCleanup(admin, { currentPassword: ADMIN_PASSWORD, dryRun: true });
  const done = s.adminLaunchCleanup(admin, { currentPassword: ADMIN_PASSWORD, dryRun: false });
  assert.equal(done.dryRun, false);
  assert.equal(done.remove.customers, dry.remove.customers);
  assert.equal(done.remove.orders, dry.remove.orders);

  assert.equal(count(s, "SELECT COUNT(*) AS n FROM users WHERE role='CUSTOMER'"), 0);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM orders WHERE user_id=?", buyer.id), 0);
  assert.ok(count(s, "SELECT COUNT(*) AS n FROM users WHERE role IN ('ADMIN','STAFF')") >= 2);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM products WHERE hidden_seed=0"), productsBefore);
  // Sold units for wiped orders are gone; unsold pool is unchanged.
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM inventory WHERE order_id=?", order.id), 0);
  assert.equal(
    count(
      s,
      `SELECT COUNT(*) AS n FROM inventory WHERE order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0`,
    ),
    unsoldAfterSale,
  );

  const audit = s.db
    .prepare("SELECT detail FROM audit WHERE action=? ORDER BY rowid DESC LIMIT 1")
    .get(LAUNCH_CLEANUP_AUDIT);
  assert.ok(audit);
  assert.equal(JSON.parse(audit.detail).removed.customers, dry.remove.customers);

  // Append-only triggers still present (health invariant).
  const triggers = s.db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger'")
    .all()
    .map((r) => r.name);
  for (const name of [
    "ledger_append_only_delete",
    "audit_append_only_delete",
    "tax_invoices_append_only_delete",
  ])
    assert.ok(triggers.includes(name), name);

  const health = s.adminSystemHealth(admin);
  assert.equal(health.ok, true, "admin health must stay green after cleanup");
});

test("HTTP: STAFF 403; ADMIN dryRun 200", async (t) => {
  const { s, admin } = fixture(t);
  const handle = createAPIHandler(s);
  const adminToken = s.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token;
  const staffToken = s.login({ email: "launch-staff@example.invalid", password: "Staff-only-Password-123" }).token;
  const call = async (token, body) => {
    const res = await handle(
      new Request("http://127.0.0.1/api/admin/launch/cleanup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Astra-Request": "1",
          Cookie: "astra_session=" + token,
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await call(staffToken, { currentPassword: ADMIN_PASSWORD })).status, 403);
  const dry = await call(adminToken, { currentPassword: ADMIN_PASSWORD });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dryRun, true);
});

test("held preorder units go back to stock; email verification rows are removed", (t) => {
  const { s, admin, buyer } = fixture(t);
  const product = s.saveProduct(admin, {
    name: "Launch Free Preorder",
    description: "จองฟรีก่อนล้างข้อมูล",
    category: "streaming",
    price: 5000,
    active: true,
    preorder: true,
    firstLabel: "1 เดือน",
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  s.adminSavePreorderSettings(admin, product.id, { mode: "free", payWindowHours: 24, lapsePolicy: "keep" });
  s.createOrder(buyer, { variantId, quantity: 1, requestKey: randomUUID() });
  s.importCodes(admin, { variantId, items: [{ loginId: "held-unit@launch.test", password: "pw" }] });
  // The free reservation is called and holds the unit.
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND reservation_id IS NOT NULL AND sold_at IS NULL", variantId), 1);
  s.db.prepare("INSERT INTO email_verifications(token_hash,user_id,email,expires_at,created_at,kind) VALUES(?,?,?,?,?,?)")
    .run("launch-test-token", buyer.id, "launch-buyer@example.invalid", Date.now() + 3600000, Date.now(), "signup");
  const dry = s.adminLaunchCleanup(admin, { currentPassword: ADMIN_PASSWORD });
  s.adminLaunchCleanup(admin, { currentPassword: ADMIN_PASSWORD, dryRun: false });
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND reservation_id IS NULL AND order_id IS NULL", variantId), 1, "unit back in stock");
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM email_verifications"), 0);
  assert.ok(dry);
});
