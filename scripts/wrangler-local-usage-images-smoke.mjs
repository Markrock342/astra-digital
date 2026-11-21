/**
 * วิธีใช้งาน pictures (product_usage_images) against wrangler dev --local: the table exists in
 * the Durable Object, admin uploads / lists / removes, the file is served.
 * Usage: npm run build && npm run cloud:dev
 *        node scripts/wrangler-local-usage-images-smoke.mjs [baseUrl]
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:4340";

function loadAdminPassword() {
  if (process.env.ASTRA_ADMIN_PASSWORD?.length >= 8)
    return process.env.ASTRA_ADMIN_PASSWORD;
  if (!existsSync(".dev.vars"))
    throw new Error("Missing .dev.vars — run npm run cloud:setup");
  const match = /^ASTRA_ADMIN_PASSWORD=(.+)$/m.exec(
    readFileSync(".dev.vars", "utf8"),
  );
  if (!match?.[1] || match[1].trim().length < 8)
    throw new Error("Add ASTRA_ADMIN_PASSWORD (>=8) to .dev.vars");
  return match[1].trim();
}

// Real 1×1 images (not magic-only stubs). Fake RIFF/WEBP stubs make browsers show a broken icon.
function webpBytes() {
  return Uint8Array.from(
    Buffer.from(
      "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
      "base64",
    ),
  );
}

function pngBytes() {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}

const adminPassword = loadAdminPassword();
const jar = new Map();
let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? " — " + detail : ""));
  console.log("PASS", ++passed, name);
}

async function api(method, path, { body, contentType, json } = {}) {
  const headers = { "X-Astra-Request": "1", Origin: base };
  if (jar.size)
    headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  let payload = body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(json);
  } else if (contentType) {
    headers["Content-Type"] = contentType;
  }
  if (payload != null)
    headers["Content-Length"] = String(
      payload.byteLength ?? Buffer.byteLength(payload),
    );
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  const response = await fetch(base + path, {
    method,
    headers,
    body: payload,
    signal: ac.signal,
  });
  clearTimeout(timer);
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const line of raw.length ? raw : [response.headers.get("set-cookie")].filter(Boolean)) {
    const [pair] = String(line).split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const buf = new Uint8Array(await response.arrayBuffer());
  const ct = response.headers.get("Content-Type") || "";
  const data = ct.includes("application/json")
    ? JSON.parse(new TextDecoder().decode(buf))
    : null;
  return { status: response.status, data, buf, headers: response.headers };
}

jar.clear();
const login = await api("POST", "/api/login", {
  json: { email: "admin@astra.local", password: adminPassword },
});
ok("admin login", login.status === 200 && login.data?.user?.role === "ADMIN");

const product = await api("POST", "/api/admin/products", {
  json: {
    name: "Wrangler Usage QA " + randomUUID().slice(0, 6),
    description: "smoke usage pictures on wrangler local",
    category: "streaming",
    price: 500,
    active: true,
  },
});
ok("create product", product.status === 200, JSON.stringify(product.data));
const productId = product.data.id;

const empty = await api("GET", `/api/admin/products/${productId}/usage-images`);
ok("list empty", empty.status === 200 && empty.data.images.length === 0, JSON.stringify(empty.data));

const up1 = await api("POST", `/api/admin/products/${productId}/usage-images`, { body: webpBytes(), contentType: "image/webp" });
ok("upload webp", up1.status === 200 && up1.data.images.length === 1, JSON.stringify(up1.data));
const up2 = await api("POST", `/api/admin/products/${productId}/usage-images`, { body: pngBytes(), contentType: "image/png" });
ok("upload png", up2.status === 200 && up2.data.images.length === 2, JSON.stringify(up2.data));

const file = await api("GET", up1.data.images[0].url);
ok("file served", file.status === 200 && file.headers.get("Content-Type") === "image/webp");

const bad = await api("POST", `/api/admin/products/${productId}/usage-images`, { body: new TextEncoder().encode("not an image"), contentType: "image/png" });
ok("non-image refused", bad.status >= 400 && bad.status < 500, String(bad.status));

const removed = await api("DELETE", `/api/admin/usage-images/${up1.data.images[0].id}`);
ok("remove", removed.status === 200 && removed.data.images.length === 1, JSON.stringify(removed.data));

jar.clear();
const anon = await api("GET", `/api/admin/products/${productId}/usage-images`);
ok("guests refused", anon.status === 401 || anon.status === 403, String(anon.status));
console.log("usage-images smoke: " + passed + " passed");
