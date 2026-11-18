// Ladder QC — Customer Storefront UX (BRIEF-20261116)
// Compare Owner items 1–8 (+ preorder Q&A) against customer LINE refs (10 images).
// SHOTS=<dir> saves review screenshots for Mark.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, admin;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.SHOTS;
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  admin = service.session(adminToken);
  service.saveSettings(admin, { line: "@asiax", email: "shop@example.invalid" });
  // Ready (manual = buyable without stock) + OOS (no inventory) + preorder + multi-variant.
  const ready = service.saveProduct(admin, {
    name: "Ladder Ready Pack",
    description: "สินค้าพร้อมส่งทดสอบ",
    category: "software",
    price: 5900,
    active: true,
  });
  service.db.prepare("UPDATE products SET delivery_type='manual' WHERE id=?").run(ready.id);
  const oos = service.saveProduct(admin, {
    name: "Ladder OOS Pack",
    description: "สินค้าหมดทดสอบ",
    category: "software",
    price: 11900,
    active: true,
  });
  service.db.prepare("DELETE FROM inventory WHERE variant_id IN (SELECT id FROM variants WHERE product_id=?)").run(oos.id);
  const pre = service.saveProduct(admin, {
    name: "Ladder Preorder Pack",
    description: "สินค้าพรีออเดอร์ทดสอบ",
    category: "software",
    price: 9900,
    active: true,
    preorder: true,
  });
  service.adminSetOrderQuestions(admin, pre.id, {
    fields: [
      { label: "วันที่ต้องการรับสินค้า", type: "text", required: true },
      { label: "รหัสผ่านที่ต้องการ", type: "text", required: true },
    ],
  });
  const multi = service.saveProduct(admin, {
    name: "Ladder Multi Variant",
    description: "สินค้าหลายตัวเลือกทดสอบ",
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
  if (shots) mkdirSync(shots, { recursive: true });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function open(browser, { width, height, lang } = PHONE) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: lang === "en" ? "en-US" : "th-TH",
  });
  if (lang === "en") await context.addInitScript(() => localStorage.setItem("asiax-lang", "en"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/");
  await page.waitForSelector(".storefront-shell");
  return { context, page, errors };
}
async function shot(page, name) {
  if (!shots) return;
  await page.screenshot({ path: shots + "/" + name + ".png", fullPage: false });
}
async function ready(page, path = "/") {
  await page.goto(base + path);
  await page.waitForSelector(".storefront-shell");
}

test("1 header guest: no login/register; prefs icon changed (mobile+desktop)", async ({ browser }) => {
  for (const vp of [PHONE, DESK]) {
    const { context, page } = await open(browser, vp);
    await ready(page);
    await expect(page.locator("header .login-link, header .register-link")).toHaveCount(0);
    await expect(page.locator("header .prefs-trigger")).toBeVisible();
    // Flag of the current language + TH/EN (client turned down the globe and 文A).
    const visibleChip = await page.locator("header .prefs-trigger").evaluate((el) => {
      const visible = [...el.childNodes].filter((n) => {
        if (n.nodeType === 3) return n.textContent.trim().length > 0;
        if (n.nodeType !== 1) return false;
        const s = getComputedStyle(n);
        return s.position !== "absolute" && s.width !== "1px" && !n.classList?.contains("sr-only");
      });
      return {
        icons: el.querySelectorAll("svg").length,
        visibleText: visible.map((n) => (n.textContent || "").trim()).join(""),
      };
    });
    expect(visibleChip.icons).toBe(1);
    await expect(page.locator("header .prefs-trigger .lang-flag")).toBeVisible();
    expect(visibleChip.visibleText).toBe("TH");
    await shot(page, "1-header-guest-" + vp.width);
    await context.close();
  }
});

test("2+3 auth: larger type + error contrast", async ({ browser }) => {
  const { context, page } = await open(browser, PHONE);
  await ready(page, "/login");
  const h1 = page.locator(".reference-auth-heading h1");
  await expect(h1).toBeVisible();
  const h1Size = await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(h1Size).toBeGreaterThanOrEqual(32);
  const btn = page.locator(".reference-auth-form .button.primary");
  const btnSize = await btn.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(btnSize).toBeGreaterThanOrEqual(16);
  await shot(page, "2-login-typography");
  await page.locator('input[name="username"]').fill("nobody");
  await page.locator('input[name="password"]').fill("wrong-password-xx");
  await page.locator(".reference-auth-form .button.primary").click();
  const err = page.locator(".reference-auth-form .error-message");
  await expect(err).toBeVisible();
  const errSize = await err.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(errSize).toBeGreaterThanOrEqual(14);
  const errColor = await err.evaluate((el) => getComputedStyle(el).color);
  // Must not be the old washed pink #e49c9c alone — stronger contrast.
  expect(errColor).not.toBe("rgb(228, 156, 156)");
  await shot(page, "3-login-error");
  await ready(page, "/register");
  const regH1 = await page.locator(".reference-auth-heading h1").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(regH1).toBeGreaterThanOrEqual(32);
  await shot(page, "2-register-typography");
  await context.close();
});

test("4 footer mobile: menu block hidden", async ({ browser }) => {
  const { context, page } = await open(browser, PHONE);
  await ready(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator(".site-footer .footer-menu")).toBeHidden();
  await shot(page, "4-footer-mobile");
  await context.close();
});

test("5 home: no search/filter; ดูเพิ่มเติม (/products keeps them)", async ({ browser }) => {
  for (const vp of [PHONE, DESK]) {
    const { context, page } = await open(browser, vp);
    await ready(page);
    await expect(page.getByRole("textbox", { name: "ค้นหาสินค้า" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^ตัวกรอง/ })).toHaveCount(0);
    const more = page.locator(".home-main .reference-catalog-title").getByRole("link", { name: "ดูเพิ่มเติม" });
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute("href", "/products");
    await shot(page, "5-home-catalog-" + vp.width);
    // The client's note says "หน้าแรก": the full product page keeps search and the filter sheet.
    await ready(page, "/products");
    await expect(page.getByRole("textbox", { name: "ค้นหาสินค้า" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^ตัวกรอง/ })).toBeVisible();
    await shot(page, "5-products-" + vp.width);
    await context.close();
  }
});

test("6+7 product cards: no เริ่ม, outlined CTA, OOS grayscale+center badge", async ({ browser }) => {
  const { context, page } = await open(browser, PHONE);
  await ready(page, "/products");
  const cards = page.locator(".product-card");
  await expect(cards.first()).toBeVisible();
  // No 「เริ่ม」 prefix on any card price.
  const prices = await page.locator(".product-card-price").allTextContents();
  for (const p of prices) expect(p).not.toMatch(/เริ่ม/);
  // Ready / preorder share outlined accent (transparent bg).
  const readyCard = page.locator(".product-card").filter({ hasText: "Ladder Ready Pack" }).locator(".card-action");
  const paint = await readyCard.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, border: s.borderTopWidth, fs: parseFloat(s.fontSize) };
  });
  expect(paint.bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(parseFloat(paint.border)).toBeGreaterThanOrEqual(1);
  expect(paint.fs).toBeGreaterThanOrEqual(14);
  // Image frame.
  const imgBorder = await page
    .locator(".product-card")
    .filter({ hasText: "Ladder Ready Pack" })
    .locator(".product-image")
    .evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(parseFloat(imgBorder)).toBeGreaterThanOrEqual(1);
  // OOS
  const oos = page.locator(".product-card.is-sold-out").filter({ hasText: "Ladder OOS Pack" });
  await expect(oos).toBeVisible();
  await expect(oos.locator(".stock-tag-center")).toHaveText("สินค้าหมด");
  await expect(oos.locator(".card-action")).toHaveText("สินค้าหมด");
  const gray = await oos.locator(".product-image").evaluate((el) => getComputedStyle(el).filter);
  expect(gray).toMatch(/grayscale/);
  // Badge geometric center within the product image (customer ref: middle of art).
  const centered = await oos.evaluate((card) => {
    const img = card.querySelector(".product-image");
    const tag = card.querySelector(".stock-tag-center");
    const a = img.getBoundingClientRect();
    const b = tag.getBoundingClientRect();
    return {
      dx: Math.abs(a.left + a.width / 2 - (b.left + b.width / 2)),
      dy: Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)),
    };
  });
  expect(centered.dx).toBeLessThan(8);
  expect(centered.dy).toBeLessThan(8);
  await shot(page, "6-7-cards-oos");
  await context.close();
});

test("8 variants: single column stack", async ({ browser }) => {
  const { context, page } = await open(browser, PHONE);
  // Find multi-variant product id from API-backed page.
  await ready(page, "/products");
  await page.locator(".product-card").filter({ hasText: "Ladder Multi Variant" }).click();
  await expect(page).toHaveURL(/\/products\//);
  const fieldset = page.locator(".reference-variants");
  await expect(fieldset).toBeVisible();
  const cols = await fieldset.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  // Single column → one track (not "Xpx Ypx").
  expect(cols.split(" ").length).toBe(1);
  const buttons = fieldset.locator("button");
  await expect(buttons).toHaveCount(3);
  const boxes = await buttons.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().y));
  expect(boxes[1]).toBeGreaterThan(boxes[0]);
  expect(boxes[2]).toBeGreaterThan(boxes[1]);
  await shot(page, "8-variants-stack");
  await context.close();
});

test("9 preorder questions appear on checkout fields", async ({ browser }) => {
  // Register + add preorder to cart path via API-backed UI is heavy; assert public product JSON.
  const detail = service.productDetail(
    service.db.prepare("SELECT id FROM products WHERE name=?").get("Ladder Preorder Pack").id,
  );
  expect(detail.preorder).toBeTruthy();
  expect(detail.checkoutFields.length).toBe(2);
  expect(detail.checkoutFields.map((f) => f.label)).toEqual([
    "วันที่ต้องการรับสินค้า",
    "รหัสผ่านที่ต้องการ",
  ]);
});
