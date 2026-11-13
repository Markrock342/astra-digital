import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";

const BOSS_PW = "Boss-Privacy-Pass-123";
function setKnownPassword(s, userId) {
  const salt = randomBytes(16).toString("hex");
  s.db
    .prepare("UPDATE users SET password_hash=? WHERE id=?")
    .run(salt + ":" + scryptSync(BOSS_PW, salt, 64).toString("hex"), userId);
}

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
  setKnownPassword(s, s.session(adminAuth.token).id);
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

  // Seed side tables that must go away with the account (Mark review #62).
  const nowMs = Date.now();
  s.db
    .prepare(
      "INSERT INTO password_resets(token_hash, user_id, expires_at, created_at) VALUES(?,?,?,?)",
    )
    .run("pdpa-reset-hash-" + user.id, user.id, nowMs + 30 * 60 * 1000, nowMs);
  s.db
    .prepare("INSERT INTO stock_watch(id, user_id, variant_id, created_at) VALUES(?,?,?,?)")
    .run("pdpa-watch-" + user.id, user.id, "stream-plus-30", new Date().toISOString().slice(0, 19).replace("T", " "));
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM password_resets WHERE user_id=?").get(user.id).n,
    1,
  );
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM stock_watch WHERE user_id=?").get(user.id).n,
    1,
  );

  const req = s.requestAccountDeletion(user, { reason: "ขอถอนความยินยอม" });
  assert.equal(req.status, "PENDING");
  assert.throws(
    () => s.requestAccountDeletion(user, { reason: "ซ้ำ" }),
    (e) => e.status === 409,
  );

  const listed = s.adminPrivacyRequests(admin, { status: "PENDING" });
  assert.ok(listed.requests.some((r) => r.id === req.id));

  // Irreversible: no password / wrong password → refused, nothing changed.
  assert.throws(() => s.approvePrivacyDeletion(admin, req.id), (e) => e.status === 403);
  assert.throws(
    () => s.approvePrivacyDeletion(admin, req.id, { currentPassword: "wrong-password-xyz" }),
    (e) => e.status === 403,
  );
  assert.equal(s.db.prepare("SELECT status FROM users WHERE id=?").get(user.id).status, "ACTIVE");
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM password_resets WHERE user_id=?").get(user.id).n,
    1,
    "wrong password must not clear password_resets",
  );
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM stock_watch WHERE user_id=?").get(user.id).n,
    1,
    "wrong password must not clear stock_watch",
  );

  const approved = s.approvePrivacyDeletion(admin, req.id, { currentPassword: BOSS_PW });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.ledgerRowsKept, ledgerBefore);

  const row = s.db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
  assert.equal(row.status, "DELETED");
  assert.match(row.email, /anonymized\.invalid$/);
  assert.equal(row.name, "ผู้ใช้ที่ลบแล้ว");
  assert.equal(row.phone, null);
  assert.equal(row.avatar_key, null);

  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM password_resets WHERE user_id=?").get(user.id).n,
    0,
  );
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM stock_watch WHERE user_id=?").get(user.id).n,
    0,
  );

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
    { currentPassword: BOSS_PW },
  );
  assert.equal(approveHttp.status, 409);
});

test("PDPA reject: admin can decline a request; customer stays active and may ask again", async (t) => {
  const { s, user, admin, buyerToken, adminToken } = fixture(t);
  const req = s.requestAccountDeletion(user, { reason: "ลองกดดู" });
  const staffish = await call(s, "POST", "/api/admin/privacy/requests/" + req.id + "/reject", buyerToken, {});
  assert.equal(staffish.status, 403);
  const rejected = await call(s, "POST", "/api/admin/privacy/requests/" + req.id + "/reject", adminToken, {});
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.status, "REJECTED");
  assert.equal(s.db.prepare("SELECT status FROM users WHERE id=?").get(user.id).status, "ACTIVE");
  assert.throws(() => s.rejectPrivacyRequest(admin, req.id), (e) => e.status === 409);
  assert.throws(
    () => s.approvePrivacyDeletion(admin, req.id, { currentPassword: BOSS_PW }),
    (e) => e.status === 409,
  );
  assert.equal(s.requestAccountDeletion(user, {}).status, "PENDING");
});
