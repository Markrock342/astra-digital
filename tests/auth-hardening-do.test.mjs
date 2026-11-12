// Same 2FA + lockout flow inside workerd with Durable Object SQLite (cloud/worker.mjs),
// because DO SQLite has different semantics from node:sqlite (run() → rowsWritten).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { base32Decode, totpCode } from "../server/auth-hardening.mjs";

test("workerd DO: TOTP enable, two-step login, recovery code, lockout, disable", { timeout: 120000 }, async (t) => {
  const { Miniflare, convertV4MiniflareOptions } = await import("miniflare");
  const { build } = await import("esbuild");
  const dir = mkdtempSync(join(tmpdir(), "astra-do-auth-"));
  const root = fileURLToPath(new URL("../", import.meta.url));
  let mf;
  t.after(async () => {
    await mf?.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
  const adminPassword = "DoAuthTest-Admin-77";
  const script = (
    await build({
      entryPoints: [join(root, "cloud/worker.mjs")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      target: "es2022",
      external: ["cloudflare:workers", "node:*"],
      loader: { ".sql": "text" },
    })
  ).outputFiles[0].text;
  mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "astra-do-auth",
      modules: true,
      script,
      compatibilityDate: "2026-10-01",
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { COMMERCE: { className: "Commerce", useSQLite: true } },
      bindings: {
        INVENTORY_KEY: "do-auth-inventory-fixture-only",
        ASTRA_ADMIN_PASSWORD: adminPassword,
      },
      cf: false,
    }),
    resourcePersistencePath: dir,
  });
  const ns = await mf.getDurableObjectNamespace("COMMERCE");
  const stub = ns.get(ns.idFromName("shop"));
  let ipSeq = 0;
  async function api(method, path, body, cookie) {
    const headers = { "X-Astra-Request": "1", "CF-Connecting-IP": "198.18.1." + (++ipSeq % 250) };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await stub.fetch("http://fixture" + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    const token = /astra_session=([a-f0-9]+)/.exec(setCookie)?.[1];
    return { status: res.status, data: await res.json(), cookie: token ? "astra_session=" + token : undefined, setCookie };
  }
  const login = (password = adminPassword) => api("POST", "/api/login", { email: "admin@astra.local", password });

  const first = await login();
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.match(first.setCookie, /Max-Age=43200/);
  const setup = await api("POST", "/api/account/totp/setup", { currentPassword: adminPassword }, first.cookie);
  assert.equal(setup.status, 200, JSON.stringify(setup.data));
  const secret = base32Decode(setup.data.secret);
  const enabled = await api("POST", "/api/account/totp/enable", { code: totpCode(secret, Date.now()) }, first.cookie);
  assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
  assert.equal(enabled.data.recoveryCodes.length, 8);

  // Password step → challenge, recovery code → session (conditional UPDATE must report changes on DO).
  const step1 = await login();
  assert.equal(step1.data.needsTotp, true);
  assert.equal(step1.cookie, undefined);
  const step2 = await api("POST", "/api/login/totp", { challenge: step1.data.challenge, code: enabled.data.recoveryCodes[0] });
  assert.equal(step2.status, 200, JSON.stringify(step2.data));
  assert.equal(step2.data.user.role, "ADMIN");
  const reused = await login();
  assert.equal(
    (await api("POST", "/api/login/totp", { challenge: reused.data.challenge, code: enabled.data.recoveryCodes[0] })).status,
    401,
    "a recovery code is single use on DO too",
  );

  // Disable with password + recovery code, then lockout after five wrong passwords.
  const off = await api(
    "POST",
    "/api/account/totp/disable",
    { currentPassword: adminPassword, code: enabled.data.recoveryCodes[1] },
    step2.cookie,
  );
  assert.equal(off.status, 200, JSON.stringify(off.data));
  const okAgain = await login();
  assert.equal(okAgain.status, 200);
  assert.ok(okAgain.cookie, "no 2FA after disable");
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await login("wrong-" + i)).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 429, 429]);
  assert.equal((await login()).status, 429);

  // Audit page shows the security events.
  const audit = await api("GET", "/api/admin/audit?action=LOGIN&limit=100", undefined, okAgain.cookie);
  assert.equal(audit.status, 200, JSON.stringify(audit.data));
  const actions = new Set(audit.data.entries.map((e) => e.action));
  for (const a of ["LOGIN_FAILED", "LOGIN_LOCKED", "LOGIN_TOTP_FAILED"]) assert.ok(actions.has(a), a);
});
