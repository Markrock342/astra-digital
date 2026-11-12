/**
 * Security negatives for post-UP-2 queue: authz boundaries + no cross-user leak.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const a = s.register({
    name: "Sec A",
    email: "sec-a@example.invalid",
    password: "Buyer-only-Password-123",
  });
  const b = s.register({
    name: "Sec B",
    email: "sec-b@example.invalid",
    password: "Buyer-only-Password-123",
  });
  s.db.prepare("UPDATE users SET phone=? WHERE id=?").run("0811111111", a.user.id);
  s.db.prepare("UPDATE users SET phone=? WHERE id=?").run("0822222222", b.user.id);
  const userA = s.session(a.token);
  const userB = s.session(b.token);
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  const staffAuth = s.register({
    name: "Sec Staff",
    email: "sec-staff@example.invalid",
    password: "Staff-only-Password-123",
  });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  return {
    s,
    userA,
    userB,
    admin,
    staff,
    tokenA: a.token,
    tokenB: b.token,
    adminToken: adminAuth.token,
    staffToken: staffAuth.token,
  };
}

const call = async (s, method, path, token, body) => {
  const handle = createAPIHandler(s);
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
  return { status: res.status, data };
};

test("privacy export never includes another customer's PII", (t) => {
  const { s, userA, userB } = fixture(t);
  const exported = s.exportMyData(userA);
  assert.equal(exported.subject.email, "sec-a@example.invalid");
  assert.equal(exported.subject.phone, "0811111111");
  const blob = JSON.stringify(exported);
  assert.ok(!blob.includes("sec-b@example.invalid"));
  assert.ok(!blob.includes("0822222222"));
  assert.ok(!blob.includes(userB.id) || exported.subject.id === userA.id);
});

test("STAFF/anonymous blocked from profit, health, privacy admin; CUSTOMER blocked from admin", async (t) => {
  const { s, tokenA, staffToken, adminToken } = fixture(t);
  for (const path of [
    "/api/admin/reports/profit",
    "/api/admin/health",
    "/api/admin/privacy/requests",
  ]) {
    assert.equal((await call(s, "GET", path, null)).status, 401);
    assert.equal((await call(s, "GET", path, tokenA)).status, 403);
    assert.equal((await call(s, "GET", path, staffToken)).status, 403);
    assert.equal((await call(s, "GET", path, adminToken)).status, 200);
  }
});

test("STAFF cannot import cost stock; ADMIN can", (t) => {
  const { s, admin, staff } = fixture(t);
  const product = s.saveProduct(admin, {
    name: "Sec Cost",
    description: "ทดสอบสิทธิ์นำเข้าต้นทุน",
    category: "streaming",
    price: 5000,
    active: true,
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  assert.throws(
    () =>
      s.importCodes(staff, {
        variantId,
        items: [{ loginId: "staff-denied@ex.invalid", password: "pw", cost: 100 }],
      }),
    (e) => e.status === 403,
  );
  assert.equal(
    s.importCodes(admin, {
      variantId,
      items: [{ loginId: "admin-ok@ex.invalid", password: "pw", cost: 100 }],
    }).imported,
    1,
  );
});

test("anonymize strips PII; stale session cannot export after DELETED", (t) => {
  const { s, userA, admin } = fixture(t);
  const req = s.requestAccountDeletion(userA, { reason: "ทดสอบ" });
  s.approvePrivacyDeletion(admin, req.id);
  const row = s.db.prepare("SELECT email, phone, name, status FROM users WHERE id=?").get(userA.id);
  assert.equal(row.status, "DELETED");
  assert.equal(row.phone, null);
  assert.match(row.email, /anonymized\.invalid$/);
  assert.equal(row.name, "ผู้ใช้ที่ลบแล้ว");
  // Even with a stale in-memory user object, status is re-read from DB.
  assert.throws(() => s.exportMyData(userA), (e) => e.status === 403);
  assert.throws(
    () => s.requestAccountDeletion(userA, { reason: "อีกครั้ง" }),
    (e) => e.status === 409,
  );
});
