// Admin login hardening: lockout, failed-login audit, short staff sessions,
// password re-confirm and TOTP 2FA (node:sqlite; the workerd run is in do-sqlite-adapter.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import {
  base32Decode,
  base32Encode,
  hotp,
  totpCode,
  verifyTotp,
  STAFF_IDLE_MS,
  STAFF_SESSION_MS,
  LOCK_BASE_MS,
} from "../server/auth-hardening.mjs";

const BASE = "http://127.0.0.1:4331";
const OWNER_PASSWORD = "Owner-secret-Password-1";
const MIN = 60000;

function shop(t, extra = {}) {
  let now = Date.UTC(2026, 10, 12, 3, 0, 0);
  const s = createCommerce({ adminPassword: OWNER_PASSWORD, clock: () => now, ...extra });
  t.after(() => s.db.close());
  const handle = createAPIHandler(s);
  let ipSeq = 0;
  async function call(method, path, { cookie, body, ip } = {}) {
    const headers = { Cookie: cookie ?? "" };
    // The per-IP limit (20/min, real time) is tested elsewhere; spread calls over test IPs
    // so only the per-account lockout decides here.
    headers["CF-Connecting-IP"] = ip ?? "198.18." + Math.floor(++ipSeq / 200) + "." + (ipSeq % 200);
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers["X-Astra-Request"] = "1";
    }
    const res = await handle(
      new Request(BASE + path, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      }),
    );
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    const token = /astra_session=([a-f0-9]+)/.exec(setCookie)?.[1];
    return {
      status: res.status,
      body: await res.json(),
      cookie: token ? "astra_session=" + token : undefined,
      maxAge: Number(/Max-Age=(\d+)/.exec(setCookie)?.[1] ?? NaN),
    };
  }
  return {
    s,
    get: (path, cookie) => call("GET", path, { cookie }),
    post: (path, cookie, body, ip) => call("POST", path, { cookie, body, ip }),
    tick: (ms) => (now += ms),
    now: () => now,
  };
}
const ownerLogin = (api, password = OWNER_PASSWORD, ip) =>
  api.post("/api/login", null, { email: "admin@astra.local", password }, ip);
function member(api, role, email, password = "Member-only-Password-123") {
  const auth = api.s.register({ name: "Member " + role, email, password });
  if (role !== ROLES.CUSTOMER) api.s.db.prepare("UPDATE users SET role=? WHERE id=?").run(role, auth.user.id);
  return { id: auth.user.id, email, password };
}
const auditRows = (s, action) =>
  s.db.prepare("SELECT * FROM audit WHERE action=? ORDER BY id").all(action).map((r) => ({
    ...r,
    detail: r.detail ? JSON.parse(r.detail) : null,
  }));

test("RFC 6238 / RFC 4226 reference vectors and base32", () => {
  const secret = Buffer.from("12345678901234567890");
  // RFC 4226 Appendix D
  assert.deepEqual(
    [0, 1, 2, 3, 9].map((c) => hotp(secret, c)),
    ["755224", "287082", "359152", "969429", "520489"],
  );
  // RFC 6238 Appendix B (SHA-1, 8 digits)
  assert.equal(totpCode(secret, 59000, 8), "94287082");
  assert.equal(totpCode(secret, 1111111109000, 8), "07081804");
  assert.equal(totpCode(secret, 20000000000000, 8), "65353130");
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.deepEqual(base32Decode("MZXW6YTBOI"), Buffer.from("foobar"));
  // ±1 step window, replays refused.
  const at = 1111111109000;
  const code = totpCode(secret, at);
  assert.equal(verifyTotp(secret, code, at + 30000), Math.floor(at / 30000));
  assert.equal(verifyTotp(secret, code, at - 30000), Math.floor(at / 30000));
  assert.equal(verifyTotp(secret, code, at + 90000), null);
  assert.equal(verifyTotp(secret, code, at, Math.floor(at / 30000)), null);
  assert.equal(verifyTotp(secret, "12345", at), null);
});

test("five failures lock the account for 15 minutes with backoff; unknown accounts look the same", async (t) => {
  const api = shop(t);
  for (let i = 0; i < 4; i++)
    assert.equal((await ownerLogin(api, "wrong-" + i, "203.0.113.7")).status, 401);
  const fifth = await ownerLogin(api, "wrong-5", "203.0.113.7");
  assert.equal(fifth.status, 429);
  // Even the right password is refused while locked, with the same message.
  const locked = await ownerLogin(api);
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error, fifth.body.error);
  assert.equal(locked.cookie, undefined);

  // A made-up account answers exactly like a real one.
  const ghost = [];
  for (let i = 0; i < 6; i++)
    ghost.push(await api.post("/api/login", null, { email: "nobody@example.invalid", password: "x" + i }));
  assert.deepEqual(
    ghost.map((r) => r.status),
    [401, 401, 401, 401, 429, 429],
  );
  assert.equal(ghost[0].body.error, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  assert.equal(ghost[5].body.error, locked.body.error);

  // The short name "admin" is the same account, so it is locked too.
  assert.equal((await api.post("/api/login", null, { username: "admin", password: OWNER_PASSWORD })).status, 429);

  // 15 minutes later the owner gets in, and success clears the counter.
  api.tick(LOCK_BASE_MS + 1000);
  const ok = await ownerLogin(api);
  assert.equal(ok.status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await ownerLogin(api, "again-" + i)).status, 401);
  assert.equal((await ownerLogin(api)).status, 200, "counter was reset by the success");

  // Backoff: the second lock in a row lasts 30 minutes.
  for (let i = 0; i < 5; i++) await ownerLogin(api, "b-" + i);
  api.tick(LOCK_BASE_MS + 1000);
  for (let i = 0; i < 5; i++) await ownerLogin(api, "c-" + i);
  api.tick(LOCK_BASE_MS + 1000);
  assert.equal((await ownerLogin(api)).status, 429, "second lock is longer than 15 minutes");
  api.tick(LOCK_BASE_MS);
  assert.equal((await ownerLogin(api)).status, 200);

  // Audit: masked identifier, keyed hash and IP; never the raw email or password.
  const failed = auditRows(api.s, "LOGIN_FAILED");
  assert.ok(failed.length >= 10);
  const first = failed[0];
  assert.equal(first.detail.ip, "203.0.113.7");
  assert.equal(first.detail.id, "ad***@astra.local");
  assert.match(first.detail.idHash, /^[a-f0-9]{12}$/);
  assert.equal(first.detail.reason, "password");
  assert.ok(!JSON.stringify(failed).includes("wrong-"));
  assert.ok(failed.some((r) => r.detail.reason === "locked"));
  const ghostRow = failed.find((r) => r.detail.id.endsWith("@example.invalid"));
  assert.equal(ghostRow.user_id, null);
  assert.equal(ghostRow.detail.id, "no***@example.invalid");
  assert.ok(auditRows(api.s, "LOGIN_LOCKED").length >= 2);

  // The admin audit page lists them (only plain LOGIN is hidden).
  const admin = api.s.session(ok.cookie.split("=")[1]);
  const page = api.s.adminAuditLog(admin, { action: "LOGIN" }).entries.map((e) => e.action);
  assert.ok(page.includes("LOGIN_FAILED"));
  assert.ok(page.includes("LOGIN_LOCKED"));
  assert.ok(!page.includes("LOGIN"));
  assert.ok(api.s.adminAuditLog(admin, { scope: "staff", action: "LOGIN_LOCKED" }).entries.length >= 1);
});

test("lockout is stored in SQLite and survives a restart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "shop.sqlite");
  const key = randomBytes(32);
  const first = createCommerce({ path, key, adminPassword: OWNER_PASSWORD });
  for (let i = 0; i < 5; i++)
    assert.throws(() => first.login({ email: "admin@astra.local", password: "nope-" + i }));
  first.db.close();
  const second = createCommerce({ path, key, adminPassword: OWNER_PASSWORD });
  t.after(() => second.db.close());
  assert.throws(
    () => second.login({ email: "admin@astra.local", password: OWNER_PASSWORD }),
    (e) => e.status === 429,
  );
});

test("admin and staff sessions: 12h absolute, 2h idle; customers keep 7 days", async (t) => {
  const api = shop(t);
  const owner = await ownerLogin(api);
  assert.equal(owner.maxAge, 12 * 3600);
  const staff = member(api, ROLES.STAFF, "idle-staff@example.invalid");
  const staffLogin = await api.post("/api/login", null, { email: staff.email, password: staff.password });
  assert.equal(staffLogin.maxAge, 12 * 3600);
  const buyer = await api.post("/api/register", null, {
    name: "Idle Buyer",
    email: "idle-buyer@example.invalid",
    password: "Idle-buyer-Password-123",
  });
  assert.equal(buyer.maxAge, 7 * 86400);

  // Activity every 1h55 keeps the admin in (sliding last_seen)...
  for (let i = 0; i < 3; i++) {
    api.tick(STAFF_IDLE_MS - 5 * MIN);
    assert.equal((await api.get("/api/me", owner.cookie)).body.user?.role, "ADMIN");
  }
  // ...the staff member who was idle for 2h is out, the customer is not.
  assert.equal((await api.get("/api/me", staffLogin.cookie)).body.user, null);
  assert.equal((await api.get("/api/me", buyer.cookie)).body.user?.email, "idle-buyer@example.invalid");

  // Absolute 12h even with steady activity.
  let elapsed = 3 * (STAFF_IDLE_MS - 5 * MIN);
  while (elapsed + 30 * MIN < STAFF_SESSION_MS) {
    api.tick(30 * MIN);
    elapsed += 30 * MIN;
    assert.equal((await api.get("/api/me", owner.cookie)).body.user?.role, "ADMIN");
  }
  api.tick(STAFF_SESSION_MS - elapsed);
  assert.equal((await api.get("/api/me", owner.cookie)).body.user, null);
  // Customer session is still alive at 12h+ and ends at 7 days.
  assert.ok((await api.get("/api/me", buyer.cookie)).body.user);
  api.tick(7 * 86400000);
  assert.equal((await api.get("/api/me", buyer.cookie)).body.user, null);
});

test("a session issued before the change is capped to the admin lifetime", async (t) => {
  const api = shop(t);
  const owner = await ownerLogin(api);
  const token = owner.cookie.split("=")[1];
  // Old row: no created_at / last_seen, 7-day expiry.
  api.s.db
    .prepare("UPDATE sessions SET created_at=NULL, last_seen=NULL, expires_at=? WHERE user_id=(SELECT id FROM users WHERE email='admin@astra.local')")
    .run(api.now() + 7 * 86400000);
  assert.ok(api.s.session(token));
  api.tick(STAFF_IDLE_MS + MIN);
  assert.equal(api.s.session(token), null);
});

test("sensitive actions need the current password again", async (t) => {
  const api = shop(t);
  const owner = await ownerLogin(api);
  const staff = member(api, ROLES.STAFF, "reauth-staff@example.invalid");
  const staffCookie = (await api.post("/api/login", null, { email: staff.email, password: staff.password })).cookie;
  const buyer = member(api, ROLES.CUSTOMER, "reauth-buyer@example.invalid");
  const buyerCookie = (await api.post("/api/login", null, { email: buyer.email, password: buyer.password })).cookie;
  const channel = { provider: "sandbox", active: true };

  const missing = await api.post("/api/admin/payment-channel", owner.cookie, channel);
  assert.equal(missing.status, 403);
  assert.match(missing.body.error, /รหัสผ่าน/);
  const wrong = await api.post("/api/admin/payment-channel", owner.cookie, { ...channel, currentPassword: "not-it" });
  assert.equal(wrong.status, 403);
  assert.equal((await api.get("/api/payment-channel")).body.channel.active, false);
  const ok = await api.post("/api/admin/payment-channel", owner.cookie, { ...channel, currentPassword: OWNER_PASSWORD });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.channel.active, true);
  assert.equal(auditRows(api.s, "REAUTH_FAILED").length, 1);

  // Staff and customers never reach the password step, even with a right password.
  for (const [cookie, password] of [[staffCookie, staff.password], [buyerCookie, buyer.password]])
    assert.equal(
      (await api.post("/api/admin/payment-channel", cookie, { ...channel, currentPassword: password })).status,
      403,
    );
  for (const [cookie, password] of [[staffCookie, staff.password], [buyerCookie, buyer.password]])
    assert.equal(
      (await api.post("/api/admin/team", cookie, { name: "Sneaky", email: "sneaky@example.invalid", role: "ADMIN", currentPassword: password }))
        .status,
      403,
    );

  // New admin and grant admin over HTTP.
  const noPw = await api.post("/api/admin/team", owner.cookie, { name: "Second Admin", email: "second@example.invalid", role: "ADMIN" });
  assert.equal(noPw.status, 403);
  const made = await api.post("/api/admin/team", owner.cookie, {
    name: "Second Admin",
    email: "second@example.invalid",
    role: "ADMIN",
    currentPassword: OWNER_PASSWORD,
  });
  assert.equal(made.status, 200);
  assert.equal(made.body.member.role, "ADMIN");
  const grantNoPw = await api.post("/api/admin/team", owner.cookie, { id: staff.id, name: "Promoted", role: "ADMIN" });
  assert.equal(grantNoPw.status, 403);
  const grant = await api.post("/api/admin/team", owner.cookie, { id: staff.id, name: "Promoted", role: "ADMIN", currentPassword: OWNER_PASSWORD });
  assert.equal(grant.status, 200);
  // Removing admin rights does not ask for the password.
  const demote = await api.post("/api/admin/team", owner.cookie, { id: staff.id, name: "Promoted", role: "STAFF" });
  assert.equal(demote.status, 200);

  // Five wrong re-confirms lock the account like five wrong logins.
  for (let i = 0; i < 4; i++)
    await api.post("/api/admin/payment-channel", owner.cookie, { ...channel, currentPassword: "nope" + i });
  assert.equal((await api.post("/api/admin/payment-channel", owner.cookie, { ...channel, currentPassword: "nope" })).status, 429);
  assert.equal((await ownerLogin(api)).status, 429);
});

async function enableTotp(api, cookie, password) {
  const setupNoPw = await api.post("/api/account/totp/setup", cookie, {});
  assert.equal(setupNoPw.status, 403);
  const setup = await api.post("/api/account/totp/setup", cookie, { currentPassword: password });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  assert.match(setup.body.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.body.otpauthUrl, /^otpauth:\/\/totp\/ASIA%20EXTRA%3A.+\?secret=[A-Z2-7]{32}&issuer=ASIA%20EXTRA/);
  const secret = base32Decode(setup.body.secret);
  const bad = await api.post("/api/account/totp/enable", cookie, { code: "000000" === totpCode(secret, api.now()) ? "111111" : "000000" });
  assert.equal(bad.status, 400);
  const enabled = await api.post("/api/account/totp/enable", cookie, { code: totpCode(secret, api.now()) });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  return { secret, base32: setup.body.secret, recoveryCodes: enabled.body.recoveryCodes };
}

test("TOTP: enable, sign in with code, recovery code, disable", async (t) => {
  const api = shop(t);
  const owner = await ownerLogin(api);
  assert.deepEqual((await api.get("/api/account/totp", owner.cookie)).body, {
    enabled: false,
    enabledAt: null,
    recoveryCodesLeft: 0,
  });
  const { secret, base32, recoveryCodes } = await enableTotp(api, owner.cookie, OWNER_PASSWORD);
  assert.equal(recoveryCodes.length, 8);
  assert.equal(new Set(recoveryCodes).size, 8);
  for (const c of recoveryCodes) assert.match(c, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
  const status = (await api.get("/api/account/totp", owner.cookie)).body;
  assert.equal(status.enabled, true);
  assert.equal(status.recoveryCodesLeft, 8);
  // Secret and recovery codes are not stored in clear text.
  const dump = JSON.stringify(api.s.db.prepare("SELECT * FROM user_totp").all()) +
    JSON.stringify(api.s.db.prepare("SELECT * FROM totp_recovery_codes").all());
  assert.ok(!dump.includes(base32));
  for (const c of recoveryCodes) assert.ok(!dump.includes(c) && !dump.includes(c.replace("-", "")));
  // A second setup is refused while 2FA is on.
  assert.equal((await api.post("/api/account/totp/setup", owner.cookie, { currentPassword: OWNER_PASSWORD })).status, 409);

  // Step 1: password → challenge, no cookie.
  api.tick(60000);
  const step1 = await ownerLogin(api, OWNER_PASSWORD, "198.51.100.4");
  assert.equal(step1.status, 200);
  assert.equal(step1.body.needsTotp, true);
  assert.match(step1.body.challenge, /^[a-f0-9]{64}$/);
  assert.equal(step1.cookie, undefined);
  assert.equal(step1.body.user, undefined);
  // Wrong code → 401 and audited.
  const wrong = await api.post("/api/login/totp", null, { challenge: step1.body.challenge, code: "000000" === totpCode(secret, api.now()) ? "111111" : "000000" }, "198.51.100.4");
  assert.equal(wrong.status, 401);
  const failedRow = auditRows(api.s, "LOGIN_TOTP_FAILED").at(-1);
  assert.equal(failedRow.detail.ip, "198.51.100.4");
  // Right code → session.
  const code = totpCode(secret, api.now());
  const step2 = await api.post("/api/login/totp", null, { challenge: step1.body.challenge, code });
  assert.equal(step2.status, 200, JSON.stringify(step2.body));
  assert.equal(step2.body.user.role, "ADMIN");
  assert.ok(step2.cookie);
  assert.equal(step2.maxAge, 12 * 3600);
  // The challenge is single use and the same code cannot be replayed.
  assert.equal((await api.post("/api/login/totp", null, { challenge: step1.body.challenge, code })).status, 401);
  const again = await ownerLogin(api);
  assert.equal((await api.post("/api/login/totp", null, { challenge: again.body.challenge, code })).status, 401);

  // Recovery code works once.
  const recovery = await api.post("/api/login/totp", null, { challenge: again.body.challenge, code: recoveryCodes[0].toUpperCase() });
  assert.equal(recovery.status, 200, JSON.stringify(recovery.body));
  assert.equal(auditRows(api.s, "RECOVERY_CODE_USED").at(-1).detail.remaining, 7);
  const third = await ownerLogin(api);
  assert.equal((await api.post("/api/login/totp", null, { challenge: third.body.challenge, code: recoveryCodes[0] })).status, 401);
  assert.equal((await api.get("/api/account/totp", recovery.cookie)).body.recoveryCodesLeft, 7);

  // Challenge expires after 5 minutes.
  const late = await ownerLogin(api);
  api.tick(5 * MIN + 1000);
  const expired = await api.post("/api/login/totp", null, { challenge: late.body.challenge, code: totpCode(secret, api.now()) });
  assert.equal(expired.status, 401);

  // Disable needs password + code.
  api.tick(60000);
  assert.equal((await api.post("/api/account/totp/disable", recovery.cookie, { code: totpCode(secret, api.now()) })).status, 403);
  assert.equal(
    (await api.post("/api/account/totp/disable", recovery.cookie, { currentPassword: OWNER_PASSWORD, code: "12" })).status,
    403,
  );
  const off = await api.post("/api/account/totp/disable", recovery.cookie, {
    currentPassword: OWNER_PASSWORD,
    code: totpCode(secret, api.now()),
  });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.enabled, false);
  assert.equal(api.s.db.prepare("SELECT COUNT(*) AS n FROM totp_recovery_codes").get().n, 0);
  const plain = await ownerLogin(api);
  assert.equal(plain.body.needsTotp, undefined);
  assert.ok(plain.cookie);

  for (const action of ["TOTP_ENABLE", "TOTP_DISABLE", "LOGIN_TOTP_FAILED", "RECOVERY_CODE_USED"])
    assert.ok(auditRows(api.s, action).length >= 1, action);
});

test("TOTP code guesses count toward the account lockout", async (t) => {
  const api = shop(t);
  const owner = await ownerLogin(api);
  const { secret } = await enableTotp(api, owner.cookie, OWNER_PASSWORD);
  const wrongCode = () => (totpCode(secret, api.now()) === "000000" ? "111111" : "000000");
  let challenge = (await ownerLogin(api)).body.challenge;
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const r = await api.post("/api/login/totp", null, { challenge, code: wrongCode() });
    statuses.push(r.status);
    if (i === 2) challenge = (await ownerLogin(api)).body.challenge; // a fresh password step does not reset the count
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 429]);
  assert.equal((await ownerLogin(api)).status, 429);
  assert.ok(auditRows(api.s, "LOGIN_LOCKED").length >= 1);
});

test("2FA endpoints are for ADMIN and STAFF on their own account only", async (t) => {
  const api = shop(t);
  const buyer = member(api, ROLES.CUSTOMER, "totp-buyer@example.invalid");
  const buyerCookie = (await api.post("/api/login", null, { email: buyer.email, password: buyer.password })).cookie;
  assert.equal((await api.get("/api/account/totp", buyerCookie)).status, 403);
  for (const path of ["setup", "enable", "disable"])
    assert.equal((await api.post("/api/account/totp/" + path, buyerCookie, { currentPassword: buyer.password, code: "123456" })).status, 403);
  assert.equal((await api.get("/api/account/totp")).status, 401);

  // Staff can protect their own login.
  const staff = member(api, ROLES.STAFF, "totp-staff@example.invalid");
  const staffCookie = (await api.post("/api/login", null, { email: staff.email, password: staff.password })).cookie;
  const { secret } = await enableTotp(api, staffCookie, staff.password);
  const step1 = await api.post("/api/login", null, { email: staff.email, password: staff.password });
  assert.equal(step1.body.needsTotp, true);
  api.tick(31000);
  const step2 = await api.post("/api/login/totp", null, { challenge: step1.body.challenge, code: totpCode(secret, api.now()) });
  assert.equal(step2.status, 200);
  assert.equal(step2.body.user.role, "STAFF");
  // Staff 2FA does not leak into the owner's status.
  const owner = await ownerLogin(api);
  assert.equal((await api.get("/api/account/totp", owner.cookie)).body.enabled, false);
});

test("the existing per-IP limit still covers both login steps", async (t) => {
  const api = shop(t);
  const statuses = [];
  for (let i = 0; i < 21; i++)
    statuses.push(
      (
        await api.post(
          i % 2 ? "/api/login" : "/api/login/totp",
          null,
          { email: "ip-" + i + "@example.invalid", password: "x", challenge: "0".repeat(64), code: "123456" },
          "192.0.2.50",
        )
      ).status,
    );
  assert.equal(statuses.at(-1), 429);
  assert.ok(statuses.slice(0, 20).every((s) => s !== 429));
});

test("rotating the env admin secret clears the owner's 2FA (escape hatch)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-hatch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "shop.sqlite");
  const key = randomBytes(32);
  const first = createCommerce({ path, key, adminPassword: OWNER_PASSWORD });
  const token = first.login({ email: "admin@astra.local", password: OWNER_PASSWORD }).token;
  const owner = first.session(token);
  const { secret } = first.totpSetup(owner, { currentPassword: OWNER_PASSWORD });
  first.totpEnable(owner, { code: totpCode(base32Decode(secret), Date.now()) });
  assert.equal(first.login({ email: "admin@astra.local", password: OWNER_PASSWORD }).needsTotp, true);
  first.db.close();

  // Same secret: 2FA stays on.
  const same = createCommerce({ path, key, adminPassword: OWNER_PASSWORD });
  assert.equal(same.login({ email: "admin@astra.local", password: OWNER_PASSWORD }).needsTotp, true);
  same.db.close();

  // Rotated secret: password reset and 2FA cleared.
  const rotated = "Rotated-owner-Password-2";
  const after = createCommerce({ path, key, adminPassword: rotated });
  t.after(() => after.db.close());
  const signedIn = after.login({ email: "admin@astra.local", password: rotated });
  assert.equal(signedIn.needsTotp, undefined);
  assert.ok(signedIn.token);
  assert.equal(after.db.prepare("SELECT COUNT(*) AS n FROM user_totp").get().n, 0);
  assert.equal(after.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='TOTP_RESET'").get().n, 1);
});
