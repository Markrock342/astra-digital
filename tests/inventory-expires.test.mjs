import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { applyMigration010, MIGRATION_010_NAME } from "../server/migrate-010.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const buyerAuth = s.register({
    name: "Expiry Buyer",
    email: "expiry-buyer@example.invalid",
    password: "Buyer-only-Password-123",
  });
  const user = s.session(buyerAuth.token);
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  const product = s.saveProduct(admin, {
    name: "Expiry Item",
    description: "ทดสอบวันหมดอายุ",
    category: "streaming",
    price: 10000,
    active: true,
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  s.updateVariant(admin, variantId, { warranty_days: 30 });
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  return { s, user, admin, product, variantId };
}

function daysFromNow(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

test("MIG-010 adds inventory.expires_at idempotently", (t) => {
  const { s } = fixture(t);
  const cols = s.db.prepare("PRAGMA table_info(inventory)").all().map((c) => c.name);
  assert.ok(cols.includes("expires_at"));
  assert.ok(
    s.db.prepare("SELECT name FROM schema_migrations WHERE name=?").get(MIGRATION_010_NAME),
  );
  assert.equal(applyMigration010(s.db).skipped, true);
});

test("import stores expires_at; units inside warranty window are not sold", (t) => {
  const { s, user, admin, product, variantId } = fixture(t);
  const soon = daysFromNow(10); // within 30-day warranty → unsellable
  const later = daysFromNow(60); // beyond warranty → sellable
  s.importCodes(admin, {
    variantId,
    items: [
      { loginId: "soon@ex.invalid", password: "pw", expiresAt: soon },
      { loginId: "later@ex.invalid", password: "pw", expiresAt: later },
    ],
  });
  const variants = s.adminProductVariants(admin, product.id).variants;
  assert.equal(variants[0].stock, 1);

  const order = s.createOrder(user, {
    variantId,
    quantity: 1,
    requestKey: "expiry-pay-001",
  });
  const paid = s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.equal(paid.status, "DELIVERED");
  assert.equal(paid.credentials[0].loginId, "later@ex.invalid");

  const leftover = s.db
    .prepare(
      `SELECT expires_at FROM inventory WHERE variant_id=? AND order_id IS NULL`,
    )
    .all(variantId);
  assert.equal(leftover.length, 1);
  assert.ok(String(leftover[0].expires_at).startsWith(soon));
});

test("expired / expiring lists + admin notify on import", (t) => {
  const { s, admin, variantId } = fixture(t);
  const expired = daysFromNow(-2);
  const expiring = daysFromNow(3);
  s.importCodes(admin, {
    variantId,
    items: [
      { loginId: "expired@ex.invalid", password: "pw", expiresAt: expired },
      { loginId: "expiring@ex.invalid", password: "pw", expiresAt: expiring },
    ],
  });
  assert.equal(
    s.adminVariantInventory(admin, variantId, { status: "expired" }).inventory.length,
    1,
  );
  assert.equal(
    s.adminVariantInventory(admin, variantId, { status: "expiring" }).inventory.length,
    1,
  );
  const list = s.adminExpiringInventory(admin);
  assert.ok(list.inventory.length >= 2);
  const note = s.db
    .prepare(
      `SELECT title, body FROM notifications WHERE kind='stock_expiry' ORDER BY rowid DESC LIMIT 1`,
    )
    .get();
  assert.ok(note);
  assert.match(note.title, /หมดอายุ/);
});

test("OUT_OF_STOCK when unit expires into warranty window before pay", (t) => {
  const { s, user, admin, variantId } = fixture(t);
  s.importCodes(admin, {
    variantId,
    items: [{ loginId: "shrink@ex.invalid", password: "pw", expiresAt: daysFromNow(60) }],
  });
  const order = s.createOrder(user, {
    variantId,
    quantity: 1,
    requestKey: "expiry-oos-001",
  });
  // After checkout, unit no longer covers the 30-day warranty → pay must not sell it.
  s.db
    .prepare(`UPDATE inventory SET expires_at=? WHERE variant_id=?`)
    .run(daysFromNow(5) + " 23:59:59", variantId);
  const paid = s.pay(user, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.equal(paid.status, "OUT_OF_STOCK");
});
