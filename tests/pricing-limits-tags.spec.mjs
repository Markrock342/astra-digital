// Pricing rules through the real UI (server/pricing.mjs, src/AdminPricing.tsx, src/Pricing.tsx):
// the admin sets compare-at, a sale, a per-account limit and a tag price in the option editor,
// tags a customer; the storefront shows the struck-through price and -X% badge on the card,
// product page and checkout; the tagged customer sees and pays the reseller price, then hits the
// limit. Desktop and a 390px phone, no sideways scroll; STAFF sees tags read-only.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, staffToken, buyerToken, buyer;
const adminPassword = randomBytes(24).toString("hex");
const PRODUCT = "stream-plus";
const OPTION = "DISNEY+ 30 DAYS หาร"; // stream-plus-30, normal price ฿100
// Optional screenshots for review: PRICING_SHOTS=<dir> npx playwright test pricing
const shots = process.env.PRICING_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const shot = (page, name) => (shots ? page.screenshot({ path: join(shots, name + ".png"), fullPage: true }) : null);

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const auth = service.register({ name: "Reseller Shopper", email: "reseller@example.invalid", password: "Reseller-shopper-Pass-1" });
  buyerToken = auth.token;
  buyer = service.session(buyerToken);
  const staffAuth = service.register({ name: "Price Staff", email: "price-staff@example.invalid", password: "Price-staff-Pass-1" });
  service.db.prepare("UPDATE users SET role='STAFF' WHERE id=?").run(service.session(staffAuth.token).id);
  staffToken = staffAuth.token;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(context, token) {
  await context.clearCookies();
  if (token)
    await context.addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("admin sets compare-at, sale, limit and a tag price in the option editor", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/products/" + PRODUCT);
  const manager = page.locator(".variant-manager");
  const row = manager.locator(".variant-row").filter({ hasText: OPTION });
  await row.getByRole("button", { name: "ราคาโปร" }).click();
  const panel = row.locator(".variant-pricing");
  await expect(panel).toContainText("ราคาปกติ ฿100.00");
  await panel.getByLabel("ราคาก่อนลด (บาท)").fill("150");
  await panel.getByLabel("ราคาโปร (บาท)").fill("79");
  await panel.getByLabel("เริ่มโปร (เวลาไทย)").fill("2026-01-01T00:00");
  await panel.getByLabel("จบโปร (เวลาไทย)").fill("2036-12-31T23:59");
  await panel.getByLabel("จำกัดต่อบัญชี (ชิ้น)").fill("1");
  await panel.getByRole("button", { name: "เพิ่มราคาแท็ก" }).click();
  await panel.getByLabel("แท็ก", { exact: true }).fill("ตัวแทน");
  await panel.getByLabel("ราคาแท็ก ตัวแทน (บาท)").fill("60");
  await shot(page, "admin-option-pricing-desktop");
  await panel.getByRole("button", { name: "บันทึกราคา" }).click();
  await expect(row.locator(".variant-pricing")).toHaveCount(0);
  await expect(row.locator(".variant-pricing-chips")).toContainText("โปร ฿79.00");
  await expect(row.locator(".variant-pricing-chips")).toContainText("ก่อนลด ฿150.00");
  await expect(row.locator(".variant-pricing-chips")).toContainText("จำกัด 1/บัญชี");
  await expect(row.locator(".variant-pricing-chips")).toContainText("ราคาแท็ก 1");
  const saved = service.db.prepare("SELECT compare_at,sale_price,max_per_customer,sale_starts_at FROM variants WHERE id='stream-plus-30'").get();
  expect({ ...saved }).toEqual({ compare_at: 15000, sale_price: 7900, max_per_customer: 1, sale_starts_at: "2025-12-31 17:00:00" });

  // Server rules come back as a Thai message (sale must be below the normal price).
  await row.getByRole("button", { name: "ราคาโปร" }).click();
  await row.getByLabel("ราคาโปร (บาท)").fill("120");
  await row.getByRole("button", { name: "บันทึกราคา" }).click();
  await expect(row.locator(".variant-pricing")).toContainText("ราคาโปรต้องต่ำกว่าราคาปกติ");
  await row.getByRole("button", { name: "ยกเลิก" }).click();
});

test("admin tags the customer; the list filters by tag; staff sees tags read-only", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/customers/" + buyer.id);
  const card = page.locator(".customer-tags-card");
  await expect(card).toContainText("ยังไม่มีแท็ก");
  await card.getByLabel("แท็กใหม่").fill("ตัวแทน");
  await card.getByRole("button", { name: "เพิ่มแท็ก" }).click();
  await expect(card.locator(".customer-tag")).toHaveText(["ตัวแทน"]);
  await card.getByLabel("แท็กใหม่").fill("VIP");
  await card.getByLabel("สีแท็กใหม่").selectOption("red");
  await card.getByRole("button", { name: "เพิ่มแท็ก" }).click();
  await expect(card.locator(".customer-tag-red")).toHaveText("VIP");
  await card.getByRole("button", { name: "เอาแท็ก VIP ออก" }).click();
  await expect(card.locator(".customer-tag")).toHaveText(["ตัวแทน"]);

  await page.goto(base + "/admin/customers");
  await page.getByLabel("แท็ก", { exact: true }).selectOption("ตัวแทน");
  const rows = page.locator(".admin-list-table tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Reseller Shopper");
  await expect(rows.first().locator(".customer-tag")).toHaveText("ตัวแทน");

  await as(page.context(), staffToken);
  await page.goto(base + "/admin/customers/" + buyer.id);
  const staffCard = page.locator(".customer-tags-card");
  await expect(staffCard.locator(".customer-tag")).toHaveText("ตัวแทน");
  await expect(staffCard).toContainText("เฉพาะแอดมินเพิ่มหรือเอาแท็กออกได้");
  await expect(staffCard.getByRole("button", { name: /เอาแท็ก/ })).toHaveCount(0);
});

test("storefront: sale price, struck-through compare-at, -X% badge and limit (signed out)", async ({ page }) => {
  await as(page.context(), null);
  await page.goto(base + "/products");
  const card = page.locator(".product-card").filter({ hasText: "DISNEY+" }).first();
  await expect(card.locator(".product-card-price")).toContainText("฿79.00");
  await expect(card.locator(".price-was")).toContainText("฿150.00");
  await expect(card.locator(".price-badge")).toHaveText("-47%");

  await page.goto(base + "/products/" + PRODUCT);
  const price = page.locator(".reference-product-info .price-display");
  await expect(price.locator(".price-now")).toHaveText("฿79.00");
  await expect(price.locator(".price-was")).toContainText("฿150.00");
  await expect(price.locator(".price-badge")).toHaveText("-47%");
  await expect(price).toContainText("ลดราคาถึง");
  await expect(page.locator(".purchase-limit")).toHaveText("จำกัด 1 ชิ้นต่อบัญชี");
  // The reseller price is never shown to other visitors.
  await expect(page.locator(".reference-product-info")).not.toContainText("ตัวแทน");
  await expect(page.locator(".reference-product-info")).not.toContainText("฿60.00");
  await shot(page, "product-sale-desktop");
});

test("tagged customer sees and pays the reseller price, then reaches the limit", async ({ page }) => {
  await as(page.context(), buyerToken);
  await page.goto(base + "/products/" + PRODUCT);
  const price = page.locator(".reference-product-info .price-display");
  await expect(price.locator(".price-now")).toHaveText("฿60.00");
  await expect(price.locator(".price-was")).toContainText("฿150.00");
  await expect(price.locator(".price-badge")).toHaveText("-60%");
  await expect(price).toContainText("ราคาสำหรับ ตัวแทน");
  await page.getByRole("button", { name: "ซื้อเลย" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  const line = page.locator(".cart-line");
  await expect(line.locator(".cart-line-price")).toHaveText("฿60.00");
  await expect(line.locator(".price-was")).toContainText("฿150.00");
  await expect(line).toContainText("ราคาสำหรับ ตัวแทน");
  await expect(page.locator(".cart-summary-total")).toContainText("฿60.00");
  // Limit 1: the basket cannot go above 1.
  await page.goto(base + "/cart");
  await expect(page.locator(".cart-line").getByRole("button", { name: "เพิ่มจำนวน" })).toBeDisabled();
  await page.goto(base + "/checkout");
  await shot(page, "checkout-reseller-desktop");
  await page.locator(".cart-bar").getByRole("button", { name: /ชำระเงิน/ }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
  const id = page.url().split("/").pop();
  expect(service.db.prepare("SELECT total,discount FROM orders WHERE id=?").get(id).total).toBe(6000);

  await page.goto(base + "/products/" + PRODUCT);
  await expect(page.locator(".purchase-limit")).toContainText("คุณซื้อครบจำนวนแล้ว");
  await expect(page.getByRole("button", { name: "ซื้อเลย" })).toBeDisabled();
});

test("390px phone: product page, checkout and the admin option editor fit without sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await as(page.context(), null);
  await page.goto(base + "/products/" + PRODUCT);
  await expect(page.locator(".reference-product-info .price-badge")).toHaveText("-47%");
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "product-sale-390");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator(".reference-product-info .price-badge")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "product-sale-390-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto(base + "/products");
  await expect(page.locator(".product-card .price-badge").first()).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);

  await as(page.context(), adminToken);
  await page.goto(base + "/admin/products/" + PRODUCT);
  const row = page.locator(".variant-manager .variant-row").filter({ hasText: OPTION });
  await row.getByRole("button", { name: "ราคาโปร" }).click();
  await expect(row.locator(".variant-pricing")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "admin-option-pricing-390");

  await page.goto(base + "/admin/customers/" + buyer.id);
  await expect(page.locator(".customer-tags-card .customer-tag")).toHaveText("ตัวแทน");
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "admin-customer-tags-390");
});
