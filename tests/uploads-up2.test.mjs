import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";

function pngBytes(size = 64) {
  const bytes = new Uint8Array(Math.max(size, 32));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

function jpegBytes() {
  const bytes = new Uint8Array(32);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

function webpBytes() {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

function svgBytes() {
  return new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
}

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const merchantAuth = s.demoMerchant();
  const merchant = s.session(merchantAuth.token);
  const buyerAuth = s.register({
    name: "Avatar Buyer",
    email: "avatar-buyer@example.invalid",
    password: "Buyer-only-Password-123",
  });
  const buyer = s.session(buyerAuth.token);
  return {
    s,
    merchant,
    buyer,
    merchantToken: merchantAuth.token,
    buyerToken: buyerAuth.token,
  };
}

async function http(handler, method, path, { token, body, contentType, json } = {}) {
  const headers = {
    "X-Astra-Request": "1",
    Origin: "http://127.0.0.1",
  };
  if (token) headers.Cookie = `astra_session=${token}`;
  let payload;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(json);
  } else if (body != null) {
    headers["Content-Type"] = contentType ?? "application/octet-stream";
    payload = body;
  }
  if (payload != null)
    headers["Content-Length"] = String(
      payload.byteLength ?? Buffer.byteLength(payload),
    );
  const response = await handler(
    new Request("http://127.0.0.1" + path, { method, headers, body: payload }),
  );
  const buf = new Uint8Array(await response.arrayBuffer());
  const ct = response.headers.get("Content-Type") || "";
  const data = ct.includes("application/json")
    ? JSON.parse(new TextDecoder().decode(buf))
    : null;
  return { status: response.status, data, buf, headers: response.headers };
}

test("UP-2: set and remove avatar; /api/me exposes avatarUrl", async (t) => {
  const { s, buyer, buyerToken } = fixture(t);
  assert.equal(s.publicUser(buyer).avatarUrl, null);

  const set = await s.setAvatar(buyer, {
    bytes: webpBytes(),
    contentType: "image/webp",
  });
  assert.match(set.avatarUrl, /^\/api\/files\/[0-9a-fA-F-]{8,}$/);
  const me = s.session(buyerToken);
  assert.equal(s.publicUser(me).avatarUrl, set.avatarUrl);

  const file = await s.getFile(set.avatarUrl.split("/").pop());
  assert.equal(file.mime, "image/webp");
  assert.equal(file.bytes[0], 0x52);

  const replaced = await s.setAvatar(me, {
    bytes: pngBytes(),
    contentType: "image/png",
  });
  assert.notEqual(replaced.avatarUrl, set.avatarUrl);
  await assert.rejects(
    () => s.getFile(set.avatarUrl.split("/").pop()),
    (e) => e.status === 404,
  );

  const cleared = await s.removeAvatar(s.session(buyerToken));
  assert.equal(cleared.avatarUrl, null);
  assert.equal(s.publicUser(s.session(buyerToken)).avatarUrl, null);
});

test("UP-2: set and remove logo; settings/overview expose logoUrl", async (t) => {
  const { s, merchant } = fixture(t);
  assert.equal(s.settings().logoUrl, null);
  assert.equal(s.overview().shop.logoUrl, null);

  const set = await s.setLogo(merchant, {
    bytes: jpegBytes(),
    contentType: "image/jpeg",
  });
  assert.match(set.logoUrl, /^\/api\/files\/[0-9a-fA-F-]{8,}$/);
  assert.equal(s.settings().logoUrl, set.logoUrl);
  assert.equal(s.overview().shop.logoUrl, set.logoUrl);

  // saveSettings must not wipe logoKey or persist derived logoUrl
  s.saveSettings(merchant, { shopName: "ร้านทดสอบโลโก้" });
  assert.equal(s.settings().logoUrl, set.logoUrl);
  assert.equal(s.settings().shopName, "ร้านทดสอบโลโก้");
  const raw = s.db
    .prepare("SELECT value FROM runtime_flags WHERE key='shop-settings'")
    .get();
  const stored = JSON.parse(raw.value);
  assert.equal(typeof stored.logoKey, "string");
  assert.equal(stored.logoUrl, undefined);

  const cleared = await s.removeLogo(merchant);
  assert.equal(cleared.logoUrl, null);
  assert.equal(s.settings().logoUrl, null);
  assert.equal(s.overview().shop.logoUrl, null);
});

test("UP-2: buyer cannot set logo; anonymous cannot set avatar", async (t) => {
  const { s, buyer } = fixture(t);
  await assert.rejects(
    () =>
      s.setLogo(buyer, { bytes: pngBytes(), contentType: "image/png" }),
    (e) => e.status === 403,
  );
  await assert.rejects(
    () =>
      s.setAvatar(null, { bytes: pngBytes(), contentType: "image/png" }),
    (e) => e.status === 401,
  );
});

test("UP-2: HTTP rejects SVG and oversized avatar; buyer logo 403", async (t) => {
  const { s, buyerToken, merchantToken } = fixture(t);
  const handler = createAPIHandler(s);

  const svg = await http(handler, "POST", "/api/profile/avatar", {
    token: buyerToken,
    body: svgBytes(),
    contentType: "image/svg+xml",
  });
  assert.equal(svg.status, 415);

  const big = new Uint8Array(2 * 1024 * 1024 + 1);
  big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const tooBig = await http(handler, "POST", "/api/profile/avatar", {
    token: buyerToken,
    body: big,
    contentType: "image/png",
  });
  assert.equal(tooBig.status, 413);

  const anon = await http(handler, "POST", "/api/profile/avatar", {
    body: pngBytes(),
    contentType: "image/png",
  });
  assert.equal(anon.status, 401);

  const buyerLogo = await http(handler, "POST", "/api/admin/settings/logo", {
    token: buyerToken,
    body: pngBytes(),
    contentType: "image/png",
  });
  assert.equal(buyerLogo.status, 403);

  const okAvatar = await http(handler, "POST", "/api/profile/avatar", {
    token: buyerToken,
    body: webpBytes(),
    contentType: "image/webp",
  });
  assert.equal(okAvatar.status, 200);
  assert.match(okAvatar.data.avatarUrl, /^\/api\/files\//);

  const me = await http(handler, "GET", "/api/me", { token: buyerToken });
  assert.equal(me.data.user.avatarUrl, okAvatar.data.avatarUrl);

  const okLogo = await http(handler, "POST", "/api/admin/settings/logo", {
    token: merchantToken,
    body: pngBytes(),
    contentType: "image/png",
  });
  assert.equal(okLogo.status, 200);
  const overview = await http(handler, "GET", "/api/overview");
  assert.equal(overview.data.shop.logoUrl, okLogo.data.logoUrl);

  const delAvatar = await http(handler, "DELETE", "/api/profile/avatar", {
    token: buyerToken,
  });
  assert.equal(delAvatar.status, 200);
  assert.equal(delAvatar.data.avatarUrl, null);

  const delLogo = await http(handler, "DELETE", "/api/admin/settings/logo", {
    token: merchantToken,
  });
  assert.equal(delLogo.status, 200);
  assert.equal(delLogo.data.logoUrl, null);
});
