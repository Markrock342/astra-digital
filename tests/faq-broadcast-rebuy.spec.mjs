// Editable FAQ → product page + /faq search, announcements to buyers of one product (bell),
// and "ซื้อซ้ำ" / "ต่ออายุ" from the order history, at desktop and 390px.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, admin;
let buyerToken, otherToken, buyer, other;
let streamId, streamVariant, otherId, otherVariant, deliveredId;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.FAQ_SHOTS; // optional folder for review screenshots
const XSS = '<img src=x onerror="window.__faqXss=1">';

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const make = (name) => {
    const p = service.saveProduct(admin, {
      name,
      description: name + " บัญชีสตรีมมิ่งรายเดือน",
      category: "streaming",
      price: 12900,
      active: true,
      firstLabel: "1 เดือน",
      firstWarrantyDays: 30,
    });
    return [p.id, service.adminProductVariants(admin, p.id).variants[0].id];
  };
  [streamId, streamVariant] = make("Rebuy Stream Plus");
  [otherId, otherVariant] = make("Quiet Music");
  service.importCodes(admin, {
    variantId: streamVariant,
    items: Array.from({ length: 6 }, (_, i) => ({ loginId: "rebuy-" + i + "@stream.test", password: "Pw-" + i })),
  });
  service.importCodes(admin, {
    variantId: otherVariant,
    items: [{ loginId: "music-0@stream.test", password: "Pw-m" }],
  });
  const reg = (name, email) => service.register({ name, email, password: "Buyer-Pass-12345" }).token;
  buyerToken = reg("Stream Buyer", "stream-buyer@example.invalid");
  otherToken = reg("Music Buyer", "music-buyer@example.invalid");
  buyer = service.session(buyerToken);
  other = service.session(otherToken);
  const buy = (user, variantId, quantity, key) => {
    const o = service.createOrder(user, { variantId, quantity, requestKey: key });
    return service.pay(user, o.id, { paymentToken: o.paymentToken, outcome: "success" });
  };
  deliveredId = buy(buyer, streamVariant, 2, "e2e-rebuy-order-1").id;
  // The other customer bought the other product; its last unit is now sold (out of stock).
  buy(other, otherVariant, 1, "e2e-music-order-1");
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(context, token) {
  await context.clearCookies();
  if (token)
    await context.addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shot = (page, name) =>
  shots ? page.screenshot({ path: `${shots}/${name}.png`, fullPage: true, animations: "disabled" }) : null;

test("admin edits the FAQ; the product page and /faq show it, search works, JSON-LD passes the CSP", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/settings/faq");
  await expect(page.getByRole("navigation", { name: "เมนูย่อย" }).getByRole("link", { name: "คำถามที่พบบ่อย" })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "คำถามที่พบบ่อย", level: 1 })).toBeVisible();
  // Defaults are filled in.
  await expect(page.getByRole("textbox", { name: "คำถามที่ 1", exact: true })).toHaveValue("ได้รับสินค้าเมื่อไหร่");
  const preview = page.locator(".faq-preview");
  await expect(preview).toContainText("สินค้ามีการรับประกันอย่างไร");

  // Edit the first answer (markup must stay literal).
  await page.getByRole("textbox", { name: "คำตอบของคำถามที่ 1", exact: true }).fill("ส่งทันทีหลังชำระเงิน\n\n- ดูได้ที่ประวัติการซื้อ\n- " + XSS);
  await expect(page.locator(".faq-item-card").first().locator(".legal-badge")).toHaveText("แก้ไขแล้ว");
  // Hide "ติดต่อร้านได้ทางไหน".
  const contact = page.locator(".faq-item-card", { has: page.locator('input[value="ติดต่อร้านได้ทางไหน"]') });
  await contact.getByLabel("ซ่อนจากหน้าร้าน").check();
  await expect(contact.locator(".faq-badge-hidden")).toBeVisible();
  // Add a product-only question and move it to the top.
  await page.getByRole("button", { name: "เพิ่มคำถาม" }).click();
  const n = await page.locator(".faq-item-card").count();
  await page.getByRole("textbox", { name: `คำถามที่ ${n}`, exact: true }).fill("Rebuy Stream Plus ใช้ได้กี่จอ");
  await page.getByRole("textbox", { name: `คำตอบของคำถามที่ ${n}`, exact: true }).fill("ใช้ได้ 1 จอต่อบัญชี");
  await page.getByLabel(`แสดงคำถามที่ ${n} ที่`).selectOption("products");
  await page.getByRole("group", { name: new RegExp(`เลือกสินค้าสำหรับคำถามที่ ${n}`) }).getByLabel("Rebuy Stream Plus").check();
  for (let i = n; i > 1; i--) await page.getByRole("button", { name: `เลื่อนคำถามที่ ${i} ขึ้น`, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "คำถามที่ 1", exact: true })).toHaveValue("Rebuy Stream Plus ใช้ได้กี่จอ");
  // Preview for that product puts it first; the /faq preview does not show it.
  await page.getByLabel("ดูตัวอย่างของหน้า").selectOption(streamId);
  await expect(preview.locator("details").first()).toContainText("Rebuy Stream Plus ใช้ได้กี่จอ");
  await page.getByLabel("ดูตัวอย่างของหน้า").selectOption("page");
  await expect(preview).not.toContainText("Rebuy Stream Plus ใช้ได้กี่จอ");
  await shot(page, "admin-faq-desktop");
  await page.getByRole("button", { name: "บันทึกคำถามที่พบบ่อย" }).click();
  await expect(page.locator(".toast")).toContainText("บันทึกคำถามที่พบบ่อยแล้ว");
  await expect(page.locator(".legal-save-bar")).toContainText("ตรงกับหน้าร้าน");
  expect(service.faq().faq.items[0].productIds).toEqual([streamId]);

  // Storefront product page (visitor), CSP violations recorded.
  await as(page.context(), null);
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
  });
  await page.goto(base + "/products/" + encodeURIComponent(streamId));
  const faq = page.locator(".product-faq");
  await expect(faq.getByRole("heading", { name: "คำถามที่พบบ่อย" })).toBeVisible();
  await expect(faq.locator("details").first()).toContainText("Rebuy Stream Plus ใช้ได้กี่จอ");
  await expect(faq).toContainText("ได้รับสินค้าเมื่อไหร่");
  await expect(faq).not.toContainText("ติดต่อร้านได้ทางไหน");
  await faq.locator("details", { hasText: "ได้รับสินค้าเมื่อไหร่" }).locator("summary").click();
  const answer = faq.locator("details", { hasText: "ได้รับสินค้าเมื่อไหร่" }).locator(".faq-answer");
  await expect(answer.locator("li")).toHaveCount(2);
  await expect(answer).toContainText(XSS);
  await expect(answer.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__faqXss)).toBeUndefined();
  // Another product does not get the product-only question.
  await page.goto(base + "/products/" + encodeURIComponent(otherId));
  await expect(page.locator(".product-faq")).toContainText("ได้รับสินค้าเมื่อไหร่");
  await expect(page.locator(".product-faq")).not.toContainText("ใช้ได้กี่จอ");

  // /faq from the footer: search, JSON-LD, no CSP violation.
  await page.locator(".site-footer").getByRole("link", { name: "คำถามที่พบบ่อย" }).click();
  await expect(page).toHaveURL(base + "/faq");
  await expect(page.getByRole("heading", { name: "คำถามที่พบบ่อย", level: 1 })).toBeVisible();
  const items = page.locator(".faq-page details");
  const total = await items.count();
  expect(total).toBeGreaterThan(4);
  await expect(page.locator(".faq-page")).not.toContainText("ใช้ได้กี่จอ");
  await expect(page.locator(".faq-page")).not.toContainText("ติดต่อร้านได้ทางไหน");
  const ld = await page.locator('script[type="application/ld+json"]').textContent();
  const data = JSON.parse(ld);
  expect(data["@type"]).toBe("FAQPage");
  expect(data.mainEntity.length).toBe(total);
  expect(ld).not.toContain("<img");
  await page.getByLabel("ค้นหาคำถาม").fill("รับประกัน");
  await expect(page.locator(".faq-count")).toContainText("พบ");
  await expect(items.first()).toHaveAttribute("open", "");
  expect(await items.count()).toBeLessThan(total);
  await expect(page.locator(".faq-page")).toContainText("สินค้ามีการรับประกันอย่างไร");
  await expect(page).toHaveURL(/\?q=/);
  await page.getByLabel("ค้นหาคำถาม").fill("ไม่มีคำนี้แน่นอน xyz");
  await expect(page.getByRole("heading", { name: "ไม่พบคำถามที่ตรงกับคำค้น" })).toBeVisible();
  await page.getByRole("button", { name: "ล้างการค้นหา" }).first().click();
  await expect(items).toHaveCount(total);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  await shot(page, "faq-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("ค้นหาคำถาม").fill("รับประกัน");
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "faq-390");
  // English storefront: untouched defaults translate.
  await page.evaluate(() => localStorage.setItem("asiax-lang", "en"));
  await page.goto(base + "/faq");
  await expect(page.getByRole("heading", { name: "FAQ", level: 1 })).toBeVisible();
  await expect(page.locator(".faq-page")).toContainText("How does the warranty work?");
  await page.evaluate(() => localStorage.setItem("asiax-lang", "th"));
});

test("admin sends an announcement to buyers of one product; only that customer's bell shows it", async ({ page, browser }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/broadcasts");
  await expect(page.getByRole("navigation", { name: "เมนูย่อย" }).getByRole("link", { name: "ประกาศถึงลูกค้า" })).toHaveClass(/active/);
  await expect(page.locator(".reference-primary-nav").getByRole("link", { name: "ลูกค้า" })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "ประกาศถึงลูกค้า", level: 1 })).toBeVisible();
  const everyone = service.broadcastPreview(admin, { audience: "all" }).count;
  await expect(page.getByTestId("broadcast-count")).toHaveText(String(everyone));
  await page.getByLabel("หัวข้อ", { exact: true }).fill("ต่ออายุ Rebuy Stream Plus");
  await page.getByLabel("ข้อความ", { exact: true }).fill("บัญชีของคุณใกล้ครบรอบแล้ว\nกดซื้อซ้ำได้ที่ประวัติการซื้อ");
  await page.getByLabel("ลิงก์ (ไม่บังคับ)", { exact: true }).fill("javascript:alert(1)");
  await expect(page.locator(".broadcast-field-error")).toBeVisible();
  await page.getByLabel("ลิงก์ (ไม่บังคับ)", { exact: true }).fill("/orders");
  await page.getByRole("radio", { name: /ลูกค้าที่ซื้อสินค้า/ }).check();
  await page.getByLabel("สินค้า", { exact: true }).selectOption(streamId);
  await page.getByLabel("ซื้อภายใน (วัน)").fill("30");
  await expect(page.getByTestId("broadcast-count")).toHaveText("1");
  await expect(page.locator(".broadcast-count")).toContainText("ลูกค้าที่ซื้อ Rebuy Stream Plus ใน 30 วันที่ผ่านมา");
  await expect(page.locator(".broadcast-bell-preview")).toContainText("ต่ออายุ Rebuy Stream Plus");
  await expect(page.getByLabel("ส่งอีเมลด้วย")).toBeDisabled();
  await shot(page, "admin-broadcast-desktop");
  await page.getByRole("button", { name: "ตรวจสอบและส่ง" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการส่งประกาศ" });
  await expect(dialog).toContainText("1 คน");
  await dialog.getByLabel(/รหัสผ่านของคุณ/).fill("wrong-password-123");
  await dialog.getByRole("button", { name: "ส่งประกาศ" }).click();
  await expect(dialog.locator(".error-message")).toContainText("รหัสผ่านไม่ถูกต้อง");
  await dialog.getByLabel(/รหัสผ่านของคุณ/).fill(adminPassword);
  await dialog.getByRole("button", { name: "ส่งประกาศ" }).click();
  await expect(page.locator(".toast")).toContainText("ส่งประกาศถึงลูกค้า 1 คนแล้ว");
  await expect(dialog).toHaveCount(0);
  const row = page.locator(".broadcast-history tbody tr").first();
  await expect(row).toContainText("ต่ออายุ Rebuy Stream Plus");
  await expect(row).toContainText("ลูกค้าที่ซื้อ Rebuy Stream Plus ใน 30 วันที่ผ่านมา");
  await expect(row).toContainText("1");
  await expect(page.locator(".broadcast-quota")).toContainText("1/5");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "admin-broadcast-390");

  // The buyer sees it in the bell; clicking opens the link.
  const buyerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await as(buyerContext, buyerToken);
  const shopper = await buyerContext.newPage();
  await shopper.goto(base + "/");
  await shopper.getByRole("button", { name: /แจ้งเตือน/ }).click();
  const panel = shopper.getByRole("dialog", { name: "แจ้งเตือน" });
  const notice = panel.locator(".notice-item", { hasText: "ต่ออายุ Rebuy Stream Plus" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("กดซื้อซ้ำได้ที่ประวัติการซื้อ");
  expect(await noSideScroll(shopper)).toBe(true);
  await shot(shopper, "bell-390");
  await notice.click();
  await expect(shopper).toHaveURL(base + "/orders");
  await buyerContext.close();

  // The other customer (bought a different product) does not.
  const otherContext = await browser.newContext();
  await as(otherContext, otherToken);
  const second = await otherContext.newPage();
  await second.goto(base + "/");
  await second.getByRole("button", { name: /แจ้งเตือน/ }).click();
  await expect(second.getByRole("dialog", { name: "แจ้งเตือน" })).toBeVisible();
  await expect(second.getByRole("dialog", { name: "แจ้งเตือน" })).not.toContainText("ต่ออายุ Rebuy Stream Plus");
  await otherContext.close();
});

test("buy again goes to checkout with the same option and quantity; renew and out-of-stock states", async ({ page }) => {
  await as(page.context(), buyerToken);
  await page.goto(base + "/orders");
  const card = page.locator(".history-item", { hasText: "Rebuy Stream Plus" });
  await expect(card.getByRole("button", { name: /^ซื้อซ้ำ/ })).toBeVisible();
  await card.getByRole("button", { name: /^ซื้อซ้ำ/ }).click();
  await expect(page).toHaveURL(base + "/checkout");
  await expect(page.getByRole("heading", { name: "สรุปรายการ" })).toBeVisible();
  await expect(page.locator(".cart-line")).toContainText("Rebuy Stream Plus");
  await expect(page.locator(".cart-line")).toContainText("1 เดือน · × 2");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("astra-cart")))).toEqual([
    { variantId: streamVariant, quantity: 2, selected: true },
  ]);

  // Warranty (used as the subscription end) inside 5 days → "ใกล้หมดอายุ? ต่ออายุ".
  const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 19).replace("T", " ");
  service.db.prepare("UPDATE orders SET warranty_until=? WHERE id=?").run(soon, deliveredId);
  await page.goto(base + "/orders/" + deliveredId);
  const actions = page.locator(".result-actions .rebuy-actions");
  await expect(actions).toContainText("ใกล้หมดอายุ?");
  await expect(actions.getByRole("button", { name: /^ต่ออายุ/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "order-renew-390");
  await page.goto(base + "/orders");
  await expect(page.locator(".history-item", { hasText: "Rebuy Stream Plus" }).locator(".rebuy-actions")).toContainText("ใกล้หมดอายุ?");
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "history-390");
  await page.locator(".history-item", { hasText: "Rebuy Stream Plus" }).getByRole("button", { name: /^ต่ออายุ/ }).click();
  await expect(page).toHaveURL(base + "/checkout");

  // Out of stock: the other buyer's product sold its last unit.
  await as(page.context(), otherToken);
  await page.goto(base + "/orders");
  const music = page.locator(".history-item", { hasText: "Quiet Music" });
  await expect(music.locator(".rebuy-out-badge")).toHaveText("สินค้าหมด");
  await expect(music.getByRole("button", { name: /^ซื้อซ้ำ/ })).toHaveCount(0);
  await music.getByRole("link", { name: "ดูสินค้า" }).click();
  await expect(page).toHaveURL(base + "/products/" + encodeURIComponent(otherId));

  // Closed for sale → link to the product list.
  service.saveProduct(admin, {
    id: otherId,
    name: "Quiet Music",
    description: "Quiet Music บัญชีสตรีมมิ่งรายเดือน",
    category: "streaming",
    price: 12900,
    active: false,
  });
  await page.goto(base + "/orders");
  await expect(music.locator(".rebuy-out-badge")).toHaveText("สินค้านี้ไม่มีขายแล้ว");
  await music.getByRole("link", { name: "ดูสินค้าอื่น" }).click();
  await expect(page).toHaveURL(base + "/products");
});

test("390px: admin FAQ editor and product FAQ have no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/settings/faq");
  await expect(page.getByRole("heading", { name: "คำถามที่พบบ่อย", level: 1 })).toBeVisible();
  await page.getByLabel("แสดงคำถามที่ 2 ที่").selectOption("products");
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "admin-faq-390");
  await as(page.context(), null);
  await page.goto(base + "/products/" + encodeURIComponent(streamId));
  await expect(page.locator(".product-faq")).toBeVisible();
  await page.locator(".product-faq details").first().locator("summary").click();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "product-faq-390");
});
