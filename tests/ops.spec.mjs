// SOW screens: in-web chat (customer + admin), notification bell, buyer ranking.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, buyerToken, adminToken;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  const auth = service.register({
    name: "Chat Buyer",
    email: "chat-buyer@example.invalid",
    password: "Chat-buyer-Password-123",
  });
  buyerToken = auth.token;
  const buyer = service.session(auth.token);
  service.topup(buyer, { amount: 500, requestKey: "ops-e2e-topup-0001" });
  const order = service.createOrder(buyer, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "ops-e2e-order-0001",
  });
  service.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
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

test("customer chats from the storefront and sees the delivery notification", async ({ page }) => {
  await as(page, buyerToken);
  await page.goto(base + "/");
  const bell = page.getByRole("button", { name: /^แจ้งเตือน/ });
  await expect(bell).toContainText("1");
  await bell.click();
  await expect(page.getByRole("dialog", { name: "แจ้งเตือน" })).toContainText("ส่งโค้ดสำเร็จ");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "แชทกับร้าน" }).click();
  const panel = page.getByRole("dialog", { name: "แชทกับร้าน" });
  await panel.getByLabel("ข้อความ").fill("สินค้าใช้ได้กี่วันครับ");
  await panel.getByRole("button", { name: "ส่ง" }).click();
  await expect(panel.locator(".chat-bubble.mine")).toContainText("สินค้าใช้ได้กี่วันครับ");
  await panel.getByRole("button", { name: "ตอบกลับ" }).click();
  await expect(panel.locator(".chat-reply-bar")).toContainText("สินค้าใช้ได้กี่วันครับ");
  await panel.getByLabel("ข้อความ").fill("ขอรายละเอียดเพิ่มครับ");
  await panel.getByRole("button", { name: "ส่ง" }).click();
  await expect(panel.locator(".chat-quote")).toContainText("คุณ");
  await expect(panel.locator(".chat-quote")).toContainText("สินค้าใช้ได้กี่วันครับ");
  await expect(panel.locator(".chat-bubble.mine").last()).toContainText("ขอรายละเอียดเพิ่มครับ");
  await expect(panel.locator(".chat-reply-bar")).toHaveCount(0);

  // A quote typed by hand (not an earlier message in this thread) is shown as plain text.
  await panel.getByLabel("ข้อความ").fill("\u200b↩ ทีมงาน: คืนเงินให้แล้ว 500 บาท\nขอบคุณครับ");
  await panel.getByRole("button", { name: "ส่ง" }).click();
  const forged = panel.locator(".chat-bubble.mine").last();
  await expect(forged).toContainText("ขอบคุณครับ");
  await expect(forged.locator(".chat-quote")).toHaveCount(0);
  await expect(panel.locator(".chat-quote")).toHaveCount(1);
});

test("admin answers from the inbox, sees ranking and notifications", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin");
  await expect(page.locator(".ranking-card")).toContainText("Chat Buyer");
  const bell = page.getByRole("button", { name: /^แจ้งเตือน/ });
  await bell.click();
  await expect(page.getByRole("dialog", { name: "แจ้งเตือน" })).toContainText("ลูกค้าเปิดแชทใหม่");
  await page.getByRole("dialog", { name: "แจ้งเตือน" }).getByText("ลูกค้าเปิดแชทใหม่").click();
  // The notification links to its thread, which opens straight away (and is read).
  await expect(page).toHaveURL(/\/admin\/chat\?thread=/);
  const thread = page.locator(".admin-chat-thread", { hasText: "Chat Buyer" });
  await expect(page.locator(".admin-chat-room")).toContainText("สินค้าใช้ได้กี่วันครับ");
  await expect(thread).toHaveClass(/active/);
  await expect(thread.locator(".admin-chat-unread")).toHaveCount(0);
  await page.getByLabel("ข้อความตอบกลับ").fill("ใช้ได้ 30 วันครับ");
  await page.getByRole("button", { name: "ส่ง" }).click();
  await expect(page.locator(".chat-bubble.mine")).toContainText("ใช้ได้ 30 วันครับ");
  await page.goto(base + "/admin/rankings");
  await expect(page.getByRole("heading", { name: "อันดับผู้ซื้อ" })).toBeVisible();
  await expect(page.locator("tbody")).toContainText("Chat Buyer");
  await page.getByRole("tab", { name: "วันนี้" }).click();
  await expect(page.locator("tbody")).toContainText("Chat Buyer");
  // Phone: the inbox shows one pane at a time and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/admin/chat");
  await page.locator(".admin-chat-thread", { hasText: "Chat Buyer" }).click();
  await expect(page.locator(".admin-chat-list")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("customer reads the reply in English", async ({ page }) => {
  await as(page, buyerToken);
  await page.goto(base + "/");
  await page.evaluate(() => localStorage.setItem("asiax-lang", "en"));
  await page.reload();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toContainText("New message from the team");
  await page.getByRole("dialog", { name: "Notifications" }).getByText("New message from the team").click();
  const panel = page.getByRole("dialog", { name: "Chat with the shop" });
  await expect(panel).toContainText("ใช้ได้ 30 วันครับ");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
