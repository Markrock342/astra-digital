import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";
let server, service, base;
const adminPassword = randomBytes(24).toString("hex");
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
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
  await page.evaluate(() => document.fonts.ready);
}
async function demo(page, path = "/account") {
  await ready(page, "/login?next=" + encodeURIComponent(path));
  await page.getByRole("button", { name: "เข้าชมด้วยบัญชีทดลอง" }).click();
  await expect(page).toHaveURL(base + path);
}
const screenshot = (page, name) =>
  page.screenshot({
    path: "docs/screenshots/" + name + ".png",
    fullPage: true,
    animations: "disabled",
  });
test("reference composition, catalog search, categories, theme and responsive layouts", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await expect(
    page.getByRole("heading", { name: "ร้านค้า", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".stat-value strong").nth(1)).toHaveText("25");
  await screenshot(page, "desktop-home");
  await ready(page, "/products");
  await expect(
    page.getByRole("heading", { name: "สินค้าทั้งหมด" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "ค้นหาสินค้า" }).fill("DISNEY+");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "ค้นหาสินค้า" })
    .fill("ไม่มีสินค้านี้");
  await expect(
    page.getByRole("heading", { name: "ไม่พบสินค้าที่ค้นหา" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ล้างตัวกรอง" }).click();
  await expect(page.locator(".product-card")).toHaveCount(2);
  await screenshot(page, "desktop-products");
  await page.getByRole("button", { name: "ธีมสว่าง" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "ธีมมืด" }).click();
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 390) await screenshot(page, "mobile-home");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "เปิดเมนู" }).click();
  await page
    .getByRole("navigation", { name: "เมนูหลัก" })
    .getByRole("link", { name: "สินค้า", exact: true })
    .click();
  await expect(page).toHaveURL(base + "/products");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, "mobile-products");
  expect(errors).toEqual([]);
});
test("customer can buy, receive a key, view history, top up and log out", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await demo(page, "/products/stream-plus");
  await page.getByRole("button", { name: "ซื้อเลย", exact: true }).click();
  await page.getByRole("button", { name: "ดำเนินการชำระเครดิต" }).click();
  await expect(page).toHaveURL(/\/checkout\/[a-z0-9-]+$/);
  await page.getByRole("button", { name: /ยืนยันชำระ/ }).click();
  await expect(
    page.getByRole("heading", { name: "สั่งซื้อสำเร็จ พร้อมรับสินค้า" }),
  ).toBeVisible();
  await expect(page.locator(".code-row code")).toContainText(
    "DEMO-KEY-NOT-VALID-",
  );
  await screenshot(page, "successful-delivery");
  const url = page.url();
  await page.reload();
  await page.getByRole("button", { name: "แสดงโค้ด", exact: true }).click();
  await expect(page.locator(".code-row code")).toContainText(
    "DEMO-KEY-NOT-VALID-",
  );
  await ready(page, "/reviews");
  await page
    .getByLabel("ความคิดเห็น", { exact: true })
    .fill("ได้รับโค้ดทดลองเรียบร้อย ซื้อสะดวกมาก");
  await page.getByRole("button", { name: "ส่งรีวิว" }).click();
  await expect(
    page
      .locator(".review-card")
      .filter({ hasText: "ได้รับโค้ดทดลองเรียบร้อย" }),
  ).toContainText("ได้รับโค้ดทดลองเรียบร้อย");
  await ready(page, "/orders");
  await expect(page.locator(".history-card")).toHaveCount(1);
  await page.locator(".history-card").click();
  await expect(page).toHaveURL(url);
  await ready(page, "/account");
  await screenshot(page, "customer-account");
  await ready(page, "/wallet");
  const before = await page.locator(".wallet-balance>strong").innerText();
  await page
    .getByRole("checkbox", { name: "ฉันเข้าใจว่าเป็นเครดิตสำหรับทดลอง" })
    .check();
  await page.getByRole("button", { name: /ยืนยันเติมเครดิต/ }).click();
  await expect(page.getByRole("status")).toContainText("สำเร็จ");
  await expect(page.locator(".wallet-balance>strong")).not.toHaveText(before);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, "mobile-wallet");
  await ready(page, "/admin");
  await expect(
    page.getByText("บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบจัดการร้านค้า"),
  ).toBeVisible();
  await ready(page, "/account");
  await page.locator(".account-button").click();
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(
    page.getByRole("link", { name: "สมัครสมาชิก", exact: true }),
  ).toBeVisible();
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "เข้าสู่ระบบเพื่อดูข้อมูลของคุณ" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("payment failure exposes no codes and keeps credit unchanged", async ({
  page,
}) => {
  await demo(page, "/products/stream-plus");
  await page.getByRole("button", { name: "ซื้อเลย", exact: true }).click();
  await page.getByRole("button", { name: "ดำเนินการชำระเครดิต" }).click();
  await expect(page).toHaveURL(/\/checkout\/[a-z0-9-]+$/);
  await page
    .getByRole("button", { name: "ทดลองกรณีชำระเงินไม่สำเร็จ" })
    .click();
  await expect(
    page.getByRole("heading", { name: "การชำระเครดิตไม่สำเร็จ" }),
  ).toBeVisible();
  await expect(page.locator(".code-row")).toHaveCount(0);
  await ready(page, "/wallet");
  await expect(page.locator(".wallet-balance>strong")).toHaveText("฿500.00");
});
test("registration and profile settings work", async ({ page }) => {
  await ready(page, "/register");
  const email = "ui-" + randomBytes(4).toString("hex") + "@example.invalid";
  await page
    .getByLabel("ชื่อผู้ใช้")
    .fill("ui_" + randomBytes(4).toString("hex"));
  await page.getByLabel("อีเมล (ไม่บังคับ)", { exact: true }).fill(email);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill("UI-test-only-12345");
  await page
    .getByLabel("ยืนยันรหัสผ่าน", { exact: true })
    .fill("UI-test-only-12345");
  await page.getByRole("button", { name: "สมัครสมาชิก", exact: true }).click();
  await expect(page).toHaveURL(base + "/account");
  await page.getByLabel("ชื่อที่แสดง").fill("Updated Customer");
  await page.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }).click();
  await expect(
    page.getByRole("heading", { name: "Updated Customer" }),
  ).toBeVisible();
});
test("admin can create a product, import inventory, reject duplicates and export", async ({
  page,
  browser,
}) => {
  await ready(page, "/login?next=%2Fadmin");
  await page
    .getByLabel("ชื่อผู้ใช้", { exact: true })
    .fill("admin@astra.local");
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(base + "/admin");
  await expect(
    page.getByRole("heading", { name: "ร้านค้า", exact: true }),
  ).toBeVisible();
  await screenshot(page, "admin-dashboard");
  await page
    .locator(".reference-primary-nav")
    .getByRole("link", { name: "สินค้า", exact: true })
    .click();
  await page.getByRole("link", { name: "เพิ่มสินค้า", exact: true }).click();
  await page.getByLabel("ชื่อสินค้า", { exact: true }).fill("QA LICENSE");
  await page
    .getByLabel("รายละเอียด", { exact: true })
    .fill("ไลเซนส์ทดลองสำหรับตรวจสอบระบบสั่งซื้อและคลังสินค้า");
  await page
    .getByRole("button", { name: "สร้างฉบับร่าง", exact: true })
    .click();
  await page.getByLabel("ราคาเริ่มต้น (เครดิตทดลอง)").fill("125");
  await page
    .getByRole("checkbox", { name: "เปิดขายสินค้า", exact: true })
    .check();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("บันทึกสินค้าแล้ว");
  const created = service.products().find((p) => p.name === "QA LICENSE");
  await ready(page, "/products/" + created.id);
  await expect(
    page.getByRole("button", { name: "ซื้อเลย", exact: true }),
  ).toBeDisabled();
  await ready(page, "/admin/inventory");
  await page.getByRole("button", { name: "นำเข้าโค้ด", exact: true }).click();
  await page
    .getByLabel("สินค้าและตัวเลือก")
    .selectOption({ label: "QA LICENSE · โค้ดดิจิทัล" });
  await page.getByLabel("โค้ด (หนึ่งโค้ดต่อบรรทัด)").fill("DEMO-QA-UI-0001");
  await page
    .getByRole("button", { name: "นำเข้าโค้ด", exact: true })
    .last()
    .click();
  await expect(page.getByRole("status")).toContainText("นำเข้า 1 โค้ดสำเร็จ");
  await page.getByRole("button", { name: "นำเข้าโค้ด", exact: true }).click();
  await page
    .getByLabel("สินค้าและตัวเลือก")
    .selectOption({ label: "QA LICENSE · โค้ดดิจิทัล" });
  await page.getByLabel("โค้ด (หนึ่งโค้ดต่อบรรทัด)").fill("DEMO-QA-UI-0001");
  await page
    .getByRole("button", { name: "นำเข้าโค้ด", exact: true })
    .last()
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "โค้ดนี้มีอยู่ในคลังแล้ว",
  );
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  const context = await browser.newContext();
  const buyer = await context.newPage();
  await demo(buyer, "/products/" + created.id);
  await buyer.getByRole("button", { name: "ซื้อเลย", exact: true }).click();
  await buyer.getByRole("button", { name: "ดำเนินการชำระเครดิต" }).click();
  await buyer.getByRole("button", { name: /ยืนยันชำระ/ }).click();
  await expect(buyer.locator(".code-row code")).toHaveText("DEMO-QA-UI-0001");
  await context.close();
  await ready(page, "/admin/inventory");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, "mobile-admin");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "ออเดอร์", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ดาวน์โหลด CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("astra-demo-orders.csv");
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
test("direct routes, errors, fonts and unknown pages work", async ({
  page,
}) => {
  for (const path of [
    "/credits",
    "/terms",
    "/privacy",
    "/support",
    "/cart",
    "/products/office-suite",
  ]) {
    await ready(page, path);
    await expect(page.locator("main h1,main h2").first()).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await ready(page, "/unknown");
  await expect(
    page.getByRole("heading", { name: "ไม่พบหน้านี้" }),
  ).toBeVisible();
  const response = await page.request.get(base + "/fonts/thai.woff2");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toBe("font/woff2");
  expect(
    (await page.request.get(base + "/.data/commerce.sqlite")).status(),
  ).toBe(404);
});
