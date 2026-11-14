// Menu › ใบเสร็จ → ใบเสร็จของฉัน (/receipts) → ขอใบเสร็จ opens the request form on the order page.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, token;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.RECEIPT_SHOTS;

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 } });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  const admin = service.session(service.login({ email: "admin@astra.local", password: adminPassword }).token);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const p = service.saveProduct(admin, { name: "Receipt Stream", description: "Receipt Stream บัญชีสตรีมมิ่งรายเดือน", category: "streaming", price: 1000, active: true, firstLabel: "30 วัน" });
  const variantId = service.adminProductVariants(admin, p.id).variants[0].id;
  service.importCodes(admin, { variantId, items: [{ loginId: "rs@x.test", password: "Pw-rs" }] });
  token = service.register({ name: "Receipt Buyer", email: "rs-buyer@example.invalid", password: "Buyer-Pass-12345" }).token;
  service.createCheckout(service.session(token), { requestKey: "my-receipts-e2e", pay: "success", lines: [{ variantId, quantity: 1 }] });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

test("menu › ใบเสร็จ lists the paid order; ขอใบเสร็จ opens the form on the order page", async ({ page }) => {
  await page.context().addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(base + "/");
  await page.getByRole("button", { name: "เมนูลัด" }).click();
  await page.locator("#storefront-menu").getByRole("link", { name: "ใบเสร็จ", exact: true }).click();
  await expect(page).toHaveURL(base + "/receipts");
  await expect(page.getByRole("heading", { name: "ใบเสร็จของฉัน" })).toBeVisible();
  const row = page.locator(".my-receipt-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Receipt Stream");
  await expect(row).toContainText(/ขอได้ถึง/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("#storefront-menu")).toBeHidden();
  if (shots) await page.screenshot({ path: shots + "/my-receipts.png", fullPage: true });
  await row.getByRole("link", { name: "ขอใบเสร็จ" }).click();
  await expect(page).toHaveURL(/\/orders\/[^/?]+\?receipt=open$/);
  await expect(page.getByRole("button", { name: "ส่งคำขอ" })).toBeVisible();
});
