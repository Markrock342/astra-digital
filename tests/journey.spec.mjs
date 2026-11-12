// End-to-end shop journey through the real UI:
// admin lists a product → stocks ID+password → customer buys, pays, receives, reviews →
// sold out → admin restocks (storefront updates live) → failed payment / sold out at pay →
// preorder queue delivered by a team member → live chat with assignment → sales report.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, buyer, buyerToken, productId, firstOrderId, staffLogin;
const adminPassword = randomBytes(24).toString("hex");
const accounts = [
  ["journey-a@stream.test", "Pw-A-111"],
  ["journey-b@stream.test", "Pw-B-222"],
];

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const auth = service.register({ name: "Journey Buyer", email: "journey@example.invalid", password: "Journey-buyer-Pass-1" });
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

test("1. admin lists a product, adds a variant and stocks ID + password", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/products/new");
  await page.getByLabel("ชื่อสินค้า").fill("Journey Stream");
  await page.getByLabel("รายละเอียด").fill("บัญชีสตรีมมิ่งสำหรับทดสอบทั้งระบบ");
  await page.getByLabel("ราคาตัวเลือกแรก (บาท)").fill("99");
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/(?!new$)[^/]+$/);
  productId = page.url().split("/").pop();

  const manager = page.locator(".variant-manager");
  await manager.getByRole("button", { name: "แก้" }).first().click();
  await manager.getByLabel("ชื่อตัวเลือก", { exact: true }).fill("30 วัน");
  await manager.getByRole("button", { name: "บันทึก" }).click();
  await expect(manager).toContainText("30 วัน");
  await manager.getByLabel("ชื่อตัวเลือกใหม่").fill("90 วัน");
  await manager.getByLabel("ราคาตัวเลือกใหม่ (บาท)").fill("249");
  await manager.getByRole("button", { name: "เพิ่มตัวเลือก" }).click();
  await expect(manager).toContainText("90 วัน");

  await manager.getByRole("button", { name: /สต็อก 0/ }).first().click();
  await manager.getByLabel("เติมสต็อก 30 วัน").fill(accounts.map((a) => a.join("\t")).join("\n"));
  await expect(manager).toContainText("พร้อมเติม 2 บัญชี");
  await manager.getByRole("button", { name: /เติม 2 บัญชี/ }).click();
  await expect(manager.getByRole("button", { name: /สต็อก 2/ })).toBeVisible();
  // Stock list never shows the real ID or password.
  await expect(manager).not.toContainText(accounts[0][0]);

  await page.getByLabel("เปิดขายสินค้า").check();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกสินค้าแล้ว")).toBeVisible();
  expect(service.products().some((p) => p.id === productId)).toBe(true);
});

test("2. customer buys, pays, receives the account and writes a review", async ({ page }) => {
  await as(page.context(), buyerToken);
  await page.goto(base + "/products/" + productId);
  await expect(page.getByRole("heading", { name: "Journey Stream" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(accounts[0][1]);
  await page.getByRole("button", { name: "ซื้อเลย", exact: true }).click();
  const proceed = page.getByRole("button", { name: /^ไปบันทึกคำสั่งซื้อ/ });
  if (await proceed.isVisible()) await proceed.click();
  await page.getByRole("button", { name: /^บันทึกคำสั่งซื้อ/ }).click();
  await expect(page).toHaveURL(/\/checkout\/[a-z0-9-]+$/);
  firstOrderId = page.url().split("/").pop();
  await page.getByRole("button", { name: /^ชำระเงิน/ }).click();
  await expect(page.getByRole("heading", { name: "สั่งซื้อสำเร็จ พร้อมรับสินค้า" })).toBeVisible();
  await page.getByRole("button", { name: /แสดงโค้ด/ }).click();
  const delivered = await page.locator(".delivered-codes").innerText();
  expect(accounts.some(([id, pw]) => delivered.includes(id) && delivered.includes(pw))).toBe(true);

  await page.goto(base + "/reviews?order=" + firstOrderId);
  await page.getByLabel("ความคิดเห็น").fill("ได้บัญชีทันที ใช้งานได้ปกติ");
  await page.getByRole("button", { name: "ส่งรีวิว" }).click();
  await expect(page.getByText("ขอบคุณสำหรับรีวิวของคุณ")).toBeVisible();
  await expect(page.locator(".credit-review-grid")).toContainText("ได้บัญชีทันที");
});

test("3. last unit sells, storefront shows sold out, admin restocks and the page updates live", async ({ page, browser }) => {
  // Someone else buys the last unit.
  const other = service.session(
    service.register({ name: "Other Buyer", email: "journey-other@example.invalid", password: "Journey-other-Pass-1" }).token,
  );
  const variantId = service.adminProductVariants(service.session(adminToken), productId).variants.find((v) => v.label === "30 วัน").id;
  const o = service.createOrder(other, { variantId, quantity: 1, requestKey: "journey-other-01" });
  service.pay(other, o.id, { paymentToken: o.paymentToken, outcome: "success" });

  await as(page.context(), buyerToken);
  await page.goto(base + "/products/" + productId);
  await expect(page.locator(".reference-variants")).toContainText("สินค้าหมด");
  await expect(page.getByRole("button", { name: "ซื้อเลย", exact: true })).toBeDisabled();

  // Admin restocks in another window; the customer's open page flips to in stock without reload.
  const adminContext = await browser.newContext();
  await as(adminContext, adminToken);
  const admin = await adminContext.newPage();
  await admin.goto(base + "/admin/products/" + productId);
  const manager = admin.locator(".variant-manager");
  await manager.getByRole("button", { name: /สต็อก 0/ }).first().click();
  await manager.getByLabel("เติมสต็อก 30 วัน").fill("journey-c@stream.test,Pw-C-333");
  await manager.getByRole("button", { name: /เติม 1 บัญชี/ }).click();
  await expect(page.locator(".reference-variants")).toContainText(/มีสินค้า|เหลือน้อย/, { timeout: 10000 });
  await expect(page.getByRole("button", { name: "ซื้อเลย", exact: true })).toBeEnabled();
  await adminContext.close();
});

test("4. failed payment and stock gone before paying never charge or deliver", async ({ page }) => {
  const variantId = service.adminProductVariants(service.session(adminToken), productId).variants.find((v) => v.label === "30 วัน").id;
  const failed = service.createOrder(buyer, { variantId, quantity: 1, requestKey: "journey-fail-01" });
  service.pay(buyer, failed.id, { paymentToken: failed.paymentToken, outcome: "failure" });
  await as(page.context(), buyerToken);
  await page.goto(base + "/orders/" + failed.id);
  await expect(page.getByRole("heading", { name: "การชำระเงินไม่สำเร็จ" })).toBeVisible();
  await expect(page.locator(".code-row")).toHaveCount(0);

  // Buyer holds an unpaid order; someone else takes the last unit; paying now is refused.
  const pending = service.createOrder(buyer, { variantId, quantity: 1, requestKey: "journey-race-01" });
  const rival = service.session(
    service.register({ name: "Rival", email: "journey-rival@example.invalid", password: "Journey-rival-Pass-1" }).token,
  );
  const rivalOrder = service.createOrder(rival, { variantId, quantity: 1, requestKey: "journey-race-02" });
  service.pay(rival, rivalOrder.id, { paymentToken: rivalOrder.paymentToken, outcome: "success" });
  await page.goto(base + "/checkout/" + pending.id);
  await page.getByRole("button", { name: /^ชำระเงิน/ }).click();
  await expect(page.getByRole("heading", { name: "สินค้าหมดก่อนทำรายการ" })).toBeVisible();
  expect(service.orderDetail(buyer, pending.id).status).toBe("OUT_OF_STOCK");
});

test("5. preorder: customer gets a queue number, a team member delivers, customer sees it live", async ({ page, browser }) => {
  const admin = service.session(adminToken);
  service.saveProduct(admin, {
    id: productId,
    name: "Journey Stream",
    description: "บัญชีสตรีมมิ่งสำหรับทดสอบทั้งระบบ",
    category: "streaming",
    price: 9900,
    active: true,
    preorder: true,
  });
  const created = service.saveStaff(admin, { name: "ทีมงานหนึ่ง", email: "journey-staff@example.invalid" });
  staffLogin = { email: "journey-staff@example.invalid", password: created.temporaryPassword };

  await as(page.context(), buyerToken);
  await page.goto(base + "/products/" + productId);
  await page.getByRole("button", { name: "จองเลย", exact: true }).click();
  const proceed = page.getByRole("button", { name: /^ไปบันทึกคำสั่งซื้อ/ });
  if (await proceed.isVisible()) await proceed.click();
  await page.getByRole("button", { name: /^บันทึกคำสั่งซื้อ/ }).click();
  await page.getByRole("button", { name: /^ชำระเงิน/ }).click();
  await expect(page.getByText(/^คิวที่ \d+$/)).toBeVisible();
  const orderUrl = page.url();

  // Stock for delivery, then the team member delivers from the queue.
  const variantId = service.adminProductVariants(admin, productId).variants.find((v) => v.label === "30 วัน").id;
  service.importCodes(admin, { variantId, items: [{ loginId: "journey-pre@stream.test", password: "Pw-PRE-444" }] });
  const staffToken = service.login(staffLogin).token;
  const staffContext = await browser.newContext();
  await as(staffContext, staffToken);
  const staffPage = await staffContext.newPage();
  await staffPage.goto(base + "/admin/preorders");
  await expect(staffPage.getByRole("navigation", { name: "จัดการร้านค้า" })).not.toContainText("การเงิน");
  await staffPage.getByRole("button", { name: "ส่งของ" }).first().click();
  await expect(staffPage.getByText(/ส่งของคิว #\d+ แล้ว/)).toBeVisible();
  await staffContext.close();

  await expect(page).toHaveURL(orderUrl);
  await expect(page.getByRole("heading", { name: "สั่งซื้อสำเร็จ พร้อมรับสินค้า" })).toBeVisible({ timeout: 10000 });
});

test("6. live chat: customer asks, admin assigns to the team member, who replies; customer sees it live", async ({ page, browser }) => {
  await as(page.context(), buyerToken);
  await page.goto(base + "/");
  await page.getByRole("button", { name: "แชทกับร้าน" }).click();
  const panel = page.getByRole("dialog", { name: "แชทกับร้าน" });
  await panel.getByLabel("ข้อความ").fill("บัญชีที่ได้เข้าไม่ได้ครับ");
  await panel.getByRole("button", { name: "ส่ง" }).click();

  const adminContext = await browser.newContext();
  await as(adminContext, adminToken);
  const admin = await adminContext.newPage();
  await admin.goto(base + "/admin/chat");
  await admin.locator(".admin-chat-thread", { hasText: "Journey Buyer" }).click();
  await expect(admin.locator(".admin-chat-room")).toContainText("บัญชีที่ได้เข้าไม่ได้ครับ");
  await admin.getByLabel("ผู้ดูแลแชทนี้").selectOption({ label: "ทีมงานหนึ่ง" });
  await expect(admin.getByText("มอบหมายแชทแล้ว")).toBeVisible();
  // A second customer message arrives while the admin keeps the room open.
  await panel.getByLabel("ข้อความ").fill("ออเดอร์ล่าสุดครับ");
  await panel.getByRole("button", { name: "ส่ง" }).click();
  await expect(admin.locator(".admin-chat-room")).toContainText("ออเดอร์ล่าสุดครับ", { timeout: 10000 });
  await adminContext.close();

  const staffContext = await browser.newContext();
  await as(staffContext, service.login(staffLogin).token);
  const staff = await staffContext.newPage();
  await staff.goto(base + "/admin/chat");
  await staff.getByRole("button", { name: "ของฉัน" }).click();
  await staff.locator(".admin-chat-thread", { hasText: "Journey Buyer" }).click();
  await staff.getByLabel("ข้อความตอบกลับ").fill("เดี๋ยวเปลี่ยนบัญชีให้ครับ");
  await staff.getByRole("button", { name: "ส่ง" }).click();
  await staffContext.close();
  await expect(panel.locator(".chat-bubble").last()).toContainText("เดี๋ยวเปลี่ยนบัญชีให้ครับ", { timeout: 10000 });
});

test("7. reports and audit reflect everything that happened", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/reports");
  await expect(page.getByRole("heading", { name: "รายงานยอดขาย" })).toBeVisible();
  await expect(page.locator(".report-bar-row").first()).toContainText("Journey Stream");
  await page.goto(base + "/admin/settings/audit");
  await expect(page.locator(".admin-list-table tbody")).toContainText("เติมสต็อก");
  await expect(page.locator(".admin-list-table tbody")).toContainText("ส่งของพรีออเดอร์");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/admin/reports");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("8. broken account: admin swaps it from the order page and the customer gets the new one", async ({ page, browser }) => {
  const admin = service.session(adminToken);
  const variantId = service.adminProductVariants(admin, productId).variants.find((v) => v.label === "30 วัน").id;
  service.importCodes(admin, { variantId, items: [{ loginId: "journey-new@stream.test", password: "Pw-NEW-555" }] });
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/orders/" + firstOrderId);
  await page.getByRole("button", { name: "บัญชีเสีย · เปลี่ยนให้ลูกค้า" }).first().click();
  await page.getByLabel(/บัญชีนี้มีปัญหาอะไร/).fill("รหัสผ่านถูกเปลี่ยน เข้าไม่ได้");
  await page.getByRole("button", { name: "ส่งบัญชีใหม่" }).click();
  await expect(page.getByText(/ส่งบัญชีใหม่ให้ลูกค้าแล้ว/)).toBeVisible();

  const customer = await browser.newContext();
  await as(customer, buyerToken);
  const mine = await customer.newPage();
  await mine.goto(base + "/orders/" + firstOrderId);
  await mine.getByRole("button", { name: /แสดงโค้ด/ }).click();
  await expect(mine.locator(".delivered-codes")).toContainText("journey-new@stream.test");
  await customer.close();
});
