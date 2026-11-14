// ข่าวสารและกิจกรรม + เกี่ยวกับเรา end to end: the admin writes and publishes a news post with
// a cover (live preview card), the storefront list / detail show it in Thai and English with
// the event badge; a scheduled post stays hidden until its time; the About page is edited with
// a live preview and the storefront follows; /news, /news/:id and /about fit 390 px in light
// and dark (no sideways scroll, text ≥ 12 px, tap targets ≥ 44 px).
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.NEWS_SHOTS; // optional folder for review screenshots
// Server clock = real time + offset, so a scheduled post can "reach" its time.
let offset = 0;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword, clock: () => Date.now() + offset });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  service.saveSettings(service.session(adminToken), {
    ...service.settings(),
    shopName: "ร้านทดสอบข่าว",
    line: "@newsshop",
    email: "hello@newsshop.example",
  });
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
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shot = (page, name, fullPage = true) =>
  shots ? page.screenshot({ path: `${shots}/${name}.png`, fullPage, animations: "disabled" }) : null;
/** Bangkok calendar date / wall time, offset by `days` / `minutes`. */
const bkk = (ms) => new Date(ms + 7 * 3600000).toISOString();
const bkkDate = (days = 0) => bkk(Date.now() + days * 86400000).slice(0, 10);
const bkkLocal = (minutes) => bkk(Date.now() + minutes * 60000).slice(0, 16);

async function testImage(page, width, height, label, hue) {
  const dataUrl = await page.evaluate(
    ([w, h, text, hueValue]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, `hsl(${hueValue} 80% 45%)`);
      g.addColorStop(1, `hsl(${hueValue + 30} 80% 32%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${Math.round(h / 7)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, w / 2, h / 2);
      return canvas.toDataURL("image/png");
    },
    [width, height, label, hue],
  );
  return { name: label.replace(/\W+/g, "-") + ".png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") };
}

test("admin writes and publishes a news post with a cover; live preview follows the form", async ({ page }) => {
  await as(page, adminToken);
  await ready(page, "/admin/settings/news");
  await expect(page.getByRole("heading", { name: "ข่าวสาร", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "ข่าวสาร" })).toHaveClass(/active/);
  await expect(page.locator(".news-admin-empty")).toBeVisible();

  await page.getByRole("button", { name: "เขียนข่าว" }).click();
  await expect(page.getByRole("heading", { name: "เขียนข่าว", level: 1 })).toBeVisible();
  // Title is checked before anything is sent.
  await page.getByRole("button", { name: "เผยแพร่", exact: true }).click();
  await expect(page.locator(".error-message, [role=alert]").first()).toContainText("กรุณาใส่หัวข้อข่าว");

  const preview = page.locator(".news-preview");
  await page.getByLabel("หัวข้อข่าว").fill("เปิดตัวโปรสิ้นปี");
  await expect(preview.locator(".news-card-title")).toHaveText("เปิดตัวโปรสิ้นปี");
  await page.getByLabel("สรุปสั้น").fill("ลดทั้งร้านถึงสิ้นเดือน");
  await page
    .getByLabel("เนื้อหา")
    .fill("รายละเอียดโปรโมชัน\n\n- ลด 20% ทุกสินค้า\n- ดูสินค้าที่ [หน้าสินค้า](/products)\n\nลิงก์ไม่ปลอดภัย [x](javascript:alert(1))");
  await page.getByRole("tab", { name: "English" }).first().click();
  await page.getByLabel("หัวข้อ (English)").fill("Year-end sale launch");
  await page.getByLabel("สรุปสั้น (English)").fill("Shop-wide discount until month end");
  await page.getByRole("tab", { name: "ไทย" }).first().click();
  await page.getByLabel("รูปปก").setInputFiles(await testImage(page, 1600, 900, "NEWS COVER", 220));
  await expect(page.locator(".news-cover-frame img")).toBeVisible();
  await expect(preview.locator(".news-card-cover img")).toBeVisible();
  await page.getByLabel("วันเริ่มกิจกรรม").fill(bkkDate(-1));
  await page.getByLabel("วันจบกิจกรรม").fill(bkkDate(5));
  await expect(preview.locator(".news-badge.is-event")).toHaveText("กิจกรรม");
  await expect(preview.locator(".news-badge.is-ongoing")).toHaveText("กำลังจัดอยู่");
  await page.getByPlaceholder("/products หรือ https://…").fill("javascript:alert(1)");
  await expect(page.locator(".news-link-problem")).toBeVisible();
  await page.getByPlaceholder("/products หรือ https://…").fill("/products");
  await expect(page.locator(".news-link-problem")).toHaveCount(0);
  await page.getByLabel("ข้อความปุ่ม").fill("ช้อปเลย");
  // Preview: page view + English.
  await page.getByRole("tab", { name: "หน้าข่าว" }).click();
  await expect(preview.locator(".news-article h1")).toHaveText("เปิดตัวโปรสิ้นปี");
  await expect(preview.locator(".news-article .rich-link")).toHaveAttribute("href", "/products");
  await expect(preview.locator(".news-article a[href^='javascript']")).toHaveCount(0);
  await page.locator(".news-preview-card").getByRole("tab", { name: "English" }).click();
  await expect(preview.locator(".news-article h1")).toHaveText("Year-end sale launch");
  await shot(page, "admin-news-editor", false);

  await page.getByRole("button", { name: "เผยแพร่", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("เผยแพร่ข่าวแล้ว");
  const row = page.locator(".news-admin-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".news-admin-status")).toHaveText("เผยแพร่อยู่");
  await expect(row.locator(".news-admin-thumb img")).toBeVisible();
  const [post] = service.adminNews(service.session(adminToken)).posts;
  expect(post.coverUrl).toMatch(/^\/api\/files\//);
  expect(post.titleEn).toBe("Year-end sale launch");
  expect(post.link).toBe("/products");
});

test("storefront /news list + detail in Thai and English", async ({ page }) => {
  await as(page, null);
  await ready(page, "/news");
  await expect(page.getByRole("heading", { name: "ข่าวสาร", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/ข่าวสาร — ร้านทดสอบข่าว/);
  const card = page.locator(".news-card").first();
  await expect(card.locator(".news-card-title")).toHaveText("เปิดตัวโปรสิ้นปี");
  await expect(card.locator(".news-card-summary")).toHaveText("ลดทั้งร้านถึงสิ้นเดือน");
  await expect(card.locator(".news-badge.is-event")).toHaveText("กิจกรรม");
  await expect(card.locator(".news-badge.is-ongoing")).toHaveText("กำลังจัดอยู่");
  await expect(card.locator(".news-card-cover img")).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/news\/[0-9a-f-]+$/);
  await expect(page.locator(".news-article h1")).toHaveText("เปิดตัวโปรสิ้นปี");
  await expect(page).toHaveTitle(/เปิดตัวโปรสิ้นปี — /);
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toContain("/api/files/");
  await expect(page.locator(".news-article li")).toHaveCount(2);
  await expect(page.locator(".news-article .rich-link")).toHaveAttribute("href", "/products");
  await expect(page.locator(".news-article")).toContainText("[x](javascript:alert(1))");
  await expect(page.locator("a[href^='javascript']")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "ช้อปเลย" })).toHaveAttribute("href", "/products");
  await shot(page, "news-detail-th");

  // English: admin's English fields, fallback to Thai where empty, English UI strings.
  await page.evaluate(() => localStorage.setItem("asiax-lang", "en"));
  await ready(page, "/news");
  await expect(page.getByRole("heading", { name: "News", level: 1 })).toBeVisible();
  await expect(page.locator(".news-card-title").first()).toHaveText("Year-end sale launch");
  await expect(page.locator(".news-badge.is-event").first()).toHaveText("Event");
  await expect(page.locator(".news-badge.is-ongoing").first()).toHaveText("Ongoing");
  await page.locator(".news-card").first().click();
  await expect(page.locator(".news-article h1")).toHaveText("Year-end sale launch");
  await expect(page.locator(".news-article .rich-text")).toContainText("รายละเอียดโปรโมชัน", { useInnerText: true });
  await expect(page.getByRole("link", { name: "ช้อปเลย" })).toBeVisible(); // EN label empty → Thai
  await page.evaluate(() => localStorage.setItem("asiax-lang", "th"));

  // Unknown id → friendly not-found.
  await ready(page, "/news/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: "ไม่พบข่าวนี้" })).toBeVisible();
});

test("scheduled post stays hidden until its time; open list refreshes on publish", async ({ page, browser }) => {
  await as(page, adminToken);
  await ready(page, "/admin/settings/news");
  await page.getByRole("button", { name: "เขียนข่าว" }).click();
  await page.getByLabel("หัวข้อข่าว").fill("ข่าวตั้งเวลา");
  await page.getByLabel("ตั้งเวลาเผยแพร่").fill(bkkLocal(30));
  await expect(page.locator(".news-card-panel").last()).toContainText("ลูกค้าจะเห็นข่าวนี้ตั้งแต่");
  await page.getByRole("button", { name: "เผยแพร่", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("เผยแพร่ข่าวแล้ว");
  const scheduled = page.locator(".news-admin-row", { hasText: "ข่าวตั้งเวลา" });
  await expect(scheduled.locator(".news-admin-status")).toHaveText("ตั้งเวลาไว้");
  const id = await scheduled.getAttribute("data-news");

  const visitor = await browser.newPage();
  await visitor.goto(base + "/news");
  await expect(visitor.locator(".news-card").first()).toBeVisible();
  await expect(visitor.locator(".news-card", { hasText: "ข่าวตั้งเวลา" })).toHaveCount(0);
  await visitor.goto(base + "/news/" + id);
  await expect(visitor.getByRole("heading", { name: "ไม่พบข่าวนี้" })).toBeVisible();

  // Time passes (server clock +31 min) → the post is public, newest first.
  offset = 31 * 60000;
  await visitor.goto(base + "/news");
  await expect(visitor.locator(".news-card-title").first()).toHaveText("ข่าวตั้งเวลา");

  // A post published while the list is open shows up without a reload (live topic "content").
  const admin = service.session(adminToken);
  const pinned = service.adminCreateNews(admin, { title: "ข่าวปักหมุดสด", published: true, pinned: true }).post;
  await expect(visitor.locator(".news-card-title").first()).toHaveText("ข่าวปักหมุดสด", { timeout: 10000 });
  await expect(visitor.locator(".news-card").first().locator(".news-badge.is-pinned")).toBeVisible();
  service.adminUpdateNews(admin, pinned.id, { published: false });
  await expect(visitor.locator(".news-card", { hasText: "ข่าวปักหมุดสด" })).toHaveCount(0, { timeout: 10000 });
  await visitor.close();

  // Delete with confirm removes the post and its row.
  await ready(page, "/admin/settings/news");
  const row = page.locator(".news-admin-row", { hasText: "ข่าวปักหมุดสด" });
  await row.getByRole("button", { name: "ลบ" }).click();
  const dialog = page.getByRole("alertdialog", { name: "ลบข่าว" });
  await dialog.getByRole("button", { name: "ลบข่าว" }).click();
  await expect(page.locator(".toast")).toContainText("ลบข่าวแล้ว");
  await expect(page.locator(".news-admin-row", { hasText: "ข่าวปักหมุดสด" })).toHaveCount(0);
});

test("about page: defaults, admin edit with live preview → storefront TH/EN", async ({ page }) => {
  await as(page, null);
  await ready(page, "/about");
  await expect(page.getByRole("heading", { name: "เกี่ยวกับเรา", level: 1 })).toBeVisible();
  await expect(page.locator(".about-body")).toContainText("ร้านทดสอบข่าว เป็นร้านสินค้าดิจิทัลออนไลน์");
  await expect(page.locator(".about-highlight")).toHaveCount(3);
  await expect(page.locator(".about-contact")).toContainText("@newsshop");

  await as(page, adminToken);
  await ready(page, "/admin/settings/about");
  await expect(page.locator("#about-admin-title")).toHaveText("เกี่ยวกับเรา");
  const preview = page.locator(".news-preview");
  await page.getByLabel("หัวข้อ").first().fill("รู้จักร้านของเรา");
  await expect(preview.locator("h1")).toHaveText("รู้จักร้านของเรา");
  await page.getByLabel("เนื้อหา").fill("เราขายสินค้าดิจิทัลมาตั้งแต่ปี 2020\n\nติดต่อ [ทีมงาน](/support)");
  await expect(preview.locator(".rich-link")).toHaveAttribute("href", "/support");
  await page.getByRole("tab", { name: "English" }).first().click();
  await page.getByLabel("หัวข้อ (English)").first().fill("Meet the shop");
  await page.getByRole("tab", { name: "ไทย" }).first().click();
  // Remove two highlights, add a new one with another icon.
  await page.getByRole("button", { name: "ลบจุดเด่นข้อ 3" }).click();
  await page.getByRole("button", { name: "ลบจุดเด่นข้อ 2" }).click();
  await page.getByRole("button", { name: "เพิ่มจุดเด่น" }).click();
  const newRow = page.locator(".about-highlight-row").nth(1);
  await newRow.getByRole("radio", { name: "Gift" }).click();
  await newRow.getByLabel("หัวข้อ", { exact: true }).fill("ของแถมทุกออเดอร์");
  await expect(preview.locator(".about-highlight")).toHaveCount(2);
  await expect(preview.locator(".about-highlight").nth(1)).toContainText("ของแถมทุกออเดอร์");
  await page.getByLabel("รูปปก").setInputFiles(await testImage(page, 2100, 900, "ABOUT", 200));
  await expect(preview.locator(".about-cover img")).toBeVisible();
  await page.getByRole("switch", { name: "แสดงช่องทางติดต่อ" }).click();
  await expect(preview.locator(".about-contact")).toHaveCount(0);
  await shot(page, "admin-about-editor", false);
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("บันทึกหน้าเกี่ยวกับเราแล้ว");
  expect(service.publicAbout().about.coverUrl).toMatch(/^\/api\/files\//);

  await as(page, null);
  await ready(page, "/about");
  await expect(page.getByRole("heading", { name: "รู้จักร้านของเรา", level: 1 })).toBeVisible();
  await expect(page.locator(".about-highlight")).toHaveCount(2);
  await expect(page.locator(".about-cover img")).toBeVisible();
  await expect(page.locator(".about-contact")).toHaveCount(0);
  await expect(page.locator(".about-body .rich-link")).toHaveAttribute("href", "/support");
  await page.evaluate(() => localStorage.setItem("asiax-lang", "en"));
  await ready(page, "/about");
  await expect(page.getByRole("heading", { name: "Meet the shop", level: 1 })).toBeVisible();
  await expect(page.locator(".about-body")).toContainText("เราขายสินค้าดิจิทัล"); // EN body empty → Thai
  await expect(page).toHaveTitle(/About us/);
  await page.evaluate(() => localStorage.setItem("asiax-lang", "th"));
});

test("390px light + dark: /news, detail and /about fit, readable, tap targets", async ({ browser }) => {
  const [post] = service.publicNews().posts;
  for (const mode of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(base + "/");
    await page.evaluate((m) => localStorage.setItem("asiax-mode", m), mode);
    for (const path of ["/news", "/news/" + post.id, "/about"]) {
      await ready(page, path);
      await expect(page.locator(".news-page, .news-detail-page, .about-page").first()).toBeVisible();
      await page.locator(".news-card, .news-article, .about-view").first().waitFor();
      expect(await noSideScroll(page), path).toBe(true);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(mode);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll(".news-page *, .news-detail-page *, .about-page *")]
          .filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12)
          .map((el) => el.className + ":" + el.textContent.slice(0, 20)),
      );
      expect(small, path).toEqual([]);
      const taps = await page.evaluate(() =>
        [...document.querySelectorAll(".news-back, .news-article-link, .news-card, .about-contact-more")]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.height < 43.5)
          .map((r) => r.height),
      );
      expect(taps, path).toEqual([]);
      // Cards read as cards on both themes: surface differs from text colour.
      const colors = await page
        .locator(".news-card, .news-article, .about-card")
        .first()
        .evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
      expect(colors.bg).not.toBe(colors.fg);
      await shot(page, `${path.split("/")[1]}${path.split("/")[2] ? "-detail" : ""}-390-${mode}`);
    }
    await context.close();
  }
});
