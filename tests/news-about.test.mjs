// ข่าวสารและกิจกรรม (server/news.mjs) + เกี่ยวกับเรา (server/about.mjs): safe text format,
// validation, publish switch / schedule visibility, pinned + newest order, ADMIN-only, audit,
// cover cleanup, live topic, SEO helpers, About defaults / save / reset, launch cleanup keeps both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ensureNewsAbout } from "../server/ensure-admin-fr.mjs";
import {
  eventState,
  isSafeHref,
  parseRichText,
  richTextPlain,
  defaultAbout,
  ABOUT_LIMITS,
  NEWS_LIMITS,
} from "../server/content-rules.mjs";
import { newsStatus } from "../server/news.mjs";
import { metaTags, newsMeta, pageMeta, sitemapXml, STATIC_PATHS } from "../server/seo.mjs";

const png = (size = 48) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[size - 1] = Math.floor(Math.random() * 255);
  return bytes;
};
const ADMIN_PASSWORD = randomBytes(18).toString("hex");

function fixture(t, { now = Date.parse("2026-12-01T05:00:00Z") } = {}) {
  const clock = { now };
  const s = createCommerce({ adminPassword: ADMIN_PASSWORD, clock: () => clock.now });
  t.after(() => s.db.close());
  const adminToken = s.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token;
  const buyerAuth = s.register({ name: "News Buyer", email: "news-buyer@example.invalid", password: "Buyer-only-Password-123" });
  const staffAuth = s.register({ name: "News Staff", email: "news-staff@example.invalid", password: "Staff-only-Password-123" });
  s.db.prepare("UPDATE users SET role='STAFF' WHERE id=?").run(s.session(staffAuth.token).id);
  return {
    s,
    clock,
    admin: s.session(adminToken),
    adminToken,
    buyer: s.session(buyerAuth.token),
    buyerToken: buyerAuth.token,
    staff: s.session(staffAuth.token),
    staffToken: staffAuth.token,
  };
}
const statusOf = async (fn) => {
  try {
    await fn();
    return 200;
  } catch (error) {
    return error.status ?? 500;
  }
};
const fileCount = (s) => s.db.prepare("SELECT COUNT(*) AS n FROM files").get().n;
const actions = (s, entity) =>
  s.db.prepare("SELECT action FROM audit WHERE entity_id=? ORDER BY id").all(entity).map((r) => r.action);

test("schema helper is idempotent", () => {
  const db = new DatabaseSync(":memory:");
  ensureNewsAbout(db);
  ensureNewsAbout(db);
  const cols = db.prepare("PRAGMA table_info(news_posts)").all().map((c) => c.name);
  for (const c of ["title", "title_en", "body", "cover_key", "event_starts", "pinned", "published", "publish_at"])
    assert.ok(cols.includes(c), c);
  db.close();
});

test("safe text format: paragraphs, lists, only / and https links", () => {
  const blocks = parseRichText("สวัสดี [ดูสินค้า](/products)\nบรรทัดสอง\n\n- หนึ่ง\n- สอง https://example.com/a.\n\n1. ก\n2. ข");
  assert.deepEqual(blocks.map((b) => b.kind), ["p", "ul", "ol"]);
  assert.equal(blocks[0].lines.length, 2);
  assert.deepEqual(blocks[0].lines[0][1], { type: "link", text: "ดูสินค้า", href: "/products" });
  const bare = blocks[1].lines[1].find((p) => p.type === "link");
  assert.equal(bare.href, "https://example.com/a", "trailing dot is not part of the URL");
  for (const bad of [
    "[x](javascript:alert(1))",
    "[x](http://example.com)",
    "[x](//evil.example)",
    "[x](data:text/html,hi)",
    "[x](/api/admin/news)",
    "<script>alert(1)</script>",
  ]) {
    const pieces = parseRichText(bad).flatMap((b) => b.lines.flat());
    assert.ok(pieces.every((p) => p.type === "text"), bad);
  }
  assert.equal(isSafeHref("https://line.me/R/ti/p/@shop"), true);
  assert.equal(isSafeHref("https://user:pw@example.com"), false);
  assert.equal(richTextPlain("- a [b](/x)\n\nc"), "a b c");
});

test("event state uses Bangkok calendar dates", () => {
  assert.equal(eventState(null, null, "2026-12-01"), null);
  assert.equal(eventState("2026-12-02", "2026-12-05", "2026-12-01"), "upcoming");
  assert.equal(eventState("2026-12-01", "2026-12-05", "2026-12-01"), "ongoing");
  assert.equal(eventState("2026-11-01", null, "2026-11-01"), "ongoing", "one-day event");
  assert.equal(eventState("2026-11-01", "2026-11-30", "2026-12-01"), "ended");
  assert.equal(newsStatus({ published: 0 }, "2026-12-01 00:00:00"), "draft");
  assert.equal(newsStatus({ published: 1, publish_at: "2026-12-02 00:00:00" }, "2026-12-01 00:00:00"), "scheduled");
});

test("validation: title, lengths, link schemes, dates, flags", async (t) => {
  const { s, admin } = fixture(t);
  const bad = (input) => statusOf(() => s.adminCreateNews(admin, input));
  assert.equal(await bad({}), 400, "title required");
  assert.equal(await bad({ title: "   " }), 400);
  assert.equal(await bad({ title: "x".repeat(NEWS_LIMITS.title + 1) }), 400);
  assert.equal(await bad({ title: "ok", summary: "x".repeat(NEWS_LIMITS.summary + 1) }), 400);
  assert.equal(await bad({ title: "ok", body: "x".repeat(NEWS_LIMITS.body + 1) }), 400);
  assert.equal(await bad({ title: "ok", link: "javascript:alert(1)" }), 400);
  assert.equal(await bad({ title: "ok", link: "http://example.com" }), 400);
  assert.equal(await bad({ title: "ok", link: "//evil.example" }), 400);
  assert.equal(await bad({ title: "ok", link: "/api/admin" }), 400);
  assert.equal(await bad({ title: "ok", eventStarts: "2026-02-30" }), 400);
  assert.equal(await bad({ title: "ok", eventStarts: "1/12/2026" }), 400);
  assert.equal(await bad({ title: "ok", eventEnds: "2026-12-05" }), 400, "end needs a start");
  assert.equal(await bad({ title: "ok", eventStarts: "2026-12-05", eventEnds: "2026-12-04" }), 400);
  assert.equal(await bad({ title: "ok", publishAt: "tomorrow" }), 400);
  assert.equal(await bad({ title: "ok", pinned: "yes" }), 400);
  assert.equal(await bad({ title: ["x"] }), 400);

  const { post } = s.adminCreateNews(admin, {
    title: "  ข่าว\nใหม่  ",
    body: "บรรทัด\r\n\r\n\r\n\r\nย่อหน้า\u0007",
    link: "https://Example.com/promo",
    linkLabel: "ไปดู",
    eventStarts: "2026-12-01",
  });
  assert.equal(post.title, "ข่าว ใหม่");
  assert.equal(post.body, "บรรทัด\n\nย่อหน้า");
  assert.equal(post.link, "https://example.com/promo");
  assert.equal(post.status, "draft", "a new post is a draft unless published is sent");
  // Removing the link clears its label.
  const { post: edited } = s.adminUpdateNews(admin, post.id, { link: "" });
  assert.equal(edited.link, null);
  assert.equal(edited.linkLabel, null);
});

test("publish switch + publish-at schedule control what visitors see", async (t) => {
  const { s, admin, clock } = fixture(t);
  const draft = s.adminCreateNews(admin, { title: "ร่าง" }).post;
  const live = s.adminCreateNews(admin, { title: "เผยแพร่", published: true }).post;
  const later = s.adminCreateNews(admin, { title: "ตั้งเวลา", published: true, publishAt: "2026-12-01T18:00" }).post;
  assert.equal(later.status, "scheduled");
  assert.equal(later.publishAt, "2026-12-01 11:00:00", "Bangkok wall time stored as UTC");
  const ids = () => s.publicNews().posts.map((p) => p.id);
  assert.deepEqual(ids(), [live.id]);
  assert.equal(await statusOf(() => s.publicNewsPost(draft.id)), 404);
  assert.equal(await statusOf(() => s.publicNewsPost(later.id)), 404);
  assert.equal(await statusOf(() => s.publicNewsPost("../../etc")), 404);
  assert.equal(s.publicNewsPost(live.id).post.title, "เผยแพร่");
  assert.equal(s.publicNews().posts[0].body, undefined, "list carries no body");

  clock.now = Date.parse("2026-12-01T11:00:00Z");
  assert.deepEqual(ids(), [later.id, live.id], "scheduled post appears at its time, as the newest");
  assert.equal(s.adminNews(admin).posts.find((p) => p.id === later.id).status, "live");

  s.adminUpdateNews(admin, live.id, { published: false });
  assert.deepEqual(ids(), [later.id]);
  assert.deepEqual(actions(s, live.id), ["NEWS_CREATE", "NEWS_UNPUBLISH"]);
  s.adminUpdateNews(admin, draft.id, { published: true });
  assert.ok(ids().includes(draft.id));
  assert.deepEqual(actions(s, draft.id), ["NEWS_CREATE", "NEWS_PUBLISH"]);
});

test("pinned first, then newest first", (t) => {
  const { s, admin, clock } = fixture(t);
  const a = s.adminCreateNews(admin, { title: "A", published: true }).post;
  clock.now += 60000;
  const b = s.adminCreateNews(admin, { title: "B", published: true }).post;
  clock.now += 60000;
  const c = s.adminCreateNews(admin, { title: "C", published: true }).post;
  assert.deepEqual(s.publicNews().posts.map((p) => p.title), ["C", "B", "A"]);
  s.adminUpdateNews(admin, a.id, { pinned: true });
  assert.deepEqual(s.publicNews().posts.map((p) => p.title), ["A", "C", "B"]);
  assert.equal(s.publicNews().posts[0].pinned, true);
  assert.deepEqual(s.adminNews(admin).posts.map((p) => p.id), [a.id, c.id, b.id]);
  // Card summary falls back to the start of the body.
  const d = s.adminCreateNews(admin, { title: "D", published: true, body: "เนื้อหา [ลิงก์](/faq)" }).post;
  assert.equal(s.publicNews().posts.find((p) => p.id === d.id).summary, "เนื้อหา ลิงก์");
});

test("ADMIN only: staff, buyers and guests are refused (service + HTTP)", async (t) => {
  const { s, admin, buyer, staff, staffToken, buyerToken, adminToken } = fixture(t);
  const post = s.adminCreateNews(admin, { title: "x" }).post;
  for (const user of [staff, buyer]) {
    assert.equal(await statusOf(() => s.adminNews(user)), 403);
    assert.equal(await statusOf(() => s.adminCreateNews(user, { title: "y" })), 403);
    assert.equal(await statusOf(() => s.adminUpdateNews(user, post.id, { title: "y" })), 403);
    assert.equal(await statusOf(() => s.adminDeleteNews(user, post.id)), 403);
    assert.equal(await statusOf(() => s.adminSetNewsCover(user, post.id, { bytes: png(), contentType: "image/png" })), 403);
    assert.equal(await statusOf(() => s.adminAbout(user)), 403);
    assert.equal(await statusOf(() => s.saveAbout(user, defaultAbout("x"))), 403);
    assert.equal(await statusOf(() => s.resetAbout(user)), 403);
  }
  const handle = createAPIHandler(s);
  const call = async (method, path, { token, json, bytes, contentType } = {}) => {
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
    return { status: response.status, data: await response.json().catch(() => null) };
  };
  assert.equal((await call("GET", "/api/admin/news")).status, 401);
  assert.equal((await call("GET", "/api/admin/news", { token: staffToken })).status, 403);
  assert.equal((await call("POST", "/api/admin/about", { token: buyerToken, json: {} })).status, 403);
  assert.equal((await call("GET", "/api/news")).status, 200);
  assert.equal((await call("GET", "/api/news/" + post.id)).status, 404, "draft is not public");
  assert.equal((await call("GET", "/api/about")).status, 200);
  const health = await call("GET", "/api/health");
  assert.equal(health.data.features.news, true);
  assert.equal(health.data.features.aboutPage, true);
  // Long Thai body (3 bytes / character) fits through the admin JSON limit.
  const created = await call("POST", "/api/admin/news", {
    token: adminToken,
    json: { title: "ยาว", body: "ก".repeat(NEWS_LIMITS.body), bodyEn: "a".repeat(NEWS_LIMITS.body), published: true },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const cover = await call("POST", `/api/admin/news/${created.data.post.id}/cover`, {
    token: adminToken,
    bytes: png(),
    contentType: "image/png",
  });
  assert.equal(cover.status, 200);
  assert.match(cover.data.post.coverUrl, /^\/api\/files\//);
  const svg = await call("POST", `/api/admin/news/${created.data.post.id}/cover`, {
    token: adminToken,
    bytes: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    contentType: "image/svg+xml",
  });
  assert.equal(svg.status, 415);
  const removed = await call("DELETE", `/api/admin/news/${created.data.post.id}`, { token: adminToken });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.filesRemoved, 1);
});

test("audit trail + cover file cleanup on replace, remove and delete; live topic bumps", async (t) => {
  const { s, admin } = fixture(t);
  const startFiles = fileCount(s);
  const content = () => s.liveVersions().content;
  const v0 = content();
  const post = s.adminCreateNews(admin, { title: "ปก", published: true }).post;
  assert.ok(content() > v0, "create bumps the content topic");
  await s.adminSetNewsCover(admin, post.id, { bytes: png(), contentType: "image/png" });
  assert.equal(fileCount(s), startFiles + 1);
  const first = s.adminNews(admin).posts[0].coverUrl;
  await s.adminSetNewsCover(admin, post.id, { bytes: png(), contentType: "image/png" });
  assert.equal(fileCount(s), startFiles + 1, "replaced cover file removed");
  assert.notEqual(s.adminNews(admin).posts[0].coverUrl, first);
  assert.equal(await statusOf(() => s.getFile(first.split("/").pop())), 404);
  await s.adminRemoveNewsCover(admin, post.id);
  assert.equal(fileCount(s), startFiles);
  await s.adminSetNewsCover(admin, post.id, { bytes: png(), contentType: "image/png" });
  s.adminUpdateNews(admin, post.id, { title: "ปกใหม่", body: "ข้อความ" });
  s.adminUpdateNews(admin, post.id, { title: "ปกใหม่" }); // no change → no audit row
  const before = content();
  const result = await s.adminDeleteNews(admin, post.id);
  assert.equal(result.filesRemoved, 1);
  assert.equal(fileCount(s), startFiles);
  assert.ok(content() > before);
  assert.deepEqual(actions(s, post.id), [
    "NEWS_CREATE",
    "NEWS_COVER_SET",
    "NEWS_COVER_SET",
    "NEWS_COVER_REMOVE",
    "NEWS_COVER_SET",
    "NEWS_UPDATE",
    "NEWS_DELETE",
  ]);
  const update = s.db.prepare("SELECT detail FROM audit WHERE entity_id=? AND action='NEWS_UPDATE'").get(post.id);
  const detail = JSON.parse(update.detail);
  assert.deepEqual(detail.changed.title, { from: "ปก", to: "ปกใหม่" });
  assert.equal(detail.changed.body, true, "long text: field name only");
  assert.equal(await statusOf(() => s.adminUpdateNews(admin, post.id, { title: "x" })), 404);
});

test("about: defaults with the shop name, save, validation, cover, reset", async (t) => {
  const { s, admin } = fixture(t);
  const first = s.publicAbout().about;
  assert.equal(first.heading.th, "เกี่ยวกับเรา");
  assert.match(first.body.th, /^ASIA EXTRA /, "untouched default shop name → brand");
  assert.equal(first.highlights.length, 3);
  assert.equal(first.showContact, true);
  assert.equal(s.adminAbout(admin).customized, false);
  s.saveSettings(admin, { ...s.settings(), shopName: "ร้านทดสอบ" });
  assert.match(s.publicAbout().about.body.th, /^ร้านทดสอบ /);

  const bad = (input) => statusOf(() => s.saveAbout(admin, input));
  const base = defaultAbout("x");
  assert.equal(await bad({ ...base, heading: { th: "" } }), 400);
  assert.equal(await bad({ ...base, body: { th: "x".repeat(ABOUT_LIMITS.body + 1) } }), 400);
  assert.equal(await bad({ ...base, highlights: Array(ABOUT_LIMITS.highlights + 1).fill(base.highlights[0]) }), 400);
  assert.equal(await bad({ ...base, highlights: [{ ...base.highlights[0], icon: "Skull" }] }), 400);
  assert.equal(await bad({ ...base, highlights: [{ ...base.highlights[0], title: { th: "" } }] }), 400);
  assert.equal(await bad({ ...base, showContact: "no" }), 400);

  const v0 = s.liveVersions().content;
  const saved = s.saveAbout(admin, {
    heading: { th: "รู้จักเรา", en: "Who we are" },
    body: { th: "ร้านของเรา\n\n- ส่งไว", en: "" },
    highlights: [{ icon: "Gift", title: { th: "ของแถม", en: "" }, text: { th: "", en: "" } }],
    showContact: false,
  });
  assert.deepEqual(saved.changed.sort(), ["body", "heading", "highlights", "showContact"]);
  assert.equal(saved.customized, true);
  assert.ok(s.liveVersions().content > v0);
  const pub = s.publicAbout().about;
  assert.equal(pub.heading.en, "Who we are");
  assert.equal(pub.highlights.length, 1);
  assert.equal(pub.showContact, false);

  // Thai rewritten, English left at the built-in default → English cleared (falls back to Thai).
  const defaults = s.adminAbout(admin).defaults;
  const kept = s.saveAbout(admin, { ...defaults, body: { th: "ข้อความใหม่", en: defaults.body.en } }).about;
  assert.equal(kept.body.en, "");
  assert.equal(kept.heading.en, defaults.heading.en, "untouched default pair keeps its English");

  const startFiles = fileCount(s);
  await s.setAboutCover(admin, { bytes: png(), contentType: "image/png" });
  assert.match(s.publicAbout().about.coverUrl, /^\/api\/files\//);
  await s.setAboutCover(admin, { bytes: png(), contentType: "image/png" });
  assert.equal(fileCount(s), startFiles + 1, "replaced cover removed");
  const reset = await s.resetAbout(admin);
  assert.equal(reset.customized, false);
  assert.equal(fileCount(s), startFiles, "reset removes the cover file");
  assert.equal(s.publicAbout().about.heading.th, "เกี่ยวกับเรา");
  assert.equal(s.publicAbout().about.coverUrl, null);
  const rows = s.db.prepare("SELECT action FROM audit WHERE entity_id='about' ORDER BY id").all().map((r) => r.action);
  assert.deepEqual(rows, ["ABOUT_SAVE", "ABOUT_SAVE", "ABOUT_COVER_SET", "ABOUT_COVER_SET", "ABOUT_RESET"]);
  // A broken stored value falls back to the defaults instead of breaking the page.
  s.db.prepare("UPDATE runtime_flags SET value=? WHERE key='about-page'").run('{"content":{"heading":5}}');
  assert.equal(s.publicAbout().about.heading.th, "เกี่ยวกับเรา");
});

test("SEO: news + about meta, sitemap lists /news, /about and published posts", (t) => {
  const { s, admin } = fixture(t);
  const post = s.adminCreateNews(admin, {
    title: 'งาน "ลดราคา" <ใหญ่>',
    summary: "",
    body: "ลด 50% [ดูสินค้า](/products)",
    published: true,
  }).post;
  s.adminCreateNews(admin, { title: "ร่าง" });
  const meta = newsMeta("https://shop.test", s.publicNewsPost(post.id).post, { shopName: "ร้านทดสอบ" });
  assert.equal(meta.title, 'งาน "ลดราคา" <ใหญ่> — ร้านทดสอบ');
  assert.equal(meta.description, "ลด 50% ดูสินค้า");
  assert.equal(meta.url, "https://shop.test/news/" + post.id);
  assert.equal(meta.type, "article");
  assert.match(metaTags(meta), /&lt;ใหญ่&gt;/);
  const about = pageMeta("https://shop.test", { path: "/about", title: "เกี่ยวกับเรา", description: "" }, null);
  assert.equal(about.url, "https://shop.test/about");
  assert.ok(STATIC_PATHS.includes("/news") && STATIC_PATHS.includes("/about"));
  const xml = sitemapXml("https://shop.test", [], [], s.publicNews().posts);
  assert.ok(xml.includes("<loc>https://shop.test/news/" + post.id + "</loc>"));
  assert.ok(xml.includes("<loc>https://shop.test/about</loc>"));
  assert.equal((xml.match(/\/news\//g) ?? []).length, 1, "drafts are not listed");
});

test("launch cleanup keeps news posts, covers and the About page", async (t) => {
  const { s, admin } = fixture(t);
  const post = s.adminCreateNews(admin, { title: "คงไว้", published: true }).post;
  await s.adminSetNewsCover(admin, post.id, { bytes: png(), contentType: "image/png" });
  s.saveAbout(admin, defaultAbout("ร้าน"));
  const dry = await s.adminLaunchCleanup(admin, { currentPassword: ADMIN_PASSWORD });
  assert.equal(dry.keep.newsPosts, 1);
  assert.equal(dry.keep.aboutPage, 1);
  await s.adminLaunchCleanup(admin, { currentPassword: ADMIN_PASSWORD, dryRun: false });
  assert.equal(s.publicNews().posts.length, 1);
  const cover = s.publicNews().posts[0].coverUrl;
  assert.ok((await s.getFile(cover.split("/").pop())).bytes);
  assert.equal(s.adminAbout(admin).customized, true);
});
