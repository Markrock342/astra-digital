/**
 * Home promo banners smoke against wrangler dev --local (Durable Object SQLite, files BLOB).
 * Usage: npm run build && npx wrangler dev --local …
 *        ASTRA_ADMIN_PASSWORD=… node scripts/wrangler-local-banners-smoke.mjs [baseUrl]
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:4340";
function loadAdminPassword() {
  if (process.env.ASTRA_ADMIN_PASSWORD?.length >= 8) return process.env.ASTRA_ADMIN_PASSWORD;
  if (!existsSync(".dev.vars")) throw new Error("Missing .dev.vars — run npm run cloud:setup");
  const match = /^ASTRA_ADMIN_PASSWORD=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"));
  if (!match?.[1] || match[1].trim().length < 8) throw new Error("Add ASTRA_ADMIN_PASSWORD (>=8) to .dev.vars");
  return match[1].trim();
}
// Real 1×1 images.
const webp = () =>
  Uint8Array.from(Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=", "base64"));
const png = () =>
  Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );

const jar = new Map();
let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? " — " + detail : ""));
  console.log("PASS", ++passed, name);
}
async function api(method, path, { body, contentType, json, cookie = true } = {}) {
  const headers = { "X-Astra-Request": "1", Origin: base };
  if (cookie && jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  let payload = body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(json);
  } else if (contentType) headers["Content-Type"] = contentType;
  if (payload != null) headers["Content-Length"] = String(payload.byteLength ?? Buffer.byteLength(payload));
  const response = await fetch(base + path, { method, headers, body: payload, signal: AbortSignal.timeout(20000) });
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair] = String(line).split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const buf = new Uint8Array(await response.arrayBuffer());
  const ct = response.headers.get("Content-Type") || "";
  const data = ct.includes("application/json") ? JSON.parse(new TextDecoder().decode(buf)) : null;
  return { status: response.status, data, buf, headers: response.headers };
}

const health = await api("GET", "/api/health");
ok("homeBanners feature", health.data?.features?.homeBanners === true);
const before = await api("GET", "/api/overview");
ok("overview has banners list", Array.isArray(before.data?.banners), JSON.stringify(before.data?.banners));
const startCount = before.data.banners.length;

ok("guest cannot list banners", (await api("GET", "/api/admin/banners", { cookie: false })).status === 401);
const login = await api("POST", "/api/login", { json: { email: "admin@astra.local", password: loadAdminPassword() } });
ok("admin login", login.status === 200 && login.data?.user?.role === "ADMIN");

const bad = await api("POST", "/api/admin/banners", { json: { alt: "x", link: "javascript:alert(1)" } });
ok("javascript: link refused", bad.status === 400);
const created = await api("POST", "/api/admin/banners", {
  json: { alt: "Wrangler banner", link: "/products?category=streaming" },
});
ok("create banner", created.status === 201 && created.data.banner.status === "draft", JSON.stringify(created.data));
const id = created.data.banner.id;
ok("draft not public", (await api("GET", "/api/overview")).data.banners.length === startCount);

const up = await api("POST", `/api/admin/banners/${id}/image`, { body: webp(), contentType: "image/webp" });
ok("upload main image", up.status === 200 && up.data.banner.status === "live", JSON.stringify(up.data));
const mobile = await api("POST", `/api/admin/banners/${id}/mobile-image`, { body: png(), contentType: "image/png" });
ok("upload mobile image", mobile.status === 200 && mobile.data.banner.mobileImageUrl);
const svg = await api("POST", `/api/admin/banners/${id}/image`, {
  body: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
  contentType: "image/svg+xml",
});
ok("svg refused", svg.status === 415);

const shown = await api("GET", "/api/overview", { cookie: false });
const banner = shown.data.banners.find((b) => b.id === id);
ok("public overview shows banner", banner?.link === "/products?category=streaming", JSON.stringify(shown.data.banners));
const image = await api("GET", banner.imageUrl, { cookie: false });
ok("banner image is public", image.status === 200 && image.headers.get("Content-Type") === "image/webp");

const off = await api("PATCH", `/api/admin/banners/${id}`, { json: { active: false } });
ok("switch off", off.status === 200 && off.data.banner.status === "off");
ok("hidden when off", !(await api("GET", "/api/overview")).data.banners.some((b) => b.id === id));
const sched = await api("PATCH", `/api/admin/banners/${id}`, { json: { active: true, startsAt: "2099-01-01T00:00" } });
ok("scheduled in the future", sched.status === 200 && sched.data.banner.status === "scheduled");

const del = await api("DELETE", `/api/admin/banners/${id}`);
ok("delete removes both files", del.status === 200 && del.data.filesRemoved === 2, JSON.stringify(del.data));
ok("image gone after delete", (await api("GET", banner.imageUrl)).status === 404);
ok("overview back to start", (await api("GET", "/api/overview")).data.banners.length === startCount);

console.log("\nwrangler local banners smoke:", passed, "passed");
