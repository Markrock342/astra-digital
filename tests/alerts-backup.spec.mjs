// Admin › ตั้งค่า › แจ้งเตือนนอกเว็บ and › สำรองข้อมูล in the browser. Outbound alerts go to a
// local mock HTTP server (the loopback-only alertRedirect hook), never to Discord.
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

// Fake webhook — shaped like a real one so validation passes; the redirect hook sends it to the mock.
const DISCORD = "https://discord.com/api/webhooks/123456789012345678/fake-webhook-token-for-e2e-only-000000";
let server, mock, service, base, adminToken;
const received = [];
const adminPassword = randomBytes(18).toString("hex");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  mock = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ path: req.url, channel: req.headers["x-astra-alert-channel"], body: JSON.parse(body || "{}") });
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  service = createCommerce({
    adminPassword,
    alertRedirect: "http://127.0.0.1:" + mock.address().port,
  });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => mock.close(r));
  service.db.close();
});
async function asAdmin(page) {
  await page.context().addCookies([
    { name: "astra_session", value: adminToken, url: base, httpOnly: true, sameSite: "Lax" },
  ]);
}
const noSideScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test("alerts form at 390px: password required, secret masked, test send reaches the mock endpoint", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asAdmin(page);
  await page.goto(base + "/admin/settings/alerts");
  await expect(page.getByRole("heading", { name: "แจ้งเตือนนอกเว็บ" })).toBeVisible();
  const discord = page.locator('.alert-channel-card[data-channel="discord"]');
  await expect(discord).toContainText("ยังไม่ได้ตั้งค่า");
  await expect(discord.getByRole("button", { name: "ทดสอบส่ง" })).toBeDisabled();
  expect(await noSideScroll(page)).toBe(true);

  await discord.getByLabel("Webhook URL").fill(DISCORD);
  await discord.getByRole("switch", { name: "เปิดแจ้งเตือนทาง Discord" }).click();
  await page.getByLabel("ข้อความแชทใหม่จากลูกค้า").uncheck();
  await page.getByLabel("รหัสผ่านของคุณ (ยืนยันก่อนบันทึก)").fill("not-the-password");
  await page.getByRole("button", { name: "บันทึกการตั้งค่า" }).click();
  await expect(page.getByRole("alert")).toContainText("รหัสผ่านไม่ถูกต้อง");
  await expect(discord).toContainText("ยังไม่ได้ตั้งค่า");

  await page.getByLabel("รหัสผ่านของคุณ (ยืนยันก่อนบันทึก)").fill(adminPassword);
  await page.getByRole("button", { name: "บันทึกการตั้งค่า" }).click();
  await expect(discord.locator(".alert-badge")).toHaveText("เปิดอยู่");
  await expect(discord.getByLabel("Webhook URL")).toHaveValue("");
  await expect(discord.getByLabel("Webhook URL")).toHaveAttribute("placeholder", /บันทึกแล้ว ••••0000/);
  await expect(page.getByLabel("ข้อความแชทใหม่จากลูกค้า")).not.toBeChecked();
  expect(await page.content()).not.toContain("fake-webhook-token-for-e2e-only");

  await discord.getByRole("button", { name: "ทดสอบส่ง" }).click();
  await expect(discord.getByRole("status")).toHaveText("ส่งสำเร็จ");
  expect(received).toHaveLength(1);
  expect(received[0].channel).toBe("discord");
  expect(received[0].path).toBe("/api/webhooks/123456789012345678/fake-webhook-token-for-e2e-only-000000");
  expect(received[0].body.content).toContain("ทดสอบการแจ้งเตือนนอกเว็บ");
  expect(received[0].body.content).toContain(base + "/admin/settings/alerts");
  const log = page.locator(".alert-log-card");
  await expect(log).toContainText("ทดสอบส่ง");
  await expect(log.locator(".alert-badge").first()).toHaveText("สำเร็จ");
  expect(await noSideScroll(page)).toBe(true);
});

test("a paid order sends an alert to the configured channel", async () => {
  const buyerAuth = service.register({ name: "E2E Alert Buyer", email: "e2e-alert@example.invalid", password: "Buyer-only-Password-123" });
  const buyer = service.session(buyerAuth.token);
  const admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  service.topup(buyer, { amount: 100, requestKey: "e2e-alert-topup-1" });
  const product = service.saveProduct(admin, { name: "E2E Alert Item", description: "แจ้งเตือน", category: "streaming", price: 500, active: true });
  const variantId = service.adminProductVariants(admin, product.id).variants[0].id;
  service.importCodes(admin, { variantId, items: [{ loginId: "e2e-login-1", password: "e2e-pass-1" }, { loginId: "e2e-login-2", password: "e2e-pass-2" }, { loginId: "e2e-login-3", password: "e2e-pass-3" }, { loginId: "e2e-login-4", password: "e2e-pass-4" }, { loginId: "e2e-login-5", password: "e2e-pass-5" }] });
  const order = service.createOrder(buyer, { variantId, quantity: 1, requestKey: "e2e-alert-order-1" });
  expect(service.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" }).status).toBe("DELIVERED");
  await service.alertsIdle();
  const last = received.at(-1).body.content;
  expect(last).toContain("ออเดอร์ใหม่ชำระแล้ว");
  expect(last).toContain("E2E Alert Item");
  expect(last).not.toContain("e2e-pass-1");
});

test("backup page at 390px: R2 not set up, download needs the password and is a gzipped backup", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asAdmin(page);
  await page.goto(base + "/admin/settings/backup");
  await expect(page.getByRole("heading", { name: "สำรองข้อมูล", exact: true })).toBeVisible();
  await expect(page.getByText("ยังไม่ได้ตั้งค่าที่เก็บสำรอง (R2)")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);

  await page.getByLabel("รหัสผ่านของคุณ").fill("not-the-password");
  await page.getByRole("button", { name: "ดาวน์โหลดไฟล์สำรอง" }).click();
  await expect(page.getByRole("alert")).toContainText("รหัสผ่านไม่ถูกต้อง");

  await page.getByLabel("รหัสผ่านของคุณ").fill(adminPassword);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "ดาวน์โหลดไฟล์สำรอง" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^asiaextra-backup-\d{8}-\d{4}Z\.json\.gz$/);
  const backup = JSON.parse(gunzipSync(readFileSync(await download.path())).toString("utf8"));
  expect(backup.format).toBe("astra-backup");
  expect(backup.tables.map((t) => t.name)).toContain("inventory");
  expect(JSON.stringify(backup)).not.toContain("fake-webhook-token-for-e2e-only");
  expect(JSON.stringify(backup)).not.toContain("e2e-pass-1");

  await page.goto(base + "/admin/settings/audit");
  await expect(page.locator("main")).toContainText("ดาวน์โหลดไฟล์สำรองข้อมูล");
});
