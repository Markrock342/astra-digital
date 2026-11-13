// หมวดหมู่: the shop uploads its own picture in the add/edit dialog; the storefront chips show it.
// บัญชีสต็อก rows show the product cover.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken;
const adminPassword = randomBytes(24).toString("hex");
const picture = readFileSync(new URL("../public/library/spotify.webp", import.meta.url));

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
async function asAdmin(page) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "astra_session", value: adminToken, url: base, httpOnly: true, sameSite: "Lax" }]);
}

test("add a category with an uploaded picture; it shows on the storefront", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/categories");
  await page.getByRole("button", { name: "เพิ่มหมวด" }).click();
  const dialog = page.getByRole("dialog", { name: "เพิ่มหมวด" });
  await dialog.getByLabel("ชื่อหมวด (ไทย)").fill("โปรของร้าน");
  await dialog.getByLabel("ชื่อหมวด (อังกฤษ)").fill("Shop deals");
  await dialog.getByLabel("เลือกรูปหมวด").setInputFiles({ name: "cat.webp", mimeType: "image/webp", buffer: picture });
  await expect(dialog.locator(".category-icon-upload img")).toHaveAttribute("src", /^\/api\/files\//);
  await dialog.getByRole("button", { name: "เพิ่มหมวด" }).click();
  await expect(page.locator(".toast")).toContainText("เพิ่มหมวด โปรของร้าน แล้ว");
  const row = service.db.prepare("SELECT id, icon FROM categories WHERE name_th='โปรของร้าน'").get();
  expect(row.icon).toMatch(/^upload-/);

  // Needs a product on sale to appear on the storefront.
  const admin = service.session(adminToken);
  service.saveProduct(admin, { name: "Deal Stream", description: "ทดสอบหมวด", category: row.id, price: 4900, active: true, firstLabel: "1 เดือน" });
  await page.goto(base + "/products");
  const chip = page.locator(".storefront-category-chip", { hasText: "โปรของร้าน" });
  await expect(chip.locator("img")).toHaveAttribute("src", "/api/files/" + row.icon.slice("upload-".length));
});

test("stock table rows show the product picture", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/inventory");
  const row = page.locator("tr", { hasText: "Deal Stream" });
  await expect(row.locator(".stock-product-thumb")).toBeVisible();
  const box = await row.locator(".stock-product-thumb").boundingBox();
  expect(Math.round(box.width)).toBe(40);
});
