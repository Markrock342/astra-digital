// Legal pages form (settings.legal) + basic SEO (sitemap, robots, link-preview meta).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createCommerce } from "../server/commerce.mjs";
import {
  DEFAULT_PRIVACY,
  DEFAULT_TERMS,
  LEGAL_FIELDS,
  POLICY_SECTION_ID,
  fillTemplate,
  formatThaiDate,
  legalSections,
  normalizeLegal,
  parseBlocks,
  renderLegalDocument,
  storedSections,
} from "../server/legal.mjs";
import {
  homeMeta,
  metaTags,
  productIdFromPath,
  productMeta,
  robotsTxt,
  sitemapXml,
} from "../server/seo.mjs";

const adminPassword = randomBytes(24).toString("hex");
function shop(t) {
  const s = createCommerce({ adminPassword });
  t.after(() => s.db.close());
  const admin = s.session(s.login({ email: "admin@astra.local", password: adminPassword }).token);
  return { s, admin };
}
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const text = (doc) =>
  doc.sections
    .flatMap((s) => [s.title, ...s.blocks.flatMap((b) => (b.type === "ul" ? b.items : [b.text]))])
    .join("\n");

test("legal defaults: formal Thai terms and PDPA privacy with every required section", () => {
  const terms = DEFAULT_TERMS.map((s) => s.id);
  for (const id of [
    "definitions", "acceptance", "account", "products", "pricing", "delivery", "warranty",
    "refunds", "prohibited", "liability", "intellectual-property", "changes", "governing-law", "contact",
  ])
    assert.ok(terms.includes(id), "terms section " + id);
  const privacy = DEFAULT_PRIVACY.map((s) => s.id);
  for (const id of [
    "controller", "data-collected", "purposes", "retention", "disclosure", "cross-border",
    "security", "rights", "cookies", "children", "changes", "contact",
  ])
    assert.ok(privacy.includes(id), "privacy section " + id);
  const doc = renderLegalDocument("privacy", null, { shopName: "QA SHOP", email: "hi@qa.example" });
  const all = text(doc);
  assert.match(all, /พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ\.ศ\. 2562/);
  assert.match(all, /สคส\./);
  assert.match(all, /Cloudflare/);
  assert.match(all, /hi@qa\.example/);
  const terms2 = text(renderLegalDocument("terms", null, { shopName: "QA SHOP" }));
  assert.match(terms2, /เครื่องหมายการค้า/);
  assert.match(terms2, /กฎหมายแห่งราชอาณาจักรไทย/);
});

test("legal fields save through settings, render with placeholders and keep the audit short", (t) => {
  const { s, admin } = shop(t);
  const customer = s.session(
    s.register({ name: "Legal Buyer", email: "legal-buyer@example.invalid", password: "Legal-buyer-Pass-123" }).token,
  );
  assert.throws(() => s.saveSettings(customer, { legal: {} }), (e) => e.status === 403);
  s.saveSettings(admin, { shopName: "QA LEGAL", email: "shop@qa.example" });
  // Never saved → built-in defaults, shop name/email as fallbacks, missing fields listed.
  assert.equal(s.legal().legal, null);
  let doc = renderLegalDocument("terms", s.legal().legal, s.overview().shop, { website: "shop.test" });
  assert.equal(doc.effectiveDate, "");
  assert.deepEqual(
    doc.missing.map((m) => m.key).sort(),
    ["address", "dpo", "effectiveDate", "line", "phone"],
  );
  assert.ok(!text(doc).includes("{{"), "no raw placeholders");
  assert.ok(!text(doc).includes("เลขประจำตัวผู้เสียภาษี"), "empty optional tax ID line is hidden");
  assert.match(text(doc), /“ร้าน” หรือ “เรา” หมายถึง QA LEGAL ผู้ให้บริการเว็บไซต์ QA LEGAL/);
  assert.match(text(doc), /อีเมล: shop@qa\.example/);

  const terms = legalSections("terms", null).map((x) => ({ ...x }));
  terms[0] = { ...terms[0], body: "ข้อความนิยามใหม่ของ {{entityName}}" };
  const moved = terms.splice(terms.findIndex((x) => x.id === "liability"), 1)[0];
  terms.unshift(moved);
  terms.splice(terms.findIndex((x) => x.id === "prohibited"), 1);
  terms.push({ id: "custom-extra", title: "บัญชีครอบครัว", body: "- ใช้ร่วมกันได้ไม่เกิน {{maxUsers}} คน" });
  s.saveSettings(admin, {
    legal: {
      entityName: "บริษัท คิวเอ จำกัด",
      address: "99 ถนนทดสอบ\nกรุงเทพมหานคร 10110",
      taxId: "0105555000000",
      phone: "02-000-0000",
      line: "@qalegal",
      dpo: "คุณข้อมูล ปลอดภัย",
      effectiveDate: "2026-11-13",
      terms: storedSections("terms", terms),
    },
  });
  const saved = s.legal().legal;
  // Untouched defaults are stored as ids only; edits keep their own text.
  assert.deepEqual(saved.terms.find((x) => x.id === "acceptance"), { id: "acceptance" });
  assert.equal(saved.terms[0].id, "liability");
  assert.equal(saved.terms.find((x) => x.id === "definitions").body, "ข้อความนิยามใหม่ของ {{entityName}}");
  assert.ok(!saved.terms.some((x) => x.id === "prohibited"));
  assert.equal(saved.privacy, undefined);
  assert.equal("legal" in s.overview().shop, false, "overview stays light");
  doc = renderLegalDocument("terms", saved, s.overview().shop);
  assert.equal(doc.effectiveDate, "13 พฤศจิกายน 2569");
  assert.deepEqual(doc.missing, []);
  assert.equal(doc.sections[0].id, "liability");
  assert.equal(doc.sections[0].number, 1);
  assert.ok(!doc.sections.some((x) => x.id === "prohibited"));
  assert.deepEqual(doc.sections.find((x) => x.id === "definitions").blocks, [
    { type: "p", text: "ข้อความนิยามใหม่ของ บริษัท คิวเอ จำกัด" },
  ]);
  const custom = doc.sections.find((x) => x.id === "custom-extra");
  assert.deepEqual(custom.blocks, [{ type: "ul", items: ["ใช้ร่วมกันได้ไม่เกิน {{maxUsers}} คน"] }], "unknown placeholders stay");
  const contact = doc.sections.find((x) => x.id === "contact").blocks[1].items;
  assert.ok(contact.includes("ที่อยู่: 99 ถนนทดสอบ กรุงเทพมหานคร 10110"), "inline multi-line value joins");
  assert.ok(contact.includes("เลขประจำตัวผู้เสียภาษี: 0105555000000"));
  assert.ok(contact.includes("LINE: @qalegal"));
  // Privacy still uses the defaults with the saved fields.
  assert.match(text(renderLegalDocument("privacy", saved, s.overview().shop)), /ผู้ประสานงานด้านข้อมูลส่วนบุคคล: คุณข้อมูล ปลอดภัย/);

  const audit = s.db
    .prepare("SELECT detail FROM audit WHERE action='SAVE_SETTINGS' ORDER BY id DESC LIMIT 1")
    .get();
  const changed = JSON.parse(audit.detail).changed;
  assert.deepEqual(Object.keys(changed), ["legal"]);
  assert.ok(changed.legal.fields.includes("entityName"));
  assert.ok(changed.legal.fields.includes("terms"));
  assert.ok(!audit.detail.includes("ข้อความนิยามใหม่"), "long text is not copied into the audit");

  // Validation: bad dates, custom sections without text, duplicates, oversized bodies, types.
  for (const legal of [
    { effectiveDate: "2026-02-30" },
    { email: "not-an-email" },
    { taxId: "<b>1</b>" },
    { terms: [{ id: "custom-x", title: "ไม่มีเนื้อหา" }] },
    { terms: [{ id: "contact" }, { id: "contact" }] },
    { terms: [{ id: "Bad Id" }] },
    { terms: [{ id: "contact", body: "x".repeat(10001) }] },
    { terms: "nope" },
    { entityName: 42 },
    [],
  ])
    assert.throws(() => s.saveSettings(admin, { legal }), (e) => e.status === 400, JSON.stringify(legal).slice(0, 60));
  assert.equal(s.legal().legal.entityName, "บริษัท คิวเอ จำกัด", "failed saves change nothing");
});

test("old custom policy text becomes an extra terms section until the form is saved", (t) => {
  const { s, admin } = shop(t);
  s.saveSettings(admin, { policy: "ห้ามแชร์บัญชี\n- ข้อเพิ่มเติม" });
  const { legal, policy } = s.legal();
  const sections = legalSections("terms", legal, policy);
  const extra = sections.find((x) => x.id === POLICY_SECTION_ID);
  assert.equal(extra.body, "ห้ามแชร์บัญชี\n- ข้อเพิ่มเติม");
  assert.equal(sections[sections.indexOf(extra) + 1].id, "changes");
  const doc = renderLegalDocument("terms", legal, { ...s.overview().shop, policy });
  assert.deepEqual(doc.sections.find((x) => x.id === POLICY_SECTION_ID).blocks, [
    { type: "p", text: "ห้ามแชร์บัญชี" },
    { type: "ul", items: ["ข้อเพิ่มเติม"] },
  ]);
  // Saving the form keeps it as a normal custom section; deleting it later sticks.
  s.saveSettings(admin, { legal: { terms: storedSections("terms", sections) } });
  assert.ok(s.legal().legal.terms.some((x) => x.id === POLICY_SECTION_ID && x.body));
  s.saveSettings(admin, {
    legal: { terms: storedSections("terms", sections.filter((x) => x.id !== POLICY_SECTION_ID)) },
  });
  const after = s.legal();
  assert.ok(!legalSections("terms", after.legal, after.policy).some((x) => x.id === POLICY_SECTION_ID));
});

test("legal text is data, never markup: HTML in fields and bodies stays literal", (t) => {
  const { s, admin } = shop(t);
  const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  s.saveSettings(admin, {
    legal: {
      entityName: attack,
      terms: [{ id: "custom-xss", title: "<b>หัวข้อ</b>", body: "ย่อหน้า " + attack + "\n- {{entityName}}" }],
    },
  });
  const legal = s.legal().legal;
  assert.equal(legal.entityName, attack, "stored as typed (escaping happens when shown)");
  const doc = renderLegalDocument("terms", legal, s.overview().shop);
  assert.equal(doc.sections[0].title, "<b>หัวข้อ</b>");
  assert.deepEqual(doc.sections[0].blocks, [
    { type: "p", text: "ย่อหน้า " + attack },
    { type: "ul", items: [attack] },
  ]);
  // Blocks only ever carry text, no html fields the UI could inject.
  for (const block of doc.sections[0].blocks)
    assert.deepEqual(Object.keys(block).sort(), block.type === "ul" ? ["items", "type"] : ["text", "type"]);
  // A placeholder value cannot smuggle in another placeholder or a bullet structure inline.
  assert.equal(fillTemplate("ชื่อ: {{entityName}}", { entityName: "a\n- b {{email}}", email: "x" }), "ชื่อ: a - b {{email}}");
  // The SEO head tags escape product text.
  const tags = metaTags(
    productMeta("https://shop.test", { id: "p1", name: '"><script>x</script>', description: "a & b <i>" }, {}),
  );
  assert.ok(!tags.includes("<script>"));
  assert.match(tags, /&quot;&gt;&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(tags, /a &amp; b &lt;i&gt;/);
});

test("parseBlocks, fillTemplate and Thai dates", () => {
  assert.deepEqual(parseBlocks("หนึ่ง\nสอง\n\n- ก\n• ข\n* ค\n\nสาม\n- ง"), [
    { type: "p", text: "หนึ่ง\nสอง" },
    { type: "ul", items: ["ก", "ข", "ค"] },
    { type: "p", text: "สาม" },
    { type: "ul", items: ["ง"] },
  ]);
  assert.equal(
    fillTemplate("บรรทัด {{a}}\n- ซ่อน {{b}}\n{{c}}", { a: "1", b: " ", c: "- x\n- y" }),
    "บรรทัด 1\n- x\n- y",
  );
  assert.equal(formatThaiDate("2027-01-01"), "1 มกราคม 2570");
  assert.equal(formatThaiDate("2027-13-01"), "");
  assert.ok(LEGAL_FIELDS.find((f) => f.key === "taxId").optional);
  assert.deepEqual(normalizeLegal({ entityName: "  ร้าน  ", unknown: "x", terms: [{ id: "contact", title: " ติดต่อ   เรา " }] }, fail), {
    entityName: "ร้าน",
    terms: [{ id: "contact", title: "ติดต่อ เรา" }],
  });
});

test("sitemap lists the storefront pages and active products only", (t) => {
  const { s, admin } = shop(t);
  const draft = s.saveProduct(admin, {
    name: "Hidden draft",
    description: "Draft",
    category: "streaming",
    price: 12300,
    active: false,
  });
  const live = s.products();
  assert.ok(live.length > 0);
  const xml = sitemapXml("https://shop.test/", live);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  for (const path of ["/", "/products", "/reviews", "/terms", "/privacy"])
    assert.ok(xml.includes(`<loc>https://shop.test${path}</loc>`), path);
  for (const p of live)
    assert.ok(xml.includes(`<loc>https://shop.test/products/${encodeURIComponent(p.id)}</loc>`), p.id);
  assert.ok(!xml.includes(draft.id), "inactive product is not listed");
  assert.ok(!xml.includes("/admin") && !xml.includes("/api"));
  // Defensive filter + escaping when handed stale/odd data.
  const odd = sitemapXml("https://shop.test", [
    { id: "a&b<c>", active: 1 },
    { id: "off", active: 0 },
    { id: "seed", active: 1, hidden_seed: 1 },
  ]);
  assert.ok(odd.includes("<loc>https://shop.test/products/a%26b%3Cc%3E</loc>"));
  assert.ok(!odd.includes("/products/off<") && !odd.includes("/products/seed<"));
});

test("robots.txt allows the storefront, blocks admin and api, points to the sitemap", () => {
  assert.equal(
    robotsTxt("https://shop.test/"),
    "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\n\nSitemap: https://shop.test/sitemap.xml\n",
  );
});

test("link-preview meta: product image becomes absolute, home uses shop name and announcement", () => {
  assert.equal(productIdFromPath("/products/netflix-premium"), "netflix-premium");
  assert.equal(productIdFromPath("/products/a%20b/"), "a b");
  assert.equal(productIdFromPath("/products/"), null);
  assert.equal(productIdFromPath("/products/a/b"), null);
  assert.equal(productIdFromPath("/products/%E0%A4%A"), null);
  const product = productMeta(
    "https://shop.test",
    { id: "p 1", name: "Stream Plus", description: "ดูหนัง\nได้ทุกวัน", imageUrl: "/api/files/abc.webp" },
    { shopName: "ร้านทดสอบ" },
  );
  assert.equal(product.title, "Stream Plus — ร้านทดสอบ");
  assert.equal(product.description, "ดูหนัง ได้ทุกวัน");
  assert.equal(product.image, "https://shop.test/api/files/abc.webp");
  assert.equal(product.url, "https://shop.test/products/p%201");
  const tags = metaTags(product);
  for (const part of [
    '<meta property="og:image" content="https://shop.test/api/files/abc.webp" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<link rel="canonical" href="https://shop.test/products/p%201" />',
    '<meta property="og:url" content="https://shop.test/products/p%201" />',
    "<title>Stream Plus — ร้านทดสอบ</title>",
  ])
    assert.ok(tags.includes(part), part);
  assert.ok(!tags.includes("og:image:width"), "custom image size is unknown");
  assert.equal(
    productMeta("https://shop.test", { id: "x", name: "X", imageUrl: "javascript:alert(1)" }, null).image,
    "https://shop.test/brand/og.png",
  );
  const home = homeMeta("https://shop.test", { shopName: "ร้านค้า", announcement: "โปรใหม่วันนี้" });
  assert.equal(home.title, "ASIA EXTRA — สินค้าดิจิทัล");
  assert.equal(home.description, "โปรใหม่วันนี้");
  assert.equal(home.url, "https://shop.test/");
  assert.ok(metaTags(home).includes('<meta property="og:image:width" content="1200" />'));
});

test("workerd: Pages proxy serves robots + sitemap and rewrites product <head> with HTMLRewriter", { timeout: 120000 }, async (t) => {
  const { Miniflare, convertV4MiniflareOptions } = await import("miniflare");
  const { build } = await import("esbuild");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const script = (
    await build({
      entryPoints: [join(root, "cloud/pages-proxy.mjs")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
    })
  ).outputFiles[0].text;
  const indexHtml = `<!doctype html><html lang="th"><head>
    <meta charset="UTF-8" />
    <meta name="description" content="old" />
    <meta property="og:title" content="ASIA EXTRA" />
    <meta property="og:image" content="/brand/og.png" />
    <meta property="og:image:width" content="1200" />
    <title>ASIA EXTRA — สินค้าดิจิทัล</title>
  </head><body><div id="root"></div></body></html>`;
  const products = [
    { id: "stream-plus", name: 'Stream "Plus" <4K>', description: "ดูได้ทุกที่", imageUrl: "/api/files/cover.webp", active: 1 },
  ];
  let apiDown = false;
  const apiCalls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: "astra-pages-proxy",
    modules: true,
    script,
    compatibilityDate: "2026-10-01",
    serviceBindings: {
      ASSETS: async () =>
        new Response(indexHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"index"', "Content-Security-Policy": "default-src 'self'" },
        }),
      COMMERCE_API: async (request) => {
        const { pathname } = new URL(request.url);
        apiCalls.push({ pathname, cookie: request.headers.get("Cookie") });
        if (apiDown) return new Response("down", { status: 503 });
        if (pathname === "/api/products") return Response.json({ products });
        if (pathname === "/api/overview")
          return Response.json({ shop: { shopName: "ร้านทดสอบ", announcement: "ประกาศ <ใหม่>" } });
        const m = /^\/api\/products\/(.+)$/.exec(pathname);
        const p = m && products.find((x) => x.id === decodeURIComponent(m[1]));
        if (p) return Response.json({ product: p });
        if (pathname === "/api/echo") return Response.json({ forwarded: true });
        return Response.json({ error: "ไม่พบสินค้า" }, { status: 404 });
      },
    },
  }));
  t.after(() => mf.dispose());
  const get = (path, init) => mf.dispatchFetch("https://shop.test" + path, init);

  const robots = await get("/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type"), /text\/plain/);
  assert.equal(await robots.text(), robotsTxt("https://shop.test"));

  const sitemap = await get("/sitemap.xml");
  assert.match(sitemap.headers.get("content-type"), /application\/xml/);
  const xml = await sitemap.text();
  assert.ok(xml.includes("<loc>https://shop.test/products/stream-plus</loc>"));
  assert.ok(xml.includes("<loc>https://shop.test/privacy</loc>"));

  const page = await get("/products/stream-plus", { headers: { Cookie: "astra_session=secret" } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("etag"), null);
  assert.equal(page.headers.get("content-security-policy"), "default-src 'self'", "CSP untouched");
  const html = await page.text();
  assert.ok(html.includes('<meta property="og:image" content="https://shop.test/api/files/cover.webp" />'));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image" />'));
  assert.ok(html.includes('<link rel="canonical" href="https://shop.test/products/stream-plus" />'));
  assert.ok(html.includes("<title>Stream &quot;Plus&quot; &lt;4K&gt; — ร้านทดสอบ</title>"));
  assert.ok(html.includes('<meta name="description" content="ดูได้ทุกที่" />'));
  assert.equal((html.match(/<title>/g) ?? []).length, 1, "old title removed");
  assert.equal((html.match(/property="og:image"/g) ?? []).length, 1, "old og:image removed");
  assert.ok(!html.includes('content="old"'));
  assert.ok(!html.includes("og:image:width"));
  assert.ok(apiCalls.every((c) => c.cookie === null), "visitor cookies never reach the API lookups");

  const home = await (await get("/")).text();
  assert.ok(home.includes("<title>ร้านทดสอบ — สินค้าดิจิทัล</title>"));
  assert.ok(home.includes('<meta name="description" content="ประกาศ &lt;ใหม่&gt;" />'));
  assert.ok(home.includes('<meta property="og:image" content="https://shop.test/brand/og.png" />'));

  // Unknown product → untouched SPA HTML.
  const missing = await (await get("/products/nope")).text();
  assert.equal(missing, indexHtml);
  // Other pages are not rewritten; /api is forwarded.
  assert.equal(await (await get("/terms")).text(), indexHtml);
  assert.deepEqual(await (await get("/api/echo")).json(), { forwarded: true });

  // API down → plain HTML for a product not in the short cache, sitemap still lists static pages.
  apiDown = true;
  assert.equal(await (await get("/products/other-id")).text(), indexHtml);
  const head = await get("/robots.txt", { method: "HEAD" });
  assert.equal(head.status, 200);

  // www → apex, same path and query; the API on www still answers (no redirect for /api).
  const www = await mf.dispatchFetch("https://www.shop.test/products?category=music", { redirect: "manual" });
  assert.equal(www.status, 301);
  assert.equal(www.headers.get("location"), "https://shop.test/products?category=music");
  apiDown = false;
  assert.deepEqual(await (await mf.dispatchFetch("https://www.shop.test/api/echo")).json(), { forwarded: true });
  assert.equal((await get("/terms", { redirect: "manual" })).status, 200, "apex is not redirected");
});
