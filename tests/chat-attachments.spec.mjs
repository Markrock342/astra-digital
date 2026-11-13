// Live chat attachments through the real UI: ask about a product from its page, paste an image
// from the clipboard, attach an order from the menu; the admin inbox shows the image and cards
// that open the back-office product / order / customer, and the team can reply with the same.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, buyerToken, buyer, product, orderId;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  product = service.saveProduct(admin, {
    name: "Chat Card Stream",
    description: "สินค้าทดสอบการ์ดในแชท",
    category: "streaming",
    price: 14900,
    active: true,
    firstLabel: "1 เดือน",
  });
  const variantId = service.adminProductVariants(admin, product.id).variants[0].id;
  service.importCodes(admin, { variantId, items: [{ loginId: "chat-card", password: "pw-chat-card" }] });
  const auth = service.register({ name: "Chat Card Buyer", email: "chat-card@example.invalid", password: "Chat-card-Pass-123" });
  buyerToken = auth.token;
  buyer = service.session(buyerToken);
  orderId = service.createOrder(buyer, { variantId, quantity: 1, requestKey: "chat-card-1" }).id;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(context, token) {
  await context.clearCookies();
  await context.addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** Pastes an image file into the focused-or-given textarea, like Ctrl/⌘+V of a screenshot. */
async function pasteImage(locator) {
  await locator.evaluate(async (el) => {
    const blob = await (await fetch("/library/netflix.webp")).blob();
    const data = new DataTransfer();
    data.items.add(new File([blob], "screenshot.webp", { type: "image/webp" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
}
const number = () => orderId.slice(0, 8).toUpperCase();

test("customer: ask about a product, paste a screenshot, send; then attach an order from the menu", async ({ page }) => {
  await as(page.context(), buyerToken);
  await page.goto(base + "/products/" + product.id);
  await page.getByRole("button", { name: "สอบถามสินค้านี้ในแชท" }).click();
  const panel = page.getByRole("dialog", { name: "แชทกับร้าน" });
  await expect(panel).toBeVisible();
  await expect(page.locator(".chat-attach-chip")).toContainText("Chat Card Stream");
  const box = panel.getByLabel("ข้อความ");
  await pasteImage(box);
  await expect(page.locator(".chat-attach-chip.has-thumb img")).toBeVisible();
  await box.fill("ตัวนี้ใช้กับทีวีได้ไหม");
  await panel.getByRole("button", { name: "ส่ง" }).click();
  const bubble = panel.locator(".chat-bubble", { hasText: "ตัวนี้ใช้กับทีวีได้ไหม" });
  await expect(bubble).toContainText("ตัวนี้ใช้กับทีวีได้ไหม");
  await expect(bubble.locator(".chat-image img")).toHaveAttribute("src", /^\/api\/chat\/files\/chat-/);
  await expect(bubble.locator(".chat-card")).toContainText("Chat Card Stream");
  await expect(bubble.locator(".chat-card")).toHaveAttribute("href", "/products/" + product.id);
  await expect(page.locator(".chat-attach-chip")).toHaveCount(0);
  // The image loads for its owner (private route, cookie auth).
  const loaded = await bubble.locator(".chat-image img").evaluate((img) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);

  // Order from the menu, no text needed.
  await panel.getByRole("button", { name: "แนบรูป สินค้า หรือคำสั่งซื้อ" }).click();
  await page.getByRole("menuitem", { name: "คำสั่งซื้อของฉัน" }).click();
  const picker = page.getByRole("dialog", { name: "เลือกคำสั่งซื้อ" });
  await expect(picker).toContainText("#" + number());
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noHorizontalScroll(page)).toBe(true);
  await picker.getByRole("button", { name: new RegExp(number()) }).click();
  await expect(page.locator(".chat-attach-chip")).toContainText("#" + number());
  await panel.getByRole("button", { name: "ส่ง" }).click();
  const orderCard = panel.locator(".chat-bubble").last().locator(".chat-card");
  await expect(orderCard).toContainText("#" + number() + " · Chat Card Stream");
  await expect(orderCard).toHaveAttribute("href", "/orders/" + orderId);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Full-size viewer.
  await bubble.locator(".chat-image").click();
  await expect(page.getByRole("dialog", { name: "รูปในแชท" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "รูปในแชท" })).toHaveCount(0);
});

test("admin: sees image + cards, opens order / product / customer, replies with a pasted image", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await as(context, adminToken);
  const page = await context.newPage();
  await page.goto(base + "/admin/chat");
  const thread = page.locator(".admin-chat-thread", { hasText: "Chat Card Buyer" });
  await expect(thread).toContainText("ออเดอร์ #" + number());
  await thread.click();
  const room = page.locator(".admin-chat-room");
  await expect(room.locator(".chat-image img")).toHaveCount(1);
  const productCard = room.locator(".chat-card", { hasText: "จัดการสินค้า" });
  await expect(productCard).toHaveAttribute("href", "/admin/products/" + product.id);
  const orderCard = room.locator(".chat-card", { hasText: "จัดการออเดอร์" });
  await expect(orderCard).toHaveAttribute("href", "/admin/orders/" + orderId);
  await expect(room.getByRole("link", { name: "ข้อมูลลูกค้า" })).toHaveAttribute("href", "/admin/customers/" + buyer.id);

  // Reply: pasted image + the customer's order from the menu.
  const box = room.getByLabel("ข้อความตอบกลับ");
  await pasteImage(box);
  await expect(room.locator(".chat-attach-chip.has-thumb")).toBeVisible();
  await room.getByRole("button", { name: "แนบรูป สินค้า หรือคำสั่งซื้อ" }).click();
  await page.getByRole("menuitem", { name: "คำสั่งซื้อของลูกค้าคนนี้" }).click();
  await page.getByRole("dialog", { name: "เลือกคำสั่งซื้อ" }).getByRole("button", { name: new RegExp(number()) }).click();
  await box.fill("วิธีตั้งค่าตามรูปนี้ครับ");
  await room.getByRole("button", { name: "ส่ง" }).click();
  const last = room.locator(".chat-bubble").last();
  await expect(last).toContainText("วิธีตั้งค่าตามรูปนี้ครับ");
  await expect(last.locator(".chat-image img")).toBeVisible();
  await expect(last.locator(".chat-card")).toContainText("#" + number());

  await orderCard.first().click();
  await expect(page).toHaveURL(base + "/admin/orders/" + orderId);
  await context.close();

  // The customer sees the team's image; a different customer cannot fetch it.
  const sent = service.db.prepare("SELECT image_key FROM chat_messages WHERE sender_type='ADMIN' AND image_key IS NOT NULL").get();
  const other = service.register({ name: "Nosy", email: "nosy@example.invalid", password: "Nosy-only-Pass-123" });
  const forOwner = await fetch(base + "/api/chat/files/" + sent.image_key, { headers: { Cookie: "astra_session=" + buyerToken } });
  expect(forOwner.status).toBe(200);
  const forOther = await fetch(base + "/api/chat/files/" + sent.image_key, { headers: { Cookie: "astra_session=" + other.token } });
  expect(forOther.status).toBe(404);
});

test("order page: ask about this order opens the chat with the order attached", async ({ page }) => {
  await as(page.context(), buyerToken);
  await page.goto(base + "/orders/" + orderId);
  await page.getByRole("button", { name: "สอบถามเรื่องคำสั่งซื้อนี้" }).click();
  await expect(page.getByRole("dialog", { name: "แชทกับร้าน" })).toBeVisible();
  await expect(page.locator(".chat-attach-chip")).toContainText("#" + number() + " · Chat Card Stream");
});
