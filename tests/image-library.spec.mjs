// Built-in product image library: pick a ready-made cover in the product editor, and the
// new-product page suggests a cover from the typed name (uploaded right after creation).
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken;
const adminPassword = randomBytes(24).toString("hex");
const netflixWebp = readFileSync(new URL("../public/library/netflix.webp", import.meta.url));

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
const imagesOf = (id) => service.db.prepare("SELECT id FROM product_images WHERE product_id=?").all(id);

test("library dialog: search (EN/TH), category chips, pick Netflix → it becomes the cover in the preview", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/products/stream-plus");
  await expect(page.getByRole("heading", { name: "รูปสินค้า" })).toBeVisible();
  await expect(page.locator(".product-image-grid figure")).toHaveCount(0);

  await page.getByRole("button", { name: "เลือกรูปจากคลัง" }).click();
  const dialog = page.getByRole("dialog", { name: "คลังรูปสินค้า" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("โลโก้เป็นเครื่องหมายการค้าของเจ้าของแบรนด์ ใช้เพื่อระบุสินค้าที่ร้านมีสิทธิ์จำหน่าย");
  const search = dialog.getByLabel("ค้นหารูปในคลัง");
  await expect(search).toBeFocused();
  expect(await dialog.locator(".image-library-item").count()).toBeGreaterThanOrEqual(25);

  // Category chip narrows the grid.
  await dialog.getByRole("button", { name: "เพลง", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Spotify" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Netflix" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "ทั้งหมด", exact: true }).click();

  // Thai keyword and English name both find it.
  await search.fill("เน็ตฟลิกซ์");
  await expect(dialog.locator(".image-library-item")).toHaveCount(1);
  await search.fill("netflix");
  await expect(dialog.locator(".image-library-item")).toHaveCount(1);
  await search.fill("zzzz-no-brand");
  await expect(dialog).toContainText("ไม่พบแบรนด์");
  await search.fill("netflix");

  await dialog.getByRole("button", { name: "Netflix" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("ตั้งรูป Netflix เป็นรูปปกแล้ว")).toBeVisible();
  await expect(page.locator(".product-image-grid figure")).toHaveCount(1);
  await expect(page.locator(".product-image-badge")).toHaveText("ปก");
  const src = await page.locator(".product-image-grid figure img").getAttribute("src");
  expect(src).toMatch(/^\/api\/files\//);
  await expect(page.locator(".product-preview-img")).toHaveAttribute("src", src);

  // It is a normal uploaded product image: same bytes as the library file, stored by the API.
  const served = await page.request.get(base + src);
  expect(Buffer.from(await served.body()).equals(netflixWebp)).toBe(true);
  expect(imagesOf("stream-plus")).toHaveLength(1);
});

test("library dialog works as a bottom sheet at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asAdmin(page);
  await page.goto(base + "/admin/products/stream-plus");
  await page.getByRole("button", { name: "เลือกรูปจากคลัง" }).click();
  const dialog = page.getByRole("dialog", { name: "คลังรูปสินค้า" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(845);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Several cover cards per row even on a phone.
  const [a, b] = await dialog.locator(".image-library-item").evaluateAll((els) =>
    els.slice(0, 2).map((el) => el.getBoundingClientRect().top),
  );
  expect(a).toBe(b);
  await expect(dialog.locator(".image-library-note")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("new product: name suggests a cover, shown in the preview and uploaded after create", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/products/new");
  const suggest = page.locator(".library-suggest");
  await expect(suggest).toContainText("แนะนำรูปจากชื่อสินค้า");
  await page.getByLabel("ชื่อสินค้า", { exact: true }).fill("Netflix Premium 4K จอส่วนตัว");
  await expect(suggest).toContainText("Netflix");
  await expect(suggest.getByLabel("ใช้รูปนี้เป็นรูปปก")).toBeChecked();
  await expect(page.locator(".product-preview-img")).toHaveAttribute("src", "/library/netflix.webp");
  await page.getByLabel("รายละเอียด").fill("บัญชี Netflix จอส่วนตัว ใช้ได้ 30 วัน");
  await page.getByLabel("ชื่อตัวเลือกแรก").fill("1 เดือน");
  await page.getByLabel("ราคาตัวเลือกแรก (บาท)").fill("199");
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  await expect(page.getByText(/สร้างฉบับร่างแล้ว · ใส่รูปปก Netflix แล้ว/)).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/products\/(?!new$)[^/]+$/);
  const id = page.url().split("/").pop();
  await expect(page.locator(".product-image-grid figure")).toHaveCount(1);
  await expect(page.locator(".product-preview-img")).toHaveAttribute("src", /^\/api\/files\//);
  expect(imagesOf(id)).toHaveLength(1);
});

test("new product: unticking the suggestion creates the product without a cover", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/products/new");
  await page.getByLabel("ชื่อสินค้า", { exact: true }).fill("Spotify Premium 1 เดือน");
  const suggest = page.locator(".library-suggest");
  await expect(suggest).toContainText("Spotify");
  await expect(page.locator(".product-preview-img")).toHaveAttribute("src", "/library/spotify.webp");
  await suggest.getByLabel("ใช้รูปนี้เป็นรูปปก").uncheck();
  await expect(page.locator(".product-preview-img")).toHaveCount(0);
  await page.getByLabel("รายละเอียด").fill("บัญชี Spotify Premium ใช้ได้ 30 วัน");
  await page.getByLabel("ชื่อตัวเลือกแรก").fill("1 เดือน");
  await page.getByLabel("ราคาตัวเลือกแรก (บาท)").fill("59");
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/(?!new$)[^/]+$/);
  await expect(page.getByRole("heading", { name: "รูปสินค้า" })).toBeVisible();
  const id = page.url().split("/").pop();
  await expect(page.locator(".product-image-grid figure")).toHaveCount(0);
  expect(imagesOf(id)).toHaveLength(0);
});

test("new product: no match → pick a cover from the library by hand", async ({ page }) => {
  await asAdmin(page);
  await page.goto(base + "/admin/products/new");
  await page.getByLabel("ชื่อสินค้า", { exact: true }).fill("แพ็กออกแบบกราฟิก");
  const suggest = page.locator(".library-suggest");
  await expect(suggest).toContainText("พิมพ์ชื่อแบรนด์");
  await suggest.getByRole("button", { name: "เลือกรูปจากคลัง" }).click();
  const dialog = page.getByRole("dialog", { name: "คลังรูปสินค้า" });
  await dialog.getByLabel("ค้นหารูปในคลัง").fill("แคนวา");
  await dialog.getByRole("button", { name: "Canva" }).click();
  await expect(dialog).toBeHidden();
  await expect(suggest).toContainText("Canva");
  await expect(page.locator(".product-preview-img")).toHaveAttribute("src", "/library/canva.webp");
});
