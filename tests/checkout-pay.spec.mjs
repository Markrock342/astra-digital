// Customer pays from the website in test mode: ready stock delivers at once,
// preorder shows a queue number, wallet tops up test credit.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, buyer, token;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword: randomBytes(24).toString("hex") });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  const auth = service.register({
    name: "Pay Buyer",
    email: "pay-buyer@example.invalid",
    password: "Pay-buyer-Password-123",
  });
  token = auth.token;
  buyer = service.session(token);
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function signedIn(page) {
  await page.context().addCookies([
    { name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" },
  ]);
}

test("wallet tops up test credit", async ({ page }) => {
  await signedIn(page);
  await page.goto(base + "/wallet");
  await expect(page.getByRole("heading", { name: "เครดิตของฉัน" })).toBeVisible();
  const balance = () =>
    service.db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM ledger WHERE user_id=? AND kind='DEMO_CREDIT'").get(buyer.id).n;
  const before = balance();
  await page.getByRole("button", { name: "฿300.00" }).click();
  await expect(page.getByText("เติมเครดิตทดลองแล้ว")).toBeVisible();
  expect(balance()).toBe(before + 30000);
});

test("ready-stock order is paid on the website and shows the item", async ({ page }) => {
  await signedIn(page);
  const order = service.createOrder(buyer, { variantId: "stream-plus-30", quantity: 1, requestKey: "web-pay-0001" });
  await page.goto(base + "/checkout/" + order.id);
  await page.getByRole("button", { name: /^ชำระเงิน/ }).click();
  await expect(page).toHaveURL(new RegExp("/orders/" + order.id + "$"));
  await expect(page.getByRole("heading", { name: "สั่งซื้อสำเร็จ พร้อมรับสินค้า" })).toBeVisible();
  expect(service.orderDetail(buyer, order.id).status).toBe("DELIVERED");
});

test("preorder is paid on the website and shows the queue number", async ({ page }) => {
  await signedIn(page);
  const reservation = service.createOrder(buyer, { variantId: "cinema-max-90", quantity: 1, requestKey: "web-pay-0002" });
  await page.goto(base + "/checkout/" + reservation.id);
  await page.getByRole("button", { name: /^ชำระเงิน/ }).click();
  await expect(page.getByText(/^คิวที่ \d+$/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
