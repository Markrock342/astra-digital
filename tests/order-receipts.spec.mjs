// ใบเสร็จคำสั่งซื้อ: account profiles, request → approve → print, 390px layout.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, buyerToken, orderId, variantId;
const adminPassword = randomBytes(24).toString("hex");
const BUYER = {
  type: "PERSON",
  name: "ลูกค้าใบเสร็จ",
  taxId: "1234567890121",
  address: "10 หมู่ 2 ต.บางพลี อ.บางพลี สมุทรปราการ 10540",
};

const shots = process.env.RECEIPT_SHOTS;
test.describe.configure({ mode: "serial" });
test.setTimeout(90000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const product = service.saveProduct(admin, {
    name: "Receipt UI Stream",
    description: "ทดสอบใบเสร็จคำสั่งซื้อ",
    category: "streaming",
    price: 5900,
    active: true,
  });
  variantId = service.adminProductVariants(admin, product.id).variants[0].id;
  service.importCodes(admin, {
    variantId,
    items: [
      { loginId: "rcp-ui-1@t.test", password: "Pw1" },
      { loginId: "rcp-ui-2@t.test", password: "Pw2" },
    ],
  });
  const auth = service.register({
    name: "Receipt UI Buyer",
    email: "receipt-ui@example.invalid",
    password: "Receipt-ui-Pass-123",
  });
  buyerToken = auth.token;
  const buyer = service.session(buyerToken);
  const order = service.createOrder(buyer, { variantId, quantity: 1, requestKey: "receipt-ui-order-1" });
  service.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  orderId = order.id;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(context, token) {
  await context.clearCookies();
  await context.addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("account profiles + request → admin approve → print receipt (desktop)", async ({ page }) => {
  await as(page.context(), buyerToken);
  await page.goto(base + "/account");
  await expect(page.getByRole("heading", { name: "ข้อมูลใบเสร็จคำสั่งซื้อ" })).toBeVisible();
  await page.getByRole("button", { name: "เพิ่มข้อมูลใบเสร็จ" }).click();
  await page.getByPlaceholder("เช่น บ้าน / ที่ทำงาน").fill("บ้าน");
  await page.getByRole("radio", { name: "บุคคลธรรมดา" }).check();
  await page.getByLabel("ชื่อ-นามสกุล").fill(BUYER.name);
  await page.getByLabel("เลขประจำตัวผู้เสียภาษี (13 หลัก)").fill(BUYER.taxId);
  await page.getByLabel("ที่อยู่").fill(BUYER.address);
  await page.getByRole("button", { name: "บันทึกโปรไฟล์" }).click();
  await expect(page.getByText("บ้าน")).toBeVisible();

  await page.goto(base + "/orders/" + orderId);
  await expect(page.getByRole("heading", { name: "ใบเสร็จคำสั่งซื้อ" })).toBeVisible();
  await page.getByRole("button", { name: "ส่งคำขอ" }).click();
  await expect(page.getByText("รอทีมงานอนุมัติ")).toBeVisible();
  await expect(page.getByRole("link", { name: "ใบเสร็จ", exact: true })).toHaveCount(0);

  await as(page.context(), adminToken);
  await page.goto(base + "/admin/order-receipts");
  await expect(page.getByRole("heading", { name: "ใบเสร็จคำสั่งซื้อ" })).toBeVisible();
  const row = page.locator("tr", { hasText: orderId.slice(0, 8).toUpperCase() });
  await expect(row).toBeVisible();
  await expect(page.getByRole("tab", { name: /รออนุมัติ/ })).toContainText("1");
  if (shots) await page.screenshot({ path: shots + "/admin-queue.png", fullPage: true, animations: "disabled" });
  await row.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  await expect(page.getByText("อนุมัติใบเสร็จแล้ว ลูกค้าดาวน์โหลดได้")).toBeVisible();
  await expect(page.getByText("ไม่มีคำขอที่รออนุมัติ")).toBeVisible();

  await as(page.context(), buyerToken);
  await page.goto(base + "/orders/" + orderId);
  await page.getByRole("link", { name: "ดู / พิมพ์ใบเสร็จ" }).click();
  await expect(page).toHaveURL(base + "/orders/" + orderId + "/receipt");
  await expect(page.getByRole("heading", { name: "ใบเสร็จคำสั่งซื้อ" })).toBeVisible();
  await expect(page.locator(".receipt-paper")).toContainText("ชำระทดลอง");
  await expect(page.locator(".receipt-paper")).toContainText(BUYER.name);
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => {
      window.__printed += 1;
    };
  });
  await page.getByRole("button", { name: "ดาวน์โหลด PDF / พิมพ์" }).click();
  expect(await page.evaluate(() => window.__printed)).toBe(1);
});

test("390px: account profiles, order card, receipt page, admin queue fit without sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await as(page.context(), buyerToken);
  await page.goto(base + "/account");
  await expect(page.getByRole("heading", { name: "ข้อมูลใบเสร็จคำสั่งซื้อ" })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.goto(base + "/orders/" + orderId);
  await expect(page.getByRole("heading", { name: "ใบเสร็จคำสั่งซื้อ" })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.goto(base + "/orders/" + orderId + "/receipt");
  await expect(page.getByRole("heading", { name: "ใบเสร็จคำสั่งซื้อ" })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);

  await as(page.context(), adminToken);
  await page.goto(base + "/admin/order-receipts");
  await expect(page.getByRole("heading", { name: "ใบเสร็จคำสั่งซื้อ" })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.getByRole("tab", { name: /อนุมัติแล้ว/ }).click();
  await expect(page.locator("tr", { hasText: orderId.slice(0, 8).toUpperCase() })).toBeVisible();
  if (shots) await page.screenshot({ path: shots + "/admin-approved-390.png", fullPage: true, animations: "disabled" });
});
