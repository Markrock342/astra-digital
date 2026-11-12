// Legal pages form → storefront /terms + /privacy, footer credit in every theme,
// robots/sitemap from the Node server, and 390px layouts.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.LEGAL_SHOTS; // optional folder for review screenshots

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
  if (token)
    await page.context().addCookies([
      { name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" },
    ]);
}
async function ready(page, path) {
  await page.goto(base + path);
  await expect(page.getByRole("heading", { name: "เชื่อมต่อร้านค้าไม่ได้" })).toHaveCount(0);
  await page.locator(".loading-row").first().waitFor({ state: "hidden" });
}
const noSideScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shot = (page, name) =>
  shots ? page.screenshot({ path: `${shots}/${name}.png`, fullPage: true, animations: "disabled" }) : null;

const XSS = '<img src=x onerror="window.__legalXss=1">';

test("admin fills the legal form; the storefront terms and privacy pages show it", async ({ page }) => {
  await as(page, adminToken);
  await ready(page, "/admin/settings/legal");
  await expect(page.getByRole("navigation", { name: "เมนูย่อย" }).getByRole("link", { name: "ข้อกำหนดและนโยบาย" })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "ข้อกำหนดและนโยบาย", level: 1 })).toBeVisible();
  const missing = page.locator(".legal-missing");
  await expect(missing).toContainText("ที่อยู่ที่จดทะเบียน");
  await expect(missing).toContainText("วันที่มีผลบังคับใช้");
  // Defaults are there out of the box, preview included.
  const preview = page.locator(".legal-preview");
  await expect(preview).toContainText("ข้อห้ามในการใช้งาน");
  await expect(preview).toContainText("ทรัพย์สินทางปัญญาและเครื่องหมายการค้า");

  await page.getByLabel("ชื่อผู้ประกอบการหรือนิติบุคคล").fill("บริษัท ทดสอบ อีทูอี จำกัด");
  await page.getByLabel("ที่อยู่ที่จดทะเบียน").fill("1 ถนนทดสอบ กรุงเทพมหานคร 10110");
  await page.getByLabel("ผู้ประสานงานด้านข้อมูลส่วนบุคคล").fill("ฝ่ายคุ้มครองข้อมูล");
  await page.getByLabel("อีเมลติดต่อ").fill("legal@e2e.example");
  await page.getByLabel("โทรศัพท์").fill("02-111-2222");
  await page.getByLabel("LINE", { exact: false }).first().fill("@e2elegal");
  await page.locator('input[name="effectiveDate"]').fill("2026-11-13");
  await expect(missing).toHaveCount(0);
  await expect(page.locator(".legal-complete")).toBeVisible();

  const body1 = page.getByRole("textbox", { name: "เนื้อหาหัวข้อที่ 1", exact: true });
  await body1.fill("ข้อความทดสอบ E2E ของ {{entityName}}\n\n- ข้อหนึ่ง " + XSS);
  await expect(page.locator(".legal-section-card").first().locator(".legal-badge")).toHaveText("แก้ไขแล้ว");
  await expect(preview).toContainText("ข้อความทดสอบ E2E ของ บริษัท ทดสอบ อีทูอี จำกัด");
  // Reorder: move section 2 (acceptance) up to first place.
  await page.getByRole("button", { name: "เลื่อนหัวข้อที่ 2 ขึ้น", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "ชื่อหัวข้อที่ 1", exact: true })).toHaveValue("การยอมรับข้อกำหนด");
  // Add a custom section and remove "ข้อห้ามในการใช้งาน".
  await page.getByRole("button", { name: "เพิ่มหัวข้อ" }).click();
  const count = await page.locator(".legal-section-card").count();
  await page.getByRole("textbox", { name: `ชื่อหัวข้อที่ ${count}`, exact: true }).fill("บัญชีใช้ร่วมกัน");
  await page.getByRole("textbox", { name: `เนื้อหาหัวข้อที่ ${count}`, exact: true }).fill("บัญชีครอบครัวใช้ได้ตามจำนวนที่ระบุในหน้าสินค้า");
  const prohibited = page.locator(".legal-section-card", {
    has: page.locator('input[value="ข้อห้ามในการใช้งาน"]'),
  });
  await prohibited.getByRole("button", { name: /^ลบหัวข้อที่/ }).click();
  await expect(preview).not.toContainText("ข้อห้ามในการใช้งาน");
  await expect(page.locator(".legal-restore select")).toContainText("ข้อห้ามในการใช้งาน");
  await shot(page, "admin-legal-desktop");
  await page.getByRole("button", { name: "บันทึกข้อกำหนดและนโยบาย" }).click();
  await expect(page.locator(".toast")).toContainText("บันทึกข้อกำหนดและนโยบายแล้ว");
  await expect(page.locator(".legal-save-bar")).toContainText("ตรงกับหน้าร้าน");

  // Storefront /terms (as a visitor).
  await as(page, null);
  await ready(page, "/terms");
  const main = page.locator("main.legal-page");
  await expect(main.getByRole("heading", { name: "ข้อกำหนดการใช้บริการ", level: 1 })).toBeVisible();
  await expect(main.locator(".legal-effective")).toHaveText("มีผลบังคับใช้ตั้งแต่ 13 พฤศจิกายน 2569");
  await expect(main.locator(".legal-section").first().locator("h2")).toContainText("1.การยอมรับข้อกำหนด");
  await expect(main).toContainText("ข้อความทดสอบ E2E ของ บริษัท ทดสอบ อีทูอี จำกัด");
  await expect(main).toContainText("บัญชีใช้ร่วมกัน");
  await expect(main).not.toContainText("ข้อห้ามในการใช้งาน");
  await expect(main).toContainText("ที่อยู่: 1 ถนนทดสอบ กรุงเทพมหานคร 10110");
  // Typed HTML shows as text and never becomes an element.
  await expect(main.locator("li", { hasText: "ข้อหนึ่ง" })).toHaveText("ข้อหนึ่ง " + XSS);
  await expect(main.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__legalXss)).toBeUndefined();
  // Table of contents links to every section.
  const toc = main.getByRole("navigation", { name: "สารบัญ" });
  await expect(toc.getByRole("link")).toHaveCount(await main.locator(".legal-section").count());
  await toc.getByRole("link", { name: /ติดต่อร้าน/ }).click();
  await expect(page).toHaveURL(/#legal-terms-contact$/);
  await shot(page, "terms-desktop");

  await ready(page, "/privacy");
  await expect(main.getByRole("heading", { name: "นโยบายความเป็นส่วนตัว", level: 1 })).toBeVisible();
  await expect(main).toContainText("ผู้ประสานงานด้านข้อมูลส่วนบุคคล: ฝ่ายคุ้มครองข้อมูล");
  await expect(main).toContainText("พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562");
  await expect(main).toContainText("สคส.");
  await expect(main.getByRole("link", { name: "ข้อกำหนดการใช้บริการ" })).toHaveAttribute("href", "/terms");

  // Signup consent links to both documents.
  await ready(page, "/register");
  const consent = page.locator(".consent-check");
  await expect(consent.getByRole("link", { name: "ข้อกำหนดการใช้บริการ" })).toHaveAttribute("href", "/terms");
  await expect(consent.getByRole("link", { name: "นโยบายความเป็นส่วนตัว" })).toHaveAttribute("href", "/privacy");
});

test("footer credit links to limitcode studio and reads well in all 8 themes", async ({ page }) => {
  await as(page, null);
  for (const mode of ["light", "dark"])
    for (const accent of ["blue", "yellow", "duo", "mono"]) {
      await page.goto(base + "/");
      await page.evaluate(([m, a]) => {
        localStorage.setItem("asiax-mode", m);
        localStorage.setItem("asiax-accent", a);
      }, [mode, accent]);
      await ready(page, "/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await expect(page.locator("html")).toHaveAttribute("data-accent", accent);
      const credit = page.locator("footer.site-footer .footer-credit");
      await expect(credit).toHaveText("Theme By limitcode studio");
      const link = credit.getByRole("link", { name: "limitcode studio" });
      await expect(link).toHaveAttribute("href", "https://limitcode.shop");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener");
      // It is the last thing in the footer.
      expect(
        await page.evaluate(() => {
          const footer = document.querySelector("footer.site-footer");
          const credit = footer.querySelector(".footer-credit");
          const all = [...footer.querySelectorAll("*")].filter((el) => el.getClientRects().length);
          return credit.contains(all[all.length - 1]) || all[all.length - 1] === credit;
        }),
      ).toBe(true);
      const contrast = await credit.evaluate((el) => {
        const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
        const lum = ([r, g, b]) =>
          [r, g, b]
            .map((v) => v / 255)
            .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        let bgEl = el;
        let bg = "rgba(0, 0, 0, 0)";
        while (bgEl && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
          bg = getComputedStyle(bgEl).backgroundColor;
          bgEl = bgEl.parentElement;
        }
        const ratio = (fg) => {
          const [a, b] = [lum(rgb(fg)), lum(rgb(bg))].sort((x, y) => y - x);
          return (a + 0.05) / (b + 0.05);
        };
        return {
          text: ratio(getComputedStyle(el).color),
          link: ratio(getComputedStyle(el.querySelector("a")).color),
        };
      });
      expect(contrast.text, `${mode}/${accent} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast.link, `${mode}/${accent} link`).toBeGreaterThanOrEqual(7);
      if (accent === "blue") {
        await credit.scrollIntoViewIfNeeded();
        await shot(page, "footer-" + mode);
      }
    }
});

test("390px: legal pages, admin form and footer credit fit without side scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await as(page, null);
  for (const path of ["/terms", "/privacy"]) {
    await ready(page, path);
    await expect(page.locator(".legal-section").first()).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
  }
  await shot(page, "privacy-390");
  const credit = page.locator(".footer-credit a");
  await credit.scrollIntoViewIfNeeded();
  // Not hidden behind the floating mobile bottom bar.
  const hit = await credit.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === top || el.contains(top);
  });
  expect(hit).toBe(true);

  await as(page, adminToken);
  await ready(page, "/admin/settings/legal");
  await expect(page.locator(".legal-section-card").first()).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  // Preview sits below the form on phones.
  const [form, preview] = await Promise.all([
    page.locator(".legal-admin-form").boundingBox(),
    page.locator(".legal-preview").boundingBox(),
  ]);
  expect(preview.y).toBeGreaterThan(form.y + form.height - 1);
  await shot(page, "admin-legal-390");
});

test("Node server serves robots.txt and a sitemap of active products", async ({ request }) => {
  const robots = await request.get(base + "/robots.txt");
  expect(robots.ok()).toBe(true);
  expect(robots.headers()["content-type"]).toContain("text/plain");
  const text = await robots.text();
  expect(text).toContain("Disallow: /admin");
  expect(text).toContain("Disallow: /api");
  expect(text).toContain(`Sitemap: ${base}/sitemap.xml`);
  const sitemap = await request.get(base + "/sitemap.xml");
  expect(sitemap.headers()["content-type"]).toContain("application/xml");
  const xml = await sitemap.text();
  for (const p of service.products()) expect(xml).toContain(`${base}/products/${encodeURIComponent(p.id)}`);
  expect(xml).toContain(`${base}/terms`);
  expect(xml).not.toContain("/admin");
});
