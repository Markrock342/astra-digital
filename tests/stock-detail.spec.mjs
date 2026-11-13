// บัญชีสต็อก: a row opens the option's stock page — counts per status, reveal the full ID +
// password (audited), edit an unsold account, and the list at 390px.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, variantId;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const admin = service.session(adminToken);
  const product = service.saveProduct(admin, { name: "Stock Page Stream", description: "หน้าสต็อก", category: "streaming", price: 12900, active: true, firstLabel: "1 เดือน" });
  variantId = service.adminProductVariants(admin, product.id).variants[0].id;
  service.importCodes(admin, {
    variantId,
    items: [
      { loginId: "first@stockpage.test", password: "pw-first", cost: "40" },
      { loginId: "second@stockpage.test", password: "pw-second" },
    ],
  });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});
async function asAdmin(page) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "astra_session", value: adminToken, url: base, httpOnly: true, sameSite: "Lax" }]);
}

test("inventory row opens the option page with counts; reveal and edit an account", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/inventory");
  await expect(page.getByPlaceholder("ค้นหาชื่อสินค้า")).toBeVisible();
  await page.getByRole("link", { name: "Stock Page Stream" }).click();
  await expect(page).toHaveURL(base + "/admin/inventory/" + variantId);
  await expect(page.getByRole("heading", { name: "Stock Page Stream · 1 เดือน" })).toBeVisible();
  const summary = page.getByLabel("สรุปจำนวนไอดี");
  await expect(summary.locator(".stock-summary-card", { hasText: "ทั้งหมด" })).toContainText("2");
  await expect(summary.locator(".stock-summary-card", { hasText: "พร้อมขาย" })).toContainText("2");
  await expect(page.getByRole("group", { name: "สถานะสต็อก" }).getByRole("button", { name: "พร้อมขาย 2" })).toBeVisible();
  await expect(page.locator(".stock-unit")).toHaveCount(2);
  await expect(page.locator(".stock-unit").first()).not.toContainText("@stockpage.test");

  // Reveal (full values, audited), then hide.
  const unit = page.locator(".stock-unit", { hasText: "ต้นทุน" });
  await unit.getByRole("button", { name: "ดูรหัส" }).click();
  await expect(unit).toContainText("first@stockpage.test");
  await expect(unit).toContainText("pw-first");
  expect(service.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='INVENTORY_REVEAL'").get().n).toBe(1);
  await unit.getByRole("button", { name: "ซ่อน" }).click();
  await expect(unit).not.toContainText("pw-first");

  // Edit: new password + expiry + cost.
  await unit.getByRole("button", { name: "แก้ไข" }).click();
  const form = page.getByRole("form", { name: "แก้ไขรายการสต็อก" });
  await expect(form.getByLabel("ต้นทุน (บาท)")).toHaveValue("40");
  await form.getByLabel("รหัสผ่านใหม่").fill("pw-changed");
  await form.getByLabel("วันหมดอายุ").fill("2031-05-01");
  await form.getByLabel("ต้นทุน (บาท)").fill("55.5");
  await form.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("บันทึกรายการสต็อกแล้ว")).toBeVisible();
  const edited = page.locator(".stock-unit", { hasText: "ต้นทุน ฿55.50" });
  await expect(edited).toContainText("หมดอายุ");
  await edited.getByRole("button", { name: "ดูรหัส" }).click();
  await expect(edited).toContainText("pw-changed");

  // Duplicate ID refused with a clear message.
  const other = page.locator(".stock-unit").filter({ hasNotText: "ต้นทุน ฿" });
  await other.getByRole("button", { name: "แก้ไข" }).click();
  await page.getByRole("form", { name: "แก้ไขรายการสต็อก" }).getByLabel("ID ใหม่").fill("FIRST@stockpage.test");
  await page.getByRole("form", { name: "แก้ไขรายการสต็อก" }).getByRole("button", { name: "บันทึก" }).click();
  await expect(other).toContainText("ID นี้มีในระบบแล้ว");

  // Back link and phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "บัญชีสต็อก" }).first().click();
  await expect(page).toHaveURL(base + "/admin/inventory");
});

test("clicking anywhere on the row opens it too", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/inventory");
  await page.locator("tr", { hasText: "Stock Page Stream" }).locator("td").nth(2).click();
  await expect(page).toHaveURL(base + "/admin/inventory/" + variantId);
});
