// ตั้งค่า › หน้าตาร้าน end to end: the admin edits hero text, marquee, section visibility and
// order, brand colour, trust cards, footer links and the share image → the storefront shows
// them in Thai and English → reset brings back the original page. The limitcode credit stays
// visible throughout, and nothing scrolls sideways at 390 px in light or dark.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken;
const adminPassword = randomBytes(24).toString("hex");
const ogFile = fileURLToPath(new URL("../public/brand/og.png", import.meta.url));

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function storefront(browser, { lang = "th", mode = "light", width = 1280 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript(
    ([l, m]) => {
      localStorage.setItem("asiax-lang", l);
      localStorage.setItem("asiax-mode", m);
    },
    [lang, mode],
  );
  return context;
}
/** The credit is on screen, untouched, and readable against the footer. */
async function expectCredit(page) {
  const credit = page.locator(".footer-credit");
  await expect(credit).toBeVisible();
  await expect(credit).toHaveText("Theme By limitcode studio");
  await expect(credit.locator('a[href="https://limitcode.shop"]')).toBeVisible();
  const ratio = await credit.locator("a").evaluate((a) => {
    const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    let el = a,
      bg = "rgba(0, 0, 0, 0)";
    while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
      bg = getComputedStyle(el).backgroundColor;
      el = el.parentElement;
    }
    const lum = ([r, g, b]) =>
      [r, g, b]
        .map((v) => v / 255)
        .map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [x, y] = [lum(rgb(getComputedStyle(a).color)), lum(rgb(bg))].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("admin edits the storefront look, customers see it in TH and EN, reset restores it", async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.context().addCookies([{ name: "astra_session", value: adminToken, url: base, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(base + "/admin/settings/appearance");
  await expect(page.getByRole("heading", { name: "หน้าตาร้าน", level: 1 })).toBeVisible();
  const frame = page.frameLocator('iframe[title="ตัวอย่างหน้าร้านจริง"]');

  // Hero: headline + primary button (TH/EN). The live preview follows before saving.
  await page.getByLabel("ข้อความหลัก (ไทย)").fill("ช้อปของแท้ ส่งไวทันใจ");
  await page.getByLabel("ข้อความหลัก (อังกฤษ)").fill("Genuine goods, delivered fast");
  await page.getByRole("group", { name: "ปุ่มหลัก" }).getByLabel("ข้อความบนปุ่ม (ไทย)").fill("ซื้อเลย");
  await page.getByRole("group", { name: "ปุ่มหลัก" }).getByLabel("ข้อความบนปุ่ม (อังกฤษ)").fill("Buy now");
  await expect(frame.locator(".hero-tagline")).toHaveText("ช้อปของแท้ ส่งไวทันใจ");
  await expect(page.locator(".appearance-save-bar")).toContainText("ยังไม่ได้บันทึก");
  // A bad link is caught before saving.
  await page.getByRole("group", { name: "ปุ่มหลัก" }).getByLabel("ลิงก์").fill("javascript:alert(1)");
  await expect(page.locator(".appearance-problem")).toContainText("https://");
  await page.getByRole("group", { name: "ปุ่มหลัก" }).getByLabel("ลิงก์").fill("/faq");

  // Marquee: edit the first item, add one.
  await page.getByRole("tab", { name: "แถบข้อความเลื่อน" }).click();
  await page.getByLabel("ข้อความที่ 1 (ไทย)").fill("โปรใหม่ทุกวัน");
  await page.getByLabel("ข้อความที่ 1 (อังกฤษ)").fill("New deals daily");
  await page.getByRole("button", { name: "เพิ่มข้อความ" }).click();
  await page.getByLabel("ข้อความที่ 6 (ไทย)").fill("ของแท้ 100%");

  // Sections: hide the stats, move the product list to the top of the list order.
  await page.getByRole("tab", { name: "ส่วนต่างๆ หน้าแรก" }).click();
  await page.getByRole("switch", { name: "แสดงสถิติร้าน" }).click();
  await expect(page.getByRole("switch", { name: "แสดงรายการสินค้า" })).toBeDisabled();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "เลื่อนรายการสินค้าขึ้น" }).click();

  // Colour: refuse an unreadable white, accept a red.
  await page.getByRole("tab", { name: "สีร้าน" }).click();
  await page.getByRole("radio", { name: "เลือกสีเอง" }).first().check();
  await page.getByLabel("สีหลัก (รหัสสี)").fill("#ffffff");
  await expect(page.locator(".appearance-problem").first()).toContainText("กลืน");
  await page.getByLabel("สีหลัก (รหัสสี)").fill("#e11d48");
  await expect(page.locator(".color-sample.light .sample-button").first()).toBeVisible();

  // Trust block: switch on, edit a card.
  await page.getByRole("tab", { name: "หน้าเครดิตร้าน" }).click();
  await page.getByRole("switch", { name: "แสดงบนหน้าเครดิตร้าน" }).click();
  await page.getByLabel("หัวข้อการ์ดที่ 1 (ไทย)").fill("รับประกันทุกชิ้น");
  await page.getByLabel("หัวข้อการ์ดที่ 1 (อังกฤษ)").fill("Every item guaranteed");
  await expect(frame.locator(".trust-block")).toContainText("รับประกันทุกชิ้น");

  // Footer: rename the first link, add an https link.
  await page.getByRole("tab", { name: "ส่วนท้าย" }).click();
  await expect(page.locator(".appearance-locked")).toContainText("limitcode studio");
  await page.getByLabel("ชื่อเมนูที่ 1 (ไทย)").fill("ช้อปทั้งหมด");
  await page.getByLabel("ชื่อเมนูที่ 1 (อังกฤษ)").fill("Shop all");
  await page.getByRole("button", { name: "เพิ่มเมนู" }).click();
  await page.getByLabel("ชื่อเมนูที่ 6 (ไทย)").fill("LINE ร้าน");
  await page.locator(".appearance-row").nth(5).getByLabel("ลิงก์").fill("https://line.me/R/ti/p/@shop");

  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.locator(".appearance-save-bar")).toContainText("ตรงกับหน้าร้าน");

  // SEO: upload the share image (used at once, no save needed).
  await page.getByRole("tab", { name: "SEO และการแชร์" }).click();
  await page.getByLabel("เลือกไฟล์รูปตอนแชร์ลิงก์").setInputFiles(ogFile);
  await expect(page.getByRole("button", { name: "กลับไปใช้รูปเดิม" })).toBeVisible();
  const audit = service.db.prepare("SELECT action FROM audit WHERE entity_id='appearance' ORDER BY id").all().map((r) => r.action);
  expect(audit).toEqual(["APPEARANCE_SAVE", "APPEARANCE_OG_SET"]);

  // Storefront, Thai.
  let context = await storefront(browser);
  let shop = await context.newPage();
  await shop.goto(base + "/");
  await expect(shop.locator(".hero-tagline")).toHaveText("ช้อปของแท้ ส่งไวทันใจ");
  await expect(shop.locator(".hero-cta")).toHaveText("ซื้อเลย");
  await expect(shop.locator(".hero-cta")).toHaveAttribute("href", "/faq");
  await expect(shop.locator(".marquee-track span").first()).toContainText("โปรใหม่ทุกวัน");
  await expect(shop.locator(".marquee-track")).toContainText("ของแท้ 100%");
  await expect(shop.locator(".stats-panel")).toHaveCount(0);
  // Product list now comes before the activity panel.
  const order = await shop.evaluate(() => {
    const kids = [...document.querySelector(".home-main").children].map((el) => el.className);
    return [kids.findIndex((c) => c.includes("reference-catalog")), kids.findIndex((c) => c.includes("activity-panel"))];
  });
  expect(order[0]).toBeLessThan(order[1]);
  const accent = await shop.locator(".hero-cta").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(accent).toBe("rgb(225, 29, 72)");
  await expect(shop.locator(".footer-menu a").first()).toHaveText("ช้อปทั้งหมด");
  await expect(shop.locator('.footer-menu a[href="https://line.me/R/ti/p/@shop"]')).toHaveAttribute("target", "_blank");
  await expect(shop.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/api\/files\/[0-9a-f-]{36}$/);
  await expectCredit(shop);
  await shop.goto(base + "/credits");
  await expect(shop.getByTestId("trust-block")).toContainText("รับประกันทุกชิ้น");
  await expectCredit(shop);
  await context.close();

  // Storefront, English (filled-in English shown; empty English falls back to Thai).
  context = await storefront(browser, { lang: "en" });
  shop = await context.newPage();
  await shop.goto(base + "/");
  await expect(shop.locator(".hero-tagline")).toHaveText("Genuine goods, delivered fast");
  await expect(shop.locator(".hero-cta")).toHaveText("Buy now");
  await expect(shop.locator(".marquee-track")).toContainText("New deals daily");
  await expect(shop.locator(".marquee-track")).toContainText("ของแท้ 100%");
  await expect(shop.locator(".footer-menu a").first()).toHaveText("Shop all");
  await shop.goto(base + "/credits");
  await expect(shop.getByTestId("trust-block")).toContainText("Every item guaranteed");
  await expectCredit(shop);
  await context.close();

  // 390 px, light and dark: nothing scrolls sideways, credit readable.
  for (const mode of ["light", "dark"]) {
    context = await storefront(browser, { mode, width: 390 });
    shop = await context.newPage();
    for (const path of ["/", "/credits"]) {
      await shop.goto(base + path);
      await expect(shop.locator(".site-footer")).toBeVisible();
      expect(await noOverflow(shop), path + " " + mode).toBe(true);
      await expectCredit(shop);
    }
    await context.close();
  }

  // Reset everything → the original storefront.
  await page.getByRole("button", { name: "คืนค่าเดิมทั้งหมด" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "คืนค่าเดิม" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  context = await storefront(browser);
  shop = await context.newPage();
  await shop.goto(base + "/");
  await expect(shop.locator(".hero-tagline")).toHaveText("ร้านสินค้าดิจิทัล ส่งไว ปลอดภัย ใช้งานได้ทันที");
  await expect(shop.locator(".hero-cta")).toHaveText("สินค้าทั้งหมด");
  // Visitor (not signed in): the second button is "เข้าสู่ระบบ".
  await expect(shop.locator(".hero-ghost")).toHaveText("เข้าสู่ระบบ");
  await expect(shop.locator(".marquee-track span").first()).toContainText("สินค้าพร้อมส่ง ได้รับทันทีหลังชำระเงิน");
  await expect(shop.locator(".stats-panel")).toHaveCount(1);
  expect(await shop.locator(".hero-cta").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(21, 52, 255)");
  await expect(shop.locator(".footer-menu a")).toHaveText(["สินค้าทั้งหมด", "เครดิตร้าน", "ประวัติการซื้อ", "คำถามที่พบบ่อย", "ติดต่อเรา"]);
  await expect(shop.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/brand\/og\.png$/);
  await expect(shop.locator("#shop-colors")).toHaveCount(0);
  await expectCredit(shop);
  await shop.goto(base + "/credits");
  await expect(shop.getByTestId("trust-block")).toHaveCount(0);
  await context.close();
});

test("admin page at 390 px: no sideways scroll, big tap targets", async ({ page }) => {
  await page.context().addCookies([{ name: "astra_session", value: adminToken, url: base, httpOnly: true, sameSite: "Lax" }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/admin/settings/appearance");
  for (const name of ["ส่วนหัว", "แถบข้อความเลื่อน", "ส่วนต่างๆ หน้าแรก", "สีร้าน", "หน้าเครดิตร้าน", "ส่วนท้าย", "SEO และการแชร์"]) {
    const tab = page.getByRole("tab", { name });
    await tab.click();
    expect((await tab.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await noOverflow(page), name).toBe(true);
  }
  const small = await page.locator(".appearance-admin button:visible").evaluateAll((buttons) =>
    buttons
      .filter((b) => !b.classList.contains("appearance-switch"))
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.height < 44)
      .map((r) => Math.round(r.height)),
  );
  expect(small).toEqual([]);
});
