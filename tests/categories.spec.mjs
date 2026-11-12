// Product categories end to end: admin creates a category with a library icon, reorders it,
// moves a product into it with the bulk bar; the storefront chip filters and the URL works
// (reload, search, sort); the home page category row in every theme; 390px layouts.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, product, other;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.CATEGORY_SHOTS; // optional folder for review screenshots
const CAT = { id: "music-apps", th: "แอปฟังเพลง", en: "Music apps" };

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const admin = service.session(adminToken);
  product = service.saveProduct(admin, {
    name: "E2E Tune Premium",
    description: "บัญชีฟังเพลงสำหรับทดสอบหมวดหมู่",
    category: "software",
    price: 15900,
    active: true,
  });
  other = service.saveProduct(admin, {
    name: "E2E Office Pack",
    description: "ซอฟต์แวร์สำหรับทดสอบหมวดหมู่",
    category: "software",
    price: 4900,
    active: true,
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
const shot = (page, name) =>
  shots ? page.screenshot({ path: `${shots}/${name}.png`, fullPage: true, animations: "disabled" }) : null;
const rowOrder = (page) =>
  page.locator(".category-table tbody tr").evaluateAll((rows) => rows.map((r) => r.dataset.category));

test("admin: create with a library icon, reorder, bulk-move a product; storefront chip + URL filter", async ({ page }) => {
  await as(page, adminToken);
  await ready(page, "/admin/categories");
  await expect(page.getByRole("heading", { name: "หมวดหมู่", level: 1 })).toBeVisible();
  // Seeded: the original five + the account-shop defaults.
  expect(await rowOrder(page)).toEqual(["streaming", "music", "software", "games", "gift", "ai", "productivity", "vpn"]);
  await shot(page, "admin-categories");

  await page.getByRole("button", { name: "เพิ่มหมวด" }).click();
  const dialog = page.getByRole("dialog", { name: "เพิ่มหมวด" });
  await dialog.getByLabel("ชื่อหมวด (ไทย)").fill(CAT.th);
  await dialog.getByLabel("ชื่อหมวด (อังกฤษ)").fill(CAT.en);
  // The slug follows the English name until edited.
  await expect(dialog.getByLabel("รหัสในลิงก์ (slug)")).toHaveValue(CAT.id);
  await dialog.getByRole("button", { name: "เลือกจากคลังรูป" }).click();
  const library = page.getByRole("dialog", { name: "คลังรูปสินค้า" });
  await library.getByLabel("ค้นหารูปในคลัง").fill("spotify");
  await library.getByRole("button", { name: "Spotify" }).click();
  await expect(library).toHaveCount(0);
  await expect(dialog.locator(".category-icon img")).toHaveAttribute("src", "/library/spotify.webp");
  await dialog.getByRole("button", { name: "เพิ่มหมวด" }).click();
  await expect(page.locator(".toast")).toContainText("เพิ่มหมวด " + CAT.th + " แล้ว");
  const row = page.locator(`tr[data-category="${CAT.id}"]`);
  await expect(row).toContainText(CAT.th);
  await expect(row).toContainText(CAT.en);
  await expect(row.locator(".category-icon img")).toHaveAttribute("src", "/library/spotify.webp");
  await expect(row).toContainText("ยังไม่แสดง");
  expect((await rowOrder(page)).at(-1)).toBe(CAT.id);

  // Reorder: up twice → third from the end.
  await page.getByRole("button", { name: "เลื่อน " + CAT.th + " ขึ้น" }).click();
  await expect.poll(async () => (await rowOrder(page)).at(-2)).toBe(CAT.id);
  await page.getByRole("button", { name: "เลื่อน " + CAT.th + " ขึ้น" }).click();
  await expect.poll(async () => (await rowOrder(page)).at(-3)).toBe(CAT.id);
  const saved = service.adminCategories(service.session(adminToken)).categories.map((c) => c.id);
  expect(saved.at(-3)).toBe(CAT.id);

  // Delete with products is offered as "move then delete" (cancelled here).
  await page.locator('tr[data-category="software"]').getByRole("button", { name: "ลบ" }).click();
  const del = page.getByRole("alertdialog");
  await expect(del).toContainText("ย้ายสินค้า");
  await expect(del.getByRole("button", { name: "ย้ายสินค้าและลบหมวด" })).toBeDisabled();
  await del.getByRole("button", { name: "ยกเลิก" }).click();

  // Bulk move from the products list.
  await ready(page, "/admin/products");
  await page.getByRole("checkbox", { name: "เลือก " + "E2E Tune Premium" }).check();
  await page.getByRole("button", { name: "ย้ายหมวด…" }).click();
  await page.getByLabel("ย้ายไปหมวด").selectOption(CAT.id);
  await page.getByRole("button", { name: `ยืนยันย้าย 1 สินค้าไป ${CAT.th}` }).click();
  await expect(page.locator(".toast")).toContainText(`ย้าย 1 สินค้าไปหมวด ${CAT.th} แล้ว`);
  expect(service.db.prepare("SELECT category FROM products WHERE id=?").get(product.id).category).toBe(CAT.id);
  await expect(
    page.locator("tr", { hasText: "E2E Tune Premium" }).locator(".product-category-tag"),
  ).toHaveText(CAT.th);

  // Storefront: chip with icon, name and count; click filters and updates the URL.
  await as(page, null);
  await ready(page, "/products");
  const chips = page.getByRole("navigation", { name: "หมวดหมู่สินค้า" });
  const chip = chips.locator(`[data-category="${CAT.id}"]`);
  await expect(chip).toContainText(CAT.th);
  await expect(chip.locator(".chip-count")).toHaveText("1");
  await expect(chip.locator("img")).toHaveAttribute("src", "/library/spotify.webp");
  await expect(chips.locator('[data-category="vpn"]')).toHaveCount(0); // empty → not shown
  await expect(page.locator(".product-card", { hasText: "E2E Office Pack" })).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(base + "/products?category=" + CAT.id);
  await expect(chip).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await expect(page.locator(".product-card")).toContainText("E2E Tune Premium");
  await expect(page.locator(".reference-catalog-title h2")).toHaveText(CAT.th);
  await expect(page).toHaveTitle(new RegExp("^" + CAT.th + " — "));
  await shot(page, "storefront-chip-filtered");

  // The URL loads filtered and works with search + sort.
  await ready(page, "/products?category=" + CAT.id);
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page.getByLabel("ค้นหาสินค้า").fill("zzz-nothing");
  await expect(page.locator(".product-card")).toHaveCount(0);
  await page.getByLabel("ค้นหาสินค้า").fill("tune");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page.getByLabel("เรียงสินค้า").selectOption("high");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await expect(page).toHaveURL(base + "/products?category=" + CAT.id);
  // "ทั้งหมด" clears the filter; back returns to the category.
  await page.getByLabel("ค้นหาสินค้า").fill("");
  await chips.getByRole("link", { name: /ทั้งหมด/ }).click();
  await expect(page).toHaveURL(base + "/products");
  await expect(page.locator(".product-card", { hasText: "E2E Office Pack" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(base + "/products?category=" + CAT.id);
  await expect(page.locator(".product-card")).toHaveCount(1);
  // Unknown or hidden ids fall back to all products.
  await ready(page, "/products?category=does-not-exist");
  await expect(page.locator(".product-card", { hasText: "E2E Office Pack" })).toBeVisible();

  // Hidden in admin → gone from the storefront.
  service.adminUpdateCategory(service.session(adminToken), CAT.id, { hidden: true });
  await ready(page, "/products");
  await expect(chips.locator(`[data-category="${CAT.id}"]`)).toHaveCount(0);
  service.adminUpdateCategory(service.session(adminToken), CAT.id, { hidden: false });
});

test("home category row links to the filtered list; EN names; all 8 themes", async ({ page }) => {
  await as(page, null);
  await ready(page, "/");
  const row = page.getByRole("region", { name: "เลือกตามหมวดหมู่" });
  await expect(row).toBeVisible();
  const card = row.locator(`[data-category="${CAT.id}"]`);
  await expect(card).toContainText(CAT.th);
  await expect(card).toContainText("1 รายการ");
  await expect(card.locator("img")).toHaveAttribute("src", "/library/spotify.webp");
  await expect(row.locator('[data-category="vpn"]')).toHaveCount(0);
  await card.click();
  await expect(page).toHaveURL(base + "/products?category=" + CAT.id);
  await expect(page.locator(".product-card")).toHaveCount(1);

  // English storefront uses name_en.
  await page.evaluate(() => localStorage.setItem("asiax-lang", "en"));
  await ready(page, "/");
  await expect(page.getByRole("region", { name: "Shop by category" }).locator(`[data-category="${CAT.id}"]`)).toContainText(
    CAT.en,
  );
  await ready(page, "/products?category=" + CAT.id);
  await expect(page.locator(".reference-catalog-title h2")).toHaveText(CAT.en);
  await page.evaluate(() => localStorage.setItem("asiax-lang", "th"));

  for (const mode of ["light", "dark"])
    for (const accent of ["blue", "yellow", "duo", "mono"]) {
      await page.evaluate(
        ([m, a]) => {
          localStorage.setItem("asiax-mode", m);
          localStorage.setItem("asiax-accent", a);
        },
        [mode, accent],
      );
      await ready(page, "/");
      const themed = page.locator(`.home-category-card[data-category="${CAT.id}"]`);
      await expect(themed).toBeVisible();
      const colors = await themed.evaluate((el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, fg: s.color, page: getComputedStyle(document.body).backgroundColor };
      });
      expect(colors.bg, `${mode}/${accent} card background`).not.toBe("rgba(0, 0, 0, 0)");
      expect(colors.fg, `${mode}/${accent} text`).not.toBe(colors.bg);
      await ready(page, "/products?category=" + CAT.id);
      const selected = page.locator(".storefront-category-chip.selected");
      await expect(selected).toHaveAttribute("data-category", CAT.id);
      const chip = await selected.evaluate((el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, fg: s.color };
      });
      expect(chip.fg, `${mode}/${accent} selected chip contrast`).not.toBe(chip.bg);
      expect(await noSideScroll(page)).toBe(true);
      if (accent === "blue" || accent === "yellow") await shot(page, `chips-${mode}-${accent}`);
    }
  await page.evaluate(() => {
    localStorage.removeItem("asiax-mode");
    localStorage.removeItem("asiax-accent");
  });
});

test("390px: home row, chips and the admin categories page have no side scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await as(page, null);
  for (const path of ["/", "/products", "/products?category=" + CAT.id]) {
    await ready(page, path);
    expect(await noSideScroll(page), path).toBe(true);
  }
  await ready(page, "/");
  const cards = page.locator(".home-category-card");
  await expect(cards.first()).toBeVisible();
  // Two cards per row on phones.
  const [a, b] = await cards.evaluateAll((els) => els.slice(0, 2).map((el) => el.getBoundingClientRect().top));
  expect(Math.abs(a - b)).toBeLessThan(2);
  await shot(page, "home-390");
  await ready(page, "/products");
  await shot(page, "products-390");

  await as(page, adminToken);
  await ready(page, "/admin/categories");
  await expect(page.locator(`tr[data-category="${CAT.id}"]`)).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "admin-categories-390");
  await page.locator(`tr[data-category="${CAT.id}"]`).getByRole("button", { name: "แก้ไข" }).click();
  await expect(page.getByRole("dialog", { name: "แก้ไขหมวด" })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "admin-category-edit-390");
  await page.getByRole("dialog", { name: "แก้ไขหมวด" }).getByRole("button", { name: "ยกเลิก" }).click();
  await ready(page, "/admin/products");
  await page.getByRole("checkbox", { name: "เลือก E2E Office Pack" }).check();
  await page.getByRole("button", { name: "ย้ายหมวด…" }).click();
  await expect(page.getByLabel("ย้ายไปหมวด")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "admin-bulk-move-390");
});
