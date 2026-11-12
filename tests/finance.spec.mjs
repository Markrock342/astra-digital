// Finance hardening in the browser: test-money banner, refund from order detail,
// credit adjustment from customer detail, transaction detail sheet, CSV row count.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, buyer, adminToken, paidOrder;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  const auth = service.register({
    name: "Finance Buyer",
    email: "finance-buyer@example.invalid",
    password: "Finance-buyer-Password-123",
  });
  buyer = service.session(auth.token);
  const order = service.createOrder(buyer, { variantId: "stream-plus-30", quantity: 1, requestKey: "finance-e2e-0001" });
  paidOrder = service.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function asAdmin(page) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "astra_session", value: adminToken, url: base, httpOnly: true, sameSite: "Lax" },
  ]);
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("test-money banner shows on dashboard, finance and reports in sandbox mode", async ({ page }) => {
  await asAdmin(page);
  for (const path of ["/admin", "/admin/payments", "/admin/reports"]) {
    await page.goto(base + path);
    await expect(page.locator(".test-money-banner")).toContainText("โหมดทดสอบ: ตัวเลขนี้ไม่ใช่เงินจริง");
  }
  await page.goto(base + "/admin");
  await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
  const metrics = page.locator(".reference-admin-metrics");
  await expect(metrics).toContainText("คืนเงิน");
  await expect(metrics).toContainText("อัตราชำระสำเร็จ");
  await expect(metrics).toContainText("ยอดเฉลี่ยต่อออเดอร์");
});

test("admin refunds part of a paid order into store credit with a confirm step", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/orders/" + paidOrder.id);
  const money = page.locator(".order-money");
  await expect(money).toContainText("ชำระแล้ว");
  await expect(money).toContainText("฿100.00");
  await money.getByRole("button", { name: "คืนเงิน" }).click();
  await money.getByLabel("ยอดคืน (บาท)").fill("40");
  await money.getByRole("button", { name: "ตรวจสอบการคืนเงิน" }).click();
  await expect(page.getByRole("alert")).toContainText("กรุณาเลือกเหตุผล");
  await money.getByLabel("เหตุผลการคืนเงิน").selectOption("ACCOUNT_BROKEN");
  await money.getByRole("button", { name: "ตรวจสอบการคืนเงิน" }).click();
  await money.getByRole("button", { name: "ยืนยันคืนเงิน ฿40.00" }).click();
  await expect(page.getByText("คืนเงิน ฿40.00 เข้าเครดิตลูกค้าแล้ว")).toBeVisible();
  await expect(page.locator(".reference-admin-heading")).toContainText("คืนเงินบางส่วน");
  await expect(money).toContainText("−฿40.00");
  await expect(money).toContainText("คืนได้อีก ฿60.00");
  expect(service.orderDetail(buyer, paidOrder.id).refundStatus).toBe("PARTIALLY_REFUNDED");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
});

test("admin adjusts customer credit; history shows type and running balance", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/customers/" + buyer.id);
  const before = service.publicUser(buyer).balance;
  await page.getByRole("button", { name: "ปรับยอดเครดิต" }).click();
  await page.getByRole("button", { name: "หักเครดิต" }).click();
  await page.getByLabel("ยอด (บาท)").fill("25");
  await page.getByLabel("เหตุผล (บันทึกภายใน)").fill("แก้ยอดเติมซ้ำ");
  await page.getByRole("button", { name: "ตรวจสอบ", exact: true }).click();
  await page.getByRole("button", { name: "ยืนยันหักเครดิต ฿25.00" }).click();
  await expect(page.getByText(/หักเครดิต ฿25.00 แล้ว/)).toBeVisible();
  expect(service.publicUser(buyer).balance).toBe(before - 2500);
  const history = page.locator(".credit-history");
  await expect(history).toContainText("ปรับยอด");
  await expect(history).toContainText("คืนเงิน");
  await expect(history).toContainText("ซื้อ");
  await expect(history.locator("tbody tr").first()).toContainText((before - 2500) / 100 + ".00");
});

test("finance rows open a detail sheet; CSV button shows the row count", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/payments");
  await expect(page.getByRole("link", { name: /ดาวน์โหลด CSV \(\d+ แถว\)/ })).toBeVisible();
  await expect(page.locator(".liability-card")).toContainText("เครดิตลูกค้าคงค้าง");
  const refundRow = page.locator(".admin-list-table tbody tr", { hasText: "คืนเงิน" }).first();
  await expect(refundRow).toContainText("−฿40.00");
  await page.locator(".admin-list-table tbody tr", { hasText: "รับชำระ" }).first().locator("td").first().click();
  const sheet = page.getByRole("dialog", { name: "รายละเอียดรายการเงิน" });
  await expect(sheet).toContainText("รับชำระ");
  await expect(sheet).toContainText("Finance Buyer");
  await expect(sheet).toContainText("เงินทดสอบ");
  await expect(sheet).toContainText("ไทม์ไลน์");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await page.getByLabel("ลูกค้า", { exact: true }).fill("nobody-here");
  await expect(page.locator(".reference-empty-text")).toContainText("ไม่พบรายการตามตัวกรอง");
  await page.getByLabel("ลูกค้า", { exact: true }).fill("");
  await page.getByLabel("ยอดต่ำสุด (บาท)").fill("50");
  await expect(page.locator(".admin-list-table tbody")).not.toContainText("−฿40.00");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
});

test("customer sees the refund on the order and in the wallet", async ({ page }) => {
  const auth = service.login({ email: "finance-buyer@example.invalid", password: "Finance-buyer-Password-123" });
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "astra_session", value: auth.token, url: base, httpOnly: true, sameSite: "Lax" },
  ]);
  await page.goto(base + "/orders/" + paidOrder.id);
  await expect(page.locator(".refund-note")).toContainText("฿40.00");
  await page.goto(base + "/wallet");
  await expect(page.locator(".wallet-history")).toContainText("คืนเงิน");
  await expect(page.locator(".wallet-history")).toContainText("คงเหลือ");
});
