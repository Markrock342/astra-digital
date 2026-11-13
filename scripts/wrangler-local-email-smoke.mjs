/**
 * Email + Turnstile smoke against `wrangler dev --local` (Durable Object SQLite, real
 * workerd). Starts wrangler twice with a throw-away state folder; nothing is deployed and
 * no real email is sent:
 *
 *   1. OFF  — no email / Turnstile config: health flags false, forgot-password 404,
 *             register works without a token, storefront CSP unchanged.
 *   2. ON   — RESEND_API_KEY + EMAIL_FROM with EMAIL_API_BASE pointing at a local mock
 *             Resend server, and Cloudflare's public Turnstile TEST keys with
 *             TURNSTILE_VERIFY_URL pointing at a local mock siteverify (both started here;
 *             the mock accepts only the test secret + dummy token, like Cloudflare does).
 *             Runs register → verify email (link captured by the mock) → forgot → reset →
 *             login → admin email log.
 *
 * Usage:  npm run build && node scripts/wrangler-local-email-smoke.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

if (!existsSync("dist/index.html")) throw new Error("Run npm run build first");

// Cloudflare's documented Turnstile test keys (always pass). Not secrets.
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const ADMIN_PASSWORD = "Smoke-admin-" + randomBytes(8).toString("hex");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? " — " + JSON.stringify(detail).slice(0, 400) : ""));
  console.log("PASS", ++passed, name);
}
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function startWrangler(vars) {
  const port = await freePort();
  const state = mkdtempSync(join(tmpdir(), "astra-email-smoke-"));
  const args = ["wrangler", "dev", "--local", "--port", String(port), "--persist-to", state, "--log-level", "warn"];
  for (const [k, v] of Object.entries(vars)) args.push("--var", k + ":" + v);
  const child = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) return { child, base, state, log: () => log };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill("SIGTERM");
  throw new Error("wrangler dev did not start:\n" + log.slice(-2000));
}
async function stopWrangler(w) {
  w.child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 800));
  rmSync(w.state, { recursive: true, force: true });
}
function client(base) {
  const jar = new Map();
  return {
    jar,
    async call(method, path, body, ip = "203.0.113." + (1 + Math.floor(Math.random() * 200))) {
      const headers = { "X-Astra-Request": "1", Origin: base, "CF-Connecting-IP": ip };
      if (jar.size) headers.Cookie = [...jar].map(([k, v]) => k + "=" + v).join("; ");
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(";");
        const i = pair.indexOf("=");
        if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
    },
  };
}
const baseVars = {
  INVENTORY_KEY: randomBytes(32).toString("hex"),
  ASTRA_ADMIN_PASSWORD: ADMIN_PASSWORD,
};

// ---------------------------------------------------------------- 1. OFF
{
  const w = await startWrangler(baseVars);
  try {
    const api = client(w.base);
    const health = await api.call("GET", "/api/health");
    ok("off: storage is Durable Object SQLite", health.data.storage === "cloudflare-durable-sqlite", health.data);
    ok("off: features.email false", health.data.features?.email === false);
    ok("off: features.turnstile false", health.data.features?.turnstile === false);
    ok("off: features.emailVerification true (gate stays off without email)", health.data.features?.emailVerification === true);
    ok("off: no site key", health.data.turnstileSiteKey === null);
    const forgot = await api.call("POST", "/api/password/forgot", { email: "smoke@mail.example.com" });
    ok("off: forgot-password 404 with Thai text", forgot.status === 404 && /ติดต่อร้าน/.test(forgot.data.error), forgot);
    const reg = await api.call("POST", "/api/register", { name: "Smoke Off", username: "smoke_off", password: "Smoke-off-Password-1" });
    ok("off: register works without a Turnstile token", reg.status === 200, reg);
    const offMe = await api.call("GET", "/api/me");
    ok("off: no email → verification not required", offMe.data.user?.emailVerification?.required === false, offMe.data);
    const page = await fetch(w.base + "/login");
    ok("off: storefront CSP unchanged", page.headers.get("content-security-policy")?.includes("script-src 'self';"));
  } finally {
    await stopWrangler(w);
  }
}

// ---------------------------------------------------------------- 2. ON (mock Resend)
const outbox = [];
const verifyCalls = [];
const mock = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/siteverify") {
      const form = new URLSearchParams(body);
      verifyCalls.push(Object.fromEntries(form));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: form.get("secret") === TEST_SECRET && form.get("response") === DUMMY_TOKEN }));
    } else if (req.method === "POST" && req.url === "/emails" && req.headers.authorization === "Bearer re_local_mock_key") {
      outbox.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "mock-" + outbox.length }));
    } else {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "bad mock request" }));
    }
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockBase = "http://127.0.0.1:" + mock.address().port;
{
  const w = await startWrangler({
    ...baseVars,
    EMAIL_FROM: "shop@mail.example.com",
    RESEND_API_KEY: "re_local_mock_key",
    EMAIL_API_BASE: mockBase,
    TURNSTILE_SITE_KEY: TEST_SITE_KEY,
    TURNSTILE_SECRET: TEST_SECRET,
    TURNSTILE_VERIFY_URL: mockBase + "/siteverify",
  });
  try {
    const api = client(w.base);
    const health = await api.call("GET", "/api/health");
    ok("on: features.email true", health.data.features?.email === true, health.data);
    ok("on: features.turnstile true + site key", health.data.features?.turnstile === true && health.data.turnstileSiteKey === TEST_SITE_KEY);
    const login = await fetch(w.base + "/login");
    ok("on: storefront CSP allows challenges.cloudflare.com", /script-src 'self' https:\/\/challenges\.cloudflare\.com/.test(login.headers.get("content-security-policy")));
    const admin = await fetch(w.base + "/admin");
    ok("on: /admin CSP stays strict", admin.headers.get("content-security-policy")?.includes("script-src 'self';"));
    const noToken = await api.call("POST", "/api/register", { name: "Smoke On", email: "smoke-on@mail.example.com", password: "Smoke-on-Password-12" });
    ok("on: register without a token → Thai 403", noToken.status === 403 && /บอท/.test(noToken.data.error), noToken);

    const reg = await api.call("POST", "/api/register", {
      name: "Smoke On",
      email: "smoke-on@mail.example.com",
      password: "Smoke-on-Password-12",
      turnstileToken: DUMMY_TOKEN,
    });
    ok("on: register with the test token", reg.status === 200, [reg, w.log().slice(-800)]);
    ok("on: siteverify got secret + token + client IP", verifyCalls.at(-1)?.secret === TEST_SECRET && verifyCalls.at(-1)?.response === DUMMY_TOKEN && !!verifyCalls.at(-1)?.remoteip, verifyCalls);
    {
      // Email verification: sign-up link → verify on the Worker (Durable Object SQLite).
      ok("on: features.emailVerification true", health.data.features?.emailVerification === true);
      const before = await api.call("GET", "/api/me");
      ok("on: new account unverified, gate on", before.data.user?.emailVerified === false && before.data.user?.emailVerification?.required === true, before.data);
      for (let i = 0; i < 40 && !outbox.length; i++) await new Promise((r) => setTimeout(r, 250));
      const verifyMail = outbox[0];
      const verifyLink = /\/verify-email\?token=([a-f0-9]{64})/.exec(verifyMail?.text ?? "");
      ok("on: verification email reached the mock with a link", !!verifyLink && verifyMail.to[0] === "smoke-on@mail.example.com", outbox);
      const bad = await api.call("POST", "/api/verify-email", { token: "f".repeat(64) });
      ok("on: wrong token → 400", bad.status === 400, bad);
      const verified = await api.call("POST", "/api/verify-email", { token: verifyLink[1] });
      ok("on: verify 200", verified.status === 200 && verified.data.alreadyVerified === false, verified);
      const after = await api.call("GET", "/api/me");
      ok("on: account verified", after.data.user?.emailVerified === true, after.data);
      const noMail = await api.call("POST", "/api/register", { name: "No Mail", username: "smoke_nomail", password: "Smoke-on-Password-12", turnstileToken: DUMMY_TOKEN });
      ok("on: sign-up without an email refused while verification is on", noMail.status === 400, noMail);
      outbox.length = 0;
      api.jar.clear();
      const forgot = await api.call("POST", "/api/password/forgot", { email: "smoke-on@mail.example.com", turnstileToken: DUMMY_TOKEN });
      const unknown = await api.call("POST", "/api/password/forgot", { email: "nobody@mail.example.com", turnstileToken: DUMMY_TOKEN });
      ok("on: forgot answers the same for known and unknown", forgot.status === 200 && JSON.stringify(forgot.data) === JSON.stringify(unknown.data), [forgot, unknown]);
      for (let i = 0; i < 40 && !outbox.length; i++) await new Promise((r) => setTimeout(r, 250));
      ok("on: one email reached the mock Resend", outbox.length === 1, outbox);
      const mail = outbox[0];
      ok("on: from / to", /^(?:[^<>]+ <shop@mail\.example\.com>|shop@mail\.example\.com)$/.test(mail.from) && mail.to[0] === "smoke-on@mail.example.com", mail);
      const link = /\/reset-password\?token=([a-f0-9]{64})/.exec(mail.text);
      ok("on: email has the reset link, no password", !!link && !mail.text.includes("Smoke-on-Password-12"));
      const reset = await api.call("POST", "/api/password/reset", { token: link[1], newPassword: "Smoke-new-Password-34" });
      ok("on: reset 200", reset.status === 200, reset);
      const reuse = await api.call("POST", "/api/password/reset", { token: link[1], newPassword: "Smoke-third-Password-5" });
      ok("on: token is single-use", reuse.status === 400, reuse);
      const signIn = await api.call("POST", "/api/login", { username: "smoke-on@mail.example.com", password: "Smoke-new-Password-34", turnstileToken: DUMMY_TOKEN });
      ok("on: login with the new password", signIn.status === 200, signIn);
      const boss = client(w.base);
      const bossLogin = await boss.call("POST", "/api/login", { username: "admin", password: ADMIN_PASSWORD, turnstileToken: DUMMY_TOKEN });
      ok("on: owner login", bossLogin.status === 200, bossLogin);
      const status = await boss.call("GET", "/api/admin/integrations");
      ok(
        "on: admin email log row (resend, ok, masked)",
        status.status === 200 && status.data.log[0]?.ok === 1 && status.data.log[0]?.provider === "resend" && status.data.log[0]?.recipient === "sm***@mail.example.com",
        status.data,
      );
      ok("on: no secret in the admin status", !JSON.stringify(status.data).includes("re_local_mock_key") && !JSON.stringify(status.data).includes(TEST_SECRET));
    }
  } finally {
    await stopWrangler(w);
    mock.close();
  }
}
console.log(`\n${passed} checks passed`);
