/**
 * Wrangler --local smoke: POST /api/admin/launch/cleanup dryRun then refuse without password.
 * Usage: node scripts/wrangler-local-launch-cleanup-smoke.mjs http://127.0.0.1:4346
 */
const base = (process.argv[2] || "http://127.0.0.1:4346").replace(/\/$/, "");
const ADMIN_EMAIL = "admin@astra.local";
const ADMIN_PASSWORD = process.env.ASTRA_ADMIN_PASSWORD || "admin1234";

async function req(path, { method = "GET", cookie, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json", "X-Astra-Request": "1" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
}

const login = await req("/api/login", {
  method: "POST",
  body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
});
if (login.status !== 200) {
  console.error("login failed", login.status, login.json);
  process.exit(1);
}
const cookie = /astra_session=[^;]+/.exec(login.setCookie || "")?.[0];
if (!cookie) {
  console.error("no session cookie");
  process.exit(1);
}

const denied = await req("/api/admin/launch/cleanup", {
  method: "POST",
  cookie,
  body: { currentPassword: "not-the-password" },
});
if (denied.status !== 403) {
  console.error("expected 403 for bad password", denied.status, denied.json);
  process.exit(1);
}

const dry = await req("/api/admin/launch/cleanup", {
  method: "POST",
  cookie,
  body: { currentPassword: ADMIN_PASSWORD },
});
if (dry.status !== 200 || dry.json.dryRun !== true || !dry.json.remove) {
  console.error("dryRun failed", dry.status, dry.json);
  process.exit(1);
}

const health = await req("/api/admin/health", { cookie });
if (health.status !== 200 || health.json.ok !== true) {
  console.error("health not ok", health.status, health.json);
  process.exit(1);
}

console.log("launch-cleanup smoke OK", {
  removeCustomers: dry.json.remove.customers,
  healthOk: health.json.ok,
});
