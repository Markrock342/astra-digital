// Product categories: table + seeding, admin CRUD with audit, delete/move, bulk move,
// public overview, saveProduct validation, sitemap / link-preview meta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ensureCategories } from "../server/ensure-admin-fr.mjs";
import { ACCOUNT_SHOP_CATEGORIES, DEFAULT_CATEGORIES, categories as legacyExport } from "../server/catalog.mjs";
import { categoryMeta, categoryIdFromQuery, metaTags, sitemapXml } from "../server/seo.mjs";

/** Close DBs then remove the temp dir; Windows may EPERM if the file lock lingers. */
function cleanupTempDir(dir, ...dbs) {
  for (const db of dbs) {
    try {
      db?.close?.();
    } catch {
      /* already closed */
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    if (e && e.code !== "EPERM" && e.code !== "ENOENT") throw e;
  }
}

const ORIGINAL = ["streaming", "music", "software", "games", "gift"];
const FRESH = [...ORIGINAL, "ai", "productivity", "vpn"];

function shop(t, options = {}) {
  const s = createCommerce({ allowDemoAdmin: true, ...options });
  t.after(() => s.db.close());
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  const customerAuth = s.register({
    name: "Category Buyer",
    email: "category-buyer@example.invalid",
    password: "Category-buyer-Pass-123",
  });
  const customer = s.session(customerAuth.token);
  return { s, admin, adminToken: adminAuth.token, customer, customerToken: customerAuth.token };
}
const ids = (list) => list.map((c) => c.id);
const audits = (s, action) =>
  s.db.prepare("SELECT * FROM audit WHERE action=? ORDER BY rowid").all(action);
const newProduct = (s, admin, category, extra = {}) =>
  s.saveProduct(admin, {
    name: "Cat Item " + randomBytes(3).toString("hex"),
    description: "สินค้าทดสอบหมวดหมู่",
    category,
    price: 9900,
    active: true,
    ...extra,
  });

test("seeding: fresh shop gets the 5 original + ai/productivity/vpn, idempotent, deleted rows stay deleted", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-categories-"));
  const path = join(dir, "shop.sqlite");
  const key = randomBytes(32);
  const first = createCommerce({ path, key, allowDemoAdmin: true });
  let again;
  t.after(() => cleanupTempDir(dir, first.db, again?.db));
  const admin = first.session(first.demoMerchant().token);
  const all = first.adminCategories(admin).categories;
  assert.deepEqual(ids(all), FRESH, "original ids kept, in order, then the account-shop defaults");
  const byId = Object.fromEntries(all.map((c) => [c.id, c]));
  assert.equal(byId.streaming.name_th, "ความบันเทิง");
  assert.equal(byId.ai.icon, "chatgpt");
  assert.equal(byId.productivity.name_th, "ทำงาน/ออกแบบ");
  assert.equal(byId.vpn.name_th, "VPN/คลาวด์");
  assert.equal(byId.vpn.icon, "nordvpn");
  // Every seeded product is in a known category.
  assert.equal(
    first.db.prepare("SELECT COUNT(*) AS n FROM products WHERE category NOT IN (SELECT id FROM categories)").get().n,
    0,
  );
  // Running ensure again changes nothing.
  ensureCategories(first.db);
  ensureCategories(first.db);
  assert.equal(first.db.prepare("SELECT COUNT(*) AS n FROM categories").get().n, FRESH.length);
  // A category the admin deleted is not brought back on the next start.
  first.adminDeleteCategory(admin, "vpn");
  first.db.close();
  again = createCommerce({ path, key, allowDemoAdmin: true });
  const admin2 = again.session(again.demoMerchant().token);
  assert.deepEqual(ids(again.adminCategories(admin2).categories), FRESH.filter((id) => id !== "vpn"));
  // catalog.mjs keeps its old export for older importers.
  assert.deepEqual(ids(legacyExport), ORIGINAL);
  assert.ok(legacyExport.every((c) => typeof c.name === "string"));
  assert.deepEqual(ids(ACCOUNT_SHOP_CATEGORIES), ["ai", "productivity", "vpn"]);
  assert.equal(DEFAULT_CATEGORIES.length, 5);
});

test("upgrade: an existing shop with products in the old categories keeps them valid (no extra defaults)", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(
    "CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT, category TEXT, active INTEGER DEFAULT 1, hidden_seed INTEGER DEFAULT 0)",
  );
  db.exec(
    "INSERT INTO products(id,name,category) VALUES('a','A','music'),('b','B','gift'),('c','C','legacy-x')",
  );
  ensureCategories(db);
  ensureCategories(db);
  const rows = db.prepare("SELECT id,name_th FROM categories ORDER BY sort_order").all();
  assert.deepEqual(
    rows.map((r) => r.id),
    [...ORIGINAL, "legacy-x"],
    "existing shop: the 5 originals + a row for the unknown product category, no ai/vpn",
  );
  assert.equal(rows.at(-1).name_th, "legacy-x");
});

test("upgrade on a real database: drop the table, reopen, products and saveProduct keep working", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-categories-up-"));
  const path = join(dir, "shop.sqlite");
  const key = randomBytes(32);
  const old = createCommerce({ path, key, allowDemoAdmin: true });
  let s;
  t.after(() => cleanupTempDir(dir, old.db, s?.db));
  newProduct(old, old.session(old.demoMerchant().token), "music");
  // Simulate the database as it was before this feature.
  old.db.exec("DROP TABLE categories");
  old.db.close();
  s = createCommerce({ path, key, allowDemoAdmin: true });
  const admin = s.session(s.demoMerchant().token);
  assert.deepEqual(ids(s.adminCategories(admin).categories), ORIGINAL);
  const product = s.db.prepare("SELECT * FROM products WHERE category='music' AND hidden_seed=0 LIMIT 1").get();
  assert.ok(product);
  s.saveProduct(admin, {
    id: product.id,
    name: product.name,
    description: product.description,
    category: "music",
    active: true,
  });
  assert.ok(s.overview().categories.some((c) => c.id === "music" && c.count > 0));
});

test("CRUD: ADMIN only, validation, rename TH/EN, icon, hide, slug change moves products, audit rows", (t) => {
  const { s, admin, customer } = shop(t);
  assert.throws(() => s.adminCategories(customer), (e) => e.status === 403);
  assert.throws(() => s.adminCreateCategory(customer, { id: "x", name_th: "X" }), (e) => e.status === 403);
  assert.throws(() => s.adminCreateCategory(null, { id: "x", name_th: "X" }), (e) => e.status === 401 || e.status === 403);
  for (const bad of ["", "Bad Slug", "ข้อมูล", "-x", "x-", "a--b", "a_b", "x".repeat(41)])
    assert.throws(() => s.adminCreateCategory(admin, { id: bad, name_th: "หมวด" }), (e) => e.status === 400, bad);
  assert.throws(() => s.adminCreateCategory(admin, { id: "ok", name_th: "" }), (e) => e.status === 400);
  assert.throws(() => s.adminCreateCategory(admin, { id: "ok", name_th: "ก".repeat(41) }), (e) => e.status === 400);
  assert.throws(
    () => s.adminCreateCategory(admin, { id: "ok", name_th: "หมวด", icon: "../x" }),
    (e) => e.status === 400,
  );
  assert.throws(() => s.adminCreateCategory(admin, { id: "music", name_th: "ซ้ำ" }), (e) => e.status === 409);

  const made = s.adminCreateCategory(admin, {
    id: "movies",
    name_th: "  ดูหนัง/ซีรีส์ ",
    name_en: "Movies",
    icon: "netflix",
  }).category;
  assert.deepEqual(
    { id: made.id, name_th: made.name_th, name_en: made.name_en, icon: made.icon, hidden: made.hidden, count: made.count },
    { id: "movies", name_th: "ดูหนัง/ซีรีส์", name_en: "Movies", icon: "netflix", hidden: false, count: 0 },
  );
  assert.equal(ids(s.adminCategories(admin).categories).at(-1), "movies", "new categories go last");
  const created = audits(s, "CATEGORY_CREATE");
  assert.equal(created.length, 1);
  assert.equal(created[0].entity_id, "movies");
  assert.equal(created[0].user_id, admin.id);

  // Rename + icon + hide; unchanged fields are not audited.
  const updated = s.adminUpdateCategory(admin, "movies", {
    name_th: "หนังและซีรีส์",
    name_en: "",
    icon: null,
    hidden: true,
  });
  assert.deepEqual(updated.changed.sort(), ["hidden", "icon", "name_en", "name_th"]);
  assert.equal(updated.category.name_en, null);
  assert.equal(updated.category.hidden, true);
  assert.throws(() => s.adminUpdateCategory(admin, "movies", { hidden: "yes" }), (e) => e.status === 400);
  assert.throws(() => s.adminUpdateCategory(admin, "nope", { name_th: "x" }), (e) => e.status === 404);
  const noop = s.adminUpdateCategory(admin, "movies", { name_th: "หนังและซีรีส์" });
  assert.deepEqual(noop.changed, []);
  assert.equal(audits(s, "CATEGORY_UPDATE").length, 1, "no-op update writes no audit row");
  const detail = JSON.parse(audits(s, "CATEGORY_UPDATE")[0].detail);
  assert.deepEqual(detail.changed.name_th, { from: "ดูหนัง/ซีรีส์", to: "หนังและซีรีส์" });
  assert.deepEqual(detail.changed.hidden, { from: false, to: true });

  // Slug change: products move in the same transaction.
  const p1 = newProduct(s, admin, "movies");
  const p2 = newProduct(s, admin, "movies");
  assert.throws(() => s.adminUpdateCategory(admin, "movies", { id: "music" }), (e) => e.status === 409);
  assert.equal(s.db.prepare("SELECT category FROM products WHERE id=?").get(p1.id).category, "movies");
  const renamed = s.adminUpdateCategory(admin, "movies", { id: "film" });
  assert.equal(renamed.moved, 2);
  assert.equal(renamed.category.id, "film");
  assert.equal(renamed.category.count, 2);
  for (const p of [p1, p2])
    assert.equal(s.db.prepare("SELECT category FROM products WHERE id=?").get(p.id).category, "film");
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM categories WHERE id='movies'").get().n, 0);
  const slugAudit = JSON.parse(audits(s, "CATEGORY_UPDATE").at(-1).detail);
  assert.deepEqual(slugAudit.changed.id, { from: "movies", to: "film", products: 2 });
});

test("reorder: full id list, stale list refused, audited once", (t) => {
  const { s, admin, customer } = shop(t);
  const before = ids(s.adminCategories(admin).categories);
  const next = [...before];
  [next[0], next[1]] = [next[1], next[0]]; // "streaming" down one
  assert.throws(() => s.adminReorderCategories(customer, { ids: next }), (e) => e.status === 403);
  const result = s.adminReorderCategories(admin, { ids: next });
  assert.equal(result.changed, true);
  assert.deepEqual(ids(result.categories), next);
  assert.deepEqual(ids(s.adminCategories(admin).categories), next);
  assert.equal(s.adminReorderCategories(admin, { ids: next }).changed, false);
  assert.equal(audits(s, "CATEGORY_UPDATE").length, 1);
  assert.throws(() => s.adminReorderCategories(admin, { ids: next.slice(1) }), (e) => e.status === 409);
  assert.throws(() => s.adminReorderCategories(admin, { ids: [next[0], ...next.slice(0, -1)] }), (e) => e.status === 400);
  assert.throws(() => s.adminReorderCategories(admin, { ids: [] }), (e) => e.status === 400);
  // Public order follows.
  const pub = ids(s.overview().categories);
  assert.deepEqual(pub, next.filter((id) => pub.includes(id)));
});

test("delete: blocked while products use it; moveTo moves them and deletes in one transaction", (t) => {
  const { s, admin, customer } = shop(t);
  const empty = s.adminCreateCategory(admin, { id: "empty-one", name_th: "ว่าง" }).category;
  assert.throws(() => s.adminDeleteCategory(customer, empty.id), (e) => e.status === 403);
  assert.deepEqual(s.adminDeleteCategory(admin, empty.id), { id: "empty-one", deleted: true, moved: 0, moveTo: null });
  assert.throws(() => s.adminDeleteCategory(admin, empty.id), (e) => e.status === 404);

  newProduct(s, admin, "music");
  newProduct(s, admin, "music", { active: false });
  const used = s.db.prepare("SELECT COUNT(*) AS n FROM products WHERE category='music' AND hidden_seed=0").get().n;
  const demoRows = s.db.prepare("SELECT COUNT(*) AS n FROM products WHERE category='music' AND hidden_seed=1").get().n;
  assert.equal(used, 2);
  assert.throws(
    () => s.adminDeleteCategory(admin, "music"),
    (e) => e.status === 409 && e.message.includes(String(used)),
  );
  assert.throws(() => s.adminDeleteCategory(admin, "music", { moveTo: "music" }), (e) => e.status === 400);
  assert.throws(() => s.adminDeleteCategory(admin, "music", { moveTo: "missing" }), (e) => e.status === 404);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM categories WHERE id='music'").get().n, 1, "nothing changed");
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM products WHERE category='music'").get().n, used + demoRows);

  const softwareBefore = s.db.prepare("SELECT COUNT(*) AS n FROM products WHERE category='software'").get().n;
  const result = s.adminDeleteCategory(admin, "music", { moveTo: "software" });
  assert.deepEqual(result, { id: "music", deleted: true, moved: used, moveTo: "software" });
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM products WHERE category='music'").get().n, 0);
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM products WHERE category='software'").get().n,
    softwareBefore + used + demoRows,
  );
  const move = audits(s, "CATEGORY_MOVE_PRODUCTS");
  assert.equal(move.length, 1);
  assert.equal(move[0].entity_id, "software");
  assert.equal(JSON.parse(move[0].detail).count, used);
  const del = audits(s, "CATEGORY_DELETE");
  assert.deepEqual(del.map((r) => r.entity_id), ["empty-one", "music"]);
  assert.equal(JSON.parse(del[1].detail).moved, used);
  // saveProduct now refuses the deleted id.
  assert.throws(() => newProduct(s, admin, "music"), (e) => e.status === 400);
  // Only old demo rows (hidden everywhere) left: counts as empty; the rows follow the first
  // remaining category so no product points at a missing id.
  assert.equal(s.adminCategories(admin).categories.find((c) => c.id === "games").count, 0);
  assert.ok(s.db.prepare("SELECT COUNT(*) AS n FROM products WHERE category='games'").get().n > 0);
  assert.equal(s.adminDeleteCategory(admin, "games").moved, 0);
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM products WHERE category NOT IN (SELECT id FROM categories)").get().n,
    0,
  );
});

test("bulk move: one transaction, unknown category refused, per-product + category audit", (t) => {
  const { s, admin, customer } = shop(t);
  s.adminCreateCategory(admin, { id: "accounts", name_th: "บัญชี" });
  const a = newProduct(s, admin, "music");
  const b = newProduct(s, admin, "games");
  const c = newProduct(s, admin, "accounts");
  assert.throws(
    () => s.bulkUpdateProducts(customer, { action: "move", ids: [a.id], category: "accounts" }),
    (e) => e.status === 403,
  );
  assert.throws(
    () => s.bulkUpdateProducts(admin, { action: "move", ids: [a.id], category: "nope" }),
    (e) => e.status === 404,
  );
  assert.throws(() => s.bulkUpdateProducts(admin, { action: "move", ids: [a.id] }), (e) => e.status === 400);
  assert.throws(
    () => s.bulkUpdateProducts(admin, { action: "move", ids: [a.id, "missing"], category: "accounts" }),
    (e) => e.status === 404,
  );
  assert.equal(s.db.prepare("SELECT category FROM products WHERE id=?").get(a.id).category, "music", "all or nothing");
  const result = s.bulkUpdateProducts(admin, { action: "move", ids: [a.id, b.id, c.id], category: "accounts" });
  assert.deepEqual(
    { updated: result.updated, unchanged: result.unchanged, category: result.category },
    { updated: 2, unchanged: 1, category: "accounts" },
  );
  for (const p of [a, b, c])
    assert.equal(s.db.prepare("SELECT category FROM products WHERE id=?").get(p.id).category, "accounts");
  assert.equal(audits(s, "PRODUCT_BULK_MOVE").length, 3);
  const summary = audits(s, "CATEGORY_MOVE_PRODUCTS");
  assert.equal(summary.length, 1);
  assert.deepEqual(JSON.parse(summary[0].detail).from.sort(), ["games", "music"]);
  // The other bulk actions still work.
  assert.equal(s.bulkUpdateProducts(admin, { action: "deactivate", ids: [a.id] }).updated, 1);
});

test("public overview: only visible categories with products on sale, {id,name,name_en,icon,count}", (t) => {
  const { s, admin } = shop(t);
  newProduct(s, admin, "music");
  const pub = s.overview().categories;
  assert.ok(pub.length > 0);
  for (const c of pub) assert.deepEqual(Object.keys(c).sort(), ["count", "icon", "id", "name", "name_en"]);
  assert.ok(!pub.some((c) => ["ai", "productivity", "vpn"].includes(c.id)), "empty categories are not public");
  const activeMusic = s.db
    .prepare("SELECT COUNT(*) AS n FROM products WHERE category='music' AND active=1 AND hidden_seed=0")
    .get().n;
  assert.equal(pub.find((c) => c.id === "music").count, activeMusic);
  // Admin sees every category, with counts.
  const adminList = s.adminCategories(admin).categories;
  assert.deepEqual(ids(adminList).sort(), FRESH.slice().sort());
  assert.ok(ids(s.adminOverview(admin).categories).includes("vpn"));

  // A draft product does not make a category public; an active one does.
  const draft = newProduct(s, admin, "vpn", { active: false });
  assert.ok(!ids(s.overview().categories).includes("vpn"));
  s.bulkUpdateProducts(admin, { action: "activate", ids: [draft.id] });
  assert.deepEqual(s.overview().categories.find((c) => c.id === "vpn"), {
    id: "vpn",
    name: "VPN/คลาวด์",
    name_en: "VPN & cloud",
    icon: "nordvpn",
    count: 1,
  });
  // Hidden: gone from the public list (products stay on sale), still in the admin list.
  s.adminUpdateCategory(admin, "vpn", { hidden: true });
  assert.ok(!ids(s.overview().categories).includes("vpn"));
  assert.ok(s.products().some((p) => p.id === draft.id), "products in a hidden category stay buyable");
  assert.ok(s.adminCategories(admin).categories.find((c) => c.id === "vpn").hidden);
});

test("saveProduct validates against the table", (t) => {
  const { s, admin } = shop(t);
  assert.throws(() => newProduct(s, admin, "not-a-category"), (e) => e.status === 400);
  assert.throws(() => newProduct(s, admin, undefined), (e) => e.status === 400);
  assert.throws(() => newProduct(s, admin, 7), (e) => e.status === 400);
  s.adminCreateCategory(admin, { id: "new-cat", name_th: "ใหม่", hidden: true });
  const p = newProduct(s, admin, "new-cat");
  assert.equal(s.db.prepare("SELECT category FROM products WHERE id=?").get(p.id).category, "new-cat");
  s.saveProduct(admin, { id: p.id, name: "Renamed", description: "สินค้าทดสอบหมวดหมู่", category: "ai", active: true });
  assert.equal(s.db.prepare("SELECT category FROM products WHERE id=?").get(p.id).category, "ai");
});

test("HTTP: public /api/overview and /api/categories, admin endpoints incl. DELETE ?moveTo", async (t) => {
  const { s, adminToken, customerToken } = shop(t);
  const handle = createAPIHandler(s);
  const call = async (method, path, body, token = adminToken) => {
    const headers = { Cookie: "astra_session=" + token };
    if (method !== "GET") Object.assign(headers, { "X-Astra-Request": "1" });
    if (body) headers["Content-Type"] = "application/json";
    const res = await handle(
      new Request("http://local.test" + path, { method, headers, body: body ? JSON.stringify(body) : undefined }),
    );
    return { status: res.status, data: await res.json() };
  };
  const overview = await call("GET", "/api/overview", undefined, "");
  assert.equal(overview.status, 200);
  assert.ok(overview.data.categories.every((c) => c.count > 0 && !("hidden" in c)));
  const pub = await call("GET", "/api/categories", undefined, "");
  assert.deepEqual(pub.data.categories, overview.data.categories);
  for (const [method, path, body] of [
    ["GET", "/api/admin/categories"],
    ["POST", "/api/admin/categories", { id: "x", name_th: "X" }],
    ["PATCH", "/api/admin/categories/music", { name_th: "X" }],
    ["POST", "/api/admin/categories/reorder", { ids: ["music"] }],
    ["DELETE", "/api/admin/categories/music"],
  ])
    assert.equal((await call(method, path, body, customerToken)).status, 403, method + " " + path);
  const list = await call("GET", "/api/admin/categories");
  assert.equal(list.status, 200);
  assert.equal(list.data.categories.length, FRESH.length);
  const created = await call("POST", "/api/admin/categories", { id: "http-cat", name_th: "เอชทีทีพี", icon: "steam" });
  assert.equal(created.status, 201);
  const patched = await call("PATCH", "/api/admin/categories/http-cat", { name_en: "HTTP" });
  assert.equal(patched.data.category.name_en, "HTTP");
  newProduct(s, s.session(adminToken), "games");
  const blocked = await call("DELETE", "/api/admin/categories/games");
  assert.equal(blocked.status, 409);
  const moved = await call("DELETE", "/api/admin/categories/games?moveTo=http-cat");
  assert.equal(moved.status, 200);
  assert.ok(moved.data.moved > 0);
  const after = await call("GET", "/api/overview", undefined, "");
  assert.ok(after.data.categories.some((c) => c.id === "http-cat" && c.count === moved.data.moved));
  assert.ok(!after.data.categories.some((c) => c.id === "games"));
});

test("SEO: sitemap lists visible categories; category link preview; query parsing", (t) => {
  const { s, admin } = shop(t);
  newProduct(s, admin, "music");
  newProduct(s, admin, "gift");
  s.adminUpdateCategory(admin, "gift", { hidden: true });
  const xml = sitemapXml("https://shop.example/", s.products(), s.overview().categories);
  assert.match(xml, /<loc>https:\/\/shop\.example\/products\?category=music<\/loc><priority>0\.7<\/priority>/);
  assert.doesNotMatch(xml, /category=gift/, "hidden category not listed");
  assert.doesNotMatch(xml, /category=vpn/, "empty category not listed");
  // Admin-shaped input is filtered too.
  const fromAdmin = sitemapXml("https://shop.example", [], s.adminCategories(admin).categories);
  assert.doesNotMatch(fromAdmin, /category=gift|category=vpn/);
  assert.match(fromAdmin, /category=music/);
  // Old callers (no categories) still work.
  assert.doesNotMatch(sitemapXml("https://shop.example", []), /category=/);

  const music = s.overview().categories.find((c) => c.id === "music");
  const meta = categoryMeta("https://shop.example", music, { shopName: "QA SHOP" });
  assert.equal(meta.title, "เพลงและเสียง — QA SHOP");
  assert.equal(meta.url, "https://shop.example/products?category=music");
  assert.match(meta.description, /เพลงและเสียง/);
  assert.match(metaTags(meta), /<title>เพลงและเสียง — QA SHOP<\/title>/);
  assert.equal(categoryMeta("https://x.test", { id: "a", name: "<b>" }, null).title, "<b> — ASIA EXTRA");
  assert.match(metaTags(categoryMeta("https://x.test", { id: "a", name: "<b>" }, null)), /&lt;b&gt;/);
  assert.equal(categoryIdFromQuery("Music"), "music");
  for (const bad of [null, "", "a b", "../x", "x".repeat(41), "ข้อมูล"]) assert.equal(categoryIdFromQuery(bad), null);
});
