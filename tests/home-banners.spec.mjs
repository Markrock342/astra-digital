// Home promo banners end to end: with no banners the home page is unchanged; the admin adds
// two banners through ตั้งค่า › แบนเนอร์หน้าแรก (image + crop preview, alt, link, mobile image),
// reorders them; the storefront carousel shows them, auto-advances, pauses on hover, has
// prev/next/dots/keyboard, swipes on touch, links work, and fits 390px in light + dark.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, product;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.BANNER_SHOTS; // optional folder for review screenshots

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  product = service.saveProduct(service.session(adminToken), {
    name: "E2E Banner Product",
    description: "สินค้าสำหรับทดสอบลิงก์แบนเนอร์",
    category: "streaming",
    price: 9900,
    active: true,
  });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(page, token) {
  await page.context().clearCookies();
  if (token)
    await page.context().addCookies([
      { name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" },
    ]);
}
async function ready(page, path) {
  await page.goto(base + path);
  await expect(page.getByRole("heading", { name: "เชื่อมต่อร้านค้าไม่ได้" })).toHaveCount(0);
  await page.locator(".loading-row").first().waitFor({ state: "hidden" });
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shot = (page, name, fullPage = true) =>
  shots ? page.screenshot({ path: `${shots}/${name}.png`, fullPage, animations: "disabled" }) : null;

/** Test artwork drawn in the browser: a plain gradient with a label (never brand art). */
async function testImage(page, width, height, label, hue) {
  const dataUrl = await page.evaluate(
    ([w, h, text, hueValue]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, `hsl(${hueValue} 85% 45%)`);
      g.addColorStop(1, `hsl(${hueValue + 40} 85% 30%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${Math.round(h / 7)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, w / 2, h / 2);
      ctx.font = `500 ${Math.round(h / 16)}px sans-serif`;
      ctx.fillText(`${w}×${h}`, w / 2, h / 2 + h / 6);
      return canvas.toDataURL("image/png");
    },
    [width, height, label, hue],
  );
  return { name: label.replace(/\W+/g, "-") + ".png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") };
}
const slideOrder = (page) =>
  page.locator(".banner-admin-row").evaluateAll((rows) => rows.map((r) => r.querySelector("strong").textContent));
const activeDot = (page) =>
  page.locator(".home-banners-dot").evaluateAll((dots) => dots.findIndex((d) => d.classList.contains("active")));

test("no banners: the home page is exactly as before", async ({ page }) => {
  await as(page, null);
  await ready(page, "/");
  await expect(page.locator(".home-banners")).toHaveCount(0);
  const layout = await page.evaluate(() => {
    const main = document.querySelector(".home-main");
    const hero = document.querySelector(".home-hero");
    return { first: main.firstElementChild === hero, padding: getComputedStyle(hero).paddingTop };
  });
  expect(layout).toEqual({ first: true, padding: "72px" });
  const overview = await page.evaluate(() => fetch("/api/overview").then((r) => r.json()));
  expect(overview.banners).toEqual([]);
  await shot(page, "home-no-banners", false);
});

test("admin: add two banners with crop preview, mobile image, links; reorder", async ({ page }) => {
  await as(page, adminToken);
  await ready(page, "/admin/settings/banners");
  await expect(page.getByRole("heading", { name: "แบนเนอร์หน้าแรก", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "แบนเนอร์หน้าแรก" })).toHaveClass(/active/);
  await expect(page.locator(".banner-admin-empty")).toBeVisible();

  // Banner 1: product link, main image only.
  await page.getByRole("button", { name: "เพิ่มแบนเนอร์" }).click();
  let dialog = page.getByRole("dialog", { name: "เพิ่มแบนเนอร์" });
  await expect(dialog).toBeVisible();
  // Required checks happen before anything is sent.
  await dialog.getByRole("button", { name: "เพิ่มแบนเนอร์" }).click();
  await expect(dialog.locator(".error-message, [role=alert]").first()).toBeVisible();
  await dialog.getByLabel("รูปแบนเนอร์").setInputFiles(await testImage(page, 1600, 600, "PROMO ONE", 220));
  await expect(dialog.locator(".banner-image-field.main .banner-crop img")).toBeVisible();
  await expect(dialog.locator(".banner-crop-warning")).toHaveCount(0);
  await dialog.getByLabel("ข้อความอธิบายรูป (alt)").fill("โปรหนึ่ง ลด 20%");
  await dialog.getByLabel("ลิงก์เมื่อกดแบนเนอร์").fill("javascript:alert(1)");
  await expect(dialog.locator(".banner-link-problem")).toBeVisible();
  await dialog.getByLabel("ลิงก์เมื่อกดแบนเนอร์").fill("/products/" + product.id);
  await expect(dialog.locator(".banner-link-problem")).toHaveCount(0);
  await shot(page, "admin-banner-dialog", false);
  await dialog.getByRole("button", { name: "เพิ่มแบนเนอร์" }).click();
  await expect(page.locator(".toast")).toContainText("เพิ่มแบนเนอร์แล้ว");
  await expect(dialog).toHaveCount(0);

  // Banner 2: category link, an off-ratio main image (crop warning) + a mobile image.
  await page.getByRole("button", { name: "เพิ่มแบนเนอร์" }).click();
  dialog = page.getByRole("dialog", { name: "เพิ่มแบนเนอร์" });
  await dialog.getByLabel("รูปแบนเนอร์").setInputFiles(await testImage(page, 1200, 600, "PROMO TWO", 170));
  await expect(dialog.locator(".banner-crop-warning")).toContainText("1200×600");
  await dialog.getByLabel("รูปสำหรับมือถือ").setInputFiles(await testImage(page, 1200, 800, "PROMO TWO M", 170));
  await expect(dialog.locator(".banner-image-field.mobile .banner-crop img")).toBeVisible();
  await dialog.getByLabel("ข้อความอธิบายรูป (alt)").fill("โปรสอง หมวดสตรีมมิ่ง");
  await dialog.getByLabel("ลิงก์เมื่อกดแบนเนอร์").fill("/products?category=streaming");
  await dialog.getByRole("button", { name: "เพิ่มแบนเนอร์" }).click();
  await expect(page.locator(".toast")).toContainText("เพิ่มแบนเนอร์แล้ว");

  await expect(page.locator(".banner-admin-row")).toHaveCount(2);
  expect(await slideOrder(page)).toEqual(["โปรหนึ่ง ลด 20%", "โปรสอง หมวดสตรีมมิ่ง"]);
  await expect(page.locator(".banner-admin-row").first().locator(".banner-admin-status")).toHaveText("แสดงอยู่");
  await expect(page.locator(".banner-admin-row").nth(1)).toContainText("มีรูปมือถือ");
  // Stored images were re-encoded to webp in the browser and are public files.
  const stored = service.adminBanners(service.session(adminToken)).banners;
  expect(stored.every((b) => b.imageUrl?.startsWith("/api/files/"))).toBe(true);
  expect(stored[1].mobileImageUrl).toMatch(/^\/api\/files\//);
  const mime = await page.evaluate((url) => fetch(url).then((r) => r.headers.get("Content-Type")), stored[0].imageUrl);
  expect(mime).toBe("image/webp");

  // Reorder: banner 2 up, then back down.
  await page.getByRole("button", { name: "เลื่อนแบนเนอร์ โปรสอง หมวดสตรีมมิ่ง ขึ้น" }).click();
  await expect.poll(() => slideOrder(page)).toEqual(["โปรสอง หมวดสตรีมมิ่ง", "โปรหนึ่ง ลด 20%"]);
  expect(service.overview().banners.map((b) => b.alt)).toEqual(["โปรสอง หมวดสตรีมมิ่ง", "โปรหนึ่ง ลด 20%"]);
  await page.getByRole("button", { name: "เลื่อนแบนเนอร์ โปรสอง หมวดสตรีมมิ่ง ลง" }).click();
  await expect.poll(() => slideOrder(page)).toEqual(["โปรหนึ่ง ลด 20%", "โปรสอง หมวดสตรีมมิ่ง"]);
  await shot(page, "admin-banners");

  // Audited.
  await ready(page, "/admin/settings/audit");
  await expect(page.getByText("เพิ่มแบนเนอร์หน้าแรก").first()).toBeVisible();

  // 390px admin: no sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "/admin/settings/banners");
  await expect(page.locator(".banner-admin-row")).toHaveCount(2);
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "admin-banners-390");
});

test("storefront: carousel shows, auto-advances, pauses on hover, controls + keyboard", async ({ page }) => {
  test.setTimeout(60000); // real 5 s timer + a 6 s hover pause
  await as(page, null);
  await ready(page, "/");
  const carousel = page.getByRole("region", { name: "โปรโมชั่น" });
  await expect(carousel).toBeVisible();
  await expect(carousel).toHaveAttribute("aria-roledescription", "carousel");
  const slides = carousel.locator(".home-banner-slide");
  await expect(slides).toHaveCount(2);
  await expect(slides.first().getByRole("img", { name: "โปรหนึ่ง ลด 20%" })).toBeVisible();
  await expect(slides.first()).toHaveAttribute("aria-label", "1 จาก 2");
  // Above the hero, hero untouched otherwise.
  expect(await page.evaluate(() => document.querySelector(".home-main").firstElementChild.classList.contains("home-banners"))).toBe(true);
  await shot(page, "home-banners-light", false);

  // Auto-advance after 5s (mouse kept away from the carousel).
  await page.mouse.move(5, 900);
  expect(await activeDot(page)).toBe(0);
  await expect.poll(() => activeDot(page), { timeout: 8000 }).toBe(1);
  await expect(slides.nth(1)).toHaveAttribute("aria-hidden", "false");

  // Hover pauses.
  await carousel.hover();
  await page.waitForTimeout(6000);
  expect(await activeDot(page)).toBe(1);

  // Buttons, dots and keyboard.
  await carousel.getByRole("button", { name: "แบนเนอร์ถัดไป" }).click();
  await expect.poll(() => activeDot(page)).toBe(0); // wraps around
  await carousel.getByRole("button", { name: "แบนเนอร์ก่อนหน้า" }).click();
  await expect.poll(() => activeDot(page)).toBe(1);
  await carousel.getByRole("button", { name: "ไปที่แบนเนอร์ 1" }).click();
  await expect.poll(() => activeDot(page)).toBe(0);
  await expect(carousel.getByRole("button", { name: "ไปที่แบนเนอร์ 1" })).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => activeDot(page)).toBe(1);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => activeDot(page)).toBe(0);
  // Pause button stops rotation for good.
  await carousel.getByRole("button", { name: "หยุดเลื่อนแบนเนอร์อัตโนมัติ" }).click();
  await expect(carousel.getByRole("button", { name: "เล่นแบนเนอร์อัตโนมัติ" })).toHaveAttribute("aria-pressed", "true");

  // The visible banner link opens the product page (in-app navigation).
  await slides.first().getByRole("link").click();
  await expect(page).toHaveURL(base + "/products/" + product.id);
  await ready(page, "/");
  await carousel.getByRole("button", { name: "ไปที่แบนเนอร์ 2" }).click();
  await expect.poll(() => activeDot(page)).toBe(1);
  await slides.nth(1).getByRole("link").click();
  await expect(page).toHaveURL(base + "/products?category=streaming");
});

test("reduced motion: no auto-rotation", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(base + "/");
  const carousel = page.getByRole("region", { name: "โปรโมชั่น" });
  await expect(carousel).toBeVisible();
  await expect(carousel.getByRole("button", { name: "เล่นแบนเนอร์อัตโนมัติ" })).toBeVisible();
  await page.mouse.move(5, 880);
  await page.waitForTimeout(5800);
  expect(await activeDot(page)).toBe(0);
  await context.close();
});

test("390px light + dark: phone image, swipe, no sideways scroll; banners off → home as before", async ({ browser }) => {
  for (const mode of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(base + "/");
    await page.evaluate((m) => localStorage.setItem("asiax-mode", m), mode);
    await ready(page, "/");
    const carousel = page.getByRole("region", { name: "โปรโมชั่น" });
    await expect(carousel).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
    const frame = await carousel.locator(".home-banner-slide").first().boundingBox();
    // Some banners have a phone image → 3:2 frame on phones.
    expect(Math.abs(frame.width / frame.height - 1.5)).toBeLessThan(0.03);
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(390);
    // Second banner uses its phone image.
    const current = await carousel
      .locator(".home-banner-slide")
      .nth(1)
      .locator("img")
      .evaluate((img) => img.currentSrc);
    expect(current).toContain(service.overview().banners[1].mobileImageUrl);
    // Swipe left with a touch gesture.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.synthesizeScrollGesture", {
      x: Math.round(frame.x + frame.width * 0.8),
      y: Math.round(frame.y + frame.height / 2),
      xDistance: -Math.round(frame.width * 0.7),
      yDistance: 0,
      gestureSourceType: "touch",
      speed: 1200,
    });
    await expect.poll(() => activeDot(page), { timeout: 4000 }).toBe(1);
    const colors = await carousel.locator(".home-banners-arrow.next").evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, fg: s.color };
    });
    expect(colors.fg).not.toBe(colors.bg);
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, `home-banners-390-${mode}`, false);
    if (mode === "dark") {
      await page.setViewportSize({ width: 1280, height: 900 });
      await ready(page, "/");
      await shot(page, "home-banners-dark", false);
    }
    await context.close();
  }

  // Switch both banners off → home page is back to the no-banner layout.
  const admin = service.session(adminToken);
  for (const b of service.adminBanners(admin).banners) service.adminUpdateBanner(admin, b.id, { active: false });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(base + "/");
  await page.locator(".loading-row").first().waitFor({ state: "hidden" });
  await expect(page.locator(".home-banners")).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector(".home-main").firstElementChild.classList.contains("home-hero"))).toBe(true);
  expect(await noSideScroll(page)).toBe(true);
  await context.close();
});
