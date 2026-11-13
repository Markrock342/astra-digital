// Team inbox: a pin rises to the top, search highlights a real <mark>, and 390px does not overflow.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken;
const adminPassword = randomBytes(24).toString("hex");
const orderId = "66af8b46-1111-4222-8333-444444444444";

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const older = service.session(service.register({ name: "ค้นหาชื่อพิเศษ", email: "pin-ui-old@example.invalid", password: "Buyer-only-Password-123" }).token);
  const newer = service.session(service.register({ name: "คนใหม่กว่า", email: "pin-ui-new@example.invalid", password: "Buyer-only-Password-123" }).token);
  const first = service.openChatThread(older, { body: "ข้อความสีส้มในแชท" });
  const second = service.openChatThread(newer, { body: "ทักทีหลัง" });
  service.db.prepare("UPDATE chat_messages SET created_at=datetime('now','+5 seconds') WHERE thread_id=?").run(second.thread.id);
  service.db.prepare("UPDATE chat_threads SET order_id=? WHERE id=?").run(orderId, first.thread.id);
  mkdirSync("test-results/chat-pin-search", { recursive: true });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function asAdmin(context) {
  await context.clearCookies();
  await context.addCookies([{ name: "astra_session", value: adminToken, url: base, httpOnly: true, sameSite: "Lax" }]);
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("pin rises to the top, search highlights, and 390px stays on screen", async ({ page }) => {
  await asAdmin(page.context());
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base + "/admin/chat");
  const rows = page.locator(".admin-chat-thread");
  await expect(rows.first()).toContainText("คนใหม่กว่า");
  await rows.filter({ hasText: "ค้นหาชื่อพิเศษ" }).click();
  await page.getByRole("button", { name: "ปักหมุด" }).click();
  await expect(page.getByRole("button", { name: "เลิกปักหมุด" })).toBeVisible();
  await expect(rows.first()).toContainText("ค้นหาชื่อพิเศษ");
  await expect(rows.first().locator(".chat-pin-mark")).toBeVisible();
  await page.screenshot({ path: "test-results/chat-pin-search/pinned-list.png" });

  const search = page.getByLabel("ค้นหาแชท");
  await search.fill("สีส้ม");
  const hit = rows.filter({ hasText: "ค้นหาชื่อพิเศษ" });
  await expect(hit.locator("mark.chat-hit")).toContainText("สีส้ม");
  await page.screenshot({ path: "test-results/chat-pin-search/search-highlight.png" });
  await search.fill("#66AF8B46");
  await expect(hit).toBeVisible();
  await search.fill("66af8b46");
  await expect(hit).toBeVisible();
  await search.fill("ค้นหาชื่อพิเศษ");
  await expect(hit.locator("mark.chat-hit").first()).toContainText("ค้นหาชื่อ");
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");

  await page.setViewportSize({ width: 390, height: 844 });
  const pinBox = await page.getByRole("button", { name: "เลิกปักหมุด" }).boundingBox();
  expect(pinBox.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "กลับไปรายการแชท" }).click();
  await search.fill("สีส้ม");
  await expect(hit.locator("mark.chat-hit")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  const field = await page.locator(".chat-inbox-search").boundingBox();
  expect(field.width).toBeGreaterThan(300);
  const clear = await page.getByRole("button", { name: "ล้างการค้นหา" }).boundingBox();
  expect(clear.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: "test-results/chat-pin-search/390-light.png" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: "test-results/chat-pin-search/390-dark.png" });
  expect(await noHorizontalScroll(page)).toBe(true);
});
