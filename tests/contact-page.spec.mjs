// "ติดต่อเรา" page: the admin fills ตั้งค่า › ร้าน › ช่องทางติดต่อ, the storefront /support page
// shows only the filled channels with working tel: / mailto: / LINE / Google Maps links,
// the footer shows phone + LINE + email, and the page fits a 390px phone in light and dark.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

const shots = process.env.CONTACT_SHOTS; // optional folder for review screenshots
let server, service, base, adminToken;
const adminPassword = randomBytes(24).toString("hex");

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

async function asAdmin(page) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "astra_session", value: adminToken, url: base, httpOnly: true, sameSite: "Lax" },
  ]);
}
const shot = (page, name) =>
  shots ? page.screenshot({ path: `${shots}/${name}.png`, fullPage: true, animations: "disabled" }) : null;
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const MESSAGE = "ร้านตอบแชททุกวัน 09:00–22:00 น.\nแจ้งเลขคำสั่งซื้อทุกครั้ง";
const ADDRESS = "99/1 ถนนสุขุมวิท แขวงคลองเตย\nเขตคลองเตย กรุงเทพฯ 10110";

test("empty contact settings: /support keeps the default text and shows no channel cards", async ({ page }) => {
  await page.goto(base + "/support");
  await expect(page.getByRole("heading", { level: 1, name: "ติดต่อเรา" })).toBeVisible();
  await expect(page).toHaveTitle(/^ติดต่อเรา — /);
  await expect(page.locator(".contact-message")).toContainText("หากมีปัญหาเกี่ยวกับการรับโค้ด");
  await expect(page.locator(".contact-channel")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /ตรวจสอบคำสั่งซื้อ/ })).toHaveAttribute("href", "/orders");
  await expect(page.getByRole("heading", { name: "ข้อมูลที่ควรเตรียมเมื่อแจ้งปัญหา" })).toBeVisible();
  // The footer menu always links to the contact page.
  await expect(page.locator(".footer-menu").getByRole("link", { name: "ติดต่อเรา" })).toHaveAttribute("href", "/support");
});

test("admin saves contact details → /support shows them with the right links", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/settings");
  // No fake defaults: empty settings stay empty (hints are placeholders only).
  const line = page.locator('input[name="line"]');
  await expect(line).toHaveValue("");
  await expect(line).toHaveAttribute("placeholder", /@/);
  await expect(page.locator('input[name="email"]')).toHaveValue("");

  await page.getByLabel("ข้อความในหน้าติดต่อเรา").fill(MESSAGE);
  await page.getByLabel("ที่อยู่").fill(ADDRESS);
  await line.fill("@asiaextra");
  await page.locator('input[name="phone"]').fill("081-234 5678");
  await page.locator('input[name="email"]').fill("support@shop.example");
  await page.locator('input[name="facebook"]').fill("https://www.facebook.com/asiaextra.shop");
  await page.locator('input[name="discord"]').fill("asiaextra#0001"); // not a URL → text only
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกการตั้งค่าแล้ว")).toBeVisible();
  const saved = service.settings();
  expect(saved.address).toBe(ADDRESS);
  expect(saved.contactMessage).toBe(MESSAGE);
  expect(saved.phone).toBe("081-234 5678");

  await page.context().clearCookies();
  await page.goto(base + "/support");
  const message = page.locator(".contact-message");
  await expect(message).toHaveText(MESSAGE);
  // Line breaks are kept on screen.
  expect(await message.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-line");

  const card = (key) => page.locator(`.contact-channel[data-channel="${key}"]`);
  await expect(page.locator(".contact-channel")).toHaveCount(6);
  await expect(card("phone")).toHaveAttribute("href", "tel:0812345678");
  await expect(card("phone")).not.toHaveAttribute("target", /.+/);
  await expect(card("email")).toHaveAttribute("href", "mailto:support@shop.example");
  await expect(card("email")).toHaveAttribute("id", "email");
  await expect(card("line")).toHaveAttribute("href", "https://line.me/R/ti/p/%40asiaextra");
  await expect(card("line")).toHaveAttribute("target", "_blank");
  await expect(card("line")).toHaveAttribute("rel", "noopener noreferrer");
  await expect(card("facebook")).toHaveAttribute("href", "https://www.facebook.com/asiaextra.shop");
  await expect(card("facebook")).toContainText("facebook.com/asiaextra.shop");
  await expect(card("discord")).toContainText("asiaextra#0001");
  expect(await card("discord").evaluate((el) => el.tagName)).toBe("DIV");
  await expect(card("address")).toHaveAttribute(
    "href",
    "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(ADDRESS.replace(/\s+/g, " ")),
  );
  await expect(card("address").locator(".contact-channel-value")).toHaveText(ADDRESS);
  await expect(card("address")).toHaveAttribute("rel", "noopener noreferrer");

  // Footer: LINE, phone and email cards all lead to the contact page.
  const footer = page.locator(".footer-contact");
  await expect(footer.getByRole("heading", { name: "ติดต่อเรา" })).toBeVisible();
  await expect(footer.locator(".contact-card")).toHaveCount(3);
  await expect(footer.locator(".contact-card", { hasText: "081-234 5678" })).toHaveAttribute("href", "/support");
  await expect(footer.locator(".contact-card", { hasText: "support@shop.example" })).toHaveAttribute("href", "/support#email");

  // English storefront translates the labels; admin text stays as typed.
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contact us" })).toBeVisible();
  await expect(card("phone")).toContainText("Phone");
  await expect(card("address")).toContainText("Address");
  await expect(card("address")).toContainText("Open in Maps");
  await page.getByRole("button", { name: "TH", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "ติดต่อเรา" })).toBeVisible();
  await shot(page, "contact-desktop-light");
});

test("contact page fits 390px in light and dark themes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/support");
  await expect(page.locator(".contact-channel")).toHaveCount(6);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    expect(await noSideScroll(page), theme).toBe(true);
    const colors = await page.locator('.contact-channel[data-channel="phone"]').evaluate((el) => {
      const style = getComputedStyle(el);
      const page = getComputedStyle(document.querySelector(".storefront-shell") ?? document.body);
      return { bg: style.backgroundColor, fg: style.color, shell: page.backgroundColor };
    });
    if (theme === "light") expect(colors.bg).toBe("rgb(255, 255, 255)");
    else expect(colors.bg).not.toBe("rgb(255, 255, 255)");
    expect(colors.fg, theme).not.toBe(colors.bg);
    // Every card stays inside the viewport.
    const right = await page
      .locator(".contact-channel")
      .evaluateAll((els) => Math.max(...els.map((el) => el.getBoundingClientRect().right)));
    expect(right, theme).toBeLessThanOrEqual(390);
    await shot(page, "contact-390-" + theme);
  }
});

test("blank fields hide again and a LINE URL is used as-is", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/settings");
  await page.getByLabel("ที่อยู่").fill("");
  await page.getByLabel("ข้อความในหน้าติดต่อเรา").fill("");
  for (const name of ["phone", "email", "facebook", "discord"]) await page.locator(`input[name="${name}"]`).fill("");
  await page.locator('input[name="line"]').fill("https://lin.ee/AbCdEf1");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกการตั้งค่าแล้ว")).toBeVisible();

  await page.context().clearCookies();
  await page.goto(base + "/support");
  await expect(page.locator(".contact-channel")).toHaveCount(1);
  await expect(page.locator('.contact-channel[data-channel="line"]')).toHaveAttribute("href", "https://lin.ee/AbCdEf1");
  await expect(page.locator(".contact-message")).toContainText("หากมีปัญหาเกี่ยวกับการรับโค้ด");
  await expect(page.locator(".footer-contact .contact-card")).toHaveCount(1);
});
