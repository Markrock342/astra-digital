// Back-in-stock notices and review moderation through the real UI:
// a customer asks "แจ้งเตือนเมื่อมีของ" on an out-of-stock option, the admin sees the waiting
// count and imports stock, and the customer's bell opens the product; the admin replies to a
// review (shown under it on the product page) and hides another one with a reason (gone from
// the storefront, kept in the admin list). Pages fit a 390px phone.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, buyerToken, buyer, productId, variantId, replyReviewId, hideReviewId;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const product = service.saveProduct(admin, {
    name: "Restock Stream",
    description: "บัญชีสตรีมมิ่งสำหรับทดสอบแจ้งเตือนเมื่อมีของ",
    category: "streaming",
    price: 9900,
    firstLabel: "30 วัน",
    active: true,
  });
  productId = product.id;
  variantId = service.adminProductVariants(admin, productId).variants[0].id;
  const auth = service.register({ name: "Restock Shopper", email: "restock-shopper@example.invalid", password: "Restock-shopper-Pass-1" });
  buyerToken = auth.token;
  buyer = service.session(buyerToken);
  // Two delivered orders on DISNEY+ (stream-plus-30) with reviews: one to answer, one to hide.
  for (const [i, rating, comment] of [
    [1, 2, "ได้บัญชีช้ากว่าที่คิด แต่ใช้งานได้"],
    [2, 5, "โปรโมชั่นร้านอื่นถูกกว่า ทักไลน์ xyz123 ได้เลย"],
  ]) {
    const order = service.createOrder(buyer, { variantId: "stream-plus-30", quantity: 1, requestKey: "e2e-review-" + i, acceptTerms: true });
    service.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
    service.addReview(buyer, { orderId: order.id, rating, comment });
    const id = service.db.prepare("SELECT id FROM reviews WHERE order_id=?").get(order.id).id;
    if (i === 1) replyReviewId = id;
    else hideReviewId = id;
  }
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

test("signed-out visitors are sent to log in before asking for a notice", async ({ page }) => {
  await as(page.context(), null);
  await page.goto(base + "/products/" + productId);
  await expect(page.getByRole("heading", { name: "Restock Stream" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ซื้อเลย" })).toHaveCount(0);
  await page.getByRole("button", { name: "แจ้งเตือนเมื่อมีของ" }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get("next"))).toBe(
    "/products/" + productId + "?variant=" + variantId,
  );
});

test("customer asks for a notice, admin sees the waiting count and imports, the bell links back", async ({ page }) => {
  await as(page.context(), buyerToken);
  await page.goto(base + "/products/" + productId);
  await page.getByRole("button", { name: "แจ้งเตือนเมื่อมีของ" }).click();
  await expect(page.getByTestId("stock-watch")).toContainText("เราจะแจ้งเตือนเมื่อมีของ");
  expect(service.db.prepare("SELECT COUNT(*) AS n FROM stock_watch WHERE user_id=?").get(buyer.id).n).toBe(1);
  // Never a stock number on the storefront.
  await expect(page.locator(".reference-product-info")).not.toContainText(/เหลือ\s*\d/);

  await page.goto(base + "/account");
  const list = page.locator(".stock-watch-list");
  await expect(list).toContainText("สินค้าที่รอแจ้งเตือน");
  await expect(list).toContainText("Restock Stream");

  await as(page.context(), adminToken);
  await page.goto(base + "/admin/products");
  await expect(page.getByRole("button", { name: "ดูสต็อก Restock Stream" })).toContainText("รอแจ้งเตือน 1 คน");
  await page.goto(base + "/admin/products/" + productId);
  const manager = page.locator(".variant-manager");
  await expect(manager).toContainText("รอแจ้งเตือน 1 คน");
  await manager.getByRole("button", { name: /สต็อก 0/ }).first().click();
  await manager.getByLabel("เติมสต็อก 30 วัน").fill("restock-e2e@stream.test\tPw-Restock-1");
  await manager.getByRole("button", { name: /ตรวจ 1 รายการ/ }).click();
  await manager.getByRole("button", { name: "เพิ่ม 1 บัญชี" }).click();
  await expect(manager.getByRole("button", { name: /สต็อก 1/ })).toBeVisible();
  await expect(manager).not.toContainText("รอแจ้งเตือน 1 คน");

  await as(page.context(), buyerToken);
  await page.goto(base + "/");
  await page.locator(".notice-button").click();
  const panel = page.getByRole("dialog", { name: "แจ้งเตือน" });
  await expect(panel).toContainText("สินค้าที่คุณรอกลับมามีของแล้ว");
  await expect(panel).toContainText("Restock Stream · 30 วัน");
  await panel.getByRole("button", { name: /สินค้าที่คุณรอกลับมามีของแล้ว/ }).click();
  await expect(page).toHaveURL(new RegExp("/products/" + productId + "\\?variant="));
  await expect(page.getByRole("button", { name: "ซื้อเลย" })).toBeEnabled();
  await page.goto(base + "/account");
  await expect(page.locator(".stock-watch-list")).toContainText("ยังไม่มีสินค้าที่รอแจ้งเตือน");
});

test("admin replies to a review; it shows under the review on the product page", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/products");
  await page.locator(".reference-subnav").getByRole("link", { name: "รีวิว" }).click();
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  await expect(page.getByRole("heading", { name: "รีวิวสินค้า" })).toBeVisible();
  await page.getByLabel("การตอบกลับ").selectOption("no");
  const card = page.locator(`[data-review-id="${replyReviewId}"]`);
  await expect(card).toContainText("ยังไม่ตอบ");
  await expect(page.locator("main")).not.toContainText("ไม่พบหน้านี้");
  await card.getByRole("button", { name: "ตอบกลับ", exact: true }).click();
  await card.getByLabel(/ตอบกลับรีวิวของ/).fill("ขออภัยค่ะ ตอนนี้ร้านส่งอัตโนมัติทันทีหลังชำระแล้ว");
  await card.getByRole("button", { name: "ส่งคำตอบ" }).click();
  await expect(card).toContainText("ตอบกลับจากร้าน");
  await expect(card).toContainText("ตอบแล้ว");
  expect(service.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='REVIEW_REPLY' AND entity_id=?").get(replyReviewId).n).toBe(1);

  await as(page.context(), buyerToken);
  await page.goto(base + "/products/stream-plus");
  const item = page.locator("#review-" + replyReviewId);
  await expect(item.locator(".review-shop-reply")).toContainText("ตอบกลับจากร้าน");
  await expect(item.locator(".review-shop-reply")).toContainText("ขออภัยค่ะ ตอนนี้ร้านส่งอัตโนมัติทันทีหลังชำระแล้ว");
  // The customer's bell links to the review on the reviews page.
  await page.locator(".notice-button").click();
  await page.getByRole("dialog", { name: "แจ้งเตือน" }).getByRole("button", { name: /ร้านตอบกลับรีวิวของคุณ/ }).click();
  await expect(page).toHaveURL(new RegExp("/reviews\\?review=" + replyReviewId));
  await expect(page.locator("#review-" + replyReviewId)).toHaveClass(/review-focus/);
  await expect(page.locator("#review-" + replyReviewId)).toContainText("ตอบกลับจากร้าน");
});

test("admin hides a review with a reason; it disappears publicly but stays in the admin list", async ({ page }) => {
  const ratingBefore = service.productDetail("stream-plus").rating;
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/reviews");
  const card = page.locator(`[data-review-id="${hideReviewId}"]`);
  await card.getByRole("button", { name: "ซ่อนรีวิว" }).click();
  // A reason is required, then a confirm step.
  await card.getByRole("button", { name: "ซ่อนรีวิว…" }).click();
  await expect(card.getByRole("alert")).toContainText("เลือกเหตุผลในการซ่อน");
  await card.getByLabel("สแปม/โฆษณา").check();
  await card.getByRole("button", { name: "ซ่อนรีวิว…" }).click();
  await expect(card.getByRole("group", { name: "ยืนยันการซ่อนรีวิว" })).toContainText("เหตุผล: สแปม/โฆษณา");
  await card.getByRole("button", { name: "ยืนยันซ่อนรีวิว" }).click();
  await expect(card).toContainText("ซ่อนอยู่ · สแปม/โฆษณา");
  await expect(card.getByRole("button", { name: "แสดงอีกครั้ง" })).toBeVisible();
  const audit = service.db.prepare("SELECT * FROM audit WHERE action='REVIEW_HIDE' AND entity_id=?").get(hideReviewId);
  expect(JSON.parse(audit.detail).reason).toBe("SPAM");
  const ratingAfter = service.productDetail("stream-plus").rating;
  expect(ratingAfter.count).toBe(ratingBefore.count - 1);

  await page.getByRole("tab", { name: "ซ่อนอยู่" }).click();
  await expect(page.getByTestId("admin-review")).toHaveCount(1);

  await as(page.context(), null);
  await page.goto(base + "/reviews");
  await expect(page.getByTestId("review-policy")).toContainText("ไม่ซ่อนรีวิวเพราะคะแนนต่ำหรือคำติ");
  await expect(page.locator("#review-" + replyReviewId)).toBeVisible();
  await expect(page.locator("#review-" + hideReviewId)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("xyz123");
  await page.goto(base + "/products/stream-plus");
  await expect(page.locator(".reference-product-reviews")).toBeVisible();
  await expect(page.locator("#review-" + hideReviewId)).toHaveCount(0);
});

test("staff can reply but has no hide button", async ({ page }) => {
  const auth = service.register({ name: "Review Staffer", email: "review-staffer@example.invalid", password: "Review-staffer-Pass-1" });
  service.db.prepare("UPDATE users SET role='STAFF' WHERE id=?").run(auth.user.id);
  await as(page.context(), auth.token);
  await page.goto(base + "/admin/reviews");
  await expect(page.getByRole("heading", { name: "รีวิวสินค้า" })).toBeVisible();
  const card = page.locator(`[data-review-id="${replyReviewId}"]`);
  await expect(card).toContainText("ตอบกลับจากร้าน");
  await expect(page.getByRole("button", { name: "ซ่อนรีวิว" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "แสดงอีกครั้ง" })).toHaveCount(0);
});

test("390px: product notice button, account list and admin reviews fit the phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const admin = service.session(adminToken);
  const other = service.saveProduct(admin, {
    name: "Phone Restock",
    description: "สินค้าทดสอบหน้าจอมือถือ",
    category: "streaming",
    price: 5000,
    firstLabel: "30 วัน จอส่วนตัว",
    active: true,
  });
  await as(page.context(), buyerToken);
  await page.goto(base + "/products/" + other.id);
  await page.getByRole("button", { name: "แจ้งเตือนเมื่อมีของ" }).click();
  await expect(page.getByTestId("stock-watch")).toContainText("เราจะแจ้งเตือนเมื่อมีของ");
  expect(await noSideScroll(page)).toBe(true);
  await page.goto(base + "/account");
  await expect(page.locator(".stock-watch-list")).toContainText("Phone Restock");
  expect(await noSideScroll(page)).toBe(true);
  await page.locator(".stock-watch-list").getByRole("button", { name: /ยกเลิก/ }).click();
  await expect(page.locator(".stock-watch-list")).toContainText("ยังไม่มีสินค้าที่รอแจ้งเตือน");
  await page.goto(base + "/reviews");
  await expect(page.locator("#review-" + replyReviewId)).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);

  await as(page.context(), adminToken);
  await page.goto(base + "/admin/reviews");
  await expect(page.getByTestId("admin-review").first()).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.locator(`[data-review-id="${replyReviewId}"]`).getByRole("button", { name: "ซ่อนรีวิว" }).click();
  await expect(page.locator(".review-hide-form")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.goto(base + "/admin/products");
  await expect(page.locator(".variant-stock-summary").first()).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
});
