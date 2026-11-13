import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { TRACK_A_MIGRATION_FILES } from "../server/migrate-005.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  const staffAuth = s.register({
    name: "Health Staff",
    email: "health-staff@example.invalid",
    password: "Staff-only-Password-123",
  });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  return { s, admin, staff, adminToken: adminAuth.token, staffToken: staffAuth.token };
}

test("admin health passes on fresh shop; STAFF 403", async (t) => {
  const { s, admin, staff, adminToken, staffToken } = fixture(t);
  assert.throws(() => s.adminSystemHealth(staff), (e) => e.status === 403);
  const report = s.adminSystemHealth(admin);
  assert.equal(report.ok, true);
  assert.deepEqual(report.migrations.missing, []);
  assert.equal(report.migrations.expected.length, TRACK_A_MIGRATION_FILES.length);
  assert.ok(report.checks.every((c) => c.ok));

  const handle = createAPIHandler(s);
  const forbidden = await handle(
    new Request("http://127.0.0.1/api/admin/health", {
      headers: { Cookie: "astra_session=" + staffToken, "X-Astra-Request": "1" },
    }),
  );
  assert.equal(forbidden.status, 403);
  const ok = await handle(
    new Request("http://127.0.0.1/api/admin/health", {
      headers: { Cookie: "astra_session=" + adminToken, "X-Astra-Request": "1" },
    }),
  );
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
});

test("health flags stuck inventory on pending order", (t) => {
  const { s, admin } = fixture(t);
  const buyer = s.session(
    s.register({
      name: "Health Buyer",
      email: "health-buyer@example.invalid",
      password: "Buyer-only-Password-123",
    }).token,
  );
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  s.importCodes(admin, {
    variantId: "stream-plus-30",
    items: [{ loginId: "stuck@ex.invalid", password: "pw" }],
  });
  const order = s.createOrder(buyer, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "health-stuck-001",
  });
  // Force a stuck allocation the normal pay path would never leave behind.
  const unit = s.db
    .prepare("SELECT id FROM inventory WHERE variant_id=? AND order_id IS NULL LIMIT 1")
    .get("stream-plus-30");
  s.db.prepare("UPDATE inventory SET order_id=? WHERE id=?").run(order.id, unit.id);

  const report = s.adminSystemHealth(admin);
  assert.equal(report.ok, false);
  const stuck = report.checks.find((c) => c.id === "stuck_stock");
  assert.equal(stuck.ok, false);
});
