// SweetAlert2 replaces the browser confirm/prompt: result, required reason, Esc, 390, dark storefront.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, buyerToken, productId, variantId;
const adminPassword = randomBytes(24).toString("hex");
const webp = readFileSync(new URL("../public/library/spotify.webp", import.meta.url));

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword, seed: false });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const admin = service.session(adminToken);
  const saved = service.saveProduct(admin, {
    name: "Dialog Product",
    description: "สินค้าทดสอบกล่องยืนยัน",
    category: "streaming",
    price: 14900,
    active: true,
    firstLabel: "1 เดือน",
  });
  productId = saved.id;
  variantId = productId + "-30";
  service.importCodes(admin, { variantId, items: [{ loginId: "dialog-user", password: "dialog-pass" }] });
  const auth = service.register({ name: "Dialog Buyer", email: "dialog@example.invalid", password: "Dialog-Pass-123" });
  buyerToken = auth.token;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(context, token) {
  await context.clearCookies();
  await context.addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}

test("cancel keeps the product image; confirm deletes it", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/admin/products/" + productId);
  const section = page.locator(".product-images");
  await section.getByLabel("เลือกรูปสินค้า").setInputFiles({ name: "cover.webp", mimeType: "image/webp", buffer: webp });
  await expect(section.locator("figure")).toHaveCount(1);
  await section.getByRole("button", { name: "ลบรูป" }).click();
  const dialog = page.locator(".astra-dialog");
  await expect(dialog).toContainText("ลบรูปนี้?");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const confirmBox = await dialog.getByRole("button", { name: "ยืนยัน" }).boundingBox();
  expect(confirmBox.height).toBeGreaterThanOrEqual(44);
  await dialog.getByRole("button", { name: "ยกเลิก" }).click();
  await expect(section.locator("figure")).toHaveCount(1);
  await section.getByRole("button", { name: "ลบรูป" }).click();
  await dialog.getByRole("button", { name: "ยืนยัน" }).click();
  await expect(page.getByText("ลบรูปแล้ว")).toBeVisible();
  await expect(section.locator("figure")).toHaveCount(0);
});

test("an empty defect reason cannot be confirmed, and Esc cancels", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/inventory/" + variantId);
  await page.locator(".stock-act-defect").click();
  const dialog = page.locator(".astra-dialog");
  await expect(dialog).toContainText("เหตุผลที่บัญชีนี้ใช้ไม่ได้");
  await dialog.getByRole("button", { name: "ยืนยัน" }).click();
  await expect(dialog).toContainText("กรอกข้อมูลก่อน");
  await expect(page.getByText("ทำเครื่องหมายว่าเสียแล้ว")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(service.db.prepare("SELECT defective FROM inventory WHERE variant_id=?").get(variantId).defective).not.toBe(1);
});

test("storefront delete-account dialog fits 390 in dark mode and translates", async ({ page }) => {
  await as(page.context(), buyerToken);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/account");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.accent = "blue";
  });
  await page.getByRole("button", { name: "ขอลบบัญชี" }).click();
  const dialog = page.locator(".astra-dialog");
  await expect(dialog).toContainText("ยืนยันขอลบบัญชี?");
  await dialog.getByRole("button", { name: "ยกเลิก" }).click();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.accent = "yellow";
  });
  await page.getByRole("button", { name: "ขอลบบัญชี" }).click();
  await expect(dialog).toContainText("ยืนยันขอลบบัญชี?");
  const colors = await dialog.evaluate((el) => {
    const title = el.querySelector(".astra-dialog-title");
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).map((n) => lin(Number(n) / 255));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const bg = getComputedStyle(el).backgroundColor;
    const fg = getComputedStyle(title).color;
    const hi = Math.max(lum(bg), lum(fg));
    const lo = Math.min(lum(bg), lum(fg));
    return { bg, fg, contrast: (hi + 0.05) / (lo + 0.05) };
  });
  expect(colors.bg).toBe("rgb(255, 255, 255)");
  expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "ยกเลิก" }).click();
  // Language lives in the header "ภาษาและธีม" popover since the client round (#97).
  await page.getByRole("button", { name: "ภาษาและธีม" }).click();
  await page.getByRole("dialog", { name: "ภาษาและธีม" }).getByRole("button", { name: "EN", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(dialog).toContainText("Request account deletion?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});
