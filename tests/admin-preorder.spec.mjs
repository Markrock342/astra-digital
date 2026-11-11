// Admin screens built ahead of NOTT's DB-005 API: preorder queue board,
// deliver button, ID + password import, and the customer's credential view.
// Real API where it exists; mocked routes for the endpoints DB-005 will add.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, buyer, paidPreorder;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  const auth = service.register({
    name: "Queue Buyer",
    email: "queue-buyer@example.invalid",
    password: "Queue-buyer-Password-123",
  });
  buyer = service.session(auth.token);
  const reservation = service.createOrder(buyer, {
    variantId: "cinema-max-90",
    quantity: 1,
    requestKey: "admin-queue-e2e-0001",
  });
  paidPreorder = service.pay(buyer, reservation.id, {
    paymentToken: reservation.paymentToken,
    outcome: "success",
  });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function ready(page, path) {
  await page.goto(base + path);
  await page.locator(".loading-row").waitFor({ state: "hidden" });
}
async function loginAdmin(page, next) {
  await ready(page, "/login?next=" + encodeURIComponent(next));
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill("admin@astra.local");
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(base + next);
}
async function withFeatures(page, features) {
  await page.route("**/api/health", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, features } });
  });
}

test("queue board lists paid preorders in order; deliver waits for DB-005", async ({ page }) => {
  expect(paidPreorder.status).toBe("PREORDER");
  await loginAdmin(page, "/admin/preorders");
  await expect(page.getByRole("heading", { name: "คิวพรีออเดอร์" })).toBeVisible();
  const row = page.locator("tbody tr").filter({ hasText: "#" + paidPreorder.queueNumber });
  await expect(row).toContainText("Queue Buyer");
  await expect(row.getByRole("button", { name: "ส่งของ" })).toBeDisabled();
  await expect(page.getByRole("note")).toContainText("ปุ่มส่งของจะใช้ได้หลังอัปเดตฐานข้อมูล");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

test("with delivery enabled, admin confirms and the deliver endpoint is called once", async ({ page }) => {
  await withFeatures(page, { credentialPair: true, preorderDelivery: true });
  const calls = [];
  await page.route("**/api/admin/reservations/*/deliver", async (route) => {
    calls.push(route.request().url());
    await route.fulfill({
      json: { id: paidPreorder.id, status: "DELIVERED", delivered: 1 },
    });
  });
  await loginAdmin(page, "/admin/preorders");
  const row = page.locator("tbody tr").filter({ hasText: "#" + paidPreorder.queueNumber });
  await row.getByRole("button", { name: "ส่งของ" }).click();
  await row.getByRole("button", { name: "ยกเลิก" }).click();
  expect(calls).toHaveLength(0);
  await row.getByRole("button", { name: "ส่งของ" }).click();
  await row.getByRole("button", { name: /ยืนยันส่งคิว/ }).click();
  await expect(page.getByRole("status")).toContainText(
    "ส่งของคิว #" + paidPreorder.queueNumber + " แล้ว",
  );
  expect(calls).toEqual([
    base + "/api/admin/reservations/" + paidPreorder.id + "/deliver",
  ]);
});

test("ID + password import sends pairs, accepts a spreadsheet paste and rejects half rows", async ({ page }) => {
  await withFeatures(page, { credentialPair: true, preorderDelivery: false });
  let sent;
  await page.route("**/api/admin/inventory", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { imported: sent.items.length } });
  });
  await loginAdmin(page, "/admin/inventory");
  await page.getByRole("button", { name: "นำเข้าโค้ด", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("ไอดีและรหัสผ่าน")).toBeVisible();

  // Half-filled row is refused before any request.
  await dialog.getByLabel("ไอดี 1").fill("only-id@example.invalid");
  await dialog.getByRole("button", { name: "นำเข้าโค้ด", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("ทุกแถวต้องมีทั้งไอดีและรหัสผ่าน");
  expect(sent).toBeUndefined();

  // Paste two rows copied from a spreadsheet (TAB between columns).
  await dialog.getByLabel("ไอดี 1").fill("");
  await dialog.getByLabel("ไอดี 1").evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text", "first@example.invalid\tPa:ss|1 \nsecond@example.invalid\tp\tw2\n");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(dialog.getByLabel("ไอดี 2")).toHaveValue("second@example.invalid");
  await dialog.getByRole("button", { name: "นำเข้าโค้ด", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("นำเข้า 2 บัญชีสำเร็จ");
  expect(sent.items).toEqual([
    { loginId: "first@example.invalid", password: "Pa:ss|1 " },
    { loginId: "second@example.invalid", password: "p\tw2" },
  ]);
  expect(sent.variantId).toBeTruthy();
  expect(sent.codes).toBeUndefined();
});

test("customer sees a delivered ID and password masked until revealed", async ({ page }) => {
  const r = await page.request.post(base + "/api/login", {
    headers: { "X-Astra-Request": "1", "Content-Type": "application/json", Origin: base },
    data: { email: "queue-buyer@example.invalid", password: "Queue-buyer-Password-123" },
  });
  expect(r.status()).toBe(200);
  await page.route("**/api/orders/" + paidPreorder.id, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({
      response: res,
      json: {
        ...body,
        status: "DELIVERED",
        codes: [],
        credentials: [{ loginId: "viewer@example.invalid", password: "S3cret-pw" }],
      },
    });
  });
  await ready(page, "/orders/" + paidPreorder.id);
  const box = page.locator(".delivered-codes");
  await expect(box).toContainText("ไอดี");
  await expect(box).not.toContainText("S3cret-pw");
  await box.getByRole("button", { name: /แสดงโค้ด/ }).click();
  await expect(box).toContainText("viewer@example.invalid");
  await expect(box).toContainText("S3cret-pw");
  await expect(box.getByRole("button", { name: /คัดลอกรหัสผ่าน/ })).toBeVisible();
});
