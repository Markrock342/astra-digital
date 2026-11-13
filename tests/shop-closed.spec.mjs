// Shop switched off: the product page, checkout and an unpaid order say so instead of a silent
// grey button; reopening brings the buttons back.
import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, admin, buyerToken, productId, variantId, order;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  admin = service.session(service.login({ email: "admin@astra.local", password: adminPassword }).token);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const p = service.saveProduct(admin, { name: "Closed Shop Stream", description: "ทดสอบปิดร้าน", category: "streaming", price: 5000, active: true, firstLabel: "1 เดือน" });
  productId = p.id;
  variantId = service.adminProductVariants(admin, p.id).variants[0].id;
  service.importCodes(admin, { variantId, items: [{ loginId: "cs1@x.test", password: "p1" }, { loginId: "cs2@x.test", password: "p2" }] });
  const auth = service.register({ name: "Closed Shop Buyer", email: "csb@example.invalid", password: "Closed-shop-Pass-123" });
  buyerToken = auth.token;
  const buyer = service.session(buyerToken);
  service.adjustCustomerCredit(admin, buyer.id, { amount: 20000, reason: "ทดสอบปิดร้าน", requestKey: randomUUID() });
  order = service.createOrder(buyer, { variantId, quantity: 1, requestKey: randomUUID() });
  service.saveSettings(admin, { shopOpen: false });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

test("closed: product page, checkout and the unpaid order explain why the button is off", async ({ page }) => {
  await page.context().addCookies([{ name: "astra_session", value: buyerToken, url: base, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(base + "/products/" + productId);
  await expect(page.locator(".shop-closed-note")).toContainText("ร้านปิดให้บริการชั่วคราว");
  await expect(page.getByRole("button", { name: "ซื้อเลย" })).toBeDisabled();

  await page.goto(base + "/orders/" + order.id);
  const note = page.locator(".shop-closed-note");
  await expect(note).toContainText("ยังชำระเงินไม่ได้");
  await expect(page.getByRole("button", { name: /ชำระเงิน/ })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Reopen: note gone, pay works.
  service.saveSettings(admin, { shopOpen: true });
  await page.reload();
  await expect(page.locator(".shop-closed-note")).toHaveCount(0);
  await page.getByRole("button", { name: /ชำระเงิน/ }).click();
  await expect(page.locator(".delivered-codes")).toBeVisible();
});
