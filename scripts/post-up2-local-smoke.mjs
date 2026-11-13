/**
 * Local HTTP smoke for post-UP-2 queue (Node createCommerce + createAPIHandler).
 * Does NOT hit the live shop.
 */
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";

const s = createCommerce({ allowDemoAdmin: true });
const handle = createAPIHandler(s);

async function call(method, path, token, body) {
  const res = await handle(
    new Request("http://127.0.0.1" + path, {
      method,
      headers: {
        Cookie: token ? "astra_session=" + token : "",
        "Content-Type": "application/json",
        "X-Astra-Request": "1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

try {
  const adminAuth = s.demoMerchant();
  const adminToken = adminAuth.token;
  const BOSS_PW = "Boss-Smoke-Pass-123";
  const salt = randomBytes(16).toString("hex");
  s.db
    .prepare("UPDATE users SET password_hash=? WHERE id=?")
    .run(salt + ":" + scryptSync(BOSS_PW, salt, 64).toString("hex"), s.session(adminToken).id);
  const buyerAuth = s.register({
    name: "Smoke Buyer",
    email: "smoke-up2@example.invalid",
    password: "Buyer-only-Password-123",
  });
  const buyerToken = buyerAuth.token;
  const staffAuth = s.register({
    name: "Smoke Staff",
    email: "smoke-staff-up2@example.invalid",
    password: "Staff-only-Password-123",
  });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staffToken = staffAuth.token;

  const admin = s.session(adminToken);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const product = s.saveProduct(admin, {
    name: "Smoke Cost Item",
    description: "ทดสอบสโมคต้นทุน",
    category: "streaming",
    price: 12000,
    active: true,
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  s.updateVariant(admin, variantId, { warranty_days: 7 });

  // Import with cost + far expiry
  const imp = await call("POST", "/api/admin/inventory", adminToken, {
    variantId,
    items: [
      {
        loginId: "smoke-cost@ex.invalid",
        password: "pw-smoke",
        cost: 4500,
        expiresAt: "2099-01-01",
      },
    ],
  });
  assert.equal(imp.status, 200, "import " + JSON.stringify(imp.data));
  assert.equal(imp.data.imported, 1);

  const buyer = s.session(buyerToken);
  const order = s.createOrder(buyer, {
    variantId,
    quantity: 1,
    requestKey: "smoke-up2-order-1",
  });
  const paid = s.pay(buyer, order.id, {
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.equal(paid.status, "DELIVERED");

  const profit = await call("GET", "/api/admin/reports/profit", adminToken);
  assert.equal(profit.status, 200);
  assert.equal(profit.data.totals.cost, 4500);
  assert.equal(profit.data.totals.profit, paid.total - 4500);
  assert.equal((await call("GET", "/api/admin/reports/profit", staffToken)).status, 403);

  const health = await call("GET", "/api/admin/health", adminToken);
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  assert.ok(health.data.migrations.applied.includes("011_perf_indexes.sql"));

  const exported = await call("GET", "/api/account/privacy/export", buyerToken);
  assert.equal(exported.status, 200);
  assert.equal(exported.data.subject.email, "smoke-up2@example.invalid");
  assert.ok(!JSON.stringify(exported.data).includes("pw-smoke"));

  const del = await call("POST", "/api/account/privacy/delete", buyerToken, {
    reason: "smoke",
  });
  assert.equal(del.status, 201);
  const approve = await call(
    "POST",
    "/api/admin/privacy/requests/" + del.data.id + "/approve",
    adminToken,
    { currentPassword: BOSS_PW },
  );
  assert.equal(approve.status, 200);
  assert.equal(approve.data.status, "APPROVED");

  const row = s.db
    .prepare("SELECT email, status, phone FROM users WHERE id=?")
    .get(buyerAuth.user.id);
  assert.equal(row.status, "DELETED");
  assert.equal(row.phone, null);

  // Expiry: unit inside warranty window is not sold
  const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  s.importCodes(admin, {
    variantId,
    items: [{ loginId: "smoke-soon@ex.invalid", password: "pw", expiresAt: soon }],
  });
  const stock = s.adminProductVariants(admin, product.id).variants[0].stock;
  assert.equal(stock, 0, "soon-expiring unit must not count as sellable with warranty 7d");

  console.log("PASS post-up2 local smoke");
  console.log(
    JSON.stringify(
      {
        profit: profit.data.totals,
        healthOk: health.data.ok,
        migrations: health.data.migrations.applied.length,
        anonymized: row.email,
      },
      null,
      2,
    ),
  );
} finally {
  s.db.close();
}
