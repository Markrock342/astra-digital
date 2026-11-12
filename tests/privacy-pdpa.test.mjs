import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const buyerAuth = s.register({
    name: "PDPA Buyer",
    email: "pdpa-buyer@example.invalid",
    password: "Buyer-only-Password-123",
  });
  const user = s.session(buyerAuth.token);
  s.db
    .prepare("UPDATE users SET phone=?, first_name=?, last_name=? WHERE id=?")
    .run("0812345678", "ชื่อ", "นามสกุล", user.id);
  const refreshed = s.session(buyerAuth.token);
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  return { s, user: refreshed, admin, buyerToken: buyerAuth.token, adminToken: adminAuth.token };
}

const call = async (s, method, path, token, body) => {
  const handle = createAPIHandler(s);
  const response = await handle(
    new Request("http://127.0.0.1" + path, {
      method,
      headers: {
        Cookie: "astra_session=" + token,
        "Content-Type": "application/json",
        "X-Astra-Request": "1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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

test("customer can export own JSON; staff cannot", async (t) => {
  const { s, user, admin, buyerToken } = fixture(t);
  const staffAuth = s.register({
    name: "PDPA Staff",
    email: "pdpa-staff@example.invalid",
    password: "Staff-only-Password-123",
  });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  assert.throws(() => s.exportMyData(staff), (e) => e.status === 403);
  assert.throws(() => s.exportMyData(admin), (e) => e.status === 403);

  const exported = s.exportMyData(user);
  assert.equal(exported.subject.email, "pdpa-buyer@example.invalid");
  assert.equal(exported.subject.phone, "0812345678");
  assert.ok(Array.isArray(exported.orders));
  assert.ok(Array.isArray(exported.ledger));

  const http = await call(s, "GET", "/api/account/privacy/export", buyerToken);
  assert.equal(http.status, 200);
  assert.equal(http.data.subject.email, "pdpa-buyer@example.invalid");
});

test("delete request + admin anonymize keeps ledger/orders; no append-only delete", async (t) => {
  const { s, user, admin, buyerToken, adminToken } = fixture(t);
  s.importCodes(admin, {
    variantId: "stream-plus-30",
    items: [{ loginId: "pdpa-stock@ex.invalid", password: "pw" }],
  });
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "pdpa-order-001",
  });
  s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  const ledgerBefore = s.db
    .prepare("SELECT COUNT(*) AS n FROM ledger WHERE user_id=?")
    .get(user.id).n;
  assert.ok(ledgerBefore > 0);
  const auditBefore = s.db.prepare("SELECT COUNT(*) AS n FROM audit").get().n;

  const req = s.requestAccountDeletion(user, { reason: "ขอถอนความยินยอม" });
  assert.equal(req.status, "PENDING");
  assert.throws(
    () => s.requestAccountDeletion(user, { reason: "ซ้ำ" }),
    (e) => e.status === 409,
  );

  const listed = s.adminPrivacyRequests(admin, { status: "PENDING" });
  assert.ok(listed.requests.some((r) => r.id === req.id));

  const approved = s.approvePrivacyDeletion(admin, req.id);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.ledgerRowsKept, ledgerBefore);

  const row = s.db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
  assert.equal(row.status, "DELETED");
  assert.match(row.email, /anonymized\.invalid$/);
  assert.equal(row.name, "ผู้ใช้ที่ลบแล้ว");
  assert.equal(row.phone, null);
  assert.equal(row.avatar_key, null);

  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE user_id=?").get(user.id).n,
    ledgerBefore,
  );
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id=?").get(user.id).n,
    1,
  );
  assert.ok(s.db.prepare("SELECT COUNT(*) AS n FROM audit").get().n >= auditBefore);

  // Append-only: cannot DELETE ledger rows.
  assert.throws(() => {
    s.db.prepare("DELETE FROM ledger WHERE user_id=?").run(user.id);
  });

  const http = await call(s, "POST", "/api/account/privacy/delete", buyerToken, {
    reason: "ผ่าน HTTP แต่ session เก่า",
  });
  // Session was wiped on approve — request should fail auth.
  assert.ok(http.status === 401 || http.status === 403 || http.status === 409);

  const approveHttp = await call(
    s,
    "POST",
    "/api/admin/privacy/requests/" + req.id + "/approve",
    adminToken,
    {},
  );
  assert.equal(approveHttp.status, 409);
});
