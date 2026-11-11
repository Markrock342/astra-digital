// Admin preorder queue, deliver, ID+password import, and customer credential view.
// Hits real DB-005 APIs (features on).
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, buyer, buyerToken, paidPreorder;
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
  buyerToken = auth.token;
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
  service.db
    .prepare(
      "DELETE FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL",
    )
    .run("cinema-max-90");
  const adminAuth = service.login({
    email: "admin@astra.local",
    password: adminPassword,
  });
  service.importCodes(service.session(adminAuth.token), {
    variantId: "cinema-max-90",
    items: [{ loginId: "viewer@example.invalid", password: "S3cret-pw" }],
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
  await page.locator('input[name="username"]').fill("admin@astra.local");
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.locator("form").getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(base + next);
}

test("queue board lists paid preorders with deliver enabled", async ({ page }) => {
  expect(paidPreorder.status).toBe("PREORDER");
  const health = await page.request.get(base + "/api/health");
  expect((await health.json()).features).toEqual({
    credentialPair: true,
    preorderDelivery: true,
  });
  await loginAdmin(page, "/admin/preorders");
  await expect(page.getByRole("heading", { name: "คิวพรีออเดอร์" })).toBeVisible();
  const row = page.locator("tbody tr").filter({ hasText: "#" + paidPreorder.queueNumber });
  await expect(row).toContainText("Queue Buyer");
  await expect(row.getByRole("button", { name: "ส่งของ" })).toBeEnabled();
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

test("admin confirms and deliver API fulfills once; queue clears", async ({ page }) => {
  await loginAdmin(page, "/admin/preorders");
  const row = page.locator("tbody tr").filter({ hasText: "#" + paidPreorder.queueNumber });
  await row.getByRole("button", { name: "ส่งของ" }).click();
  await row.getByRole("button", { name: "ยกเลิก" }).click();
  await row.getByRole("button", { name: "ส่งของ" }).click();
  await row.getByRole("button", { name: /ยืนยันส่งคิว/ }).click();
  await expect(page.getByRole("status")).toContainText(
    "ส่งของคิว #" + paidPreorder.queueNumber + " แล้ว",
  );
  await expect(page.locator("tbody tr").filter({ hasText: "#" + paidPreorder.queueNumber })).toHaveCount(0);
  const status = service.db
    .prepare("SELECT status FROM reservations WHERE id=?")
    .get(paidPreorder.id).status;
  expect(status).toBe("DELIVERED");
  expect(
    service.db
      .prepare("SELECT COUNT(*) AS n FROM inventory WHERE reservation_id=?")
      .get(paidPreorder.id).n,
  ).toBe(1);
});

test("ID + password import sends pairs, accepts a spreadsheet paste and rejects half rows", async ({
  page,
}) => {
  await loginAdmin(page, "/admin/inventory");
  await page.getByRole("button", { name: "นำเข้าโค้ด", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("ไอดีและรหัสผ่าน")).toBeVisible();

  await dialog.getByLabel("ไอดี 1").fill("only-id@example.invalid");
  await dialog.getByRole("button", { name: "นำเข้าโค้ด", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("ทุกแถวต้องมีทั้งไอดีและรหัสผ่าน");

  await dialog.getByLabel("ไอดี 1").fill("");
  await dialog.getByLabel("ไอดี 1").evaluate((el) => {
    const data = new DataTransfer();
    data.setData(
      "text",
      "first@example.invalid\tPa:ss|1 \nsecond@example.invalid\tp\tw2\n",
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(dialog.getByLabel("ไอดี 2")).toHaveValue("second@example.invalid");
  await dialog.getByRole("button", { name: "นำเข้าโค้ด", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("นำเข้า 2 บัญชีสำเร็จ");
});

test("customer sees a delivered ID and password masked until revealed", async ({ page }) => {
  await page.context().addCookies([
    {
      name: "astra_session",
      value: buyerToken,
      url: base,
    },
  ]);
  await ready(page, "/orders/" + paidPreorder.id);
  const box = page.locator(".delivered-codes");
  await expect(box).toContainText("ไอดี");
  await expect(box).not.toContainText("S3cret-pw");
  await box.getByRole("button", { name: /แสดงโค้ด/ }).click();
  await expect(box).toContainText("viewer@example.invalid");
  await expect(box).toContainText("S3cret-pw");
  await expect(box.getByRole("button", { name: /คัดลอกรหัสผ่าน/ })).toBeVisible();
});
