// Home promo banners (server/banners.mjs): link validation, Bangkok schedule window, ordering,
// ADMIN-only permissions, image upload checks, file cleanup and the audit trail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ensureBanners } from "../server/ensure-admin-fr.mjs";
import {
  MAX_BANNERS,
  bannerStatus,
  bannerTimeInput,
  normalizeBannerLink,
} from "../server/banners.mjs";

const failThrow = (status, message) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
const png = (size = 48) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[size - 1] = Math.floor(Math.random() * 255);
  return bytes;
};
const webp = () => {
  const bytes = new Uint8Array(40);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
};

function fixture(t, { now = Date.parse("2026-12-01T05:00:00Z") } = {}) {
  const clock = { now };
  const adminPassword = randomBytes(18).toString("hex");
  const s = createCommerce({ adminPassword, clock: () => clock.now });
  t.after(() => s.db.close());
  const adminToken = s.login({ email: "admin@astra.local", password: adminPassword }).token;
  const admin = s.session(adminToken);
  const buyerAuth = s.register({
    name: "Banner Buyer",
    email: "banner-buyer@example.invalid",
    password: "Buyer-only-Password-123",
  });
  const staffAuth = s.register({
    name: "Banner Staff",
    email: "banner-staff@example.invalid",
    password: "Staff-only-Password-123",
  });
  s.db.prepare("UPDATE users SET role='STAFF' WHERE id=?").run(s.session(staffAuth.token).id);
  return {
    s,
    clock,
    admin,
    adminToken,
    buyer: s.session(buyerAuth.token),
    buyerToken: buyerAuth.token,
    staff: s.session(staffAuth.token),
    staffToken: staffAuth.token,
  };
}
const fileCount = (s) => s.db.prepare("SELECT COUNT(*) AS n FROM files").get().n;
const auditActions = (s, entity) =>
  s.db
    .prepare("SELECT action FROM audit WHERE entity_id=? ORDER BY id")
    .all(entity)
    .map((r) => r.action);

test("link validation: in-shop paths and https only", () => {
  const ok = (value) => normalizeBannerLink(value, failThrow);
  const bad = (value) => assert.throws(() => ok(value), (e) => e.status === 400, String(value));
  assert.equal(ok(""), null);
  assert.equal(ok("   "), null);
  assert.equal(ok(null), null);
  assert.equal(ok("/products/netflix-premium"), "/products/netflix-premium");
  assert.equal(ok("/products?category=ai"), "/products?category=ai");
  assert.equal(ok("/faq#refund"), "/faq#refund");
  assert.equal(ok("https://line.me/R/ti/p/@asiaextra"), "https://line.me/R/ti/p/@asiaextra");
  assert.equal(ok("  https://Example.com/path  "), "https://example.com/path");
  for (const value of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "http://example.com",
    "ftp://example.com/x",
    "mailto:a@example.com",
    "//evil.example/x",
    "/\\evil.example",
    "\\\\evil.example",
    "https://user:pass@example.com/",
    "https://localhost/x",
    "products/x",
    "/products/a b",
    "/api/admin/banners",
    "/products/<script>",
    "https://example.com/" + "a".repeat(600),
    42,
  ])
    bad(value);
});

test("schedule: Bangkok wall time → UTC and the public window", (t) => {
  assert.equal(bannerTimeInput("2026-12-01T00:00", "x", false, failThrow), "2026-11-30 17:00:00");
  assert.equal(bannerTimeInput("2026-12-01", "x", true, failThrow), "2026-12-01 16:59:59");
  assert.equal(bannerTimeInput("", "x", false, failThrow), null);
  assert.throws(() => bannerTimeInput("1 Dec 2026", "x", false, failThrow), (e) => e.status === 400);
  assert.throws(() => bannerTimeInput("2026-13-40T10:00", "x", false, failThrow), (e) => e.status === 400);
  assert.equal(bannerStatus({ image_key: null, active: 1 }, "2026-12-01 00:00:00"), "draft");

  // Clock: 2026-12-01 12:00 Bangkok (05:00 UTC).
  const { s, clock, admin } = fixture(t);
  const make = async (input) => {
    const { banner } = s.adminCreateBanner(admin, { alt: "Banner", ...input });
    await s.adminSetBannerImage(admin, banner.id, { bytes: png(), contentType: "image/png" });
    return banner.id;
  };
  return (async () => {
    const always = await make({ alt: "Always" });
    const later = await make({ alt: "Later", startsAt: "2026-12-01T13:00" });
    const ending = await make({ alt: "Ending", endsAt: "2026-12-01T12:30" });
    const over = await make({ alt: "Over", startsAt: "2026-11-01T00:00", endsAt: "2026-11-30T23:59" });
    const off = await make({ alt: "Off", active: false });
    s.adminCreateBanner(admin, { alt: "Draft, no image" });
    const shown = () => s.overview().banners.map((b) => b.alt);
    assert.deepEqual(shown(), ["Always", "Ending"]);
    const statuses = Object.fromEntries(s.adminBanners(admin).banners.map((b) => [b.alt, b.status]));
    assert.deepEqual(statuses, {
      Always: "live",
      Later: "scheduled",
      Ending: "live",
      Over: "ended",
      Off: "off",
      "Draft, no image": "draft",
    });
    // Form values come back as Bangkok wall time.
    const laterRow = s.adminBanners(admin).banners.find((b) => b.id === later);
    assert.equal(laterRow.startsAtLocal, "2026-12-01T13:00");
    assert.equal(laterRow.startsAt, "2026-12-01 06:00:00");

    clock.now = Date.parse("2026-12-01T06:00:00Z"); // 13:00 Bangkok: Later starts, Ending ended
    assert.deepEqual(shown(), ["Always", "Later"]);
    s.adminUpdateBanner(admin, off, { active: true });
    assert.deepEqual(shown(), ["Always", "Later", "Off"]);
    s.adminUpdateBanner(admin, ending, { endsAt: null });
    assert.deepEqual(shown(), ["Always", "Later", "Ending", "Off"]);
    // End before start is refused; an unrelated field keeps the stored window.
    assert.throws(
      () => s.adminUpdateBanner(admin, over, { endsAt: "2026-10-01T00:00" }),
      (e) => e.status === 400,
    );
    s.adminUpdateBanner(admin, over, { alt: "Over (renamed)" });
    const overRow = s.adminBanners(admin).banners.find((b) => b.id === over);
    assert.equal(overRow.endsAtLocal, "2026-11-30T23:59");
    assert.equal(always.length > 0, true);
    // Public shape carries nothing internal.
    assert.deepEqual(Object.keys(s.overview().banners[0]).sort(), ["alt", "id", "imageUrl", "link", "mobileImageUrl"]);
  })();
});

test("create/update validation, max banners and ordering", async (t) => {
  const { s, admin } = fixture(t);
  assert.throws(() => s.adminCreateBanner(admin, {}), (e) => e.status === 400);
  assert.throws(() => s.adminCreateBanner(admin, { alt: "   " }), (e) => e.status === 400);
  assert.throws(() => s.adminCreateBanner(admin, { alt: "x".repeat(161) }), (e) => e.status === 400);
  assert.throws(() => s.adminCreateBanner(admin, { alt: "A", link: "javascript:alert(1)" }), (e) => e.status === 400);
  assert.throws(() => s.adminCreateBanner(admin, { alt: "A", active: "yes" }), (e) => e.status === 400);
  assert.throws(
    () => s.adminCreateBanner(admin, { alt: "A", startsAt: "2026-12-02T00:00", endsAt: "2026-12-01T00:00" }),
    (e) => e.status === 400,
  );
  const { banner } = s.adminCreateBanner(admin, { alt: "  Sale   20%  ", link: "/products?category=ai" });
  assert.equal(banner.alt, "Sale 20%");
  assert.equal(banner.status, "draft");
  assert.throws(() => s.adminUpdateBanner(admin, banner.id, { link: "http://plain.example" }), (e) => e.status === 400);
  assert.throws(() => s.adminUpdateBanner(admin, "nope", { alt: "x" }), (e) => e.status === 404);
  assert.throws(
    () => s.adminUpdateBanner(admin, "00000000-0000-4000-8000-000000000000", { alt: "x" }),
    (e) => e.status === 404,
  );
  const same = s.adminUpdateBanner(admin, banner.id, { alt: "Sale 20%" });
  assert.deepEqual(same.changed, []);
  const cleared = s.adminUpdateBanner(admin, banner.id, { link: "" });
  assert.equal(cleared.banner.link, null);

  const ids = [banner.id];
  for (let i = 2; i <= MAX_BANNERS; i++) ids.push(s.adminCreateBanner(admin, { alt: "B" + i }).banner.id);
  assert.throws(() => s.adminCreateBanner(admin, { alt: "One too many" }), (e) => e.status === 409);
  assert.deepEqual(
    s.adminBanners(admin).banners.map((b) => b.id),
    ids,
  );

  // Reorder: full list only, no duplicates, no strangers.
  const reversed = [...ids].reverse();
  const result = s.adminReorderBanners(admin, { ids: reversed });
  assert.equal(result.changed, true);
  assert.deepEqual(result.banners.map((b) => b.id), reversed);
  assert.equal(s.adminReorderBanners(admin, { ids: reversed }).changed, false);
  assert.throws(() => s.adminReorderBanners(admin, { ids: reversed.slice(1) }), (e) => e.status === 409);
  assert.throws(() => s.adminReorderBanners(admin, { ids: [reversed[0], ...reversed.slice(0, -1)] }), (e) => e.status === 400);
  assert.throws(() => s.adminReorderBanners(admin, { ids: [] }), (e) => e.status === 400);
  assert.throws(() => s.adminReorderBanners(admin, {}), (e) => e.status === 400);
  const audits = s.db.prepare("SELECT detail FROM audit WHERE action='BANNER_REORDER'").all();
  assert.equal(audits.length, 1);
  assert.deepEqual(JSON.parse(audits[0].detail).changed.order.to, reversed);

  // Public order follows the admin order.
  for (const id of reversed.slice(0, 3))
    await s.adminSetBannerImage(admin, id, { bytes: png(), contentType: "image/png" });
  assert.deepEqual(
    s.overview().banners.map((b) => b.id),
    reversed.slice(0, 3),
  );
});

test("permissions: ADMIN only (staff, customer, guest refused)", async (t) => {
  const { s, admin, staff, buyer } = fixture(t);
  const { banner } = s.adminCreateBanner(admin, { alt: "Admin banner" });
  for (const user of [staff, buyer, null]) {
    const denied = (e) => e.status === 401 || e.status === 403;
    assert.throws(() => s.adminBanners(user), denied);
    assert.throws(() => s.adminCreateBanner(user, { alt: "x" }), denied);
    assert.throws(() => s.adminUpdateBanner(user, banner.id, { alt: "x" }), denied);
    assert.throws(() => s.adminReorderBanners(user, { ids: [banner.id] }), denied);
    await assert.rejects(
      () => s.adminSetBannerImage(user, banner.id, { bytes: png(), contentType: "image/png" }),
      denied,
    );
    await assert.rejects(() => s.adminRemoveBannerMobileImage(user, banner.id), denied);
    await assert.rejects(() => s.adminDeleteBanner(user, banner.id), denied);
  }
  assert.equal(s.adminBanners(admin).banners.length, 1);
  assert.equal(fileCount(s), 0);
});

test("images: type checks, replace and delete clean up unused files", async (t) => {
  const { s, admin } = fixture(t);
  const { banner } = s.adminCreateBanner(admin, { alt: "Files", link: "https://example.com/promo" });
  const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  await assert.rejects(
    () => s.adminSetBannerImage(admin, banner.id, { bytes: svg, contentType: "image/svg+xml" }),
    (e) => e.status === 415,
  );
  await assert.rejects(
    () => s.adminSetBannerImage(admin, banner.id, { bytes: png(), contentType: "image/jpeg" }),
    (e) => e.status === 415,
  );
  await assert.rejects(
    () => s.adminSetBannerImage(admin, banner.id, { bytes: new Uint8Array(0), contentType: "image/png" }),
    (e) => e.status === 415,
  );
  await assert.rejects(
    () => s.adminSetBannerImage(admin, "00000000-0000-4000-8000-000000000000", { bytes: png(), contentType: "image/png" }),
    (e) => e.status === 404,
  );
  assert.equal(fileCount(s), 0);

  const first = (await s.adminSetBannerImage(admin, banner.id, { bytes: png(), contentType: "image/png" })).banner;
  const firstKey = first.imageUrl.split("/").pop();
  assert.equal(first.status, "live");
  assert.equal(fileCount(s), 1);
  // Public bytes through the normal file route.
  const file = await s.getFile(firstKey);
  assert.equal(file.mime, "image/png");

  // Replacing the main image removes the old file.
  const second = (await s.adminSetBannerImage(admin, banner.id, { bytes: webp(), contentType: "image/webp" })).banner;
  assert.notEqual(second.imageUrl, first.imageUrl);
  assert.equal(fileCount(s), 1);
  await assert.rejects(() => s.getFile(firstKey), (e) => e.status === 404);

  // Mobile image: set, replace, remove.
  const withMobile = (await s.adminSetBannerImage(admin, banner.id, { bytes: png(), contentType: "image/png" }, "mobile"))
    .banner;
  assert.ok(withMobile.mobileImageUrl);
  assert.equal(s.overview().banners[0].mobileImageUrl, withMobile.mobileImageUrl);
  assert.equal(fileCount(s), 2);
  await s.adminSetBannerImage(admin, banner.id, { bytes: png(), contentType: "image/png" }, "mobile");
  assert.equal(fileCount(s), 2);
  const noMobile = (await s.adminRemoveBannerMobileImage(admin, banner.id)).banner;
  assert.equal(noMobile.mobileImageUrl, null);
  assert.equal(fileCount(s), 1);
  // Removing again is a no-op (no extra audit row).
  await s.adminRemoveBannerMobileImage(admin, banner.id);

  // A key still used elsewhere is kept (e.g. restored from a backup that shares a key).
  const other = s.adminCreateBanner(admin, { alt: "Shares file" }).banner;
  const sharedKey = second.imageUrl.split("/").pop();
  s.db.prepare("UPDATE banners SET image_key=? WHERE id=?").run(sharedKey, other.id);
  const deleted = await s.adminDeleteBanner(admin, banner.id);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.filesRemoved, 0);
  assert.equal(fileCount(s), 1);
  const last = await s.adminDeleteBanner(admin, other.id);
  assert.equal(last.filesRemoved, 1);
  assert.equal(fileCount(s), 0);
  await assert.rejects(() => s.adminDeleteBanner(admin, other.id), (e) => e.status === 404);
  assert.deepEqual(s.overview().banners, []);

  assert.deepEqual(auditActions(s, banner.id), [
    "BANNER_CREATE",
    "BANNER_IMAGE_SET",
    "BANNER_IMAGE_SET",
    "BANNER_MOBILE_IMAGE_SET",
    "BANNER_MOBILE_IMAGE_SET",
    "BANNER_MOBILE_IMAGE_REMOVE",
    "BANNER_DELETE",
  ]);
  const created = s.db
    .prepare("SELECT user_id, detail FROM audit WHERE action='BANNER_CREATE' AND entity_id=?")
    .get(banner.id);
  assert.equal(created.user_id, admin.id);
  assert.equal(JSON.parse(created.detail).link, "https://example.com/promo");
});

test("HTTP: routes, upload pipeline, public overview and live topic", async (t) => {
  const { s, adminToken, staffToken, buyerToken } = fixture(t);
  const handle = createAPIHandler(s);
  async function call(method, path, { token, json, bytes, contentType } = {}) {
    const headers = { "X-Astra-Request": "1" };
    if (token) headers.Cookie = "astra_session=" + token;
    let body;
    if (json !== undefined) {
      body = JSON.stringify(json);
      headers["Content-Type"] = "application/json";
    } else if (bytes) {
      body = bytes;
      headers["Content-Type"] = contentType;
      headers["Content-Length"] = String(bytes.byteLength);
    }
    const response = await handle(new Request("http://fixture" + path, { method, headers, body }));
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* binary */
    }
    return { status: response.status, data, headers: response.headers };
  }
  const before = s.liveVersions().catalog;
  assert.equal((await call("GET", "/api/admin/banners", { token: staffToken })).status, 403);
  assert.equal((await call("GET", "/api/admin/banners", { token: buyerToken })).status, 403);
  assert.equal((await call("GET", "/api/admin/banners")).status, 401);
  assert.equal(
    (await call("POST", "/api/admin/banners", { token: staffToken, json: { alt: "Nope" } })).status,
    403,
  );
  const created = await call("POST", "/api/admin/banners", {
    token: adminToken,
    json: { alt: "HTTP banner", link: "/products?category=streaming" },
  });
  assert.equal(created.status, 201);
  const id = created.data.banner.id;
  const bad = await call("POST", "/api/admin/banners", { token: adminToken, json: { alt: "x", link: "javascript:alert(1)" } });
  assert.equal(bad.status, 400);

  // Upload: guest 401, staff 403, wrong type 415, too big 413, then OK.
  const up = (token, bytes, contentType = "image/png", slot = "image") =>
    call("POST", `/api/admin/banners/${id}/${slot}`, { token, bytes, contentType });
  assert.equal((await up(null, png())).status, 401);
  assert.equal((await up(staffToken, png())).status, 403);
  assert.equal((await up(adminToken, new TextEncoder().encode("<svg/>"), "image/svg+xml")).status, 415);
  const huge = new Uint8Array(2 * 1024 * 1024 + 8);
  huge.set([0x89, 0x50, 0x4e, 0x47], 0);
  assert.equal((await up(adminToken, huge)).status, 413);
  const ok = await up(adminToken, png());
  assert.equal(ok.status, 200);
  assert.ok(ok.data.banner.imageUrl.startsWith("/api/files/"));
  assert.equal((await up(adminToken, webp(), "image/webp", "mobile-image")).status, 200);

  const overview = await call("GET", "/api/overview");
  assert.equal(overview.data.banners.length, 1);
  assert.equal(overview.data.banners[0].link, "/products?category=streaming");
  // Banner image is public (no cookie needed).
  const image = await call("GET", overview.data.banners[0].imageUrl);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("Content-Type"), "image/png");

  const patched = await call("PATCH", "/api/admin/banners/" + id, { token: adminToken, json: { active: false } });
  assert.equal(patched.status, 200);
  assert.equal((await call("GET", "/api/overview")).data.banners.length, 0);
  assert.equal(
    (await call("POST", "/api/admin/banners/reorder", { token: adminToken, json: { ids: [id] } })).status,
    200,
  );
  assert.equal((await call("DELETE", `/api/admin/banners/${id}/mobile-image`, { token: adminToken })).status, 200);
  assert.equal((await call("DELETE", "/api/admin/banners/" + id, { token: staffToken })).status, 403);
  const removed = await call("DELETE", "/api/admin/banners/" + id, { token: adminToken });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.filesRemoved, 1);
  assert.equal(fileCount(s), 0);
  // Storefront tabs refetch the overview on "catalog".
  assert.ok(s.liveVersions().catalog > before);
});

test("ensureBanners is idempotent and keeps rows", (t) => {
  const { s, admin } = fixture(t);
  s.adminCreateBanner(admin, { alt: "Keep me" });
  ensureBanners(s.db);
  ensureBanners(s.db);
  assert.equal(s.adminBanners(admin).banners[0].alt, "Keep me");
  assert.equal(s.features.homeBanners, true);
});
