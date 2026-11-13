// Email verification at sign-up (server/email-verification.mjs): link tokens, resend limits,
// the order / payment gate and its switches, the one-time backfill, admin "ยืนยันให้", PDPA.
// Uses a fake email sender; nothing leaves the machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import {
  EMAIL_NOT_VERIFIED,
  EMAIL_NOT_VERIFIED_PAY,
  VERIFY_RESEND_COOLDOWN_MS,
  VERIFY_RESEND_PER_HOUR,
  VERIFY_TOKEN_MS,
} from "../server/email-verification.mjs";
import { EMAIL_TEMPLATES, validateTemplate } from "../server/email-templates.mjs";

const BASE = "https://shop.example.com";
const PASSWORD = "Verify-Password-123";
const OWNER = "Owner-verify-Password-1";

function fakeMailer() {
  const sent = [];
  return {
    sent,
    enabled: true,
    provider: "test",
    from: "shop@mail.example.com",
    async send(message) {
      sent.push(message);
      return { id: "msg-" + sent.length };
    },
  };
}
const linkToken = (message) => /\/verify-email\?token=([a-f0-9]{64})/.exec(message?.text ?? "")?.[1];

function shop(t, { email = fakeMailer(), ...options } = {}) {
  let now = Date.UTC(2026, 10, 13, 3, 0, 0);
  const s = createCommerce({ adminPassword: OWNER, clock: () => now, email, ...options });
  t.after(async () => {
    await s.emailIdle();
    s.db.close();
  });
  const admin = s.session(s.login({ email: "admin@astra.local", password: OWNER }).token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const p = s.saveProduct(admin, { name: "Verify Stream", description: "ทดสอบยืนยันอีเมล", category: "streaming", price: 5000, active: true, firstLabel: "1 เดือน" });
  const variantId = s.adminProductVariants(admin, p.id).variants[0].id;
  s.importCodes(admin, {
    variantId,
    items: Array.from({ length: 6 }, (_, i) => ({ loginId: "verify-" + i + "@x.test", password: "pw" + i })),
  });
  const handle = createAPIHandler(s);
  let ip = 0;
  async function call(method, path, body, cookie = "") {
    const headers = { Cookie: cookie, "CF-Connecting-IP": "198.51.100." + (++ip % 250) };
    if (method === "POST") Object.assign(headers, { "Content-Type": "application/json", "X-Astra-Request": "1" });
    const res = await handle(new Request(BASE + path, { method, headers, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined }));
    const token = /astra_session=([a-f0-9]+)/.exec(res.headers.get("Set-Cookie") ?? "")?.[1];
    return { status: res.status, body: await res.json(), cookie: token ? "astra_session=" + token : undefined };
  }
  const order = (user) => s.createOrder(user, { variantId, quantity: 1, requestKey: randomUUID() });
  return { s, admin, variantId, email, call, order, advance: (ms) => (now += ms), now: () => now };
}
async function signUp(api, address = "buyer@mail.example.com") {
  const r = await api.call("POST", "/api/register", { name: "ผู้ซื้อทดสอบ", username: "u" + randomBytes(4).toString("hex"), email: address, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await api.s.emailIdle();
  return { id: r.body.user.id, cookie: r.cookie, user: r.body.user };
}
const sessionOf = (api, cookie) => api.s.session(cookie.split("=")[1]);
const auditRows = (s, action) => s.db.prepare("SELECT * FROM audit WHERE action=? ORDER BY id").all(action);

test("sign-up sends a 24 h link; only a keyed hash is stored; the link verifies once; health flag", async (t) => {
  const api = shop(t);
  const health = await api.call("GET", "/api/health");
  assert.equal(health.body.features.emailVerification, true);
  const buyer = await signUp(api);
  assert.equal(buyer.user.emailVerified, false);
  assert.equal(buyer.user.emailVerification.required, true);
  assert.equal(buyer.user.emailVerification.canSend, true);
  assert.equal(api.email.sent.length, 1);
  const mail = api.email.sent[0];
  assert.equal(mail.to, "buyer@mail.example.com");
  assert.match(mail.subject, /ยืนยันอีเมล/);
  const token = linkToken(mail);
  assert.ok(token, "link carries the token");
  assert.ok(mail.html.includes(BASE + "/verify-email?token=" + token), "link uses the request origin");
  assert.ok(!mail.text.includes(PASSWORD));
  const rows = api.s.db.prepare("SELECT * FROM email_verifications").all();
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes(token), "token never stored");
  assert.equal(rows[0].expires_at - rows[0].created_at, VERIFY_TOKEN_MS);
  assert.equal(rows[0].kind, "signup");
  assert.equal(api.s.db.prepare("SELECT kind FROM email_log").get().kind, "verify_email");

  // Bad tokens: clear 400, nothing changes.
  for (const bad of ["", "abc", "z".repeat(64), "a".repeat(64)]) {
    const r = await api.call("POST", "/api/verify-email", { token: bad });
    assert.equal(r.status, 400, bad);
    assert.match(r.body.error, /ลิงก์ยืนยันอีเมลไม่ถูกต้อง/);
  }
  const ok = await api.call("POST", "/api/verify-email", { token });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.alreadyVerified, false);
  assert.equal(ok.body.email, "bu***@mail.example.com", "masked");
  const me = await api.call("GET", "/api/me", undefined, buyer.cookie);
  assert.equal(me.body.user.emailVerified, true);
  assert.equal(me.body.user.emailVerification, undefined);
  // Opening the same link again: idempotent ok, no second audit row.
  const again = await api.call("POST", "/api/verify-email", { token });
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyVerified, true);
  assert.equal(auditRows(api.s, "EMAIL_VERIFIED").length, 1);
  // Resend after verifying: refused.
  assert.equal((await api.call("POST", "/api/verify-email/resend", {}, buyer.cookie)).status, 409);
});

test("expired link → 410 with a clear message; a replaced link → 410; the newest works", async (t) => {
  const api = shop(t);
  const buyer = await signUp(api);
  const first = linkToken(api.email.sent[0]);
  api.advance(VERIFY_TOKEN_MS + 1000);
  const expired = await api.call("POST", "/api/verify-email", { token: first });
  assert.equal(expired.status, 410);
  assert.match(expired.body.error, /หมดอายุ/);
  const resent = await api.call("POST", "/api/verify-email/resend", {}, buyer.cookie);
  assert.equal(resent.status, 200, JSON.stringify(resent.body));
  await api.s.emailIdle();
  const second = linkToken(api.email.sent[1]);
  api.advance(VERIFY_RESEND_COOLDOWN_MS);
  assert.equal((await api.call("POST", "/api/verify-email/resend", {}, buyer.cookie)).status, 200);
  await api.s.emailIdle();
  const third = linkToken(api.email.sent[2]);
  const replaced = await api.call("POST", "/api/verify-email", { token: second });
  assert.equal(replaced.status, 410);
  assert.match(replaced.body.error, /ลิงก์ใหม่กว่า/);
  assert.equal((await api.call("POST", "/api/verify-email", { token: third })).status, 200);
  assert.ok(api.s.db.prepare("SELECT email_verified_at FROM users WHERE id=?").get(buyer.id).email_verified_at);
});

test("resend: 60 s cooldown, at most 3 per hour (the sign-up email does not count), signed in only", async (t) => {
  const api = shop(t);
  const buyer = await signUp(api);
  assert.equal((await api.call("POST", "/api/verify-email/resend", {})).status, 401);
  const tooSoon = await api.call("POST", "/api/verify-email/resend", {}, buyer.cookie);
  assert.equal(tooSoon.status, 429);
  assert.match(tooSoon.body.error, /วินาที/);
  const me = await api.call("GET", "/api/me", undefined, buyer.cookie);
  assert.equal(me.body.user.emailVerification.resendInSeconds, 60);
  for (let i = 0; i < VERIFY_RESEND_PER_HOUR; i++) {
    api.advance(VERIFY_RESEND_COOLDOWN_MS);
    const r = await api.call("POST", "/api/verify-email/resend", {}, buyer.cookie);
    assert.equal(r.status, 200, "resend " + (i + 1));
    assert.equal(r.body.emailVerification.resendInSeconds, 60);
  }
  api.advance(VERIFY_RESEND_COOLDOWN_MS);
  const limited = await api.call("POST", "/api/verify-email/resend", {}, buyer.cookie);
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /ครบ 3 ครั้ง/);
  await api.s.emailIdle();
  assert.equal(api.email.sent.length, 1 + VERIFY_RESEND_PER_HOUR);
  // An hour later it works again; only one live link at a time.
  api.advance(3600000);
  assert.equal((await api.call("POST", "/api/verify-email/resend", {}, buyer.cookie)).status, 200);
  assert.equal(api.s.db.prepare("SELECT COUNT(*) AS n FROM email_verifications WHERE user_id=? AND used_at IS NULL").get(buyer.id).n, 1);
  assert.equal(auditRows(api.s, "EMAIL_VERIFY_RESEND").length, VERIFY_RESEND_PER_HOUR + 1);
});

test("gate on: an unverified customer cannot order, preorder or pay; can still browse, chat, read the account", async (t) => {
  const api = shop(t);
  const buyer = await signUp(api);
  const user = sessionOf(api, buyer.cookie);
  // An order made before verification was switched on (gate off) …
  api.s.saveSettings(api.admin, { requireEmailVerification: false });
  const waiting = api.order(user);
  api.s.saveSettings(api.admin, { requireEmailVerification: true });
  assert.throws(() => api.order(user), (e) => e.status === 403 && e.message === EMAIL_NOT_VERIFIED);
  assert.throws(() => api.s.createOrder(user, { variantId: "cinema-max-30", quantity: 1, requestKey: randomUUID() }), (e) => e.status === 403 && e.message === EMAIL_NOT_VERIFIED, "preorder too");
  // … cannot be paid either.
  assert.throws(() => api.s.pay(user, waiting.id, { paymentToken: waiting.paymentToken, outcome: "success" }), (e) => e.status === 403 && e.message === EMAIL_NOT_VERIFIED_PAY);
  const http = await api.call("POST", "/api/orders", { variantId: api.variantId, quantity: 1, requestKey: randomUUID() }, buyer.cookie);
  assert.equal(http.status, 403);
  assert.equal(http.body.error, "กรุณายืนยันอีเมลก่อนสั่งซื้อ");
  // Still allowed: products, account, chat.
  assert.equal((await api.call("GET", "/api/products", undefined, buyer.cookie)).status, 200);
  assert.equal((await api.call("GET", "/api/me", undefined, buyer.cookie)).status, 200);
  assert.equal((await api.call("GET", "/api/orders", undefined, buyer.cookie)).status, 200);
  const chat = await api.call("POST", "/api/chat/threads", { body: "สวัสดีครับ" }, buyer.cookie);
  assert.ok([200, 201].includes(chat.status), JSON.stringify(chat.body));
  // Verify → orders and the waiting payment go through.
  await api.call("POST", "/api/verify-email", { token: linkToken(api.email.sent[0]) });
  assert.equal(api.s.pay(user, waiting.id, { paymentToken: waiting.paymentToken, outcome: "success" }).status, "DELIVERED");
  assert.equal(api.order(user).status, "PENDING_PAYMENT");
});

test("gate off by setting: no link at sign-up, no notice, orders work; email optional at sign-up again", async (t) => {
  const api = shop(t);
  api.s.saveSettings(api.admin, { requireEmailVerification: false });
  assert.equal(api.s.settings().requireEmailVerification, false);
  const buyer = await signUp(api, "gateoff@mail.example.com");
  assert.equal(api.email.sent.length, 0, "no sign-up link while verification is off");
  assert.equal(buyer.user.emailVerified, false);
  assert.equal(buyer.user.emailVerification.required, false);
  assert.equal(api.order(sessionOf(api, buyer.cookie)).status, "PENDING_PAYMENT");
  const noEmail = await api.call("POST", "/api/register", { username: "no_mail_ok", password: PASSWORD });
  assert.equal(noEmail.status, 200);
  assert.throws(() => api.s.saveSettings(api.admin, { requireEmailVerification: "yes" }), (e) => e.status === 400);
  const audit = auditRows(api.s, "SAVE_SETTINGS").map((a) => JSON.parse(a.detail));
  assert.deepEqual(audit[0].changed.requireEmailVerification, { from: true, to: false });
});

test("gate on: sign-up needs a real address (placeholder / reserved domains refused)", async (t) => {
  const api = shop(t);
  for (const body of [
    { username: "no_mail_user", password: PASSWORD },
    { username: "invalid_mail", email: "x@example.invalid", password: PASSWORD },
  ]) {
    const r = await api.call("POST", "/api/register", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, /อีเมลที่ใช้งานได้/);
  }
});

test("email not configured: gate off, no link, sign-up with or without email works, nothing blocks sales", async (t) => {
  const api = shop(t, { email: null });
  const health = await api.call("GET", "/api/health");
  assert.equal(health.body.features.email, false);
  assert.equal(health.body.features.emailVerification, true);
  assert.equal(api.s.settings().requireEmailVerification, true, "setting stays on; email being down turns the gate off");
  const buyer = await signUp(api, "nomailer@mail.example.com");
  assert.equal(buyer.user.emailVerified, false);
  assert.equal(buyer.user.emailVerification.required, false);
  assert.equal(buyer.user.emailVerification.canSend, false);
  const user = sessionOf(api, buyer.cookie);
  const o = api.order(user);
  assert.equal(api.s.pay(user, o.id, { paymentToken: o.paymentToken, outcome: "success" }).status, "DELIVERED");
  assert.equal(api.s.db.prepare("SELECT COUNT(*) AS n FROM email_verifications").get().n, 0);
  assert.equal((await api.call("POST", "/api/register", { username: "plain_user", password: PASSWORD })).status, 200);
  const resend = await api.call("POST", "/api/verify-email/resend", {}, buyer.cookie);
  assert.equal(resend.status, 409);
  assert.match(resend.body.error, /ยังไม่เปิดระบบส่งอีเมล/);
});

test("staff, owner and demo visitors are exempt", async (t) => {
  const api = shop(t);
  const staffAuth = await signUp(api, "staff@mail.example.com");
  api.s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.id);
  const staff = sessionOf(api, staffAuth.cookie);
  assert.equal(api.order(staff).status, "PENDING_PAYMENT");
  assert.equal(api.s.publicUser(staff).emailVerified, true);
  assert.equal(api.order(api.admin).status, "PENDING_PAYMENT");
  const visitor = api.s.session(api.s.demo().token);
  assert.equal(api.s.publicUser(visitor).emailVerified, true);
  assert.equal(api.order(visitor).status, "PENDING_PAYMENT");
});

test("change email: password required, new address unverified, old links dead, link goes to the new address", async (t) => {
  const api = shop(t);
  const buyer = await signUp(api, "typo@mail.example.com");
  const oldLink = linkToken(api.email.sent[0]);
  const other = await signUp(api, "taken@mail.example.com");
  assert.ok(other.id);
  api.advance(VERIFY_RESEND_COOLDOWN_MS);
  const wrong = await api.call("POST", "/api/verify-email/change", { email: "fixed@mail.example.com", currentPassword: "wrong-password-1" }, buyer.cookie);
  assert.equal(wrong.status, 403);
  const taken = await api.call("POST", "/api/verify-email/change", { email: "taken@mail.example.com", currentPassword: PASSWORD }, buyer.cookie);
  assert.equal(taken.status, 409);
  const fake = await api.call("POST", "/api/verify-email/change", { email: "x@shop.local", currentPassword: PASSWORD }, buyer.cookie);
  assert.equal(fake.status, 400);
  const changed = await api.call("POST", "/api/verify-email/change", { email: "Fixed@Mail.example.com", currentPassword: PASSWORD }, buyer.cookie);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.email, "fixed@mail.example.com");
  assert.equal(changed.body.emailVerified, false);
  await api.s.emailIdle();
  const mail = api.email.sent.at(-1);
  assert.equal(mail.to, "fixed@mail.example.com");
  assert.equal((await api.call("POST", "/api/verify-email", { token: oldLink })).status, 410, "link for the old address");
  assert.equal((await api.call("POST", "/api/verify-email", { token: linkToken(mail) })).status, 200);
  const [row] = auditRows(api.s, "EMAIL_CHANGE");
  assert.deepEqual(JSON.parse(row.detail), { from: "ty***@mail.example.com", to: "fi***@mail.example.com", sent: true });
  // A verified customer who changes the address must verify again.
  api.advance(VERIFY_RESEND_COOLDOWN_MS);
  await api.call("POST", "/api/verify-email/change", { email: "again@mail.example.com", currentPassword: PASSWORD }, buyer.cookie);
  assert.throws(() => api.order(sessionOf(api, buyer.cookie)), (e) => e.status === 403);
});

test("admin: badge data, manual verify (ADMIN only, audited in the customer history), email edit resets", async (t) => {
  const api = shop(t);
  const buyer = await signUp(api, "nomailbox@mail.example.com");
  const staffAuth = await signUp(api, "staff2@mail.example.com");
  api.s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.id);
  const staff = sessionOf(api, staffAuth.cookie);
  assert.equal(api.s.adminCustomerDetail(api.admin, buyer.id).customer.emailVerifiedAt, null);
  assert.throws(() => api.s.adminVerifyCustomerEmail(staff, buyer.id), (e) => e.status === 403);
  const adminCookie = "astra_session=" + api.s.login({ email: "admin@astra.local", password: OWNER }).token;
  const r = await api.call("POST", "/api/admin/customers/" + buyer.id + "/verify-email", {}, adminCookie);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const detail = api.s.adminCustomerDetail(api.admin, buyer.id);
  assert.ok(detail.customer.emailVerifiedAt);
  const entry = detail.history.find((h) => h.action === "CUSTOMER_EMAIL_VERIFIED");
  assert.ok(entry, "shows in the customer history");
  assert.deepEqual(entry.detail, { email: "no***@mail.example.com", manual: true });
  assert.equal((await api.call("POST", "/api/admin/customers/" + buyer.id + "/verify-email", {}, adminCookie)).status, 409);
  assert.equal(api.order(sessionOf(api, buyer.cookie)).status, "PENDING_PAYMENT");
  // The sign-up link is dead after the manual verify (opening it says "already verified").
  assert.equal((await api.call("POST", "/api/verify-email", { token: linkToken(api.email.sent[0]) })).body.alreadyVerified, true);
  // Admin changes the address → not verified any more; same address → unchanged.
  api.s.adminUpdateCustomer(api.admin, buyer.id, { firstName: "ผู้ซื้อ", email: "nomailbox@mail.example.com" });
  assert.ok(api.s.adminCustomerDetail(api.admin, buyer.id).customer.emailVerifiedAt);
  api.s.adminUpdateCustomer(api.admin, buyer.id, { firstName: "ผู้ซื้อ", email: "new-box@mail.example.com" });
  assert.equal(api.s.adminCustomerDetail(api.admin, buyer.id).customer.emailVerifiedAt, null);
  assert.throws(() => api.s.adminVerifyCustomerEmail(api.admin, staffAuth.id), (e) => e.status === 404, "customers only");
});

test("PDPA: export has the status only; approved deletion removes verification rows", async (t) => {
  const api = shop(t);
  const buyer = await signUp(api, "pdpa-verify@mail.example.com");
  const user = sessionOf(api, buyer.cookie);
  const exported = api.s.exportMyData(user);
  assert.equal(exported.subject.emailVerified, false);
  const blob = JSON.stringify(exported);
  assert.ok(!blob.includes("token_hash") && !blob.includes(linkToken(api.email.sent[0])), "no links / hashes exported");
  assert.equal(api.s.db.prepare("SELECT COUNT(*) AS n FROM email_verifications WHERE user_id=?").get(buyer.id).n, 1);
  const req = api.s.requestAccountDeletion(user, {});
  api.s.approvePrivacyDeletion(api.admin, req.id, { currentPassword: OWNER });
  assert.equal(api.s.db.prepare("SELECT COUNT(*) AS n FROM email_verifications WHERE user_id=?").get(buyer.id).n, 0);
});

test("verify_email template: editable, link placeholder required", () => {
  const def = EMAIL_TEMPLATES.verify_email;
  assert.deepEqual(def.required, ["ลิงก์ยืนยัน"]);
  assert.throws(() => validateTemplate("verify_email", { subject: "s", heading: "h", body: "ไม่มีลิงก์" }), /\{ลิงก์ยืนยัน\}/);
  assert.deepEqual(validateTemplate("verify_email", def.defaults), def.defaults);
});

test("existing users are backfilled verified once; later sign-ups start unverified", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-verify-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "shop.sqlite");
  const key = randomBytes(32);
  let s = createCommerce({ path, key });
  const old = s.register({ name: "Old Customer", email: "old@mail.example.com", password: PASSWORD }, {});
  s.db.close();
  // Roll the database back to "before this feature": no column, no table.
  const raw = new DatabaseSync(path);
  raw.exec("DROP TABLE email_verifications");
  raw.exec("ALTER TABLE users DROP COLUMN email_verified_at");
  raw.close();
  s = createCommerce({ path, key, email: fakeMailer() });
  const row = s.db.prepare("SELECT email_verified_at, created_at FROM users WHERE id=?").get(old.user.id);
  assert.equal(row.email_verified_at, row.created_at, "existing account counts as verified");
  assert.equal(s.publicUser(s.session(s.login({ email: "old@mail.example.com", password: PASSWORD }).token)).emailVerified, true);
  const fresh = s.register({ name: "New Customer", email: "new@mail.example.com", password: PASSWORD }, {});
  s.db.close();
  s = createCommerce({ path, key, email: fakeMailer() });
  t.after(() => s.db.close());
  assert.equal(s.db.prepare("SELECT email_verified_at FROM users WHERE id=?").get(fresh.user.id).email_verified_at, null, "reopen does not backfill again");
});
