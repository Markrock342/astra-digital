// Basket with tick boxes → one order number for several items → pay once → every item delivered,
// and the purchase history shows it as one row. 390px.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, buyerToken, alpha, beta, gamma;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.CART_SHOTS;

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.use({ viewport: { width: 390, height: 844 } });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  const admin = service.session(service.login({ email: "admin@astra.local", password: adminPassword }).token);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const make = (name, price) => {
    const p = service.saveProduct(admin, { name, description: name + " บัญชีสตรีมมิ่งรายเดือน", category: "streaming", price, active: true, firstLabel: "30 วัน" });
    const variantId = service.adminProductVariants(admin, p.id).variants[0].id;
    service.importCodes(admin, {
      variantId,
      items: Array.from({ length: 4 }, (_, i) => ({ loginId: name.toLowerCase().replace(/\W/g, "") + i + "@cart.test", password: "Pw-" + i })),
    });
    return variantId;
  };
  alpha = make("Cart Alpha", 1500);
  beta = make("Cart Beta", 2500);
  gamma = make("Cart Gamma", 900);
  buyerToken = service.register({ name: "Cart Buyer", email: "cart-buyer@example.invalid", password: "Buyer-Pass-12345" }).token;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

test("tick two of three lines, summary, pay once, one order number", async ({ page }) => {
  await page.context().addCookies([{ name: "astra_session", value: buyerToken, url: base, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(base + "/");
  await page.evaluate(
    (lines) => localStorage.setItem("astra-cart", JSON.stringify(lines)),
    [
      { variantId: alpha, quantity: 2, selected: true },
      { variantId: beta, quantity: 1, selected: true },
      { variantId: gamma, quantity: 1, selected: false },
    ],
  );
  await page.goto(base + "/cart");
  const lines = page.locator(".cart-line");
  await expect(lines).toHaveCount(3);
  await expect(page.locator(".mobile-bottom-nav .cart-count")).toHaveText("4");
  const bar = page.locator(".cart-bar");
  await expect(bar).toContainText("ยอดรวม 3 ชิ้น");
  await expect(bar).toContainText("฿55.00");
  await expect(page.getByRole("checkbox", { name: /เลือกทั้งหมด/ })).not.toBeChecked();
  if (shots) await page.screenshot({ path: shots + "/cart.png", fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Tick all, then untick the third again.
  await page.getByText(/เลือกทั้งหมด/).click();
  await expect(bar).toContainText("ยอดรวม 4 ชิ้น");
  await page.getByRole("checkbox", { name: /Cart Gamma/ }).click({ force: true });
  await expect(bar).toContainText("ยอดรวม 3 ชิ้น");

  await bar.getByRole("button", { name: "ไปชำระเงิน" }).click();
  await expect(page).toHaveURL(base + "/checkout");
  await expect(page.getByRole("heading", { name: "สรุปรายการ" })).toBeVisible();
  await expect(page.locator(".cart-line")).toHaveCount(2);
  await expect(page.getByRole("radio", { name: /เครดิตร้าน/ })).toHaveAttribute("aria-checked", "true");
  if (shots) await page.screenshot({ path: shots + "/summary.png", fullPage: true, animations: "disabled" });
  // Pay straight from the summary: no "save the order" step.
  await page.locator(".cart-bar").getByRole("button", { name: "ชำระเงิน" }).click();
  await expect(page).toHaveURL(/\/checkouts\/[a-z0-9-]+$/);
  const checkoutId = page.url().split("/").pop();
  await expect(page.locator(".group-line")).toHaveCount(2);
  await expect(page.locator(".group-item")).toHaveCount(3);
  await expect(page.locator(".group-head .status")).toHaveText("จัดส่งสำเร็จ");
  if (shots) await page.screenshot({ path: shots + "/group.png", fullPage: true, animations: "disabled" });
  // Paid lines leave the basket; the unticked one stays.
  await expect(page.locator(".mobile-bottom-nav .cart-count")).toHaveText("1");

  await page.goto(base + "/orders");
  const rows = page.locator(".order-list-panel .history-item");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("+ อีก 1 รายการ");
  await expect(rows.first()).toContainText("#" + checkoutId.slice(0, 8).toUpperCase());
  // ID / password / code match the whole value (server search); product names match in part.
  await page.getByRole("searchbox").fill("cartbeta0@cart.test");
  await expect(rows).toHaveCount(1);
  await rows.first().locator(".history-card").click();
  await expect(page).toHaveURL(base + "/checkouts/" + checkoutId);
  // A line's own page links back to the whole order.
  await page.locator(".group-line-link").first().click();
  await page.getByRole("link", { name: /ทั้งคำสั่งซื้อ #/ }).click();
  await expect(page).toHaveURL(base + "/checkouts/" + checkoutId);
});

test("buy now + discount code: summary → pay → done", async ({ page }) => {
  const admin = service.session(service.login({ email: "admin@astra.local", password: adminPassword }).token);
  service.adminCreateCoupon(admin, { code: "CART10", type: "PERCENT", value: 10 });
  await page.context().addCookies([{ name: "astra_session", value: buyerToken, url: base, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(base + "/");
  await page.evaluate((v) => localStorage.setItem("astra-cart", JSON.stringify([{ variantId: v, quantity: 1, selected: true }])), beta);
  await page.goto(base + "/checkout");
  await page.getByPlaceholder("เช่น WELCOME10").fill("CART10");
  await page.getByRole("button", { name: "ใช้โค้ด" }).click();
  await expect(page.locator(".coupon-applied")).toContainText("CART10");
  await expect(page.locator(".cart-bar")).toContainText("฿22.50");
  await page.locator(".cart-bar").getByRole("button", { name: "ชำระเงิน" }).click();
  await expect(page).toHaveURL(/\/orders\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { name: "สั่งซื้อสำเร็จ พร้อมรับสินค้า" })).toBeVisible();
});
