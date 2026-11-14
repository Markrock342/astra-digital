// Email verification in the browser (email captured by a fake sender, nothing is sent):
// register → "ยืนยันอีเมลของคุณ" notice → checkout blocked → resend cooldown → open the link →
// checkout works. Also 390px (no sideways scroll, 44px taps), dark mode, and the admin
// toggle / badge / "ยืนยันให้".
import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, admin, productId, variantId;
const outbox = [];
const adminPassword = randomBytes(24).toString("hex");
const PASSWORD = "Verify-e2e-Pass-123";
const shots = process.env.VERIFY_SHOTS || "";

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({
    adminPassword,
    email: {
      enabled: true,
      provider: "test",
      from: "shop@mail.example.com",
      send: async (message) => (outbox.push(message), { id: "e2e-" + outbox.length }),
    },
  });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  admin = service.session(service.login({ email: "admin@astra.local", password: adminPassword }).token);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const p = service.saveProduct(admin, { name: "Verify Stream", description: "ทดสอบยืนยันอีเมล", category: "streaming", price: 5000, active: true, firstLabel: "1 เดือน" });
  productId = p.id;
  variantId = service.adminProductVariants(admin, p.id).variants[0].id;
  service.importCodes(admin, { variantId, items: [{ loginId: "ve1@x.test", password: "p1" }, { loginId: "ve2@x.test", password: "p2" }] });
});
test.afterAll(async () => {
  await service.emailIdle();
  await new Promise((r) => server.close(r));
  service.db.close();
});

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const verifyLink = (message) => /(\/verify-email\?token=[a-f0-9]{64})/.exec(message?.text ?? "")?.[1];

test("register → notice → blocked checkout → resend cooldown → link → checkout works (390px)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/register");
  // Email is required while verification is on.
  const email = page.locator('input[name="email"]');
  await expect(email).toHaveAttribute("required", "");
  await expect(page.getByText("ต้องเป็นอีเมลที่ใช้งานได้จริง")).toBeVisible();
  await page.locator('input[name="username"]').fill("verify_buyer");
  await email.fill("verify-buyer@mail.example.com");
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="confirmPassword"]').fill(PASSWORD);
  await page.locator('input[name="acceptTerms"]').check();
  await page.getByRole("button", { name: "สมัครสมาชิก" }).click();

  // Account page: the notice with the address, resend on cooldown.
  await expect(page).toHaveURL(/\/account$/);
  const card = page.locator("#verify-email");
  await expect(card).toContainText("ยืนยันอีเมลของคุณ");
  await expect(card).toContainText("verify-buyer@mail.example.com");
  const resend = card.getByRole("button", { name: /ส่งอีกครั้งได้ใน \d+ วินาที/ });
  await expect(resend).toBeDisabled();
  await expect(card.getByRole("button", { name: "เปลี่ยนอีเมล" })).toBeVisible();
  for (const button of await card.locator(".button, .text-button").all()) {
    const box = await button.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await noSideScroll(page)).toBe(true);
  if (shots) await page.screenshot({ path: shots + "/account-390.png", fullPage: true });
  await expect.poll(() => outbox.length).toBe(1);
  const firstLink = verifyLink(outbox[0]);
  expect(firstLink).toBeTruthy();

  // Product page + checkout: notice, final button off.
  await page.goto(base + "/products/" + productId);
  await expect(page.locator(".email-verify-card.compact")).toContainText("ยืนยันอีเมลของคุณ");
  await page.getByRole("button", { name: "ซื้อเลย" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.locator(".email-verify-card.compact")).toBeVisible();
  await expect(page.locator(".cart-bar").getByRole("button", { name: /ชำระเงิน/ })).toBeDisabled();
  expect(await noSideScroll(page)).toBe(true);
  if (shots) await page.screenshot({ path: shots + "/checkout-390.png", fullPage: true });

  // Resend once the cooldown is over (server clock: fast-forward by aging the last link).
  service.db.prepare("UPDATE email_verifications SET created_at=created_at-61000").run();
  await page.goto(base + "/account");
  const again = page.locator("#verify-email").getByRole("button", { name: "ส่งลิงก์อีกครั้ง" });
  await expect(again).toBeEnabled();
  await again.click();
  await expect(page.locator("#verify-email").getByRole("button", { name: /ส่งอีกครั้งได้ใน \d+ วินาที/ })).toBeDisabled();
  await expect.poll(() => outbox.length).toBe(2);
  const link = verifyLink(outbox[1]);

  // The first link was replaced by the new one.
  await page.goto(base + firstLink);
  await expect(page.getByRole("heading", { name: "ลิงก์ใช้ไม่ได้" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("ลิงก์ใหม่กว่า");

  await page.goto(base + link);
  await expect(page.getByRole("heading", { name: "ยืนยันอีเมลแล้ว" })).toBeVisible();
  await expect(page).toHaveURL(/\/verify-email$/); // token dropped from the address bar
  expect(await noSideScroll(page)).toBe(true);
  if (shots) await page.screenshot({ path: shots + "/verified-390.png", fullPage: true });
  await page.getByRole("button", { name: "ไปชำระเงินต่อ" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.locator(".email-verify-card")).toHaveCount(0);
  await page.locator(".cart-bar").getByRole("button", { name: /ชำระเงิน/ }).click();
  await expect(page.locator(".delivered-codes")).toBeVisible();

  // Same link again: already verified, not an error.
  await page.goto(base + link);
  await expect(page.getByRole("heading", { name: "อีเมลนี้ยืนยันแล้ว" })).toBeVisible();
});

test("dark mode: the notice and the verify page read well; English strings", async ({ page }) => {
  const auth = service.register({ name: "Dark Buyer", username: "dark_buyer", email: "dark-buyer@mail.example.com", password: PASSWORD });
  await page.context().addCookies([{ name: "astra_session", value: auth.token, url: base, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(base + "/");
  await page.evaluate(() => localStorage.setItem("asiax-mode", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/account");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const card = page.locator("#verify-email");
  await expect(card).toBeVisible();
  // Card follows the dark surface (not a white box on a dark page).
  const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g).map(Number);
  expect(r + g + b).toBeLessThan(150);
  expect(await noSideScroll(page)).toBe(true);
  if (shots) await page.screenshot({ path: shots + "/account-dark-390.png", fullPage: true });

  // Change the address from the notice (password again); the link goes to the new one.
  await card.getByRole("button", { name: "เปลี่ยนอีเมล" }).click();
  await card.getByLabel("อีเมลใหม่").fill("dark-new@mail.example.com");
  await card.getByLabel("รหัสผ่านปัจจุบัน").fill(PASSWORD);
  service.db.prepare("UPDATE email_verifications SET created_at=created_at-61000").run();
  await card.getByRole("button", { name: "บันทึกและส่งลิงก์" }).click();
  await expect(card).toContainText("dark-new@mail.example.com");
  await expect.poll(() => outbox.at(-1)?.to).toBe("dark-new@mail.example.com");

  await page.goto(base + "/verify-email?token=" + "0".repeat(64));
  await expect(page.getByRole("heading", { name: "ลิงก์ใช้ไม่ได้" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ขอลิงก์ใหม่ในหน้าบัญชี" })).toBeVisible();
  if (shots) await page.screenshot({ path: shots + "/invalid-dark-390.png", fullPage: true });

  await page.evaluate(() => localStorage.setItem("asiax-lang", "en"));
  await page.goto(base + "/account");
  const en = await page.evaluate(() => document.documentElement.lang);
  if (en === "en") await expect(page.locator("#verify-email")).toContainText("Verify your email");
  await page.evaluate(() => {
    localStorage.removeItem("asiax-lang");
    localStorage.setItem("asiax-mode", "light");
  });
});

test("admin: toggle in ตั้งค่า › ร้าน, badge and “ยืนยันให้” on the customer page", async ({ page }) => {
  const auth = service.register({ name: "No Mailbox", username: "no_mailbox", email: "no-mailbox@mail.example.com", password: PASSWORD });
  const adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  await page.context().addCookies([{ name: "astra_session", value: adminToken, url: base, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(base + "/admin/settings");
  const toggle = page.getByLabel("ให้ลูกค้ายืนยันอีเมลก่อนสั่งซื้อ");
  await expect(toggle).toBeChecked();
  await expect(page.locator(".email-verify-setting")).toContainText("นับว่ายืนยันแล้ว");

  await page.goto(base + "/admin/customers/" + auth.user.id);
  const heading = page.locator(".reference-admin-heading");
  await expect(heading.locator(".email-verified-badge")).toHaveText("ยังไม่ยืนยันอีเมล");
  await page.getByRole("button", { name: "ยืนยันให้" }).click();
  await expect(heading.locator(".email-verified-badge")).toHaveText("ยืนยันอีเมลแล้ว");
  await expect(page.locator(".admin-timeline")).toContainText("ยืนยันอีเมลให้ลูกค้า");
  if (shots) await page.screenshot({ path: shots + "/admin-customer.png", fullPage: true });
  const buyer = service.session(auth.token);
  expect(service.createOrder(buyer, { variantId, quantity: 1, requestKey: randomUUID() }).status).toBe("PENDING_PAYMENT");

  // Switch verification off → a new customer is not asked.
  await page.goto(base + "/admin/settings");
  await page.getByLabel("ให้ลูกค้ายืนยันอีเมลก่อนสั่งซื้อ").uncheck();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect.poll(() => service.settings().requireEmailVerification).toBe(false);
  const later = service.register({ name: "Later", username: "later_buyer", email: "later@mail.example.com", password: PASSWORD });
  expect(service.session(later.token) && service.publicUser(service.session(later.token)).emailVerification.required).toBe(false);
  service.saveSettings(admin, { requireEmailVerification: true });
});
