// Shop logo: upload / replace / remove in ตั้งค่า › ร้าน; the back-office header and the team's
// chat picture use it. Customers' chat messages carry their profile photo (or first letter).
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, buyerToken;
const adminPassword = randomBytes(24).toString("hex");
const netflix = readFileSync(new URL("../public/library/netflix.webp", import.meta.url));
const spotify = readFileSync(new URL("../public/library/spotify.webp", import.meta.url));

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  buyerToken = service.register({ name: "Mali Buyer", email: "mali@example.invalid", password: "Mali-buyer-Pass-123" }).token;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});
async function as(context, token) {
  await context.clearCookies();
  await context.addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}

test("built-in X mark by default; admin uploads, replaces and goes back to it; the header follows", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/settings");
  const card = page.locator(".logo-setting");
  await expect(card.getByAltText("โลโก้เดิมของร้าน")).toHaveAttribute("src", "/brand/icon-512.png");
  await expect(page.locator(".platform-mark img")).toHaveAttribute("src", "/brand/icon-512.png");
  await card.getByLabel("เลือกไฟล์โลโก้").setInputFiles({ name: "logo.webp", mimeType: "image/webp", buffer: netflix });
  await expect(page.getByText("เปลี่ยนโลโก้แล้ว")).toBeVisible();
  const first = await card.getByAltText("โลโก้ร้านปัจจุบัน").getAttribute("src");
  expect(first).toMatch(/^\/api\/files\//);
  await expect(page.locator(".platform-mark img")).toHaveAttribute("src", first);
  await card.getByLabel("เลือกไฟล์โลโก้").setInputFiles({ name: "logo2.webp", mimeType: "image/webp", buffer: spotify });
  await expect(card.getByAltText("โลโก้ร้านปัจจุบัน")).not.toHaveAttribute("src", first);
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "กลับไปใช้โลโก้เดิม" }).click();
  await expect(card.getByAltText("โลโก้เดิมของร้าน")).toBeVisible();
  await expect(page.locator(".platform-mark img")).toHaveAttribute("src", "/brand/icon-512.png");
  // Put one back for the chat test.
  await card.getByLabel("เลือกไฟล์โลโก้").setInputFiles({ name: "logo.webp", mimeType: "image/webp", buffer: netflix });
  await expect(page.locator(".platform-mark img")).toBeVisible();
});

test("chat: team replies show the shop logo, customer messages show the customer's photo", async ({ browser }) => {
  const logo = service.overview().shop.logoUrl;
  expect(logo).toMatch(/^\/api\/files\//);
  // Customer with a profile photo.
  const up = await fetch(base + "/api/profile/avatar", {
    method: "POST",
    headers: { Cookie: "astra_session=" + buyerToken, "Content-Type": "image/webp", "X-Astra-Request": "1", Origin: base },
    body: spotify,
  });
  expect(up.status).toBe(200);
  const avatar = (await up.json()).avatarUrl;

  const customer = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await as(customer, buyerToken);
  const shop = await customer.newPage();
  await shop.goto(base + "/");
  await shop.getByRole("button", { name: "แชทกับร้าน" }).click();
  const panel = shop.getByRole("dialog", { name: "แชทกับร้าน" });
  await panel.getByLabel("ข้อความ").fill("สวัสดีครับ");
  await panel.getByRole("button", { name: "ส่ง" }).click();
  await expect(panel.locator(".chat-row.mine .chat-avatar")).toHaveAttribute("src", avatar);

  const team = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await as(team, adminToken);
  const inbox = await team.newPage();
  await inbox.goto(base + "/admin/chat");
  const row = inbox.locator(".admin-chat-thread", { hasText: "Mali Buyer" });
  await expect(row.locator("img.avatar")).toHaveAttribute("src", avatar);
  await row.click();
  const room = inbox.locator(".admin-chat-room");
  await expect(room.locator(".chat-row:not(.mine) .chat-avatar")).toHaveAttribute("src", avatar);
  await room.getByLabel("ข้อความตอบกลับ").fill("สวัสดีค่ะ ยินดีให้บริการ");
  await room.getByRole("button", { name: "ส่ง" }).click();
  await expect(room.locator(".chat-row.mine .chat-avatar").last()).toHaveAttribute("src", logo);

  await expect(panel.locator(".chat-row:not(.mine) .chat-avatar")).toHaveAttribute("src", logo, { timeout: 15000 });
  expect(await shop.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await customer.close();
  await team.close();
});

test("without photos: first letters, and only the last message of a run shows the picture", async ({ browser }) => {
  const other = service.register({ name: "Noi", email: "noi@example.invalid", password: "Noi-buyer-Pass-123" });
  const user = service.session(other.token);
  const opened = service.openChatThread(user, { body: "ข้อความแรก" });
  service.postChatMessage(user, opened.thread.id, { body: "ข้อความที่สอง" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await as(ctx, adminToken);
  const inbox = await ctx.newPage();
  await inbox.goto(base + "/admin/chat?thread=" + opened.thread.id);
  const room = inbox.locator(".admin-chat-room");
  await expect(room.locator(".chat-row")).toHaveCount(2);
  await expect(room.locator(".chat-row").first().locator(".chat-avatar-gap")).toHaveCount(1);
  await expect(room.locator(".chat-row").last().locator(".chat-avatar-letter")).toHaveText("N");
  await ctx.close();
});

test("bell items carry a picture: product cover for orders, customer for chat, shop logo for the customer", async ({ browser }) => {
  const admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const p = service.saveProduct(admin, { name: "Bell Stream", description: "รูปในแจ้งเตือน", category: "streaming", price: 3000, active: true, firstLabel: "1 เดือน" });
  const variantId = service.adminProductVariants(admin, p.id).variants[0].id;
  const up = await fetch(base + "/api/admin/products/" + p.id + "/images", {
    method: "POST",
    headers: { Cookie: "astra_session=" + adminToken, "Content-Type": "image/webp", "X-Astra-Request": "1", Origin: base },
    body: netflix,
  });
  const cover = (await up.json()).image.url;
  service.importCodes(admin, { variantId, items: [{ loginId: "bell1@x.test", password: "p1" }] });
  const buyer = service.session(buyerToken);
  const { randomUUID } = await import("node:crypto");
  service.adjustCustomerCredit(admin, buyer.id, { amount: 10000, reason: "ทดสอบกระดิ่ง", requestKey: randomUUID() });
  const o = service.createOrder(buyer, { variantId, quantity: 1, requestKey: randomUUID() });
  service.pay(buyer, o.id, { paymentToken: o.paymentToken, outcome: "success" });

  const team = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await as(team, adminToken);
  const page = await team.newPage();
  await page.goto(base + "/admin");
  await page.getByRole("button", { name: /แจ้งเตือน/ }).first().click();
  const panel = page.getByRole("dialog", { name: "แจ้งเตือน" });
  await expect(panel.locator(".notice-item", { hasText: "ออเดอร์ใหม่" }).first().locator(".notice-pic img")).toHaveAttribute("src", cover);
  await expect(panel.locator(".notice-item", { hasText: "ลูกค้า" }).first().locator(".notice-pic")).toBeVisible();
  await team.close();

  const shopper = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await as(shopper, buyerToken);
  const shop = await shopper.newPage();
  await shop.goto(base + "/");
  await shop.getByRole("button", { name: /แจ้งเตือน/ }).first().click();
  const mine = shop.getByRole("dialog", { name: "แจ้งเตือน" });
  await expect(mine.locator(".notice-item", { hasText: "ได้รับโค้ดแล้ว" }).first().locator(".notice-pic img")).toHaveAttribute("src", cover);
  await expect(mine.locator(".notice-item", { hasText: "ทีมงาน" }).first().locator(".notice-pic img")).toHaveAttribute("src", /\/api\/files\/|\/brand\/icon-512\.png/);
  await shopper.close();
});

test("a photo sent in chat shows in the bell (team and customer) and the phone panel stays on screen", async ({ browser }) => {
  const buyer = service.session(buyerToken);
  const upload = async (token) => {
    const r = await fetch(base + "/api/chat/images", {
      method: "POST",
      headers: { Cookie: "astra_session=" + token, "Content-Type": "image/webp", "X-Astra-Request": "1", Origin: base },
      body: spotify,
    });
    return (await r.json()).imageId;
  };
  // Fresh thread so the staff alert is not throttled.
  service.db.prepare("UPDATE chat_threads SET status='CLOSED' WHERE user_id=?").run(buyer.id);
  const opened = service.openChatThread(buyer, { imageId: await upload(buyerToken) });
  const sent = opened.messages.at(-1).imageUrl;
  service.postChatMessage(service.session(adminToken), opened.thread.id, { imageId: await upload(adminToken) });
  const reply = service.chatMessages(buyer, opened.thread.id).at(-1).imageUrl;

  const team = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await as(team, adminToken);
  const page = await team.newPage();
  await page.goto(base + "/admin");
  await page.getByRole("button", { name: /แจ้งเตือน/ }).first().click();
  const panel = page.getByRole("dialog", { name: "แจ้งเตือน" });
  await expect(panel.locator(".notice-item", { hasText: "[รูปภาพ]" }).first().locator(".notice-pic.photo img")).toHaveAttribute("src", sent);
  const box = await panel.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await team.close();

  const shopper = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await as(shopper, buyerToken);
  const shop = await shopper.newPage();
  await shop.goto(base + "/");
  await shop.getByRole("button", { name: /แจ้งเตือน/ }).first().click();
  const mine = shop.getByRole("dialog", { name: "แจ้งเตือน" });
  await expect(mine.locator(".notice-item", { hasText: "มีข้อความใหม่จากทีมงาน" }).first().locator(".notice-pic.photo img")).toHaveAttribute("src", reply);
  const box2 = await mine.boundingBox();
  expect(box2.x).toBeGreaterThanOrEqual(0);
  expect(box2.x + box2.width).toBeLessThanOrEqual(390);
  await shopper.close();
});
