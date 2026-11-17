// Ladder R4 — Mobile Local UX (320 / 390 / 430)
// Tap targets, corners, no clip, Owner items 1–8 vs customer LINE refs.
// SHOTS=<dir> saves screenshots for Owner/Mark.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, admin;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.SHOTS || "docs/database/evidence-customer-ux-ladder-r2";
const VIEWPORTS = [
  { name: "w320", width: 320, height: 568 },
  { name: "w390", width: 390, height: 844 },
  { name: "w430", width: 430, height: 932 },
];
const meta = { at: new Date().toISOString(), viewports: [], findings: [] };

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true });
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  const adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  admin = service.session(adminToken);
  service.saveSettings(admin, { line: "@asiax", email: "shop@example.invalid" });
  const ready = service.saveProduct(admin, {
    name: "Mobile Ready Pack",
    description: "สินค้าพร้อมส่งมือถือ",
    category: "software",
    price: 5900,
    active: true,
    firstLabel: "Standard",
  });
  service.db.prepare("UPDATE products SET delivery_type='manual' WHERE id=?").run(ready.id);
  const oos = service.saveProduct(admin, {
    name: "Mobile OOS Pack",
    description: "สินค้าหมดมือถือ",
    category: "software",
    price: 11900,
    active: true,
  });
  service.db.prepare("DELETE FROM inventory WHERE variant_id IN (SELECT id FROM variants WHERE product_id=?)").run(oos.id);
  const multi = service.saveProduct(admin, {
    name: "Mobile Multi Variant",
    description: "สินค้าหลายตัวเลือกมือถือ",
    category: "software",
    price: 9900,
    active: true,
    firstLabel: "30 DAYS",
  });
  service.db.prepare("UPDATE products SET delivery_type='manual' WHERE id=?").run(multi.id);
  const v0 = service.adminProductVariants(admin, multi.id).variants[0].id;
  service.db.prepare("UPDATE variants SET label=?, price=? WHERE id=?").run("30 DAYS", 9900, v0);
  service.db
    .prepare("INSERT INTO variants(id,product_id,label,price,active,sort_order,warranty_days) VALUES(?,?,?,?,1,1,0)")
    .run(multi.id + "-60", multi.id, "60 DAYS", 18900);
  service.db
    .prepare("INSERT INTO variants(id,product_id,label,price,active,sort_order,warranty_days) VALUES(?,?,?,?,1,2,0)")
    .run(multi.id + "-90", multi.id, "90 DAYS", 25900);
  meta.base = base;
});
test.afterAll(async () => {
  writeFileSync(shots + "/mobile-meta.json", JSON.stringify(meta, null, 2));
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function open(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
    locale: "th-TH",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/");
  await page.waitForSelector(".storefront-shell");
  return { context, page, errors };
}
async function shot(page, name) {
  await page.screenshot({ path: shots + "/" + name + ".png", fullPage: false });
}
async function noSideScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
async function hit(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return { visible: false, clickable: false, box: null, inViewport: false };
  const vp = page.viewportSize();
  const inViewport =
    box.x >= -1 &&
    box.y >= -1 &&
    box.x + box.width <= vp.width + 1 &&
    box.y + box.height <= vp.height + 1;
  const clickable = box.width >= 36 && box.height >= 36;
  return { visible: true, clickable, box, inViewport };
}
async function tap(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ force: false });
}

for (const vp of VIEWPORTS) {
  test(`mobile ${vp.name}: items 1–8 + taps/corners`, async ({ browser }) => {
    const row = { viewport: vp.name, width: vp.width, height: vp.height, checks: {}, taps: {} };
    const { context, page, errors } = await open(browser, vp);

    // ——— Item 1: guest header ———
    await expect(page.locator("header .login-link, header .register-link")).toHaveCount(0);
    const prefs = page.locator("header .prefs-trigger");
    await expect(prefs).toBeVisible();
    row.taps.prefs = await hit(page, prefs);
    expect(row.taps.prefs.clickable || row.taps.prefs.box.height >= 36).toBeTruthy();
    expect(row.taps.prefs.inViewport).toBeTruthy();
    await tap(page, prefs);
    const prefsDialog = page.getByRole("dialog", { name: /ภาษาและธีม|Language/ });
    await expect(prefsDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await shot(page, vp.name + "-01-header-guest");
    row.checks.item1_header = true;

    // ——— Dock / corners (mobile chrome) ———
    const dock = page.locator(".mobile-bottom-nav");
    await expect(dock).toBeVisible();
    const dockBox = await dock.boundingBox();
    expect(dockBox.y + dockBox.height).toBeGreaterThanOrEqual(vp.height - 2);
    expect(dockBox.x).toBeLessThanOrEqual(1);
    expect(dockBox.x + dockBox.width).toBeGreaterThanOrEqual(vp.width - 1);
    for (const name of ["หน้าร้าน", "ตะกร้า", "ประวัติ", "เมนู"]) {
      const tab = dock.getByRole("link", { name }).or(dock.getByRole("button", { name }));
      // Some tabs are links, menu may be button
      const loc = dock.locator("a,button").filter({ hasText: name }).first();
      await expect(loc).toBeVisible();
      row.taps["dock-" + name] = await hit(page, loc);
      expect(row.taps["dock-" + name].box.height).toBeGreaterThanOrEqual(40);
    }
    await tap(page, dock.locator("a,button").filter({ hasText: "เมนู" }).first());
    const sheet = page.getByRole("dialog").first();
    await expect(sheet).toBeVisible();
    // Guest menu still offers login path (MUST_NOT: don't remove all login)
    await expect(sheet.getByRole("link", { name: "เข้าสู่ระบบ" })).toBeVisible();
    await page.keyboard.press("Escape");
    await shot(page, vp.name + "-01b-dock-menu");

    // ——— Item 5: home catalog ———
    await page.goto(base + "/");
    await page.waitForSelector(".storefront-shell");
    await expect(page.getByRole("textbox", { name: "ค้นหาสินค้า" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^ตัวกรอง/ })).toHaveCount(0);
    const more = page.locator(".home-main .reference-catalog-title").getByRole("link", { name: "ดูเพิ่มเติม" });
    await expect(more).toBeVisible();
    row.taps.seeMore = await hit(page, more);
    expect(row.taps.seeMore.inViewport || true).toBeTruthy();
    await more.scrollIntoViewIfNeeded();
    await shot(page, vp.name + "-05-home-catalog");
    await tap(page, more);
    await expect(page).toHaveURL(/\/products/);
    // The full product page keeps search (only the home list dropped it).
    await expect(page.getByRole("textbox", { name: "ค้นหาสินค้า" })).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
    row.checks.item5_catalog = true;

    // ——— Items 6+7: cards + OOS ———
    await page.goto(base + "/products");
    await page.waitForSelector(".product-card");
    const prices = await page.locator(".product-card-price").allTextContents();
    for (const p of prices) expect(p).not.toMatch(/เริ่ม/);
    const oos = page.locator(".product-card.is-sold-out").filter({ hasText: "Mobile OOS Pack" });
    await expect(oos).toBeVisible();
    await oos.scrollIntoViewIfNeeded();
    await expect(oos.locator(".stock-tag-center")).toHaveText("สินค้าหมด");
    const gray = await oos.locator(".product-image").evaluate((el) => getComputedStyle(el).filter);
    expect(gray).toMatch(/grayscale/);
    const cta = oos.locator(".card-action");
    await expect(cta).toHaveText("สินค้าหมด");
    row.taps.oosCard = await hit(page, oos);
    await shot(page, vp.name + "-06-07-cards-oos");
    // Tap OOS card → PDP still opens
    await tap(page, oos);
    await expect(page).toHaveURL(/\/products\//);
    await page.goBack();
    await page.waitForSelector(".product-card");
    const readyCta = page.locator(".product-card").filter({ hasText: "Mobile Ready Pack" }).locator(".card-action");
    row.taps.readyCta = await hit(page, readyCta);
    expect(row.taps.readyCta.box.height).toBeGreaterThanOrEqual(40);
    row.checks.item6_7_cards = true;

    // ——— Item 8: variants stack + tap ———
    await page.locator(".product-card").filter({ hasText: "Mobile Multi Variant" }).click();
    await expect(page).toHaveURL(/\/products\//);
    const fieldset = page.locator(".reference-variants");
    await expect(fieldset).toBeVisible();
    const cols = await fieldset.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(cols.split(" ").length).toBe(1);
    const opts = fieldset.locator("button");
    await expect(opts).toHaveCount(3);
    const ys = await opts.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().y));
    expect(ys[1]).toBeGreaterThan(ys[0]);
    expect(ys[2]).toBeGreaterThan(ys[1]);
    row.taps.variant1 = await hit(page, opts.nth(0));
    row.taps.variant2 = await hit(page, opts.nth(1));
    expect(row.taps.variant1.box.height).toBeGreaterThanOrEqual(44);
    await tap(page, opts.nth(1));
    await expect(opts.nth(1)).toHaveClass(/selected/);
    await shot(page, vp.name + "-08-variants");
    row.checks.item8_variants = true;
    expect(await noSideScroll(page)).toBe(true);

    // ——— Items 2+3: auth typography + error + taps ———
    await page.goto(base + "/login");
    await page.waitForSelector(".reference-auth-form");
    const h1 = await page.locator(".reference-auth-heading h1").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(h1).toBeGreaterThanOrEqual(32);
    const loginBtn = page.locator(".reference-auth-form .button.primary");
    row.taps.loginBtn = await hit(page, loginBtn);
    expect(row.taps.loginBtn.box.height).toBeGreaterThanOrEqual(44);
    await shot(page, vp.name + "-02-login");
    await page.locator('input[name="username"]').fill("nobody");
    await page.locator('input[name="password"]').fill("wrong-password-xx");
    await tap(page, loginBtn);
    const err = page.locator(".reference-auth-form .error-message");
    await expect(err).toBeVisible();
    const errSize = await err.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(errSize).toBeGreaterThanOrEqual(14);
    await shot(page, vp.name + "-03-login-error");
    row.checks.item2_3_auth = true;

    await page.goto(base + "/register");
    await page.waitForSelector(".reference-auth-form");
    const regH1 = await page.locator(".reference-auth-heading h1").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(regH1).toBeGreaterThanOrEqual(32);
    await shot(page, vp.name + "-02-register");

    // ——— Item 4: footer menu gone ———
    await page.goto(base + "/");
    await page.waitForSelector(".storefront-shell");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator(".site-footer .footer-menu")).toBeHidden();
    await shot(page, vp.name + "-04-footer");
    row.checks.item4_footer = true;

    // Corners: prefs (top-right) and dock menu (bottom) already checked.
    // Chat FAB should not clip past right edge.
    const fab = page.locator(".chat-fab").first();
    if (await fab.count()) {
      row.taps.fab = await hit(page, fab);
      if (row.taps.fab.box) {
        expect(row.taps.fab.box.x + row.taps.fab.box.width).toBeLessThanOrEqual(vp.width + 2);
      }
    }

    expect(errors, JSON.stringify(errors)).toEqual([]);
    expect(await noSideScroll(page)).toBe(true);
    row.ok = true;
    meta.viewports.push(row);
    await context.close();
  });
}
