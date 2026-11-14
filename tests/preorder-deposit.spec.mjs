// Preorder modes end to end (server/preorder.mjs, src/Preorder.tsx, src/AdminPreorder.tsx):
// 1) deposit: admin sets the mode in the product editor → customer reserves with a deposit →
//    stock import calls the queue → customer pays the balance → credentials shown.
// 2) free: two customers reserve for free → stock calls the first → the first lets the
//    deadline pass (time moved in the DB) → the next customer is called, pays, receives.
import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, admin, adminToken;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  admin = service.session(adminToken);
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(context, token) {
  await context.clearCookies();
  await context.addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}
function customer(name) {
  const auth = service.register({
    name,
    email: name.toLowerCase().replace(/\W+/g, "-") + "@example.invalid",
    password: "Preorder-e2e-Pass-" + randomBytes(3).toString("hex"),
  });
  const user = service.session(auth.token);
  service.adjustCustomerCredit(admin, user.id, { amount: 50000, reason: "ทดสอบพรีออเดอร์", requestKey: randomUUID() });
  return { token: auth.token, user };
}
function preorderProduct(name, price) {
  const product = service.saveProduct(admin, {
    name,
    description: "สินค้าพรีออเดอร์สำหรับทดสอบ",
    category: "streaming",
    price,
    active: true,
    preorder: true,
    firstLabel: "1 เดือน",
  });
  return { id: product.id, variantId: service.adminProductVariants(admin, product.id).variants[0].id };
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("deposit: admin sets the mode → reserve with deposit → import calls → pay balance → credentials", async ({ page }) => {
  const product = preorderProduct("Deposit Max", 10000);
  // Admin: product editor › วิธีจอง.
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/products/" + product.id);
  const card = page.locator(".preorder-mode-card");
  await expect(card.getByRole("heading", { name: "วิธีจอง" })).toBeVisible();
  await card.getByText("มัดจำ", { exact: true }).click();
  await card.getByLabel("มัดจำกี่เปอร์เซ็นต์").fill("30");
  await card.getByLabel("เวลาชำระหลังเรียกคิว (ชั่วโมง)").fill("24");
  await card.getByLabel("คืนมัดจำเป็นเครดิตร้าน").check();
  await expect(card.locator(".preorder-mode-summary")).toContainText("มัดจำ 30% ของราคา");
  await card.getByRole("button", { name: "บันทึกวิธีจอง" }).click();
  await expect(page.getByText("บันทึกวิธีจองแล้ว")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Customer: product page shows the deposit button and the rules.
  const buyer = customer("Deposit Buyer");
  await as(page.context(), buyer.token);
  await page.goto(base + "/products/" + product.id);
  const reserve = page.getByRole("button", { name: "จองคิว · มัดจำ ฿30.00" });
  await expect(reserve).toBeEnabled();
  const rules = page.locator(".preorder-rules");
  await expect(rules).toContainText("มัดจำ ฿30.00 ตอนจอง");
  await expect(rules).toContainText("ชำระส่วนที่เหลือ ฿70.00 ภายใน 24 ชั่วโมง");
  await expect(rules).toContainText("คืนมัดจำเป็นเครดิตร้าน");
  await reserve.click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.locator(".preorder-summary-row").first()).toContainText("฿30.00");
  await expect(page.locator(".cart-bar")).toContainText("฿30.00");
  await page.locator(".cart-bar").getByRole("button", { name: /ชำระเงิน/ }).click();
  await expect(page).toHaveURL(/\/orders\/[^/]+$/);
  const orderId = page.url().split("/").pop();
  const progress = page.locator(".preorder-progress");
  await expect(progress).toContainText("จ่ายมัดจำแล้ว ฿30.00");
  await expect(progress).toContainText("รอของเข้า");
  await expect(progress.getByRole("button", { name: "ยกเลิกการจอง" })).toBeVisible();

  // Admin imports stock: the queue is called and one unit held for this customer.
  service.importCodes(admin, { variantId: product.variantId, items: [{ loginId: "deposit-e2e@x.test", password: "Dep0sit-pw" }] });
  await page.goto(base + "/orders/" + orderId);
  await expect(page.getByRole("heading", { name: "ของพร้อมแล้ว ชำระส่วนที่เหลือ" })).toBeVisible();
  await expect(progress.locator(".preorder-countdown")).toContainText("เหลือเวลา");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
  // Dark theme renders the same steps.
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect(progress.locator(".preorder-steps li.is-current")).toBeVisible();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await progress.getByRole("button", { name: "ชำระส่วนที่เหลือ ฿70.00" }).click();
  await expect(page.locator(".delivered-codes")).toBeVisible();
  await expect(page.locator(".delivered-codes")).toContainText("deposit-e2e@x.test");
  await expect(page.locator(".preorder-steps li.is-done")).toHaveCount(3);

  // Admin queue shows the finished row; finance shows nothing left as มัดจำค้าง.
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/preorders");
  await page.getByRole("button", { name: /จบแล้ว 30 วัน/ }).click();
  const row = page.locator("tbody tr").filter({ hasText: "Deposit Buyer" });
  await expect(row).toContainText("มัดจำ");
  await expect(row).toContainText("ส่งแล้ว");
  await expect(row).toContainText("฿30.00");
  await page.goto(base + "/admin/payments");
  await expect(page.locator(".deposits-held-card")).toContainText("฿0.00");
});

test("free: reserve without paying → first lets the deadline pass → next is called and paid", async ({ page }) => {
  const product = preorderProduct("Free Queue Plus", 10000);
  service.adminSavePreorderSettings(admin, product.id, { mode: "free", payWindowHours: 6 });
  const first = customer("Free First");
  const second = customer("Free Second");

  // First customer reserves through the UI: no payment, queue number straight away.
  await as(page.context(), first.token);
  await page.goto(base + "/products/" + product.id);
  await expect(page.locator(".preorder-rules")).toContainText("จองฟรี ไม่ต้องจ่ายตอนนี้");
  await page.getByRole("button", { name: "จองคิวฟรี" }).click();
  await expect(page.locator(".cart-bar")).toContainText("฿0.00");
  await page.locator(".cart-bar").getByRole("button", { name: /ชำระเงิน/ }).click();
  await expect(page).toHaveURL(/\/orders\/[^/]+$/);
  const firstId = page.url().split("/").pop();
  const progress = page.locator(".preorder-progress");
  await expect(progress).toContainText("ไม่ได้จ่ายเงินตอนจอง");
  await expect(progress).toContainText("คุณอยู่คิวแรก");

  const secondOrder = service.createOrder(second.user, { variantId: product.variantId, quantity: 1, requestKey: randomUUID() });
  expect(secondOrder.status).toBe("PREORDER");
  service.importCodes(admin, { variantId: product.variantId, items: [{ loginId: "free-e2e@x.test", password: "Fr33-pw" }] });
  await page.reload();
  await expect(page.getByRole("heading", { name: "ของพร้อมแล้ว ชำระเพื่อรับสินค้า" })).toBeVisible();

  // The first customer's window ends (moved in the DB); the next read runs the sweep.
  service.db
    .prepare("UPDATE reservations SET pay_by=datetime('now','-1 minute') WHERE id=?")
    .run(firstId);
  service.db.prepare("DELETE FROM runtime_flags WHERE key='pending-expiry-sweep'").run();
  await page.reload();
  await expect(page.getByRole("heading", { name: "หมดเวลาชำระส่วนที่เหลือ" })).toBeVisible();
  await expect(page.locator(".preorder-ended")).toContainText("สิทธิ์ส่งต่อให้คิวถัดไปแล้ว");

  // Second customer: bell + order page say it is their turn; pay the full price.
  await as(page.context(), second.token);
  await page.goto(base + "/orders/" + secondOrder.id);
  await expect(page.getByRole("heading", { name: "ของพร้อมแล้ว ชำระเพื่อรับสินค้า" })).toBeVisible();
  await page.locator(".notice-button").first().click();
  await expect(page.locator(".notice-panel")).toContainText("ของพร้อมแล้ว ชำระเพื่อรับสินค้า");
  await page.locator(".notice-button").first().click();
  await page.getByRole("button", { name: "ชำระ ฿100.00 เพื่อรับสินค้า" }).click();
  await expect(page.locator(".delivered-codes")).toBeVisible();
  await expect(page.locator(".delivered-codes")).toContainText("free-e2e@x.test");

  // Admin queue: the lapsed one shows as หมดเวลา; 390px without side scroll.
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/preorders");
  await page.getByRole("button", { name: /จบแล้ว 30 วัน/ }).click();
  await expect(page.locator("tbody tr").filter({ hasText: "Free First" })).toContainText("หมดเวลา");
  await expect(page.locator("tbody tr").filter({ hasText: "Free Second" })).toContainText("ส่งแล้ว");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
});
