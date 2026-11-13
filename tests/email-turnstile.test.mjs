// Email sending, self-service password reset, order emails and Turnstile.
// Uses a fake email sender and a fake siteverify; nothing leaves the machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler, pageSecurityHeaders, securityHeaders } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { createEmailSender, isRealEmail, maskEmail, templates } from "../server/email.mjs";
import { createTurnstile, SITEVERIFY_URL } from "../server/turnstile.mjs";
import { totpCode, base32Decode } from "../server/auth-hardening.mjs";
import { RESET_TOKEN_MS } from "../server/account-email.mjs";
import { emailVerificationOff } from "./fixtures/email-verification-off.mjs";

const BASE = "https://shop.example.com";
const MIN = 60000;

function fakeMailer({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    enabled: true,
    provider: "test",
    from: "shop@mail.example.com",
    async send(message) {
      if (fail) throw new Error("provider down");
      sent.push(message);
      return { id: "msg-" + sent.length };
    },
  };
}
/** siteverify stand-in: "good-token" passes, anything else fails. Records each call. */
function fakeSiteverify() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = new URLSearchParams(init.body);
    calls.push({ url, secret: body.get("secret"), response: body.get("response"), remoteip: body.get("remoteip") });
    return Response.json({ success: body.get("response") === "good-token" });
  };
  return { calls, fetchImpl };
}

function shop(t, options = {}) {
  let now = Date.UTC(2026, 10, 13, 3, 0, 0);
  const s = emailVerificationOff(createCommerce({ allowDemoAdmin: true, clock: () => now, ...options }));
  t.after(async () => {
    await s.emailIdle();
    s.db.close();
  });
  const handle = createAPIHandler(s);
  let ipSeq = 0;
  async function call(method, path, { cookie, body, ip } = {}) {
    const headers = { Cookie: cookie ?? "" };
    headers["CF-Connecting-IP"] = ip ?? "198.51." + Math.floor(++ipSeq / 200) + "." + (ipSeq % 200);
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers["X-Astra-Request"] = "1";
    }
    const res = await handle(
      new Request(BASE + path, { method, headers, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined }),
    );
    const token = /astra_session=([a-f0-9]+)/.exec(res.headers.get("Set-Cookie") ?? "")?.[1];
    return { status: res.status, body: await res.json(), cookie: token ? "astra_session=" + token : undefined };
  }
  return {
    s,
    advance: (ms) => (now += ms),
    get: (path, cookie) => call("GET", path, { cookie }),
    post: (path, body, opts = {}) => call("POST", path, { body, ...opts }),
  };
}
const PASSWORD = "Original-Password-123";
async function customer(api, email, extra = {}) {
  const r = await api.post("/api/register", { name: "ลูกค้าทดสอบ", email, password: PASSWORD, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id: r.body.user.id, cookie: r.cookie, email };
}
const linkToken = (message) => /reset-password\?token=([a-f0-9]{64})/.exec(message.text)?.[1];
const auditCount = (s, action) => s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action=?").get(action).n;

// ---------------------------------------------------------------- disabled (default)

test("email and Turnstile stay off without config: health flags, 404 reset, register unchanged", async (t) => {
  const api = shop(t);
  const health = await api.get("/api/health");
  assert.equal(health.body.features.email, false);
  assert.equal(health.body.features.passwordReset, false);
  assert.equal(health.body.features.turnstile, false);
  assert.equal(health.body.turnstileSiteKey, null);
  const buyer = await customer(api, "off@mail.example.com");
  assert.ok(buyer.cookie, "register works with no Turnstile token");
  const forgot = await api.post("/api/password/forgot", { email: "off@mail.example.com" });
  assert.equal(forgot.status, 404);
  assert.match(forgot.body.error, /ติดต่อร้าน/);
  assert.equal((await api.post("/api/password/reset", { token: "a".repeat(64), newPassword: "x".repeat(12) })).status, 404);
  assert.equal(api.s.db.prepare("SELECT COUNT(*) AS n FROM email_log").get().n, 0);
  // Order emails do nothing either.
  assert.equal(api.s.sendOrderConfirmation("missing"), false);
  // Env helpers with nothing set.
  assert.equal(createEmailSender({}).enabled, false);
  assert.equal(createEmailSender({ RESEND_API_KEY: "re_x" }).enabled, false, "EMAIL_FROM is required");
  assert.equal(createTurnstile({ TURNSTILE_SITE_KEY: "only-site-key" }).enabled, false);
  assert.deepEqual(pageSecurityHeaders("/login", false), securityHeaders);
});

// ---------------------------------------------------------------- forgot / reset

test("forgot-password answers the same for real, unknown and no-email accounts; only real ones get mail", async (t) => {
  const mailer = fakeMailer();
  const api = shop(t, { email: mailer });
  await customer(api, "real@mail.example.com");
  const noEmail = await api.post("/api/register", { username: "noemail_user", password: PASSWORD });
  assert.equal(noEmail.status, 200);

  const answers = [];
  for (const email of ["real@mail.example.com", "nobody@mail.example.com", "noemail_user@no-email.asiax.local"]) {
    const r = await api.post("/api/password/forgot", { email });
    answers.push(JSON.stringify([r.status, r.body]));
  }
  assert.equal(new Set(answers).size, 1, "identical status and body: " + answers[0]);
  await api.s.emailIdle();
  assert.equal(mailer.sent.length, 1);
  const [mail] = mailer.sent;
  assert.equal(mail.to, "real@mail.example.com");
  assert.match(mail.subject, /ตั้งรหัสผ่านใหม่/);
  const token = linkToken(mail);
  assert.ok(token, "link carries the token");
  assert.ok(mail.text.startsWith("ASIA EXTRA"), "shop name from settings (default)");
  assert.ok(mail.html.includes(BASE + "/reset-password?token=" + token), "link uses the request origin");
  // Only a keyed hash is stored, never the token.
  const rows = api.s.db.prepare("SELECT * FROM password_resets").all();
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes(token));
  assert.equal(rows[0].expires_at - rows[0].created_at, RESET_TOKEN_MS);
  assert.equal(auditCount(api.s, "PASSWORD_RESET_REQUEST"), 3);
  // Log: masked recipient, ok, provider id.
  const log = api.s.db.prepare("SELECT * FROM email_log").all();
  assert.equal(log.length, 1);
  assert.equal(log[0].recipient, "re***@mail.example.com");
  assert.equal(log[0].ok, 1);
  assert.equal(log[0].provider_id, "msg-1");
  assert.equal(log[0].kind, "password_reset");
});

test("reset token is single-use, expires after 30 minutes, revokes sessions and clears lockout", async (t) => {
  const mailer = fakeMailer();
  const api = shop(t, { email: mailer });
  const buyer = await customer(api, "reset@mail.example.com");
  assert.ok((await api.get("/api/me", buyer.cookie)).body.user, "signed in before");
  // Lock the account with wrong passwords.
  for (let i = 0; i < 5; i++) await api.post("/api/login", { username: buyer.email, password: "wrong-password-xx" });
  assert.equal((await api.post("/api/login", { username: buyer.email, password: PASSWORD })).status, 429);

  await api.post("/api/password/forgot", { email: buyer.email });
  await api.s.emailIdle();
  const token = linkToken(mailer.sent.at(-1));

  const short = await api.post("/api/password/reset", { token, newPassword: "short" });
  assert.equal(short.status, 400, "same ≥10 rule as the profile change");
  const bad = await api.post("/api/password/reset", { token: "f".repeat(64), newPassword: "Brand-new-Password-1" });
  assert.equal(bad.status, 400);

  const done = await api.post("/api/password/reset", { token, newPassword: "Brand-new-Password-1" });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await api.get("/api/me", buyer.cookie)).body.user, null, "old session revoked");
  const again = await api.post("/api/password/reset", { token, newPassword: "Another-Password-22" });
  assert.equal(again.status, 400, "single use");
  assert.match(again.body.error, /ลิงก์/);

  const oldLogin = await api.post("/api/login", { username: buyer.email, password: PASSWORD });
  assert.equal(oldLogin.status, 401, "lockout cleared, old password rejected");
  const login = await api.post("/api/login", { username: buyer.email, password: "Brand-new-Password-1" });
  assert.equal(login.status, 200);
  assert.equal(auditCount(api.s, "PASSWORD_RESET_DONE"), 1);

  // Expiry: a fresh link stops working after 30 minutes.
  await api.post("/api/password/forgot", { email: buyer.email });
  await api.s.emailIdle();
  const late = linkToken(mailer.sent.at(-1));
  api.advance(RESET_TOKEN_MS + MIN);
  assert.equal((await api.post("/api/password/reset", { token: late, newPassword: "Too-late-Password-1" })).status, 400);
  // A newer link replaces the older one.
  await api.post("/api/password/forgot", { email: buyer.email });
  await api.post("/api/password/forgot", { email: buyer.email });
  await api.s.emailIdle();
  const [older, newer] = mailer.sent.slice(-2).map(linkToken);
  assert.equal((await api.post("/api/password/reset", { token: older, newPassword: "Older-link-Password-1" })).status, 400);
  assert.equal((await api.post("/api/password/reset", { token: newer, newPassword: "Newer-link-Password-1" })).status, 200);
});

test("forgot-password is rate limited per IP (429) and per account (silent, same answer)", async (t) => {
  const mailer = fakeMailer();
  const api = shop(t, { email: mailer });
  await customer(api, "limit@mail.example.com");
  const ip = "203.0.113.9";
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await api.post("/api/password/forgot", { email: "limit@mail.example.com" }, { ip })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  await api.s.emailIdle();
  assert.equal(mailer.sent.length, 3, "at most 3 links per account per hour");
  api.advance(61 * MIN);
  assert.equal((await api.post("/api/password/forgot", { email: "limit@mail.example.com" })).status, 200);
  await api.s.emailIdle();
  assert.equal(mailer.sent.length, 4);
});

test("staff with 2FA can reset the password but the next login still asks for the code", async (t) => {
  const mailer = fakeMailer();
  const api = shop(t, { email: mailer });
  const staff = await customer(api, "staff@mail.example.com");
  api.s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staff.id);
  const login = await api.post("/api/login", { username: staff.email, password: PASSWORD });
  const setup = await api.post("/api/account/totp/setup", { currentPassword: PASSWORD }, { cookie: login.cookie });
  const secret = base32Decode(setup.body.secret);
  const enabled = await api.post("/api/account/totp/enable", { code: totpCode(secret, Date.UTC(2026, 10, 13, 3, 0, 0)) }, { cookie: login.cookie });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));

  await api.post("/api/password/forgot", { email: staff.email });
  await api.s.emailIdle();
  const reset = await api.post("/api/password/reset", { token: linkToken(mailer.sent.at(-1)), newPassword: "Staff-new-Password-1" });
  assert.equal(reset.status, 200);
  const next = await api.post("/api/login", { username: staff.email, password: "Staff-new-Password-1" });
  assert.equal(next.status, 200);
  assert.equal(next.body.needsTotp, true, "2FA still required");
  assert.equal(next.cookie, undefined);
});

// ---------------------------------------------------------------- order emails

function orderFixture(t, mailer) {
  const api = shop(t, { email: mailer });
  const s = api.s;
  const merchant = s.session(s.demoMerchant().token);
  s.setPaymentChannel(merchant, { provider: "sandbox", active: true });
  const p = s.saveProduct(merchant, { name: "Mail Ready", description: "ทดสอบอีเมล", category: "streaming", price: 15000, active: true });
  const ready = s.adminProductVariants(merchant, p.id).variants[0].id;
  s.importCodes(merchant, { variantId: ready, items: [{ loginId: "mail-login-1", password: "SECRET-PW-1" }, { loginId: "mail-login-2", password: "SECRET-PW-2" }] });
  const pre = s.saveProduct(merchant, { name: "Mail Preorder", description: "ทดสอบอีเมล", category: "streaming", price: 9900, preorder: true, active: true });
  const preVariant = s.adminProductVariants(merchant, pre.id).variants[0].id;
  return { api, s, merchant, ready, preVariant };
}
const buy = (s, user, variantId, key) => {
  const order = s.createOrder(user, { variantId, quantity: 1, requestKey: key });
  return { order, paid: s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" }) };
};

test("order confirmation and preorder-ready emails: once each, no credentials, no passwords", async (t) => {
  const mailer = fakeMailer();
  const { s, merchant, ready, preVariant } = orderFixture(t, mailer);
  const user = s.session(s.register({ name: "ผู้ซื้อ", email: "buyer@mail.example.com", password: PASSWORD }).token);

  const { order, paid } = buy(s, user, ready, "mail-order-0001");
  assert.equal(paid.status, "DELIVERED");
  s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" }); // repeat: no 2nd email
  await s.emailIdle();
  assert.equal(mailer.sent.length, 1);
  const confirm = mailer.sent[0];
  assert.match(confirm.subject, /ยืนยันคำสั่งซื้อ/);
  assert.ok(confirm.text.includes(order.id.slice(0, 8).toUpperCase()), "order number");
  assert.ok(confirm.text.includes("Mail Ready"), "product");
  assert.ok(confirm.text.includes("150.00 บาท"), "amount");
  assert.ok(confirm.text.includes("/orders/" + order.id), "link to the order page");

  const pre = buy(s, user, preVariant, "mail-preorder-0001");
  assert.equal(pre.paid.status, "PREORDER");
  s.importCodes(merchant, { variantId: preVariant, items: [{ loginId: "pre-login-1", password: "SECRET-PW-3" }] });
  s.deliverReservation(merchant, pre.order.id);
  s.deliverReservation(merchant, pre.order.id); // idempotent: no 2nd email
  await s.emailIdle();
  assert.deepEqual(
    mailer.sent.map((m) => m.subject.split(" ")[0]),
    ["ยืนยันคำสั่งซื้อ", "ยืนยันคำสั่งซื้อ", "สินค้าพรีออเดอร์พร้อมแล้ว"],
  );
  const blob = JSON.stringify(mailer.sent);
  for (const secret of ["SECRET-PW", "mail-login", "pre-login", PASSWORD]) assert.ok(!blob.includes(secret), secret);
  const kinds = s.db.prepare("SELECT kind, ok FROM email_log ORDER BY rowid").all();
  assert.deepEqual(kinds.map((k) => [k.kind, k.ok]), [["order_confirmed", 1], ["order_confirmed", 1], ["preorder_ready", 1]]);

  // Customers without a real email get nothing.
  const noMail = s.session(s.register({ username: "nomail_buyer", password: PASSWORD }).token);
  buy(s, noMail, ready, "mail-order-0002");
  await s.emailIdle();
  assert.equal(mailer.sent.length, 3);
});

test("a failing provider never fails the payment; the error lands in email_log", async (t) => {
  const mailer = fakeMailer({ fail: true });
  const { s, ready } = orderFixture(t, mailer);
  const user = s.session(s.register({ name: "ผู้ซื้อ", email: "fail@mail.example.com", password: PASSWORD }).token);
  const { paid } = buy(s, user, ready, "mail-fail-0001");
  assert.equal(paid.status, "DELIVERED");
  await s.emailIdle();
  const row = s.db.prepare("SELECT * FROM email_log").get();
  assert.equal(row.ok, 0);
  assert.match(row.error, /provider down/);
});

test("password reset email never contains the password; templates escape HTML", () => {
  const mail = templates.passwordReset({ shopName: "<b>ร้าน</b>", link: "https://x.example.com/reset-password?token=abc" });
  assert.ok(!mail.html.includes("<b>ร้าน</b>"));
  assert.ok(mail.html.includes("&lt;b&gt;"));
  assert.ok(!/รหัสผ่านของคุณคือ|password:/i.test(mail.text));
  assert.equal(maskEmail("somchai@gmail.com"), "so***@gmail.com");
  assert.equal(isRealEmail("user@no-email.asiax.local"), false);
  assert.equal(isRealEmail("admin@astra.local"), false);
  assert.equal(isRealEmail("buyer@gmail.com"), true);
});

// ---------------------------------------------------------------- providers

test("providers: binding EMAIL wins over Resend; Resend uses EMAIL_API_BASE and the key; 5s-style timeout", async () => {
  const bindingCalls = [];
  const binding = createEmailSender({
    EMAIL: { send: async (m) => (bindingCalls.push(m), { messageId: "cf-1" }) },
    EMAIL_FROM: "shop@mail.example.com",
    RESEND_API_KEY: "re_should_not_be_used",
  });
  assert.equal(binding.provider, "cloudflare");
  assert.deepEqual(await binding.send({ to: "a@mail.example.com", subject: "s", text: "t", html: "<p>t</p>" }), { id: "cf-1" });
  assert.equal(bindingCalls[0].from, "shop@mail.example.com");

  const requests = [];
  const resend = createEmailSender(
    { RESEND_API_KEY: "re_test_key", EMAIL_FROM: "shop@mail.example.com", EMAIL_API_BASE: "http://127.0.0.1:9/mock/" },
    {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return Response.json({ id: "re-123" });
      },
    },
  );
  assert.equal(resend.provider, "resend");
  assert.deepEqual(await resend.send({ to: "a@mail.example.com", subject: "s", text: "t", html: "h" }), { id: "re-123" });
  assert.equal(requests[0].url, "http://127.0.0.1:9/mock/emails");
  assert.equal(requests[0].init.headers.Authorization, "Bearer re_test_key");
  assert.deepEqual(JSON.parse(requests[0].init.body).to, ["a@mail.example.com"]);

  const failing = createEmailSender(
    { RESEND_API_KEY: "re_test_key", EMAIL_FROM: "shop@mail.example.com" },
    { fetchImpl: async () => Response.json({ message: "domain not verified" }, { status: 403 }) },
  );
  await assert.rejects(failing.send({ to: "a@mail.example.com", subject: "s", text: "t" }), /403/);

  const slow = createEmailSender(
    { RESEND_API_KEY: "re_test_key", EMAIL_FROM: "shop@mail.example.com" },
    {
      timeoutMs: 50,
      fetchImpl: (url, init) =>
        new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    },
  );
  await assert.rejects(slow.send({ to: "a@mail.example.com", subject: "s", text: "t" }), /timed out/);
});

// ---------------------------------------------------------------- Turnstile

test("Turnstile on: health exposes the site key; register, login and forgot need a valid token", async (t) => {
  const verify = fakeSiteverify();
  const turnstile = createTurnstile(
    { TURNSTILE_SITE_KEY: "site-key-123", TURNSTILE_SECRET: "secret-xyz" },
    { fetchImpl: verify.fetchImpl },
  );
  const mailer = fakeMailer();
  const api = shop(t, { turnstile, email: mailer });
  const health = await api.get("/api/health");
  assert.equal(health.body.features.turnstile, true);
  assert.equal(health.body.turnstileSiteKey, "site-key-123");
  assert.ok(!JSON.stringify(health.body).includes("secret-xyz"));

  const body = { name: "บอท", email: "bot@mail.example.com", password: PASSWORD };
  const missing = await api.post("/api/register", body);
  assert.equal(missing.status, 403);
  assert.match(missing.body.error, /ไม่ใช่บอท/);
  assert.equal(verify.calls.length, 0, "missing token is rejected without calling siteverify");
  const wrong = await api.post("/api/register", { ...body, turnstileToken: "bad-token" });
  assert.equal(wrong.status, 403);
  const ok = await api.post("/api/register", { ...body, turnstileToken: "good-token" }, { ip: "192.0.2.44" });
  assert.equal(ok.status, 200);
  assert.deepEqual(verify.calls.at(-1), { url: SITEVERIFY_URL, secret: "secret-xyz", response: "good-token", remoteip: "192.0.2.44" });
  assert.equal(api.s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE email=?").get("bot@mail.example.com").n, 1);

  assert.equal((await api.post("/api/login", { username: "bot@mail.example.com", password: PASSWORD })).status, 403);
  // The widget's own hidden form field is accepted too.
  const login = await api.post("/api/login", { username: "bot@mail.example.com", password: PASSWORD, "cf-turnstile-response": "good-token" });
  assert.equal(login.status, 200);

  assert.equal((await api.post("/api/password/forgot", { email: "bot@mail.example.com" })).status, 403);
  assert.equal((await api.post("/api/password/forgot", { email: "bot@mail.example.com", turnstileToken: "good-token" })).status, 200);

  // Storefront pages get the Turnstile origin in CSP; the back office never does.
  assert.match(pageSecurityHeaders("/login", true)["Content-Security-Policy"], /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.match(pageSecurityHeaders("/register", true)["Content-Security-Policy"], /frame-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.equal(pageSecurityHeaders("/admin/settings", true), securityHeaders);
  assert.equal(pageSecurityHeaders("/admin", true), securityHeaders);
});

test("Turnstile fails closed when siteverify errors or times out", async () => {
  const down = createTurnstile(
    { TURNSTILE_SITE_KEY: "k", TURNSTILE_SECRET: "s" },
    { fetchImpl: async () => { throw new Error("network"); } },
  );
  assert.equal(await down.verify("good-token", "1.2.3.4"), false);
  const status500 = createTurnstile(
    { TURNSTILE_SITE_KEY: "k", TURNSTILE_SECRET: "s" },
    { fetchImpl: async () => new Response("oops", { status: 500 }) },
  );
  assert.equal(await status500.verify("good-token"), false);
  const hang = createTurnstile(
    { TURNSTILE_SITE_KEY: "k", TURNSTILE_SECRET: "s" },
    {
      timeoutMs: 30,
      fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    },
  );
  assert.equal(await hang.verify("good-token"), false);
});

// ---------------------------------------------------------------- admin visibility

test("admin › settings integrations: status and last 20 log rows, admin only, no secrets", async (t) => {
  const mailer = fakeMailer();
  const turnstile = createTurnstile({ TURNSTILE_SITE_KEY: "site-key-123", TURNSTILE_SECRET: "secret-xyz" }, { fetchImpl: fakeSiteverify().fetchImpl });
  const api = shop(t, { email: mailer, turnstile });
  const boss = await api.post("/api/demo-merchant", {});
  const buyer = await customer(api, "log@mail.example.com", { turnstileToken: "good-token" });
  for (let i = 0; i < 3; i++)
    await api.post("/api/password/forgot", { email: buyer.email, turnstileToken: "good-token" });
  await api.s.emailIdle();
  assert.equal((await api.get("/api/admin/integrations", buyer.cookie)).status, 403);
  const status = await api.get("/api/admin/integrations", boss.cookie);
  assert.equal(status.status, 200);
  assert.equal(status.body.email.enabled, true);
  assert.equal(status.body.email.provider, "test");
  assert.equal(status.body.turnstile.enabled, true);
  assert.equal(status.body.log.length, 3);
  assert.equal(status.body.log[0].recipient, "lo***@mail.example.com");
  const blob = JSON.stringify(status.body);
  assert.ok(!blob.includes("secret-xyz"));
  assert.ok(!blob.includes("log@mail.example.com"));
});
