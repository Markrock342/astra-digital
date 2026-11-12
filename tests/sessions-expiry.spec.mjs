// Small UX round B in the browser: the unpaid-order window (admin setting + customer
// order page) and "my devices" on the storefront account page and the admin account page.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

const MIN = 60000;
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

let server, service, base;
let offset = 0;
const adminPassword = randomBytes(24).toString("hex");
const buyerEmail = "devices-e2e@example.invalid";
const buyerPassword = "Devices-e2e-Password-123";

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  // Real time + offset: SQLite stamps created_at with the real clock, the expiry reads this one.
  service = createCommerce({ adminPassword, clock: () => Date.now() + offset });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  service.register({ name: "Devices Buyer", email: buyerEmail, password: buyerPassword });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(page, token) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" },
  ]);
}
const signIn = (email, password, ua, ip) => service.login({ email, password }, { userAgent: ua, ip }).token;
const adminLogin = (ua = MAC_CHROME) => signIn("admin@astra.local", adminPassword, ua, "203.0.113.10");
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("admin sets the payment window in ตั้งค่า › ร้าน", async ({ page }) => {
  await as(page, adminLogin());
  await page.goto(base + "/admin/settings");
  const field = page.getByLabel("ยกเลิกออเดอร์ที่ยังไม่ชำระหลัง (นาที)");
  await expect(field).toHaveValue("30");
  await field.fill("15");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกการตั้งค่าแล้ว")).toBeVisible();
  expect(service.settings().pendingExpiryMinutes).toBe(15);
  // Out of range is refused with a clear message (browser check off to reach the server).
  await page.locator('input[name="pendingExpiryMinutes"]').evaluate((el) => {
    el.removeAttribute("min");
    el.removeAttribute("max");
  });
  await field.fill("2");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("เวลารอชำระเงินต้องอยู่ระหว่าง 5–1440 นาที")).toBeVisible();
  expect(service.settings().pendingExpiryMinutes).toBe(15);
});

test("an unpaid order runs out of time: pay is refused and the page says order again", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const token = signIn(buyerEmail, buyerPassword, IPHONE_SAFARI, "198.51.100.20");
  const buyer = service.session(token);
  service.topup(buyer, { amount: 500, requestKey: "expiry-e2e-topup-01" });
  const order = service.createOrder(buyer, { variantId: "stream-plus-30", quantity: 1, requestKey: "expiry-e2e-order-01" });
  await as(page, token);
  await page.goto(base + "/orders/" + order.id);
  await expect(page.getByText(/กรุณาชำระภายใน/)).toBeVisible();
  const pay = page.getByRole("button", { name: /ชำระเงิน/ });
  await expect(pay).toBeEnabled();

  offset += 16 * MIN; // past the 15-minute window set above
  await pay.click();
  await expect(page.getByText("หมดเวลาชำระเงิน · สั่งใหม่ได้")).toBeVisible();
  await expect(page.getByRole("heading", { name: "หมดเวลาชำระเงิน" })).toBeVisible();
  await expect(page.locator(".delivery-product .status")).toHaveText("หมดเวลาชำระเงิน");
  await expect(page.getByRole("link", { name: "สั่งซื้อใหม่" })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  const row = service.db.prepare("SELECT status, expired_at FROM orders WHERE id=?").get(order.id);
  expect(row.status).toBe("CANCELLED");
  expect(row.expired_at).toBeTruthy();
  expect(service.db.prepare("SELECT COUNT(*) AS n FROM payments WHERE order_id=?").get(order.id).n).toBe(0);
  const audit = service.db.prepare("SELECT user_id FROM audit WHERE action='ORDER_EXPIRED' AND entity_id=?").get(order.id);
  expect(audit.user_id).toBeNull();

  // History shows the same status.
  await page.goto(base + "/orders");
  await expect(page.locator(".history-card", { hasText: order.id.slice(0, 8).toUpperCase() }).locator(".status")).toHaveText(
    "หมดเวลาชำระเงิน",
  );

  // The admin timeline says the system cancelled it and why.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await as(page, adminLogin());
  await page.goto(base + "/admin/orders/" + order.id);
  await expect(page.locator(".admin-activity")).toContainText("ระบบ");
  await expect(page.locator(".admin-activity")).toContainText("เหตุผล: หมดเวลาชำระเงิน");
});

test("customer sees their devices at 390px, signs one out, then all others after a confirm", async ({ page }) => {
  service.db.prepare("DELETE FROM sessions").run();
  await page.setViewportSize({ width: 390, height: 844 });
  const mine = signIn(buyerEmail, buyerPassword, MAC_CHROME, "203.0.113.77");
  const phone = signIn(buyerEmail, buyerPassword, IPHONE_SAFARI, "2001:db8:abcd:12::9");
  await as(page, mine);
  await page.goto(base + "/account");
  const card = page.locator(".sessions-card");
  await expect(card.getByRole("heading", { name: "อุปกรณ์ที่เข้าสู่ระบบ" })).toBeVisible();
  const rows = card.locator(".sessions-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Chrome · macOS");
  await expect(rows.first()).toContainText("เครื่องนี้");
  await expect(rows.first()).toContainText("IP 203.0.113.0/24");
  await expect(rows.nth(1)).toContainText("Safari · iPhone");
  await expect(rows.nth(1)).toContainText("IP 2001:db8:abcd::/48");
  await expect(rows.nth(1)).toContainText("ใช้งานล่าสุด");
  await expect(card).not.toContainText("203.0.113.77");
  expect(await noSideScroll(page)).toBe(true);

  await rows.nth(1).getByRole("button", { name: /ออกจากระบบเครื่องนี้/ }).click();
  await expect(rows).toHaveCount(1);
  expect(service.session(phone)).toBeNull();
  expect(service.session(mine)).not.toBeNull();

  // Two more devices, then sign out everywhere else (with a confirm step).
  const edge = signIn(buyerEmail, buyerPassword, WINDOWS_EDGE, "198.51.100.3");
  const phone2 = signIn(buyerEmail, buyerPassword, IPHONE_SAFARI, "198.51.100.4");
  await page.reload();
  await expect(rows).toHaveCount(3);
  await card.getByRole("button", { name: "ออกจากระบบทุกเครื่องยกเว้นเครื่องนี้" }).click();
  const confirm = card.getByRole("group", { name: "ยืนยันออกจากระบบเครื่องอื่น" });
  await expect(confirm).toContainText("ออกจากระบบอีก 2 เครื่อง");
  expect(await noSideScroll(page)).toBe(true);
  await confirm.getByRole("button", { name: "ยืนยันออกจากระบบ 2 เครื่อง" }).click();
  await expect(page.getByText("ออกจากระบบเครื่องอื่นแล้ว 2 เครื่อง")).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(card.getByRole("button", { name: "ออกจากระบบทุกเครื่องยกเว้นเครื่องนี้" })).toHaveCount(0);
  expect(service.session(edge)).toBeNull();
  expect(service.session(phone2)).toBeNull();
  expect(service.session(mine)).not.toBeNull();
  const actions = service.db
    .prepare("SELECT action FROM audit WHERE action LIKE 'SESSION_REVOKE%' ORDER BY id")
    .all()
    .map((r) => r.action);
  expect(actions).toEqual(["SESSION_REVOKE", "SESSION_REVOKE_OTHERS"]);

  // Signing out this device from the list ends this browser's session.
  await rows.first().getByRole("button", { name: /ออกจากระบบเครื่องนี้/ }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(service.session(mine)).toBeNull();
});

test("admin account page lists the admin's own devices only", async ({ page }) => {
  service.db.prepare("DELETE FROM sessions").run();
  const admin = adminLogin(MAC_CHROME);
  adminLogin(IPHONE_SAFARI);
  signIn(buyerEmail, buyerPassword, WINDOWS_EDGE, "198.51.100.3");
  await as(page, admin);
  await page.goto(base + "/admin/settings/account");
  const card = page.locator(".sessions-card");
  await expect(card.getByRole("heading", { name: "อุปกรณ์ที่เข้าสู่ระบบ" })).toBeVisible();
  await expect(card.locator(".sessions-row")).toHaveCount(2);
  await expect(card.locator(".sessions-row.is-current")).toContainText("Chrome · macOS");
  await expect(card).not.toContainText("Edge · Windows");
  await card.getByRole("button", { name: "ออกจากระบบทุกเครื่องยกเว้นเครื่องนี้" }).click();
  await card.getByRole("button", { name: "ยืนยันออกจากระบบ 1 เครื่อง" }).click();
  await expect(card.locator(".sessions-row")).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(card.locator(".sessions-row")).toHaveCount(1);
  expect(await noSideScroll(page)).toBe(true);
});
