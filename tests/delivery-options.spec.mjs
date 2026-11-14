// Delivery types + option groups end to end: the admin sets a product to "บัญชีแชร์", imports a
// shared account with profiles + PINs, splits the options into 3 groups and opens some combos;
// the customer picks options (struck-through combos, price updates, list click), buys and sees
// the seat + PIN. A shop-fulfilled product: the customer fills the field at checkout, the admin
// delivers from ออเดอร์ › รอส่งมอบ, the customer sees it. 390px light / dark, no side scroll.
import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, admin, adminToken, buyerToken, seatProduct, manualProduct;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  seatProduct = service.saveProduct(admin, {
    name: "Family Stream",
    description: "บัญชีแชร์หลายจอ",
    category: "streaming",
    price: 9900,
    active: true,
    firstLabel: "7 วัน",
    firstWarrantyDays: 7,
  }).id;
  manualProduct = service.saveProduct(admin, {
    name: "Gmail Invite Pro",
    description: "ร้านเชิญเข้าแพ็กเกจ",
    category: "streaming",
    price: 15000,
    active: true,
    firstLabel: "1 เดือน",
  }).id;
  service.adminSetDelivery(admin, manualProduct, {
    type: "manual",
    fields: [{ label: "อีเมล Gmail ที่จะให้เชิญ", type: "email", required: true }],
  });
  const auth = service.register({ name: "Options Buyer", email: "ob@example.invalid", password: "Options-buyer-Pass-123" });
  buyerToken = auth.token;
  const buyer = service.session(buyerToken);
  service.adjustCustomerCredit(admin, buyer.id, { amount: 100000, reason: "ทดสอบ", requestKey: randomUUID() });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

const as = (page, token) =>
  page.context().addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
// Screenshots for a visual check land in test-results/ (git-ignored).
const shot = (page, name) => page.screenshot({ path: "test-results/delivery-options/" + name + ".png", fullPage: true });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("admin: shared seats + 3 option groups from the product editor", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/products/" + seatProduct);
  const card = page.locator(".delivery-type-card");
  await expect(card).toBeVisible();
  await card.locator(".delivery-type-option", { hasText: "บัญชีแชร์" }).click();
  await card.getByRole("button", { name: "บันทึกวิธีส่งมอบ" }).click();
  await expect(page.getByText("บันทึกวิธีส่งมอบแล้ว")).toBeVisible();
  expect(service.adminDelivery(admin, seatProduct).type).toBe("shared");

  // Import one shared account with 2 profiles + PINs.
  await page.getByRole("button", { name: /^สต็อก 0/ }).click();
  await page.getByLabel("เติมสต็อก 7 วัน").fill("family@x.test,Secret-1,จอ1:1111|จอ2:2222");
  await page.getByRole("button", { name: /ตรวจ 1 รายการ/ }).click();
  await expect(page.locator(".stock-import-table")).toContainText("2");
  await page.getByRole("button", { name: "เพิ่ม 1 บัญชี" }).click();
  await expect(page.getByText(/นำเข้า 1 บัญชีสำเร็จ \(2 ที่นั่ง\)/)).toBeVisible();
  // Seat chip opens the seat editor.
  await page.locator(".stock-seat-chip").first().click();
  await expect(page.locator(".seat-panel")).toContainText("ขายแล้ว 0/2");
  await page.getByRole("button", { name: "ปิดรายการที่นั่ง" }).click();
  await page.getByRole("button", { name: /^สต็อก 2/ }).click();

  // Split into groups: ระยะเวลา (existing) + แพ็กเกจ + ประเภท.
  await page.getByRole("button", { name: "แบ่งเป็นกลุ่มตัวเลือก" }).click();
  await page.getByRole("button", { name: "แก้กลุ่ม" }).click();
  await page.getByLabel("ชื่อกลุ่มที่ 1").fill("ระยะเวลา");
  const addValue = async (group, value) => {
    const input = page.getByLabel("เพิ่มค่าใน " + group);
    await input.fill(value);
    await input.press("Enter");
  };
  await addValue("ระยะเวลา", "30 วัน");
  await page.getByRole("button", { name: "เพิ่มกลุ่ม" }).click();
  await page.getByLabel("ชื่อกลุ่มที่ 2").fill("แพ็กเกจ");
  await addValue("แพ็กเกจ", "Basic");
  await addValue("แพ็กเกจ", "Premium");
  await page.getByRole("button", { name: "เพิ่มกลุ่ม" }).click();
  await page.getByLabel("ชื่อกลุ่มที่ 3").fill("ประเภท");
  await addValue("ประเภท", "ส่วนตัว");
  await addValue("ประเภท", "แชร์");
  await expect(page.locator(".option-editor-actions small")).toHaveText("8 แบบ");
  await page.getByRole("button", { name: "บันทึกกลุ่ม" }).click();
  await expect(page.getByText(/เพิ่ม 7 แบบ/)).toBeVisible();
  await expect(page.locator(".option-grid tbody tr")).toHaveCount(8);

  // Bulk: every "30 วัน" row → ฿299 and on sale.
  await page.getByLabel("แถวที่จะแก้").selectOption({ label: "30 วัน" });
  await page.getByLabel("ราคา (บาท)", { exact: true }).fill("299");
  await page.getByRole("button", { name: "ใช้กับ 4 แถว" }).click();
  await expect(page.getByText("แก้แล้ว 4 แถว")).toBeVisible();
  await page.getByLabel("ช่องที่จะแก้").selectOption("on");
  await page.getByRole("button", { name: "ใช้กับ 4 แถว" }).click();
  await expect(page.locator(".option-grid tr.is-off")).toHaveCount(3);
  await shot(page, "admin-grid");
  // Admin page usable at 390px (the grid scrolls inside its card).
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
});

test("customer: struck-through combos, price updates, list click, buy → seat + PIN", async ({ page }) => {
  await as(page, buyerToken);
  await page.goto(base + "/products/" + seatProduct);
  const picker = page.locator(".option-picker");
  await expect(picker).toBeVisible();
  // Default = the one combo with stock: 7 วัน / Basic / ส่วนตัว at ฿99.
  await expect(page.locator(".reference-price .price-now")).toHaveText("฿99.00");
  await expect(picker.getByRole("button", { name: "Premium" })).toBeDisabled();
  await expect(picker.getByRole("button", { name: "แชร์" })).toBeDisabled();
  const struck = await picker.getByRole("button", { name: "Premium" }).evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(struck).toContain("line-through");
  // 30 วัน: price follows, out of stock → notify instead of buy; Premium opens up.
  await picker.getByRole("button", { name: /^30 วัน/ }).click();
  await expect(page.locator(".reference-price .price-now")).toHaveText("฿299.00");
  await expect(page.getByRole("button", { name: /แจ้งเตือนเมื่อมีของ/ })).toBeVisible();
  await expect(picker.getByRole("button", { name: /Premium/ })).toBeEnabled();
  // Clear → pick again from the price list (cheapest first).
  await page.getByRole("button", { name: "ล้าง" }).click();
  await expect(page.locator(".option-need")).toBeVisible();
  await expect(page.locator(".reference-price .price-now")).toHaveText("เริ่มต้น ฿99.00");
  const rows = page.locator(".all-options-row");
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText("7 วัน / Basic / ส่วนตัว");
  await rows.first().click();
  await expect(page.locator(".reference-price .price-now")).toHaveText("฿99.00");
  await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
  // 390px, light + dark: no side scroll, chips are real tap targets.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    expect(await noSideScroll(page), theme).toBe(true);
    const small = await page
      .locator(".option-chip, .all-options-row, .option-clear")
      .evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height < 44).length);
    expect(small, theme).toBe(0);
    await shot(page, "product-390-" + theme);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));

  await page.getByRole("button", { name: "ซื้อเลย" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.locator(".cart-line")).toContainText("7 วัน / Basic / ส่วนตัว");
  await page.locator(".cart-bar").getByRole("button", { name: /ชำระเงิน/ }).click();
  await expect(page.getByRole("heading", { name: "สั่งซื้อสำเร็จ พร้อมรับสินค้า" })).toBeVisible();
  const reveal = page.getByRole("button", { name: "แสดงโค้ด" });
  if (await reveal.isVisible()) await reveal.click();
  const pair = page.locator(".credential-pair").first();
  await expect(pair.locator(".seat-label")).toHaveText("ที่นั่ง 1");
  await expect(pair).toContainText("จอ1");
  await expect(pair).toContainText("1111");
  await expect(pair).toContainText("family@x.test");
  await shot(page, "order-seat");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    expect(await noSideScroll(page), theme).toBe(true);
  }
  // One seat left on the account.
  const v = service.adminProductVariants(admin, seatProduct).variants.find((x) => x.label === "7 วัน / Basic / ส่วนตัว");
  expect(v.stock).toBe(1);
});

test("shop-fulfilled: customer fills the field, admin delivers, customer sees it", async ({ browser }) => {
  const customer = await browser.newPage();
  await as(customer, buyerToken);
  await customer.goto(base + "/products/" + manualProduct);
  await expect(customer.locator(".reference-delivery-note")).toContainText("ร้านทำรายการให้หลังชำระ");
  await customer.getByRole("button", { name: "ซื้อเลย" }).click();
  const save = customer.locator(".cart-bar").getByRole("button", { name: /ชำระเงิน/ });
  await expect(save).toBeDisabled();
  await customer.getByLabel("อีเมล Gmail ที่จะให้เชิญ").fill("me@gmail");
  await expect(save).toBeDisabled();
  await customer.getByLabel("อีเมล Gmail ที่จะให้เชิญ").fill("me@gmail.com");
  await save.click();
  await expect(customer.getByRole("heading", { name: "ชำระแล้ว รอร้านส่งมอบ" })).toBeVisible();
  await expect(customer.locator(".fulfilment-card")).toContainText("รอร้านส่งมอบ");
  await expect(customer.locator(".fulfilment-card")).toContainText("me@gmail.com");
  const orderUrl = customer.url();

  const staff = await browser.newPage();
  await as(staff, adminToken);
  await staff.goto(base + "/admin/fulfilment");
  const item = staff.locator(".fulfil-item").first();
  await expect(item).toContainText("Gmail Invite Pro");
  await expect(item).toContainText("me@gmail.com");
  await item.getByRole("button", { name: "ส่งมอบ" }).click();
  await item.getByLabel("ข้อความถึงลูกค้า").fill("เชิญแล้ว เช็กกล่องจดหมาย");
  await item.getByRole("button", { name: "ส่งแล้ว" }).click();
  await expect(staff.getByText("ส่งมอบแล้ว ลูกค้าได้แจ้งเตือน")).toBeVisible();
  await expect(staff.locator(".fulfil-item")).toHaveCount(0);

  await customer.goto(orderUrl.replace("/checkout/", "/orders/"));
  await expect(customer.locator(".fulfilment-card")).toContainText("ร้านส่งมอบแล้ว");
  await expect(customer.locator(".fulfilment-message")).toContainText("เชิญแล้ว เช็กกล่องจดหมาย");
  await shot(customer, "order-fulfilled");
  await customer.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"]) {
    await customer.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    expect(await noSideScroll(customer), theme).toBe(true);
  }
  await customer.close();
  await staff.close();
});
