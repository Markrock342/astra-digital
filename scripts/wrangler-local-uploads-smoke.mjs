/**
 * UP-1 + UP-2 smoke against wrangler dev --local (SQLite files store, no R2).
 * Usage: npm run cloud:setup && npm run build && npm run cloud:dev
 *        node scripts/wrangler-local-uploads-smoke.mjs [baseUrl]
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

function webpBytes() {
  const bytes = new Uint8Array(64);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

function pngBytes() {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
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

const health = await api("GET", "/api/health");
ok("uploads feature", health.data?.features?.uploads === true);

jar.clear();
const login = await api("POST", "/api/login", {
  json: { email: "admin@astra.local", password: adminPassword },
});
ok("admin login", login.status === 200 && login.data?.user?.role === "ADMIN");

const product = await api("POST", "/api/admin/products", {
  json: {
    name: "Wrangler Upload QA " + randomUUID().slice(0, 6),
    description: "smoke product images on wrangler local",
    category: "streaming",
    price: 500,
    active: true,
  },
});
ok("create product", product.status === 200, JSON.stringify(product.data));
const productId = product.data.id;

const up1 = await api("POST", `/api/admin/products/${productId}/images`, {
  body: webpBytes(),
  contentType: "image/webp",
});
ok("upload webp", up1.status === 200 && up1.data?.image?.url, JSON.stringify(up1.data));
const key1 = up1.data.image.url.split("/").pop();
const file1 = await api("GET", `/api/files/${key1}`);
ok(
  "GET file bytes match",
  file1.status === 200 &&
    file1.headers.get("Content-Type") === "image/webp" &&
    file1.buf[0] === 0x52 &&
    file1.buf[8] === 0x57,
);

const up2 = await api("POST", `/api/admin/products/${productId}/images`, {
  body: pngBytes(),
  contentType: "image/png",
});
ok("upload second png", up2.status === 200, JSON.stringify(up2.data));

const reorder = await api("PATCH", `/api/admin/products/${productId}/images`, {
  json: { order: [up2.data.image.id, up1.data.image.id] },
});
ok(
  "reorder images",
  reorder.status === 200 && reorder.data.images[0].id === up2.data.image.id,
  JSON.stringify(reorder.data),
);

const catalog = await api("GET", `/api/products/${productId}`);
ok(
  "storefront imageUrl is cover",
  catalog.status === 200 &&
    catalog.data.product.imageUrl === up2.data.image.url &&
    catalog.data.product.images.length === 2,
  JSON.stringify(catalog.data.product.images),
);

const del = await api("DELETE", `/api/admin/product-images/${up2.data.image.id}`);
ok("delete image", del.status === 200 && del.data?.deleted === true);

const after = await api("GET", `/api/products/${productId}`);
ok(
  "after delete one image remains",
  after.data.product.images.length === 1 &&
    after.data.product.images[0].id === up1.data.image.id,
);

// --- UP-2 avatar + logo ---
const avatar = await api("POST", "/api/profile/avatar", {
  body: webpBytes(),
  contentType: "image/webp",
});
ok(
  "upload avatar",
  avatar.status === 200 && avatar.data?.avatarUrl,
  JSON.stringify(avatar.data),
);
const me = await api("GET", "/api/me");
ok(
  "me has avatarUrl",
  me.status === 200 && me.data?.user?.avatarUrl === avatar.data.avatarUrl,
  JSON.stringify(me.data?.user),
);
const avatarKey = avatar.data.avatarUrl.split("/").pop();
const avatarFile = await api("GET", `/api/files/${avatarKey}`);
ok(
  "GET avatar bytes match",
  avatarFile.status === 200 &&
    avatarFile.headers.get("Content-Type") === "image/webp" &&
    avatarFile.buf[0] === 0x52,
);

const logo = await api("POST", "/api/admin/settings/logo", {
  body: pngBytes(),
  contentType: "image/png",
});
ok(
  "upload logo",
  logo.status === 200 && logo.data?.logoUrl,
  JSON.stringify(logo.data),
);
const overview = await api("GET", "/api/overview");
ok(
  "overview has logoUrl",
  overview.status === 200 && overview.data?.shop?.logoUrl === logo.data.logoUrl,
  JSON.stringify(overview.data?.shop),
);

const delAvatar = await api("DELETE", "/api/profile/avatar");
ok("delete avatar", delAvatar.status === 200 && delAvatar.data?.avatarUrl === null);
const meCleared = await api("GET", "/api/me");
ok("me avatar cleared", meCleared.data?.user?.avatarUrl == null);

const delLogo = await api("DELETE", "/api/admin/settings/logo");
ok("delete logo", delLogo.status === 200 && delLogo.data?.logoUrl === null);
const overviewCleared = await api("GET", "/api/overview");
ok("overview logo cleared", overviewCleared.data?.shop?.logoUrl == null);

console.log("\nwrangler local uploads smoke:", passed, "passed");
