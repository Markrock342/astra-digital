// Back office "สร้างออเดอร์ให้ลูกค้า" (customer paid outside the site): the admin creates
// the order with a lower price + reason and the password, the order shows the marker,
// and the customer sees the delivered account. Desktop and 390px (no side scroll).
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, admin, adminToken, buyerToken, buyer, productId, variantId;
const adminPassword = randomBytes(24).toString("hex");
const buyerLogin = { email: "offsite-buyer@example.invalid", password: "Offsite-buyer-Password-123" };

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  buyer = service.session(service.register({ name: "Offsite Buyer", ...buyerLogin }).token);
  buyerToken = service.login(buyerLogin).token;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  admin = service.session(adminToken);
  const product = service.saveProduct(admin, {
    name: "Offsite Stream",
    description: "บัญชีสตรีมมิ่งสำหรับทดสอบออเดอร์หลังบ้าน",
    category: "streaming",
    price: 15000,
    active: true,
  });
  productId = product.id;
  variantId = service.adminProductVariants(admin, productId).variants[0].id;
  service.importCodes(admin, {
    variantId,
    items: [
      { loginId: "offsite-one@stream.test", password: "Pw-OFF-111" },
      { loginId: "offsite-two@stream.test", password: "Pw-OFF-222" },
    ],
  });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(page, token) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function createOrder(page, { price, reason, reference }) {
  await page.getByLabel("ค้นหาลูกค้า").fill("Offsite");
  await page.getByRole("list", { name: "ผลการค้นหาลูกค้า" }).getByRole("button", { name: /Offsite Buyer/ }).click();
  await expect(page.locator(".manual-order-picked")).toContainText("Offsite Buyer");
  await page.getByLabel("สินค้า", { exact: true }).selectOption(productId);
  await expect(page.getByLabel("ตัวเลือก")).toHaveValue(variantId);
  const summary = page.getByRole("complementary", { name: "สรุปออเดอร์" });
  await expect(summary).toContainText("฿150.00");
  if (price) {
    await page.getByLabel("ราคาต่อชิ้น (บาท)").fill(price);
    await page.getByLabel("เลขอ้างอิงการโอน").fill(reference);
    await summary.getByRole("button", { name: "ตรวจสอบก่อนสร้าง" }).click();
    await expect(summary.getByRole("alert")).toContainText("กรุณาใส่เหตุผล");
    await page.getByLabel("เหตุผลที่เปลี่ยนราคา (บันทึกภายใน)").fill(reason);
  } else {
    await page.getByLabel("เลขอ้างอิงการโอน").fill(reference);
  }
  await expect(summary).toContainText("ยอดที่ลูกค้าโอน");
  await summary.getByRole("button", { name: "ตรวจสอบก่อนสร้าง" }).click();
  const confirm = summary.getByRole("group", { name: "ยืนยันสร้างออเดอร์" });
  await expect(confirm).toContainText("Offsite Buyer");
  await confirm.getByLabel("รหัสผ่านของคุณ").fill("wrong-password-123");
  await confirm.getByRole("button", { name: /ยืนยันสร้างออเดอร์/ }).click();
  await expect(summary.getByRole("alert")).toContainText("รหัสผ่านไม่ถูกต้อง");
  await confirm.getByLabel("รหัสผ่านของคุณ").fill(adminPassword);
  await confirm.getByRole("button", { name: /ยืนยันสร้างออเดอร์/ }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop();
}

test("admin creates an order for an off-site transfer (desktop), customer sees the account", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/orders");
  await page.getByRole("link", { name: "สร้างออเดอร์" }).click();
  await expect(page.getByRole("heading", { name: "สร้างออเดอร์ให้ลูกค้า" })).toBeVisible();
  const before = service.publicUser(buyer).balance;
  const id = await createOrder(page, { price: "120", reason: "ลูกค้าประจำ ตกลงราคาทาง LINE", reference: "KBANK 13/11 10:42" });
  await expect(page.getByText(/สร้างออเดอร์และส่งของให้ลูกค้าแล้ว/)).toBeVisible();
  await expect(page.locator(".reference-admin-heading")).toContainText("สร้างโดยแอดมิน · โอนนอกเว็บ");
  const card = page.locator(".manual-order-card");
  await expect(card).toContainText("KBANK 13/11 10:42");
  await expect(card).toContainText("ลูกค้าประจำ ตกลงราคาทาง LINE");
  await expect(card).toContainText("ราคาปกติ ฿150.00");
  await expect(page.locator(".order-money")).toContainText("฿120.00");
  // Orders list shows the marker; the customer's credit is untouched.
  await page.goto(base + "/admin/orders");
  await expect(page.locator(".admin-list-table tbody tr", { hasText: "Offsite Buyer" }).first()).toContainText("สร้างโดยแอดมิน");
  expect(service.publicUser(buyer).balance).toBe(before);

  await as(page, buyerToken);
  await page.goto(base + "/orders/" + id);
  await expect(page.getByRole("heading", { name: "สั่งซื้อสำเร็จ พร้อมรับสินค้า" })).toBeVisible();
  await expect(page.locator(".manual-order-note")).toContainText("ชำระแบบโอนนอกเว็บ");
  await page.getByRole("button", { name: "แสดงโค้ด" }).click();
  await expect(page.locator(".delivered-codes")).toContainText("offsite-one@stream.test");
  await expect(page.locator(".delivered-codes")).toContainText("Pw-OFF-111");
  await page.goto(base + "/orders");
  await expect(page.locator(".history-card", { hasText: "Offsite Stream" }).first()).toContainText("฿120.00");
  await page.goto(base + "/orders/" + id + "/receipt");
  await expect(page.locator(".receipt-paper")).toContainText("โอนนอกเว็บ");
  await expect(page.locator(".receipt-paper")).toContainText("฿120.00");
});

test("same flow at 390px: no side scroll on the form, the order or the customer page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await as(page, adminToken);
  await page.goto(base + "/admin/orders/new");
  await expect(page.getByRole("heading", { name: "สร้างออเดอร์ให้ลูกค้า" })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  const id = await createOrder(page, { reference: "SCB slip 0099" });
  await expect(page.locator(".manual-order-card")).toContainText("SCB slip 0099");
  expect(await noSideScroll(page)).toBe(true);
  await page.goto(base + "/admin/orders");
  expect(await noSideScroll(page)).toBe(true);

  await as(page, buyerToken);
  await page.goto(base + "/orders/" + id);
  await expect(page.locator(".manual-order-note")).toBeVisible();
  await page.getByRole("button", { name: "แสดงโค้ด" }).click();
  await expect(page.locator(".delivered-codes")).toContainText("offsite-two@stream.test");
  expect(await noSideScroll(page)).toBe(true);
  await page.goto(base + "/orders");
  expect(await noSideScroll(page)).toBe(true);
});

test("out of stock is refused before the password step", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/orders/new");
  await page.getByLabel("ค้นหาลูกค้า").fill("Offsite");
  await page.getByRole("list", { name: "ผลการค้นหาลูกค้า" }).getByRole("button", { name: /Offsite Buyer/ }).click();
  await page.getByLabel("สินค้า", { exact: true }).selectOption(productId);
  const summary = page.getByRole("complementary", { name: "สรุปออเดอร์" });
  await expect(summary).toContainText("สินค้าคงเหลือไม่พอ");
  await page.getByLabel("เลขอ้างอิงการโอน").fill("TMB 777");
  await summary.getByRole("button", { name: "ตรวจสอบก่อนสร้าง" }).click();
  await expect(summary.getByRole("alert")).toContainText("สินค้าคงเหลือไม่พอ");
  await expect(summary.getByRole("group", { name: "ยืนยันสร้างออเดอร์" })).toHaveCount(0);
});
