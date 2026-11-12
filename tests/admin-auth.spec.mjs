// Admin login hardening in the browser: 2FA setup and two-step login, recovery code,
// disable, lockout in the audit log, and inline password re-confirm.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";
import { base32Decode, totpCode } from "../server/auth-hardening.mjs";

let server, service, base, adminToken;
const adminPassword = randomBytes(18).toString("hex");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(page, token) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}
async function passwordStep(page, email, password) {
  await page.goto(base + "/login?next=%2Fadmin");
  await page.locator('input[name="username"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator("form").getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
}

test("admin turns on 2FA, signs in with a code and a recovery code, then turns it off", async ({ page, browser }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/settings/account");
  const card = page.locator(".totp-card");
  await expect(card.getByRole("heading", { name: "ยืนยันตัวตน 2 ขั้น" })).toBeVisible();
  await expect(card).toContainText("ปิดอยู่");
  await card.getByRole("button", { name: "เปิดใช้งาน" }).click();
  await card.getByLabel("รหัสผ่านปัจจุบัน").fill("not-the-password");
  await card.getByRole("button", { name: "เริ่มตั้งค่า" }).click();
  await expect(card.getByRole("alert")).toContainText("รหัสผ่านไม่ถูกต้อง");
  await card.getByLabel("รหัสผ่านปัจจุบัน").fill(adminPassword);
  await card.getByRole("button", { name: "เริ่มตั้งค่า" }).click();

  const secret = (await card.locator(".totp-secret code").textContent()).replace(/\s/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await expect(card.getByRole("link", { name: /แตะเพื่อเพิ่มบัญชี/ })).toHaveAttribute("href", /^otpauth:\/\/totp\//);
  const key = base32Decode(secret);
  await card.getByLabel("รหัส 6 หลักจากแอป").fill(totpCode(key, Date.now()));
  await card.getByRole("button", { name: "ยืนยันและเปิดใช้งาน" }).click();
  const codes = card.locator(".totp-recovery-codes code");
  await expect(codes).toHaveCount(8);
  const recovery = (await codes.allTextContents()).map((c) => c.trim());
  await card.getByRole("button", { name: "บันทึกรหัสแล้ว" }).click();
  await expect(card).toContainText("เปิดอยู่");
  await expect(card).toContainText("รหัสกู้คืนเหลือ 8");

  // Sign in: password, then the code from the app (next 30-second step, so it is not a replay).
  const context = await browser.newContext();
  const other = await context.newPage();
  await passwordStep(other, "admin@astra.local", adminPassword);
  await expect(other.getByRole("heading", { name: "ยืนยันตัวตน 2 ขั้น" })).toBeVisible();
  expect((await context.cookies()).some((c) => c.name === "astra_session")).toBe(false);
  const real = totpCode(key, Date.now() + 30000);
  await other.getByLabel("รหัสยืนยัน 6 หลัก").fill(real === "000000" ? "111111" : "000000");
  await other.getByRole("button", { name: "ยืนยันและเข้าสู่ระบบ" }).click();
  await expect(other.getByRole("alert")).toContainText("รหัสยืนยันไม่ถูกต้อง");
  await other.getByLabel("รหัสยืนยัน 6 หลัก").fill(real);
  await other.getByRole("button", { name: "ยืนยันและเข้าสู่ระบบ" }).click();
  await expect(other).toHaveURL(base + "/admin");
  await context.close();

  // No phone: a recovery code instead.
  const context2 = await browser.newContext();
  const third = await context2.newPage();
  await passwordStep(third, "admin@astra.local", adminPassword);
  await third.getByRole("button", { name: "ไม่มีโทรศัพท์? ใช้รหัสกู้คืน" }).click();
  await third.getByLabel("รหัสกู้คืน").fill(recovery[0]);
  await third.getByRole("button", { name: "ยืนยันและเข้าสู่ระบบ" }).click();
  await expect(third).toHaveURL(base + "/admin");
  await context2.close();

  // Turn it off: password + code (a second recovery code here).
  await page.reload();
  await expect(card).toContainText("รหัสกู้คืนเหลือ 7");
  await card.getByRole("button", { name: "ปิดการยืนยัน 2 ขั้น" }).click();
  await card.getByLabel("รหัสผ่านปัจจุบัน").fill(adminPassword);
  await card.getByLabel("รหัส 6 หลักจากแอป หรือรหัสกู้คืน").fill(recovery[1]);
  await card.getByRole("button", { name: "ยืนยันปิดการยืนยัน 2 ขั้น" }).click();
  await expect(card).toContainText("ปิดอยู่");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto(base + "/admin/settings/audit");
  await page.getByLabel("การกระทำ").selectOption("TOTP_");
  const table = page.locator(".admin-list-table tbody");
  await expect(table).toContainText("เปิดยืนยันตัวตน 2 ขั้น");
  await expect(table).toContainText("ปิดยืนยันตัวตน 2 ขั้น");
});

test("five wrong passwords pause sign-in and the audit log shows it", async ({ page, browser }) => {
  const admin = service.session(adminToken);
  const made = service.saveStaff(admin, { name: "ทีมงานล็อก", email: "locked-staff@example.invalid" });
  const context = await browser.newContext();
  const login = await context.newPage();
  for (let i = 0; i < 4; i++) {
    await passwordStep(login, "locked-staff@example.invalid", "wrong-password-" + i);
    await expect(login.getByRole("alert")).toContainText("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  }
  await passwordStep(login, "locked-staff@example.invalid", "wrong-password-5");
  await expect(login.getByRole("alert")).toContainText("พักการเข้าสู่ระบบชั่วคราว");
  // The right password is refused while paused.
  await passwordStep(login, "locked-staff@example.invalid", made.temporaryPassword);
  await expect(login.getByRole("alert")).toContainText("พักการเข้าสู่ระบบชั่วคราว");
  await context.close();

  await as(page, adminToken);
  await page.goto(base + "/admin/settings/audit");
  await page.getByLabel("การกระทำ").selectOption("LOGIN_");
  const table = page.locator(".admin-list-table tbody");
  await expect(table).toContainText("เข้าสู่ระบบไม่สำเร็จ");
  await expect(table).toContainText("พักการเข้าสู่ระบบ (ผิดหลายครั้ง)");
  await expect(table).toContainText("lo***@example.invalid");
  await expect(table).not.toContainText("wrong-password");
});

test("payment channel and granting admin ask for the password inline", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/settings/payment");
  await page.getByRole("button", { name: "เปิดช่องทางทดสอบ" }).click();
  const confirm = page.locator(".admin-inline-confirm");
  await confirm.getByPlaceholder("รหัสผ่านของคุณ").fill("not-the-password");
  await confirm.getByRole("button", { name: "ยืนยันเปิดช่องทาง" }).click();
  await expect(page.getByRole("alert")).toContainText("รหัสผ่านไม่ถูกต้อง");
  expect(service.getPaymentChannel().active).toBe(false);
  await confirm.getByPlaceholder("รหัสผ่านของคุณ").fill(adminPassword);
  await confirm.getByRole("button", { name: "ยืนยันเปิดช่องทาง" }).click();
  await expect(page.locator(".payment-channel-card")).toContainText("เปิดใช้งาน");
  expect(service.getPaymentChannel().active).toBe(true);

  const admin = service.session(adminToken);
  service.saveStaff(admin, { name: "ทีมงานเลื่อนขั้น", email: "promote-me@example.invalid" });
  await page.goto(base + "/admin/settings/team");
  const row = page.locator(".settings-row", { hasText: "promote-me@example.invalid" });
  await row.getByRole("button", { name: "ให้สิทธิ์แอดมิน" }).click();
  await row.getByPlaceholder("รหัสผ่านของคุณ").fill(adminPassword);
  await row.getByRole("button", { name: "ยืนยันให้สิทธิ์แอดมิน" }).click();
  await expect(row).toContainText("แอดมิน");
  await expect(row.getByRole("button", { name: "ลดเป็นทีมงาน" })).toBeVisible();
});
