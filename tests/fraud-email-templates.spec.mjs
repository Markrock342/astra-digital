// Admin › ลูกค้า › สัญญาณผิดปกติ and › ตั้งค่า › ข้อความอีเมล in the browser, desktop and 390px.
// Email goes to a fake in-memory mailer; nothing leaves the machine.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, buyer, buyerEmail;
const sent = [];
const adminPassword = randomBytes(18).toString("hex");
const buyerPassword = "Buyer-only-Password-123";

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({
    adminPassword,
    email: {
      enabled: true,
      provider: "test",
      from: "shop@mail.example.com",
      async send(message) {
        sent.push(message);
        return { id: "e2e-" + sent.length };
      },
    },
  });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  // A customer who fails to pay five times in an hour → one "ชำระเงินไม่สำเร็จบ่อย" signal.
  buyerEmail = "e2e-fraud-buyer@mail.example.com";
  buyer = service.session(service.register({ name: "ลูกค้า สัญญาณ", email: buyerEmail, password: buyerPassword }).token);
  const admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const product = service.saveProduct(admin, { name: "E2E Fraud Item", description: "ทดสอบ", category: "streaming", price: 500, active: true });
  const variantId = service.adminProductVariants(admin, product.id).variants[0].id;
  service.importCodes(admin, { variantId, items: [{ loginId: "e2e-fraud-login", password: "e2e-fraud-pass" }] });
  for (let i = 0; i < 5; i += 1) {
    const order = service.createOrder(buyer, { variantId, quantity: 1, requestKey: "e2e-fraud-" + i });
    service.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "failure" });
  }
});
test.afterAll(async () => {
  await service.emailIdle();
  await new Promise((r) => server.close(r));
  service.db.close();
});
async function asAdmin(page) {
  await page.context().addCookies([
    { name: "astra_session", value: adminToken, url: base, httpOnly: true, sameSite: "Lax" },
  ]);
}
const noSideScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 1000 }],
  ["390px", { width: 390, height: 844 }],
]) {
  test(`fraud page (${name}): signal card, customer link, filters, rules, no side scroll`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await asAdmin(page);
    await page.goto(base + "/admin/fraud");
    await expect(page.getByRole("heading", { name: "สัญญาณผิดปกติ", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "สัญญาณผิดปกติ" })).toHaveClass(/active/);
    const card = page.locator('.fraud-signal-card[data-rule="failed_payments"]').first();
    await expect(card).toContainText("ชำระเงินไม่สำเร็จบ่อย");
    await expect(card).toContainText("5 ครั้ง");
    await expect(card.getByRole("link", { name: "ลูกค้า สัญญาณ" })).toHaveAttribute("href", "/admin/customers/" + buyer.id);
    await expect(page.locator(".fraud-rule-list li")).toHaveCount(5);
    await expect(page.getByRole("switch", { name: "เปิดกฎ สั่งซื้อถี่ผิดปกติ" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("tab", { name: /ตรวจแล้ว/ }).click();
    await expect(page.locator(".fraud-signal-card")).toHaveCount(0);
    await expect(page.getByText("ยังไม่มีรายการ")).toBeVisible();
    await page.getByRole("tab", { name: /รอตรวจสอบ/ }).click();
    await expect(card).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("fraud-" + name + ".png"), fullPage: true });
  });
}

test("fraud page at 390px: block an email from a signal, lift it, review with a note, save a rule", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asAdmin(page);
  await page.goto(base + "/admin/fraud");
  const card = page.locator('.fraud-signal-card[data-rule="failed_payments"]').first();
  // Block the customer's email for one day.
  await card.getByRole("button", { name: "บล็อกอีเมลชั่วคราว" }).click();
  await expect(page.getByLabel("อีเมล", { exact: true })).toHaveValue(buyerEmail);
  await page.getByLabel("เหตุผล (ไม่บังคับ)").fill("จ่ายไม่ผ่านซ้ำ");
  await page.locator(".fraud-block-form").getByRole("button", { name: "บล็อก", exact: true }).click();
  const blocks = page.locator(".fraud-block-list li");
  await expect(blocks).toHaveCount(1);
  await expect(blocks.first()).toContainText(buyerEmail);
  // The block stops logging in.
  const blocked = await page.request.post(base + "/api/login", {
    headers: { "X-Astra-Request": "1", "Content-Type": "application/json" },
    data: { email: buyerEmail, password: buyerPassword },
  });
  expect(blocked.status()).toBe(403);
  await blocks.first().getByRole("button", { name: "ยกเลิกบล็อก" }).click();
  await expect(blocks).toHaveCount(0);
  expect(await noSideScroll(page)).toBe(true);

  // Mark reviewed with a note.
  await card.getByRole("button", { name: "ตรวจแล้ว" }).click();
  await card.getByLabel("บันทึก (ไม่บังคับ)").fill("ลูกค้าแจ้งว่าบัตรมีปัญหา");
  await card.getByRole("button", { name: "ยืนยันว่าตรวจแล้ว" }).click();
  await expect(page.getByText("ไม่มีสัญญาณที่รอตรวจสอบ")).toBeVisible();
  await page.getByRole("tab", { name: /ตรวจแล้ว/ }).click();
  const reviewed = page.locator('.fraud-signal-card[data-status="reviewed"]');
  await expect(reviewed).toContainText("ลูกค้าแจ้งว่าบัตรมีปัญหา");
  await expect(reviewed).toContainText("ผู้ดูแลร้าน");

  // Change a threshold.
  const rule = page.locator('.fraud-rule-list li[data-rule="paid_orders"]');
  await rule.getByLabel("ตั้งแต่ (ออเดอร์)").fill("10");
  await page.getByRole("button", { name: "บันทึกเกณฑ์" }).click();
  await expect(page.getByText(/บันทึกล่าสุด/)).toBeVisible();
  const saved = service.adminFraud(service.session(adminToken), { status: "all" }).settings.rules.find((r) => r.key === "paid_orders");
  expect(saved.threshold).toBe(10);
  expect(await noSideScroll(page)).toBe(true);
});

test("suspend from a signal uses the normal customer status change", async ({ page }) => {
  // A fresh signal for a second customer.
  const other = service.session(
    service.register({ name: "ลูกค้า ระงับ", email: "e2e-fraud-suspend@mail.example.com", password: buyerPassword }).token,
  );
  const admin = service.session(adminToken);
  const p = service.saveProduct(admin, { name: "E2E Fraud Item 2", description: "ทดสอบ", category: "streaming", price: 500, active: true });
  const variantId = service.adminProductVariants(admin, p.id).variants[0].id;
  service.importCodes(admin, { variantId, items: [{ loginId: "e2e-fraud-login-2", password: "e2e-fraud-pass-2" }] });
  for (let i = 0; i < 5; i += 1) {
    const order = service.createOrder(other, { variantId, quantity: 1, requestKey: "e2e-fraud-s-" + i });
    service.pay(other, order.id, { paymentToken: order.paymentToken, outcome: "failure" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await asAdmin(page);
  await page.goto(base + "/admin/fraud");
  const card = page.locator(".fraud-signal-card", { hasText: "ลูกค้า ระงับ" });
  await card.getByRole("button", { name: "ระงับบัญชี" }).click();
  await card.getByLabel("เหตุผลที่ระงับ (ลูกค้าไม่เห็น)").fill("จ่ายเงินไม่ผ่านซ้ำหลายครั้ง");
  await card.getByRole("button", { name: "ยืนยันระงับ" }).click();
  await expect(card).toContainText("ระงับแล้ว");
  expect(service.db.prepare("SELECT status FROM users WHERE id=?").get(other.id).status).toBe("SUSPENDED");
});

for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 1000 }],
  ["390px", { width: 390, height: 844 }],
]) {
  test(`email templates (${name}): edit with a placeholder, preview, reject unknown, reset`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await asAdmin(page);
    await page.goto(base + "/admin/settings/email-templates");
    await expect(page.getByRole("heading", { name: "ข้อความอีเมล", exact: true })).toBeVisible();
    await expect(page.locator(".reference-subnav").getByRole("link", { name: "ข้อความอีเมล" })).toHaveClass(/active/);
    await expect(page.locator(".email-template-list button")).toHaveCount(6);
    const editor = page.locator(".email-template-editor");
    await expect(editor).toHaveAttribute("data-template", "order_confirmed");

    // Unknown placeholder is rejected by the server with a short Thai message.
    await editor.getByLabel("ข้อความ").fill("สวัสดี {ชื่อเล่น}");
    await editor.getByRole("button", { name: "บันทึก", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("ไม่รู้จัก {ชื่อเล่น}");

    // Click a placeholder chip to insert it, save, preview.
    await editor.getByLabel("ข้อความ").fill("สวัสดีคุณ ");
    await editor.getByRole("button", { name: "{ชื่อลูกค้า}" }).click();
    await expect(editor.getByLabel("ข้อความ")).toHaveValue("สวัสดีคุณ {ชื่อลูกค้า}");
    await editor.getByRole("button", { name: "บันทึก", exact: true }).click();
    await expect(page.locator(".email-template-list button.active .alert-badge")).toHaveText("แก้แล้ว");
    await editor.getByRole("button", { name: "ดูตัวอย่าง" }).click();
    const frame = page.frameLocator('iframe[title="ตัวอย่างอีเมล"]');
    await expect(frame.getByText("สวัสดีคุณ สมชาย ใจดี")).toBeVisible();
    await expect(editor.locator(".email-preview-subject strong")).toContainText("ยืนยันคำสั่งซื้อ #A1B2C3D4");
    expect(await noSideScroll(page)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("templates-" + name + ".png"), fullPage: true });
    await editor.locator(".email-preview").screenshot({ path: test.info().outputPath("preview-" + name + ".png") });

    // Reset to default (two steps).
    await editor.getByRole("button", { name: "คืนค่าเริ่มต้น" }).click();
    await editor.getByRole("button", { name: "ยืนยันคืนค่าเริ่มต้น" }).click();
    await expect(editor.getByLabel("ข้อความ")).toHaveValue(/ร้านได้รับชำระเงินแล้ว/);
    await expect(editor.locator(".email-template-title .alert-badge")).toHaveText("ค่าเริ่มต้น");
    expect(await noSideScroll(page)).toBe(true);
  });
}

test("email templates: password reset must keep its link; send test explains when it cannot send", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asAdmin(page);
  await page.goto(base + "/admin/settings/email-templates");
  await page.locator(".email-template-list button", { hasText: "ลิงก์ตั้งรหัสผ่านใหม่" }).click();
  const editor = page.locator('.email-template-editor[data-template="password_reset"]');
  await expect(editor.getByRole("button", { name: "{ลิงก์รีเซ็ต}" })).toHaveClass(/required/);
  await editor.getByLabel("ข้อความ").fill("กดลิงก์ในอีเมลนี้");
  await editor.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("{ลิงก์รีเซ็ต}");
  // The owner account uses a .local address, so "send test" is disabled with a reason.
  const testButton = editor.getByRole("button", { name: "ส่งทดสอบไปที่อีเมลของฉัน" });
  await expect(testButton).toBeDisabled();
  await expect(testButton).toHaveAttribute("title", "บัญชีของคุณไม่มีอีเมลที่รับจดหมายได้");
  expect(await noSideScroll(page)).toBe(true);
});

test("admin pages stay light and readable when the visitor prefers dark", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asAdmin(page);
  await page.goto(base + "/");
  await page.evaluate(() => localStorage.setItem("asiax-mode", "dark"));
  for (const path of ["/admin/fraud", "/admin/settings/email-templates"]) {
    await page.goto(base + path);
    const card = page.locator(".reference-admin-card").first();
    await expect(card).toBeVisible();
    const colors = await card.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, text: getComputedStyle(el.querySelector("h2, p, strong, button") ?? el).color };
    });
    // Light card (white, or the faint status tint of a fraud signal card), never a dark surface.
    const [r, g, b] = colors.bg.match(/\d+/g).map(Number);
    expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(240);
    expect(colors.text).not.toBe("rgb(255, 255, 255)");
    expect(await noSideScroll(page)).toBe(true);
  }
});
