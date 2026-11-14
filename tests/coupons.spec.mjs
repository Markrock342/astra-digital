// Coupons through the real UI: the admin creates a code (live summary sentence),
// a customer applies it at checkout, pays with test credit and sees the discount on
// the order; an invalid code shows its reason; pages fit a 390px phone.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, buyer, buyerToken, couponId;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const auth = service.register({ name: "Coupon Shopper", email: "coupon-shopper@example.invalid", password: "Coupon-shopper-Pass-1" });
  buyerToken = auth.token;
  buyer = service.session(buyerToken);
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(context, token) {
  await context.clearCookies();
  await context.addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}
async function basket(page, variantId, quantity = 1) {
  await page.goto(base + "/");
  await page.evaluate((b) => localStorage.setItem("astra-cart", JSON.stringify([b])), { variantId, quantity, selected: true });
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("admin creates a coupon with a live summary", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/products");
  await page.locator(".reference-subnav").getByRole("link", { name: "คูปอง" }).click();
  await expect(page.getByRole("heading", { name: "คูปองส่วนลด" })).toBeVisible();
  await expect(page.getByText("ยังไม่มีคูปอง")).toBeVisible();
  await page.getByRole("link", { name: "สร้างคูปอง" }).click();
  await expect(page).toHaveURL(/\/admin\/coupons\/new$/);
  await page.getByLabel("โค้ดส่วนลด").fill("save20");
  await expect(page.getByLabel("โค้ดส่วนลด")).toHaveValue("SAVE20");
  await page.getByLabel("ส่วนลด (%)").fill("20");
  await page.getByLabel("ส่วนลดสูงสุด (บาท)").fill("50");
  await page.getByLabel("ยอดสั่งซื้อขั้นต่ำ (บาท)").fill("50");
  await expect(page.getByTestId("coupon-sentence")).toHaveText("ลด 20% สูงสุด ฿50 เมื่อซื้อครบ ฿50 ใช้ได้ 1 ครั้งต่อคน");
  await page.getByLabel("หมดอายุ (เวลาไทย)").fill("2099-12-31T23:59");
  await expect(page.getByTestId("coupon-sentence")).toContainText("ถึง 31 ธ.ค. 2642");
  await page.getByRole("button", { name: "สร้างคูปอง" }).click();
  await expect(page).toHaveURL(/\/admin\/coupons\/(?!new$)[0-9a-f-]+$/);
  couponId = page.url().split("/").pop();
  await expect(page.getByRole("heading", { name: "SAVE20" })).toBeVisible();
  await expect(page.locator(".coupon-heading-actions")).toContainText("ใช้งานอยู่");
  const row = service.db.prepare("SELECT * FROM coupons WHERE id=?").get(couponId);
  expect([row.code, row.type, row.value, row.max_discount, row.min_total, row.per_user_limit]).toEqual([
    "SAVE20",
    "PERCENT",
    20,
    5000,
    5000,
    1,
  ]);
  expect(row.ends_at).toBe("2099-12-31 16:59:59");
  expect(service.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='COUPON_CREATE' AND entity_id=?").get(couponId).n).toBe(1);

  await page.getByRole("link", { name: "คูปองทั้งหมด" }).click();
  await expect(page.locator(".coupon-table")).toContainText("SAVE20");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
  await page.goto(base + "/admin/coupons/" + couponId);
  await expect(page.getByTestId("coupon-sentence")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
});

test("an invalid code shows its reason at checkout", async ({ page }) => {
  await as(page.context(), buyerToken);
  await basket(page, "stream-plus-30");
  await page.goto(base + "/checkout");
  const field = page.locator("#coupon-code");
  await field.fill("nope-code");
  await page.getByRole("button", { name: "ใช้โค้ด" }).click();
  await expect(page.locator(".coupon-box").getByRole("alert")).toHaveText("ไม่พบโค้ดส่วนลดนี้");
  // Below the minimum: the reason says how much is missing.
  service.adminCreateCoupon(service.session(adminToken), { code: "BIG-SPEND", type: "FIXED", value: 3000, minTotal: 50000 });
  await field.fill("big-spend");
  await page.getByRole("button", { name: "ใช้โค้ด" }).click();
  await expect(page.locator(".coupon-box").getByRole("alert")).toHaveText("ยอดสั่งซื้อขั้นต่ำ ฿500 (ขาดอีก ฿400)");
  await expect(page.locator(".cart-summary-total")).toContainText("฿100.00");
});

test("customer applies the code, pays with test credit and sees the discount", async ({ page }) => {
  await as(page.context(), buyerToken);
  await basket(page, "stream-plus-90", 2);
  await page.goto(base + "/checkout");
  await page.locator("#coupon-code").fill("save20");
  await page.getByRole("button", { name: "ใช้โค้ด" }).click();
  // 20% of ฿220 = ฿44 (under the ฿50 cap) → ฿176.
  await expect(page.locator(".coupon-applied")).toContainText("SAVE20");
  await expect(page.locator(".summary-discount")).toContainText("−฿44.00");
  await expect(page.locator(".cart-summary-total")).toContainText("฿176.00");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const before = service.publicUser(buyer).balance;
  // Summary → pay in one step.
  await page.locator(".cart-bar").getByRole("button", { name: /ชำระเงิน/ }).click();
  await expect(page).toHaveURL(/\/orders\/[a-z0-9-]+$/);
  const orderId = page.url().split("/").pop();
  await expect(page.getByRole("heading", { name: "สั่งซื้อสำเร็จ พร้อมรับสินค้า" })).toBeVisible();
  const breakdown = page.locator(".order-price-breakdown");
  await expect(breakdown).toContainText("ราคาสินค้า");
  await expect(breakdown).toContainText("ส่วนลด (SAVE20)");
  await expect(breakdown).toContainText("ยอดชำระ");
  await expect(breakdown).toContainText("฿176.00");

  // Server truth: payment == discounted total, credit charged once.
  const payment = service.db.prepare("SELECT amount FROM payments WHERE order_id=? AND status='SUCCEEDED'").get(orderId);
  expect(payment.amount).toBe(17600);
  expect(service.publicUser(buyer).balance).toBe(before - 17600);
  expect(service.orderDetail(buyer, orderId)).toMatchObject({ total: 17600, discount: 4400, coupon_code: "SAVE20" });

  // Admin sees it on the order and on the coupon.
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/orders/" + orderId);
  await expect(page.locator(".money-summary-coupon")).toContainText("SAVE20");
  await expect(page.locator(".money-summary-coupon")).toContainText("−฿44.00");
  await page.goto(base + "/admin/coupons/" + couponId);
  await expect(page.locator(".coupon-stats")).toContainText("฿44.00");
  await expect(page.locator(".admin-detail-card")).toContainText("coupon-shopper@example.invalid");
  await page.goto(base + "/admin/reports");
  await expect(page.locator(".admin-stat-row")).toContainText("ส่วนลดคูปองที่ให้ไป");
  await expect(page.locator(".admin-stat-row")).toContainText("฿44.00");

  // Used once per customer: the same code is refused on the next checkout.
  await as(page.context(), buyerToken);
  await basket(page, "stream-plus-30");
  await page.goto(base + "/checkout");
  await page.locator("#coupon-code").fill("SAVE20");
  await page.getByRole("button", { name: "ใช้โค้ด" }).click();
  await expect(page.locator(".coupon-box").getByRole("alert")).toHaveText("คุณใช้โค้ดนี้ไปแล้ว");
});
