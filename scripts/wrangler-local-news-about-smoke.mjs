/**
 * ข่าวสารและกิจกรรม + เกี่ยวกับเรา smoke against wrangler dev --local (Durable Object SQLite:
 * ensureNewsAbout schema, runtime_flags JSON, files BLOB, live versions).
 * Usage: npm run build && npx wrangler dev --local …
 *        ASTRA_ADMIN_PASSWORD=… node scripts/wrangler-local-news-about-smoke.mjs [baseUrl]
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:4332";
function loadAdminPassword() {
  if (process.env.ASTRA_ADMIN_PASSWORD?.length >= 8) return process.env.ASTRA_ADMIN_PASSWORD;
  if (!existsSync(".dev.vars")) throw new Error("Missing .dev.vars — run npm run cloud:setup");
  const match = /^ASTRA_ADMIN_PASSWORD=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"));
  if (!match?.[1] || match[1].trim().length < 8) throw new Error("Add ASTRA_ADMIN_PASSWORD (>=8) to .dev.vars");
  return match[1].trim();
}
// Real 1×1 WebP.
const webp = () => Uint8Array.from(Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=", "base64"));

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
const bkkLocal = (minutes) => new Date(Date.now() + 7 * 3600000 + minutes * 60000).toISOString().slice(0, 16);

const health = await api("GET", "/api/health");
ok("news + aboutPage features", health.data?.features?.news === true && health.data?.features?.aboutPage === true);
const start = (await api("GET", "/api/news")).data?.posts;
ok("public news list", Array.isArray(start), JSON.stringify(start));
const about0 = await api("GET", "/api/about");
ok("about defaults", about0.status === 200 && about0.data.about.heading.th && about0.data.about.highlights.length >= 1);
ok("guest cannot list admin news", (await api("GET", "/api/admin/news", { cookie: false })).status === 401);

const login = await api("POST", "/api/login", { json: { email: "admin@astra.local", password: loadAdminPassword() } });
ok("admin login", login.status === 200 && login.data?.user?.role === "ADMIN");
const live0 = (await api("GET", "/api/live")).data.versions.content ?? 0;

ok("javascript: link refused", (await api("POST", "/api/admin/news", { json: { title: "x", link: "javascript:alert(1)" } })).status === 400);
ok("end before start refused", (await api("POST", "/api/admin/news", { json: { title: "x", eventStarts: "2026-12-05", eventEnds: "2026-12-01" } })).status === 400);
const created = await api("POST", "/api/admin/news", {
  json: {
    title: "ข่าว wrangler",
    titleEn: "Wrangler news",
    body: "ก".repeat(6000) + "\n\n[สินค้า](/products)",
    eventStarts: "2026-01-01",
    eventEnds: "2099-12-31",
    link: "/products",
    published: true,
    pinned: true,
  },
});
ok("create published post (long Thai body)", created.status === 201 && created.data.post.status === "live", JSON.stringify(created.data).slice(0, 200));
const id = created.data.post.id;
const cover = await api("POST", `/api/admin/news/${id}/cover`, { body: webp(), contentType: "image/webp" });
ok("upload cover", cover.status === 200 && /^\/api\/files\//.test(cover.data.post.coverUrl));
const list = (await api("GET", "/api/news", { cookie: false })).data.posts;
const shown = list.find((p) => p.id === id);
ok("public list shows it pinned first, ongoing event", list[0]?.id === id && shown.eventState === "ongoing" && shown.pinned);
ok("list carries no body", shown.body === undefined);
const detail = await api("GET", "/api/news/" + id, { cookie: false });
ok("public detail", detail.status === 200 && detail.data.post.titleEn === "Wrangler news" && detail.data.post.body.length > 6000);
const image = await api("GET", shown.coverUrl, { cookie: false });
ok("cover is public webp", image.status === 200 && image.headers.get("Content-Type") === "image/webp");

const later = await api("POST", "/api/admin/news", { json: { title: "ตั้งเวลา", published: true, publishAt: bkkLocal(60) } });
ok("scheduled post", later.status === 201 && later.data.post.status === "scheduled");
ok("scheduled hidden from list", !(await api("GET", "/api/news", { cookie: false })).data.posts.some((p) => p.id === later.data.post.id));
ok("scheduled detail 404", (await api("GET", "/api/news/" + later.data.post.id, { cookie: false })).status === 404);
const draft = await api("PATCH", "/api/admin/news/" + id, { json: { published: false } });
ok("unpublish", draft.status === 200 && draft.data.post.status === "draft");
ok("draft hidden", (await api("GET", "/api/news/" + id, { cookie: false })).status === 404);

const saved = await api("POST", "/api/admin/about", {
  json: {
    heading: { th: "รู้จักเรา", en: "About the shop" },
    body: { th: "ร้านทดสอบ wrangler", en: "" },
    highlights: [{ icon: "Zap", title: { th: "ไว", en: "Fast" }, text: { th: "", en: "" } }],
    showContact: false,
  },
});
ok("save about", saved.status === 200 && saved.data.customized === true);
const badIcon = await api("POST", "/api/admin/about", {
  json: { heading: { th: "x" }, body: { th: "x" }, highlights: [{ icon: "Skull", title: { th: "x" } }] },
});
ok("unknown icon refused", badIcon.status === 400);
const aboutCover = await api("POST", "/api/admin/about/cover", { body: webp(), contentType: "image/webp" });
ok("about cover", aboutCover.status === 200 && aboutCover.data.about.coverUrl);
const pub = (await api("GET", "/api/about", { cookie: false })).data.about;
ok("public about follows", pub.heading.en === "About the shop" && pub.showContact === false && pub.coverUrl);
const reset = await api("POST", "/api/admin/about/reset", { json: {} });
ok("reset about", reset.status === 200 && reset.data.customized === false && reset.data.about.coverUrl === null);
ok("about cover file removed", (await api("GET", pub.coverUrl)).status === 404);
ok("live content topic bumped", ((await api("GET", "/api/live")).data.versions.content ?? 0) > live0);

const del = await api("DELETE", "/api/admin/news/" + id);
ok("delete removes cover file", del.status === 200 && del.data.filesRemoved === 1, JSON.stringify(del.data));
ok("cover gone", (await api("GET", shown.coverUrl)).status === 404);
ok("cleanup scheduled post", (await api("DELETE", "/api/admin/news/" + later.data.post.id)).status === 200);
ok("list back to start", (await api("GET", "/api/news")).data.posts.length === start.length);

console.log("\nwrangler local news/about smoke:", passed, "passed");
