// Browser flows against a server configured exactly like the deployed shop:
// live mode, no sample catalog, no demo accounts, no sandbox payment.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base;
const adminPassword = randomBytes(24).toString("hex");
const productName = "LIVE QA LICENSE";
const codes = ["LIVE-QA-UI-0001", "LIVE-QA-UI-0002"];
let productId;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({
    adminPassword,
    seed: false,
    allowSandbox: false,
    allowDemoAdmin: false,
  });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function ready(page, path = "/") {
  await page.goto(base + path);
  await expect(
    page.getByRole("heading", { name: "เชื่อมต่อร้านค้าไม่ได้" }),
  ).toHaveCount(0);
  await page.locator(".loading-row").waitFor({ state: "hidden" });
}
async function loginAdmin(page, next = "/admin") {
  await ready(page, "/login?next=" + encodeURIComponent(next));
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill("admin@astra.local");
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(base + next);
}
const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("live shop starts empty and offers no demo login", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page, "/");
  await ready(page, "/login");
  await expect(
    page.getByRole("button", { name: /บัญชีทดลอง/ }),
  ).toHaveCount(0);
  const health = await (await page.request.get(base + "/api/health")).json();
  expect(health.mode).toBe("live");
  const products = await (await page.request.get(base + "/api/products")).json();
  expect(products.products).toEqual([]);
  expect(errors).toEqual([]);
});

test("admin creates a product, prices it, opens it and imports codes", async ({
  page,
}) => {
  await loginAdmin(page);
  await expect(
    page.getByRole("heading", { name: "ร้านค้า", exact: true }),
  ).toBeVisible();

  await page
    .locator(".reference-primary-nav")
    .getByRole("link", { name: "สินค้า", exact: true })
    .click();
  await page.getByRole("link", { name: "เพิ่มสินค้า", exact: true }).click();
  await page.getByLabel("ชื่อสินค้า", { exact: true }).fill(productName);
  await page
    .getByLabel("รายละเอียด", { exact: true })
    .fill("ไลเซนส์สำหรับตรวจระบบร้านจริงแบบอัตโนมัติ");
  await page.getByRole("button", { name: "สร้างฉบับร่าง", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("สร้างฉบับร่างแล้ว");

  await page.getByLabel("ราคา (บาท)").fill("125");
  await page.getByRole("checkbox", { name: "เปิดขายสินค้า", exact: true }).check();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("บันทึกสินค้าแล้ว");
  productId = service.products().find((p) => p.name === productName)?.id;
  expect(productId).toBeTruthy();

  // Open for sale but no codes yet: storefront must show it as sold out.
  await ready(page, "/products/" + productId);
  await expect(page.getByText("สินค้าหมด").first()).toBeVisible();

  await ready(page, "/admin/inventory");
  const importCodes = async (text) => {
    await page.getByRole("button", { name: "นำเข้าโค้ด", exact: true }).click();
    await page
      .getByLabel("สินค้าและตัวเลือก")
      .selectOption({ label: productName + " · โค้ดดิจิทัล" });
    const singleCode = page.getByRole("radio", { name: "โค้ดเดี่ยว" });
    await expect(singleCode).toBeVisible({ timeout: 15000 });
    await singleCode.check();
    await page.getByLabel("โค้ด (หนึ่งโค้ดต่อบรรทัด)").fill(text);
    await page
      .getByRole("button", { name: "นำเข้าโค้ด", exact: true })
      .last()
      .click();
  };
  await importCodes(codes.join("\n"));
  await expect(page.getByRole("status")).toContainText("นำเข้า 2 โค้ดสำเร็จ");
  await importCodes(codes[0]);
  await expect(page.getByRole("alert")).toContainText("โค้ดนี้มีอยู่ในคลังแล้ว");
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole("link", { name: "ออเดอร์", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ดาวน์โหลด CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  for (const path of [
    "/admin/customers",
    "/admin/payments",
    "/admin/reports",
    "/admin/settings",
  ]) {
    await ready(page, path);
    await expect(page.locator(".reference-admin-main h1")).toBeVisible();
  }
});

test("customer sees a stock label, never a count or a code, and orders wait for payment", async ({
  page,
}) => {
  test.skip(!productId, "needs the product from the admin test");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await ready(page, "/register");
  const name = "live_" + randomBytes(4).toString("hex");
  await page.getByLabel("ชื่อผู้ใช้").fill(name);
  await page
    .getByLabel("อีเมล (ไม่บังคับ)", { exact: true })
    .fill(name + "@example.invalid");
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill("Live-UI-test-12345");
  await page
    .getByLabel("ยืนยันรหัสผ่าน", { exact: true })
    .fill("Live-UI-test-12345");
  await page.getByLabel(/ฉันยอมรับ/).check();
  await page.getByRole("button", { name: "สมัครสมาชิก", exact: true }).click();
  await expect(page).toHaveURL(base + "/account");

  await ready(page, "/products/" + productId);
  const body = page.locator("body");
  await expect(body).toContainText("เหลือน้อย");
  await expect(body).not.toContainText(/เหลือ\s*\d+\s*ชิ้น/);
  for (const code of codes) await expect(body).not.toContainText(code);

  await page.getByRole("button", { name: "ซื้อเลย", exact: true }).click();
  const proceed = page.getByRole("button", { name: /^ไปบันทึกคำสั่งซื้อ/ });
  if (await proceed.isVisible()) await proceed.click();
  await page.getByRole("button", { name: /^บันทึกคำสั่งซื้อ/ }).click();
  await expect(page).toHaveURL(/\/(checkout|orders)\/[a-z0-9-]+$/);
  await expect(body).toContainText(/ชำระเงินเพื่อรับสินค้า|รอชำระเงิน/);
  await expect(page.locator(".code-row")).toHaveCount(0);
  for (const code of codes) await expect(body).not.toContainText(code);

  const orders = await (
    await page.request.get(base + "/api/orders")
  ).json();
  expect(orders.orders.length).toBeGreaterThan(0);
  expect(JSON.stringify(orders)).not.toContain(codes[0]);

  await ready(page, "/admin");
  await expect(
    page.getByText("บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบจัดการร้านค้า"),
  ).toBeVisible();
  const ranking = await page.request.get(base + "/api/rankings/buyers");
  expect(ranking.status()).toBe(403);

  await ready(page, "/orders");
  await expect(page.locator(".history-card")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page, "/account");
  await page.locator(".account-button").click();
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(
    page.getByRole("link", { name: "สมัครสมาชิก", exact: true }),
  ).toBeVisible();
  await ready(page, "/orders");
  await expect(
    page.getByRole("heading", { name: "เข้าสู่ระบบเพื่อดูข้อมูลของคุณ" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
