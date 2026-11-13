// Stock detail per option: counts per status, reveal (ADMIN, audited), edit unsold units.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { randomUUID } from "node:crypto";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const staffAuth = s.register({ name: "Stock Staff", email: "stock-staff@example.invalid", password: "Staff-only-Password-123" });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const buyerAuth = s.register({ name: "Stock Buyer", email: "stock-buyer@example.invalid", password: "Buyer-only-Password-123" });
  const product = s.saveProduct(admin, { name: "Stock Detail", description: "ทดสอบสต็อก", category: "streaming", price: 9900, active: true, firstLabel: "1 เดือน" });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  s.importCodes(admin, {
    variantId,
    items: [
      { loginId: "a@stock.test", password: "pw-a" },
      { loginId: "b@stock.test", password: "pw-b", cost: "45.50" },
      { loginId: "c@stock.test", password: "pw-c" },
    ],
  });
  return { s, admin, staff: s.session(staffAuth.token), buyer: s.session(buyerAuth.token), variantId, adminToken: adminAuth.token, staffToken: staffAuth.token };
}
const units = (s, admin, variantId, status = "available") => s.adminVariantInventory(admin, variantId, { status }).inventory;

test("first page carries the option and counts per status", (t) => {
  const { s, admin, buyer, variantId } = fixture(t);
  const order = s.createOrder(buyer, { variantId, quantity: 1, requestKey: randomUUID() });
  s.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  const [first] = units(s, admin, variantId);
  s.markInventoryDefect(admin, first.id, { reason: "เข้าไม่ได้" });
  const page = s.adminVariantInventory(admin, variantId, { status: "available" });
  assert.deepEqual(page.counts, { total: 3, available: 1, expiring: 0, expired: 0, sold: 1, defective: 1 });
  assert.equal(page.variant.product, "Stock Detail");
  assert.equal(page.variant.label, "1 เดือน");
  assert.equal(page.variant.sellable, 1);
});

test("reveal: ADMIN only, audited, full values", async (t) => {
  const { s, admin, staff, variantId, staffToken, adminToken } = fixture(t);
  const unit = units(s, admin, variantId).find((u) => u.loginIdMasked);
  assert.ok(!unit.loginIdMasked.includes("@stock.test") || unit.loginIdMasked.includes("•"));
  assert.throws(() => s.revealInventoryUnit(staff, unit.id), (e) => e.status === 403);
  const shown = s.revealInventoryUnit(admin, unit.id);
  assert.match(shown.loginId, /@stock\.test$/);
  assert.match(shown.password, /^pw-/);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='INVENTORY_REVEAL' AND entity_id=?").get(unit.id).n, 1);
  const handle = createAPIHandler(s);
  const call = (token) =>
    handle(
      new Request("http://127.0.0.1/api/admin/inventory/" + unit.id + "/reveal", {
        method: "POST",
        headers: { Cookie: "astra_session=" + token, "Content-Type": "application/json", "X-Astra-Request": "1" },
        body: "{}",
      }),
    );
  assert.equal((await call(staffToken)).status, 403);
  assert.equal((await call(adminToken)).status, 200);
});

test("edit: ID / password / expiry / cost on an unsold unit; duplicates refused; secrets not in audit", async (t) => {
  const { s, admin, variantId, adminToken } = fixture(t);
  const list = units(s, admin, variantId);
  const target = list[0];
  const other = s.revealInventoryUnit(admin, list[1].id);
  assert.throws(() => s.updateInventoryUnit(admin, target.id, { loginId: other.loginId.toUpperCase() }), /มีในระบบแล้ว/);
  const res = s.updateInventoryUnit(admin, target.id, { loginId: "new@stock.test", password: "pw-new", expiresAt: "2030-01-31", cost: "12.25" });
  assert.deepEqual(res.changed.sort(), ["cost", "expiresAt", "loginId", "password"]);
  assert.equal(res.cost, 1225);
  assert.equal(res.expires_at, "2030-01-31 23:59:59");
  const shown = s.revealInventoryUnit(admin, target.id);
  assert.equal(shown.loginId, "new@stock.test");
  assert.equal(shown.password, "pw-new");
  // Re-import of the new ID is now a duplicate; the old one is free again.
  const dry = s.importCodes(admin, { variantId, dryRun: true, items: [{ loginId: "new@stock.test", password: "x" }] });
  assert.equal(dry.lines[0].status, "existing");
  const detail = s.db.prepare("SELECT detail FROM audit WHERE action='INVENTORY_EDIT' AND entity_id=?").get(target.id).detail;
  assert.ok(!detail.includes("new@stock.test") && !detail.includes("pw-new"));
  // Clearing expiry and cost.
  assert.deepEqual(s.updateInventoryUnit(admin, target.id, { expiresAt: "", cost: "" }).changed.sort(), ["cost", "expiresAt"]);
  // No change → no audit row.
  const before = s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='INVENTORY_EDIT'").get().n;
  assert.deepEqual(s.updateInventoryUnit(admin, target.id, { loginId: "new@stock.test" }).changed, []);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='INVENTORY_EDIT'").get().n, before);
  assert.throws(() => s.updateInventoryUnit(admin, target.id, { cost: "1.234" }), (e) => e.status === 400);
  assert.throws(() => s.updateInventoryUnit(admin, target.id, { expiresAt: "31/01/2030" }), (e) => e.status === 400);
  const handle = createAPIHandler(s);
  const r = await handle(
    new Request("http://127.0.0.1/api/admin/inventory/" + target.id, {
      method: "PATCH",
      headers: { Cookie: "astra_session=" + adminToken, "Content-Type": "application/json", "X-Astra-Request": "1" },
      body: JSON.stringify({ cost: "9" }),
    }),
  );
  assert.equal(r.status, 200);
});

test("edit: sold, defective and staff are refused", (t) => {
  const { s, admin, staff, buyer, variantId } = fixture(t);
  const order = s.createOrder(buyer, { variantId, quantity: 1, requestKey: randomUUID() });
  s.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  const sold = units(s, admin, variantId, "sold")[0];
  assert.throws(() => s.updateInventoryUnit(admin, sold.id, { cost: "1" }), (e) => e.status === 409);
  const free = units(s, admin, variantId)[0];
  assert.throws(() => s.updateInventoryUnit(staff, free.id, { cost: "1" }), (e) => e.status === 403);
  s.markInventoryDefect(admin, free.id, { reason: "เสีย" });
  assert.throws(() => s.updateInventoryUnit(admin, free.id, { cost: "1" }), (e) => e.status === 409);
});
