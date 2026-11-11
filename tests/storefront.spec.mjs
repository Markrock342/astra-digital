import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";
let server, service, base;
const adminPassword = randomBytes(24).toString("hex");
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});
async function ready(page, path = "/") {
  await page.goto(base + path);
  await expect(
    page.getByRole("heading", { name: "เชื่อมต่อร้านค้าไม่ได้" }),
  ).toHaveCount(0);
  await page.locator(".loading-row").waitFor({ state: "hidden" });
  await page.evaluate(() => document.fonts.ready);
}
const screenshot = (page, name) =>
  page.screenshot({
    path: "docs/screenshots/" + name + ".png",
    fullPage: true,
    animations: "disabled",
  });
test("reference composition, catalog search, categories, theme and responsive layouts", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await expect(
    page.getByRole("heading", { name: "ASIA EXTRA", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".stat-value strong").nth(1)).toHaveText("25");
  await screenshot(page, "desktop-home");
  await ready(page, "/products");
  await expect(
    page.getByRole("heading", { name: "สินค้าทั้งหมด" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "ค้นหาสินค้า" }).fill("DISNEY+");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "ค้นหาสินค้า" })
    .fill("ไม่มีสินค้านี้");
  await expect(
    page.getByRole("heading", { name: "ไม่พบสินค้าที่ค้นหา" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ล้างตัวกรอง" }).click();
  await expect(page.locator(".product-card")).toHaveCount(2);
  await screenshot(page, "desktop-products");
  // Light/dark follows the device setting.
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 390) await screenshot(page, "mobile-home");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "เมนูลัด" }).click();
  await page
    .getByRole("navigation", { name: "เมนูหลัก" })
    .getByRole("link", { name: "สินค้า", exact: true })
    .click();
  await expect(page).toHaveURL(base + "/products");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, "mobile-products");
  expect(errors).toEqual([]);
});
test("registration and profile settings work", async ({ page }) => {
  await ready(page, "/register");
  const email = "ui-" + randomBytes(4).toString("hex") + "@example.invalid";
  await page
    .getByLabel("ชื่อผู้ใช้")
    .fill("ui_" + randomBytes(4).toString("hex"));
  await page.getByLabel("อีเมล (ไม่บังคับ)", { exact: true }).fill(email);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill("UI-test-only-12345");
  await page
    .getByLabel("ยืนยันรหัสผ่าน", { exact: true })
    .fill("UI-test-only-12345");
  await page.getByRole("button", { name: "สมัครสมาชิก", exact: true }).click();
  await expect(page).toHaveURL(base + "/account");
  await page.getByLabel("ชื่อที่แสดง").fill("Updated Customer");
  await page.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }).click();
  await expect(
    page.getByRole("heading", { name: "Updated Customer" }),
  ).toBeVisible();
});
test("direct routes, errors, fonts and unknown pages work", async ({
  page,
}) => {
  for (const path of [
    "/credits",
    "/terms",
    "/privacy",
    "/support",
    "/cart",
    "/products/office-suite",
  ]) {
    await ready(page, path);
    await expect(page.locator("main h1,main h2").first()).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await ready(page, "/unknown");
  await expect(
    page.getByRole("heading", { name: "ไม่พบหน้านี้" }),
  ).toBeVisible();
  const response = await page.request.get(base + "/fonts/thai.woff2");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toBe("font/woff2");
  expect(
    (await page.request.get(base + "/.data/commerce.sqlite")).status(),
  ).toBe(404);
});

test("language switch, theme panel and brand assets", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await expect(page.locator("header .brand-logo img")).toHaveAttribute("alt", "ASIA EXTRA");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("link", { name: "Products", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "All products" })).toBeVisible();
  await page.reload();
  await page.locator(".loading-row").waitFor({ state: "hidden" });
  await expect(page.getByRole("heading", { name: "All products" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("สินค้าทั้งหมด");

  await page.getByRole("button", { name: "Customize theme" }).click();
  await page.getByRole("button", { name: /EXTRA yellow/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "yellow");
  await expect(page.locator("html")).toHaveAttribute("data-shape", "soft");
  await expect(page.getByRole("dialog", { name: "Customize theme" })).not.toContainText(/Light|Dark|Sharp|Animations/);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "yellow");

  // The back office stays Thai whatever the storefront language is.
  await page.goto(page.url().replace(/\/[^/]*$/, "/admin"));
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await page.goBack();
  await page.getByRole("button", { name: "TH", exact: true }).click();
  await expect(page.getByRole("heading", { name: "สินค้าทั้งหมด" })).toBeVisible();
  expect(errors).toEqual([]);
});
