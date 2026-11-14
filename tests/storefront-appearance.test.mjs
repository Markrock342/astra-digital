// ตั้งค่า › หน้าตาร้าน (server/appearance.mjs + appearance-rules.mjs): defaults equal today's
// storefront, validation, reset, ADMIN-only, audit trail, public overview fields, link
// previews, and the footer credit that no setting can touch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { APPEARANCE_KEY } from "../server/appearance.mjs";
import {
  APPEARANCE_PARTS,
  DEFAULT_APPEARANCE,
  HOME_SECTIONS,
  LIMITS,
  TRUST_ICONS,
  APPEARANCE_REV,
  checkColor,
  colorTokens,
  contrast,
  defaultAppearance,
  heroTitleFallback,
  migrateStoredAppearance,
  pick,
  resolveAppearance,
} from "../server/appearance-rules.mjs";
import { homeMeta, metaTags, productMeta } from "../server/seo.mjs";
import { EN_STRINGS } from "../src/i18n-en.ts";

const png = () => {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[63] = Math.floor(Math.random() * 255);
  return bytes;
};

function fixture(t) {
  const adminPassword = randomBytes(18).toString("hex");
  const s = createCommerce({ adminPassword });
  t.after(() => s.db.close());
  const adminToken = s.login({ email: "admin@astra.local", password: adminPassword }).token;
  const buyerAuth = s.register({ name: "Look Buyer", email: "look-buyer@example.invalid", password: "Buyer-only-Password-123" });
  const staffAuth = s.register({ name: "Look Staff", email: "look-staff@example.invalid", password: "Staff-only-Password-123" });
  s.db.prepare("UPDATE users SET role='STAFF' WHERE id=?").run(s.session(staffAuth.token).id);
  return {
    s,
    admin: s.session(adminToken),
    adminToken,
    buyer: s.session(buyerAuth.token),
    buyerToken: buyerAuth.token,
    staff: s.session(staffAuth.token),
    staffToken: staffAuth.token,
  };
}
const audits = (s) =>
  s.db
    .prepare("SELECT action,detail FROM audit WHERE entity_id='appearance' ORDER BY id")
    .all()
    .map((r) => ({ action: r.action, detail: r.detail ? JSON.parse(r.detail) : null }));
const stored = (s) => {
  const row = s.db.prepare("SELECT value FROM runtime_flags WHERE key=?").get(APPEARANCE_KEY);
  return row ? JSON.parse(row.value) : null;
};
const rejects = (fn, pattern) =>
  assert.throws(fn, (e) => e.status === 400 && (!pattern || pattern.test(e.message)), String(pattern ?? ""));

test("defaults are today's storefront text, word for word (TH and the current EN translations)", (t) => {
  const { s } = fixture(t);
  const a = s.overview().appearance;
  assert.equal(stored(s), null, "nothing stored until the admin saves");
  // Hero buttons + links (client round, Nov 2026): "สินค้าทั้งหมด", then "รีวิวจากลูกค้า" for
  // signed-in customers or "เข้าสู่ระบบ" for visitors.
  assert.deepEqual(a.hero.primary, { label: { th: "สินค้าทั้งหมด", en: EN_STRINGS["สินค้าทั้งหมด"] }, link: "/products" });
  assert.deepEqual(a.hero.secondary, { label: { th: "รีวิวจากลูกค้า", en: EN_STRINGS["รีวิวจากลูกค้า"] }, link: "/reviews" });
  assert.deepEqual(a.hero.guest, { label: { th: "เข้าสู่ระบบ", en: EN_STRINGS["เข้าสู่ระบบ"] }, link: "/login" });
  // Automatic hero title ("WELCOME TO " + shop name) / headline / footer description / SEO = empty.
  assert.deepEqual(a.hero.title, { th: "", en: "" });
  assert.equal(heroTitleFallback("ASIA EXTRA"), "WELCOME TO ASIA EXTRA");
  assert.deepEqual(a.hero.headline, { th: "", en: "" });
  assert.deepEqual(a.hero.subtext, { th: "", en: "" });
  assert.deepEqual(a.footer.description, { th: "", en: "" });
  // Marquee: the five strips in Theme.tsx, with their translations.
  const marquee = [
    "สินค้าพร้อมส่ง ได้รับทันทีหลังชำระเงิน",
    "เก็บ ID และรหัสผ่านแบบเข้ารหัส",
    "แชทกับร้านได้ในเว็บ",
    "รีวิวจากผู้ซื้อจริง",
    "สั่งจองล่วงหน้าได้",
  ];
  assert.deepEqual(a.marquee, marquee.map((th) => ({ th, en: EN_STRINGS[th] })));
  // Footer menu = the five links in App.tsx Footer.
  assert.deepEqual(
    a.footer.links.map((l) => [l.label.th, l.label.en, l.link]),
    [
      ["สินค้าทั้งหมด", "/products"],
      ["เครดิตร้าน", "/reviews"],
      ["ประวัติการซื้อ", "/orders"],
      ["คำถามที่พบบ่อย", "/faq"],
      ["ติดต่อเรา", "/support"],
    ].map(([th, link]) => [th, EN_STRINGS[th], link]),
  );
  // Trust block: the texts of the old credits panel, switched off so /credits stays as it is.
  assert.equal(a.trust.show, false);
  assert.deepEqual(a.trust.heading, { th: "ซื้อสินค้าอย่างมั่นใจ", en: EN_STRINGS["ซื้อสินค้าอย่างมั่นใจ"] });
  for (const card of a.trust.cards) {
    assert.equal(card.title.en, EN_STRINGS[card.title.th]);
    assert.equal(card.text.en, EN_STRINGS[card.text.th]);
    assert.ok(TRUST_ICONS.includes(card.icon));
  }
  assert.deepEqual(a.sections.map((x) => x.id), HOME_SECTIONS);
  // The category block is only on /products now: hidden on the home page by default.
  assert.deepEqual(a.sections.filter((x) => !x.visible).map((x) => x.id), ["categories"]);
  assert.deepEqual(a.colors, { primary: null, secondary: null, defaultAccent: "blue" });
  assert.deepEqual(a.seo, { title: { th: "", en: "" }, description: { th: "", en: "" }, ogImageUrl: null, faviconUrl: null });
  // Language pick: English when filled in, Thai otherwise.
  assert.equal(pick({ th: "ไทย", en: "Eng" }, "en"), "Eng");
  assert.equal(pick({ th: "ไทย", en: "" }, "en"), "ไทย");
  assert.equal(pick({ th: "ไทย", en: "Eng" }, "th"), "ไทย");
});

test("validation: lengths, link schemes, colours, counts, sections, icons", (t) => {
  const { s, admin } = fixture(t);
  const d = defaultAppearance();
  const save = (part, value) => s.saveAppearance(admin, { [part]: value });
  // Lengths.
  rejects(() => save("hero", { ...d.hero, headline: { th: "ก".repeat(LIMITS.heroHeadline + 1) } }), /ยาวเกิน/);
  rejects(() => save("hero", { ...d.hero, title: { th: "", en: "W".repeat(LIMITS.heroTitle + 1) } }), /ยาวเกิน/);
  rejects(() => save("hero", { ...d.hero, guest: { label: { th: "เข้า" }, link: "javascript:alert(1)" } }));
  rejects(() => save("marquee", ["x".repeat(LIMITS.marqueeItem + 1)]), /ยาวเกิน/);
  rejects(() => save("seo", { title: { th: "", en: "t".repeat(LIMITS.seoTitle + 1) }, description: {} }), /ยาวเกิน/);
  rejects(() => save("hero", { ...d.hero, primary: { label: { th: "" }, link: "/products" } }), /กรุณาใส่/);
  rejects(() => save("hero", { ...d.hero, headline: { th: "a\u0007b" } }), /อักขระ/);
  rejects(() => save("hero", { ...d.hero, headline: { th: 42 } }));
  // Links: only "/" in-shop paths and https.
  for (const link of [
    "javascript:alert(1)",
    "data:text/html,x",
    "http://example.com",
    "//evil.example",
    "/\\evil",
    "mailto:a@b.co",
    "/api/admin/appearance",
    "",
  ]) {
    rejects(() => save("hero", { ...d.hero, primary: { label: { th: "ซื้อ" }, link } }), undefined);
    rejects(() => save("footer", { ...d.footer, links: [{ label: { th: "เมนู" }, link }] }), undefined);
  }
  assert.equal(
    save("footer", { ...d.footer, links: [{ label: { th: "LINE" }, link: "https://line.me/R/ti/p/@shop" }] }).appearance.footer.links[0].link,
    "https://line.me/R/ti/p/@shop",
  );
  // Colours: #RRGGBB only; unreadable ones are refused.
  for (const value of ["red", "#fff", "#12345g", "1534ff", "#1534ff80", "rgb(0,0,0)"])
    rejects(() => save("colors", { primary: value }), /#RRGGBB/);
  rejects(() => save("colors", { primary: "#ffffff" }), /พื้นขาว/);
  rejects(() => save("colors", { primary: "#fefefe" }), /พื้นขาว/);
  rejects(() => save("colors", { secondary: "#000000" }), /พื้นดำ/);
  rejects(() => save("colors", { defaultAccent: "pink" }), /สีธีม/);
  assert.equal(save("colors", { primary: "#E11D48", defaultAccent: "duo" }).appearance.colors.primary, "#e11d48");
  // Counts.
  rejects(() => save("marquee", []), /อย่างน้อย/);
  rejects(() => save("marquee", Array.from({ length: LIMITS.marqueeMax + 1 }, (_, i) => "ข้อ " + i)), /สูงสุด/);
  rejects(() => save("trust", { ...d.trust, cards: [] }), /อย่างน้อย/);
  rejects(() => save("trust", { ...d.trust, cards: Array(LIMITS.cardsMax + 1).fill(d.trust.cards[0]) }), /สูงสุด/);
  rejects(() => save("footer", { ...d.footer, links: Array(LIMITS.footerLinksMax + 1).fill(d.footer.links[0]) }), /สูงสุด/);
  // Icons from the fixed set only.
  rejects(() => save("trust", { ...d.trust, cards: [{ ...d.trust.cards[0], icon: "Skull" }] }), /ไอคอน/);
  rejects(() => save("trust", { ...d.trust, cards: [{ ...d.trust.cards[0], icon: "<img onerror=x>" }] }), /ไอคอน/);
  // Sections: known ids, no duplicates, the product list cannot be hidden.
  rejects(() => save("sections", [{ id: "hero", visible: true }, { id: "hero", visible: false }]));
  rejects(() => save("sections", [{ id: "footer", visible: false }]));
  rejects(() => save("sections", HOME_SECTIONS.map((id) => ({ id, visible: id !== "products" }))), /ซ่อนไม่ได้/);
  rejects(() => save("sections", [{ id: "hero", visible: "no" }]));
  const reordered = save("sections", [{ id: "products", visible: true }, { id: "stats", visible: false }]).appearance.sections;
  assert.deepEqual(reordered.slice(0, 2), [{ id: "products", visible: true }, { id: "stats", visible: false }]);
  assert.equal(reordered.length, HOME_SECTIONS.length, "sections left out are kept, shown");
  // Whole-object shape.
  rejects(() => s.saveAppearance(admin, {}), /ไม่มีข้อมูล/);
  rejects(() => s.saveAppearance(admin, { hero: "x" }));
  // Text is collapsed to one line and trimmed (plain text, rendered as text nodes).
  const saved = save("marquee", ["  ส่งไว\n\nทันใจ  ", { th: "<b>ตัวหนา</b>", en: "Bold" }]).appearance.marquee;
  assert.deepEqual(saved, [{ th: "ส่งไว ทันใจ", en: "" }, { th: "<b>ตัวหนา</b>", en: "Bold" }]);
});

test("colour rules: readable text shades in light and dark, ink on fills", () => {
  for (const hex of ["#1534ff", "#e11d48", "#ffcc00", "#16a34a", "#777777", "#0f172a", "#fde047"]) {
    const { problem } = checkColor(hex);
    if (problem) continue;
    const tokens = colorTokens(hex);
    assert.ok(contrast(tokens.light.text, "#ffffff") >= 4.5, hex + " light text");
    assert.ok(contrast(tokens.dark.text, "#0a0a0a") >= 4.5, hex + " dark text");
    assert.ok(contrast(tokens.light.fill, tokens.light.ink) >= 4.5, hex + " light ink");
    assert.ok(contrast(tokens.dark.fill, tokens.dark.ink) >= 4.5, hex + " dark ink");
  }
  assert.match(checkColor("#ffcc00").warnings.join(" "), /พื้นขาว/, "yellow warns about white pages");
  assert.equal(checkColor("#e11d48").warnings.length, 0);
  assert.ok(checkColor("#f4f4f4").problem);
  assert.ok(checkColor("#050505").problem);
});

test("save + reset: per part and everything, audited, damaged rows fall back to defaults", async (t) => {
  const { s, admin } = fixture(t);
  const d = defaultAppearance();
  const first = s.saveAppearance(admin, {
    hero: { ...d.hero, headline: { th: "ช้อปเลย", en: "Shop" } },
    marquee: ["หนึ่ง", "สอง"],
  });
  assert.deepEqual(first.changed.sort(), ["hero", "marquee"]);
  assert.deepEqual(first.customized.sort(), ["hero", "marquee"]);
  // Saving the same values again changes nothing and writes no audit row.
  assert.deepEqual(s.saveAppearance(admin, { marquee: ["หนึ่ง", "สอง"] }).changed, []);
  const reset = await s.resetAppearance(admin, { part: "hero" });
  assert.deepEqual(reset.appearance.hero, DEFAULT_APPEARANCE.hero);
  assert.deepEqual(reset.customized, ["marquee"]);
  await assert.rejects(s.resetAppearance(admin, { part: "credit" }), (e) => e.status === 400);
  await s.resetAppearance(admin, { part: "all" });
  const back = s.overview().appearance;
  for (const part of APPEARANCE_PARTS.filter((p) => p !== "seo")) assert.deepEqual(back[part], DEFAULT_APPEARANCE[part], part);
  assert.deepEqual(
    audits(s),
    [
      { action: "APPEARANCE_SAVE", detail: { parts: ["hero", "marquee"] } },
      { action: "APPEARANCE_RESET", detail: { part: "hero" } },
      { action: "APPEARANCE_RESET", detail: { part: "all" } },
    ],
  );
  // A damaged part never blanks the storefront.
  s.db.prepare("UPDATE runtime_flags SET value=? WHERE key=?").run(
    JSON.stringify({ marquee: [], hero: { primary: { label: { th: "" } } }, colors: { primary: "#ffffff" }, footer: { links: [{ label: { th: "x" }, link: "javascript:1" }] } }),
    APPEARANCE_KEY,
  );
  const fallback = s.overview().appearance;
  assert.deepEqual(fallback.marquee, DEFAULT_APPEARANCE.marquee);
  assert.deepEqual(fallback.hero, DEFAULT_APPEARANCE.hero);
  assert.deepEqual(fallback.colors, DEFAULT_APPEARANCE.colors);
  assert.deepEqual(fallback.footer, DEFAULT_APPEARANCE.footer);
  s.db.prepare("UPDATE runtime_flags SET value='not json' WHERE key=?").run(APPEARANCE_KEY);
  assert.deepEqual(s.overview().appearance.sections, DEFAULT_APPEARANCE.sections);
  assert.deepEqual(resolveAppearance(null), defaultAppearance());
});

test("ADMIN only: staff, customers and visitors cannot read or change the appearance", async (t) => {
  const { s, staff, buyer } = fixture(t);
  for (const user of [staff, buyer, null]) {
    const denied = (e) => e.status === (user ? 403 : 401);
    assert.throws(() => s.adminAppearance(user), denied);
    assert.throws(() => s.saveAppearance(user, { marquee: ["x"] }), denied);
    await assert.rejects(s.resetAppearance(user, { part: "all" }), denied);
    await assert.rejects(s.setAppearanceImage(user, "og", { bytes: png(), contentType: "image/png" }), denied);
    await assert.rejects(s.removeAppearanceImage(user, "favicon"), denied);
  }
  assert.equal(stored(s), null);
  assert.deepEqual(audits(s), []);
});

test("OG image + favicon: upload checks, public URLs, replace/remove clean up files, SEO reset", async (t) => {
  const { s, admin } = fixture(t);
  const files = () => s.db.prepare("SELECT COUNT(*) AS n FROM files").get().n;
  const start = files();
  await assert.rejects(
    s.setAppearanceImage(admin, "og", { bytes: new TextEncoder().encode("<svg onload=alert(1)>"), contentType: "image/svg+xml" }),
    (e) => e.status === 415,
  );
  await assert.rejects(s.setAppearanceImage(admin, "banner", { bytes: png(), contentType: "image/png" }), (e) => e.status === 404);
  const og = (await s.setAppearanceImage(admin, "og", { bytes: png(), contentType: "image/png" })).appearance.seo.ogImageUrl;
  assert.match(og, /^\/api\/files\/[0-9a-f-]{36}$/);
  const og2 = (await s.setAppearanceImage(admin, "og", { bytes: png(), contentType: "image/png" })).appearance.seo.ogImageUrl;
  assert.notEqual(og, og2);
  assert.equal(files(), start + 1, "replaced OG file removed");
  const icon = (await s.setAppearanceImage(admin, "favicon", { bytes: png(), contentType: "image/png" })).appearance.seo.faviconUrl;
  assert.equal(files(), start + 2);
  const pub = s.overview().appearance.seo;
  assert.equal(pub.ogImageUrl, og2);
  assert.equal(pub.faviconUrl, icon);
  assert.equal((await s.removeAppearanceImage(admin, "favicon")).appearance.seo.faviconUrl, null);
  assert.equal(files(), start + 1);
  s.saveAppearance(admin, { seo: { title: { th: "ร้านดี" }, description: { th: "คำอธิบาย" } } });
  await s.resetAppearance(admin, { part: "seo" });
  assert.deepEqual(s.overview().appearance.seo, { ...DEFAULT_APPEARANCE.seo, ogImageUrl: null, faviconUrl: null });
  assert.equal(files(), start, "SEO reset removes the uploaded share image");
  assert.deepEqual(
    audits(s).map((a) => a.action),
    ["APPEARANCE_OG_SET", "APPEARANCE_OG_SET", "APPEARANCE_FAVICON_SET", "APPEARANCE_FAVICON_REMOVE", "APPEARANCE_SAVE", "APPEARANCE_RESET"],
  );
});

test("overview exposes only the public appearance fields", async (t) => {
  const { s, admin } = fixture(t);
  await s.setAppearanceImage(admin, "og", { bytes: png(), contentType: "image/png" });
  s.saveAppearance(admin, { colors: { primary: "#e11d48" } });
  const a = s.overview().appearance;
  assert.deepEqual(Object.keys(a).sort(), [...APPEARANCE_PARTS].sort());
  assert.deepEqual(Object.keys(a.seo).sort(), ["description", "faviconUrl", "ogImageUrl", "title"]);
  const json = JSON.stringify(a);
  for (const secret of ["ogImageKey", "faviconKey", "updatedAt", "updatedBy", admin.id, admin.email]) assert.ok(!json.includes(secret), secret);
  // Raw storage keeps the file key (needed to delete it) — never sent out.
  assert.ok(stored(s).ogImageKey);
  const all = JSON.stringify(s.overview());
  const key = stored(s).ogImageKey;
  assert.equal(all.split(key).length, all.split("/api/files/" + key).length, "the key only appears inside its /api/files URL");
});

test("the 'Theme By limitcode studio' credit cannot be removed or hidden by any setting", (t) => {
  const { s, admin } = fixture(t);
  const d = defaultAppearance();
  // Whatever extra keys a request carries, nothing about the credit is stored or published.
  s.saveAppearance(admin, {
    footer: { ...d.footer, credit: "", hideCredit: true, showCredit: false, creditColor: "#ffffff", css: ".footer-credit{display:none}" },
    colors: { primary: "#e11d48", secondary: "#0ea5e9", text: "#ffffff", muted: "#ffffff", background: "#ffffff", css: "x" },
    credit: { hidden: true },
    customCss: ".footer-credit{display:none}",
    hero: { ...d.hero, css: "x" },
  });
  const raw = JSON.stringify(stored(s));
  const pub = JSON.stringify(s.overview().appearance);
  for (const word of ['"credit"', "hideCredit", "showCredit", "creditColor", "limitcode", "customCss", '"css"', "display:none", '"hidden"', '"muted"', '"background"', '"text":"#'])
    for (const json of [raw, pub]) assert.ok(!json.includes(word), word);
  assert.deepEqual(Object.keys(s.overview().appearance.colors).sort(), ["defaultAccent", "primary", "secondary"]);
  // Colour settings only produce accent tokens — never the text / muted / background tokens the
  // credit is drawn with.
  assert.deepEqual(Object.keys(colorTokens("#e11d48").light).sort(), ["fill", "fill2", "ink", "text"]);
  // The storefront renders the credit unconditionally and pins its look.
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const credit = app.slice(app.indexOf('<p className="container footer-credit">'), app.indexOf("</footer>"));
  assert.match(credit, /Theme By\{" "\}\s*<a href="https:\/\/limitcode\.shop" target="_blank" rel="noopener">\s*limitcode studio\s*<\/a>/);
  assert.ok(!/appearance|\{.*&&/.test(credit), "no condition or appearance value inside the credit");
  const css = readFileSync(new URL("../src/footer-credit.css", import.meta.url), "utf8");
  assert.match(css, /display: block !important/);
  assert.match(css, /visibility: visible !important/);
  const theme = readFileSync(new URL("../src/Theme.tsx", import.meta.url), "utf8");
  assert.ok(!/footer-credit|--muted|--text\b|--bg\b/.test(theme.slice(theme.indexOf("export function shopColorCss"))), "colour CSS never touches credit tokens");
});

test("link previews use the SEO texts, share image and favicon; defaults unchanged", (t) => {
  const { s, admin } = fixture(t);
  const shop = { shopName: "ร้านค้า", description: "" };
  const plain = homeMeta("https://shop.test", shop, s.overview().appearance);
  assert.deepEqual(plain, { ...homeMeta("https://shop.test", shop), icon: null });
  assert.equal(plain.image, "https://shop.test/brand/og.png");
  assert.ok(!metaTags(plain).includes('rel="icon"'));
  s.db.prepare("INSERT INTO runtime_flags(key,value) VALUES(?,?)").run(
    APPEARANCE_KEY,
    JSON.stringify({
      seo: { title: { th: "ร้าน <ดี>", en: "Good" }, description: { th: "ของแท้ ส่งไว", en: "" } },
      ogImageKey: "11111111-2222-3333-4444-555555555555",
      faviconKey: "aaaaaaaa-2222-3333-4444-555555555555",
    }),
  );
  const a = s.overview().appearance;
  const home = homeMeta("https://shop.test", shop, a);
  assert.equal(home.title, "ร้าน <ดี> — สินค้าดิจิทัล");
  assert.equal(home.description, "ของแท้ ส่งไว");
  assert.equal(home.image, "https://shop.test/api/files/11111111-2222-3333-4444-555555555555");
  assert.equal(home.imageIsDefault, false);
  const tags = metaTags(home);
  assert.match(tags, /<title>ร้าน &lt;ดี&gt; — สินค้าดิจิทัล<\/title>/);
  assert.match(tags, /<link rel="icon" href="https:\/\/shop\.test\/api\/files\/aaaaaaaa-2222-3333-4444-555555555555" \/>/);
  const product = productMeta("https://shop.test", { id: "p1", name: "Netflix", description: "" }, shop, a);
  assert.equal(product.title, "Netflix — ร้าน <ดี>");
  assert.equal(product.image, "https://shop.test/api/files/11111111-2222-3333-4444-555555555555");
  assert.match(product.description, /ของแท้ ส่งไว/);
  void admin;
});

test("HTTP: routes, ADMIN only, JSON + image uploads, overview and live topic", async (t) => {
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
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  for (const token of [staffToken, buyerToken, undefined]) {
    const code = token ? 403 : 401;
    assert.equal((await call("GET", "/api/admin/appearance", { token })).status, code);
    assert.equal((await call("POST", "/api/admin/appearance", { token, json: { marquee: ["x"] } })).status, code);
    assert.equal((await call("POST", "/api/admin/appearance/reset", { token, json: { part: "all" } })).status, code);
    assert.equal((await call("POST", "/api/admin/appearance/og-image", { token, bytes: png(), contentType: "image/png" })).status, code);
    assert.equal((await call("DELETE", "/api/admin/appearance/favicon", { token })).status, code);
  }
  const before = s.liveVersions().catalog;
  const got = await call("GET", "/api/admin/appearance", { token: adminToken });
  assert.equal(got.status, 200);
  assert.deepEqual(got.data.defaults.marquee, DEFAULT_APPEARANCE.marquee);
  // Largest legal payload (every field at its limit, Thai + English) fits the request cap.
  const long = (n) => ({ th: "ก".repeat(n), en: "e".repeat(n) });
  const full = {
    hero: { headline: long(LIMITS.heroHeadline), subtext: long(LIMITS.heroSubtext), primary: { label: long(LIMITS.buttonLabel), link: "/products" }, secondary: { label: long(LIMITS.buttonLabel), link: "/reviews" } },
    marquee: Array.from({ length: LIMITS.marqueeMax }, () => long(LIMITS.marqueeItem)),
    trust: { show: true, heading: long(LIMITS.trustHeading), text: long(LIMITS.trustText), cards: Array.from({ length: LIMITS.cardsMax }, () => ({ icon: "Zap", title: long(LIMITS.cardTitle), text: long(LIMITS.cardText) })) },
    footer: { description: long(LIMITS.footerDescription), links: Array.from({ length: LIMITS.footerLinksMax }, () => ({ label: long(LIMITS.linkLabel), link: "https://example.com/" + "a".repeat(400) })) },
    seo: { title: long(LIMITS.seoTitle), description: long(LIMITS.seoDescription) },
  };
  const big = await call("POST", "/api/admin/appearance", { token: adminToken, json: full });
  assert.equal(big.status, 200, JSON.stringify(big.data));
  const bad = await call("POST", "/api/admin/appearance", { token: adminToken, json: { colors: { primary: "#fff" } } });
  assert.equal(bad.status, 400);
  const up = await call("POST", "/api/admin/appearance/favicon", { token: adminToken, bytes: png(), contentType: "image/png" });
  assert.equal(up.status, 200);
  const overview = await call("GET", "/api/overview");
  assert.equal(overview.data.appearance.seo.faviconUrl, up.data.appearance.seo.faviconUrl);
  assert.equal(overview.data.appearance.trust.show, true);
  assert.equal((await call("DELETE", "/api/admin/appearance/favicon", { token: adminToken })).status, 200);
  const reset = await call("POST", "/api/admin/appearance/reset", { token: adminToken, json: { part: "all" } });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.data.customized, []);
  assert.ok(s.liveVersions().catalog > before, "storefront tabs refetch the overview");
});

test("rows saved before the client round keep working: missing fields default, old defaults upgrade", (t) => {
  const { s, admin } = fixture(t);
  const legacySections = HOME_SECTIONS.map((id) => ({ id, visible: id !== "stats" }));
  // A row written by the previous version: old hero labels, no title / guest button, the
  // category block switched on (it was the default) and the stats hidden by the admin.
  s.db.prepare("INSERT INTO runtime_flags(key,value) VALUES(?,?)").run(
    APPEARANCE_KEY,
    JSON.stringify({
      hero: {
        headline: { th: "ช้อปเลย", en: "" },
        subtext: { th: "", en: "" },
        primary: { label: { th: "เลือกซื้อสินค้า", en: "Shop now" }, link: "/products" },
        secondary: { label: { th: "ดูรีวิวของจริง", en: "" }, link: "/reviews" },
      },
      sections: legacySections,
      updatedAt: "2026-11-01T00:00:00.000Z",
    }),
  );
  const a = s.overview().appearance;
  assert.deepEqual(a.hero.title, { th: "", en: "" }, "no title saved = automatic");
  assert.deepEqual(a.hero.guest, DEFAULT_APPEARANCE.hero.guest, "guest button gets its default, not hidden");
  assert.deepEqual(a.hero.primary, DEFAULT_APPEARANCE.hero.primary, "old default label upgraded");
  assert.equal(a.hero.secondary.label.th, "ดูรีวิวของจริง", "a label the admin typed stays");
  assert.equal(a.hero.headline.th, "ช้อปเลย");
  assert.equal(a.sections.find((x) => x.id === "categories").visible, false, "home categories hidden");
  assert.equal(a.sections.find((x) => x.id === "stats").visible, false, "admin choices kept");
  // The next save writes the upgraded row (rev) so the admin can switch categories back on.
  s.saveAppearance(admin, { sections: a.sections.map((x) => (x.id === "categories" ? { ...x, visible: true } : x)) });
  assert.equal(stored(s).rev, APPEARANCE_REV);
  assert.equal(stored(s).hero.primary.label.th, "สินค้าทั้งหมด");
  assert.equal(s.overview().appearance.sections.find((x) => x.id === "categories").visible, true, "switched back on sticks");
  // Pure helper: current rows pass through untouched; junk becomes {}.
  const current = { rev: APPEARANCE_REV, sections: [{ id: "categories", visible: true }] };
  assert.deepEqual(migrateStoredAppearance(current), current);
  assert.deepEqual(migrateStoredAppearance(null), {});
  // A section list that leaves categories out gets its default (hidden).
  assert.equal(
    resolveAppearance({ rev: APPEARANCE_REV, sections: [{ id: "products", visible: true }] }).sections.find((x) => x.id === "categories").visible,
    false,
  );
});
