// Purchase history (/orders): search by order no. / product / email / password / code,
// status filter sheet, pages of 20 and the bulk copy mode, at 390px.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, buyerToken, deliveredA, deliveredB, pendingId;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.ORDER_LIST_SHOTS;

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  const admin = service.session(service.login({ email: "admin@astra.local", password: adminPassword }).token);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const make = (name) => {
    const p = service.saveProduct(admin, { name, description: name + " บัญชีสตรีมมิ่งรายเดือน", category: "streaming", price: 100, active: true, firstLabel: "30 วัน" });
    return service.adminProductVariants(admin, p.id).variants[0].id;
  };
  const stream = make("List Stream");
  const music = make("List Music");
  service.importCodes(admin, {
    variantId: stream,
    items: Array.from({ length: 30 }, (_, i) => ({ loginId: "list-" + i + "@stream.test", password: "Pw-" + i })),
  });
  service.importCodes(admin, { variantId: music, items: [{ loginId: "tune@music.test", password: "Tune-pass" }] });
  buyerToken = service.register({ name: "List Buyer", email: "list-buyer@example.invalid", password: "Buyer-Pass-12345" }).token;
  const buyer = service.session(buyerToken);
  const buy = (variantId, quantity, key) => {
    const o = service.createOrder(buyer, { variantId, quantity, requestKey: key });
    return service.pay(buyer, o.id, { paymentToken: o.paymentToken, outcome: "success" });
  };
  deliveredA = buy(stream, 2, "e2e-list-a").id;
  deliveredB = buy(music, 1, "e2e-list-b").id;
  // 20 single orders push the list onto a second page.
  for (let i = 0; i < 20; i++) buy(stream, 1, "e2e-list-fill-" + i);
  pendingId = service.createOrder(buyer, { variantId: stream, quantity: 1, requestKey: "e2e-list-pending" }).id;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

test.use({ viewport: { width: 390, height: 844 } });

async function signedIn(page) {
  await page.context().addCookies([{ name: "astra_session", value: buyerToken, url: base, httpOnly: true, sameSite: "Lax" }]);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await page.goto(base + "/orders");
  await expect(page.locator(".order-list-panel")).toBeVisible();
}
const rows = (page) => page.locator(".order-list-panel .history-item");

test("search, status filter and pages", async ({ page }) => {
  await signedIn(page);
  await expect(page.locator(".order-pager")).toContainText("หน้า 1 จาก 2 · ทั้งหมด 23 รายการ");
  await expect(rows(page)).toHaveCount(20);
  if (shots) await page.screenshot({ path: shots + "/list.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "หน้าถัดไป" }).click();
  await expect(rows(page)).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const search = page.getByRole("searchbox");
  // Product name, a delivered email, a password, an order number (with or without #).
  await search.fill("list music");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator(".order-pager")).toContainText("หน้า 1 จาก 1 · ทั้งหมด 1 รายการ");
  await search.fill("tune@music.test");
  await expect(rows(page)).toHaveCount(1);
  await search.fill("Tune-pass");
  await expect(rows(page)).toContainText(["List Music"]);
  await search.fill("#" + deliveredA.slice(0, 8));
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("× 2");
  await search.fill("nothing-like-this");
  await expect(page.getByText("ไม่พบคำสั่งซื้อที่ตรงกับการค้นหา")).toBeVisible();
  await page.getByRole("button", { name: "ล้างคำค้น" }).click();

  await page.getByRole("button", { name: /^สถานะ/ }).click();
  await page.getByRole("radio", { name: "กำลังดำเนินการ" }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("#" + pendingId.slice(0, 8).toUpperCase());
  await page.getByRole("button", { name: /^สถานะ/ }).click();
  await page.getByRole("radio", { name: "ยกเลิก/คืนเงิน" }).click();
  await expect(page.getByText("ไม่พบคำสั่งซื้อที่ตรงกับการค้นหา")).toBeVisible();
});

test("copy mode copies the picked orders' accounts", async ({ page }) => {
  await signedIn(page);
  await page.getByRole("button", { name: "คัดลอกข้อมูล" }).click();
  const bar = page.getByRole("region", { name: "คัดลอกข้อมูล" });
  await expect(bar).toContainText("เลือกคำสั่งซื้อที่ส่งสำเร็จเพื่อคัดลอก");
  // A pending order has nothing to copy.
  await expect(page.locator(".history-card", { hasText: pendingId.slice(0, 8).toUpperCase() })).toBeDisabled();
  // Picks survive a new search.
  for (const id of [deliveredA, deliveredB]) {
    await page.getByRole("searchbox").fill(id.slice(0, 8));
    await page.locator(".history-card", { hasText: id.slice(0, 8).toUpperCase() }).click();
  }
  await page.getByRole("button", { name: "ล้างคำค้น" }).click();
  await expect(bar).toContainText("เลือก 2 รายการ");
  // A tap in copy mode picks, never opens the order.
  await expect(page).toHaveURL(base + "/orders");
  if (shots) await page.screenshot({ path: shots + "/copy.png", animations: "disabled" });
  await bar.getByRole("button", { name: "คัดลอก", exact: true }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const lines = text.split("\n");
  expect(lines).toHaveLength(3);
  expect(lines).toContain("tune@music.test | Tune-pass");
  expect(lines.filter((l) => /^list-\d+@stream\.test \| Pw-\d+$/.test(l))).toHaveLength(2);
  // Page 1: the pending order + 19 delivered; picks from page 2 stay picked.
  await bar.getByRole("button", { name: "เลือกทั้งหน้า" }).click();
  await expect(bar).toContainText("เลือก 21 รายการ");
  await bar.getByRole("button", { name: "ปิดโหมดคัดลอก" }).click();
  await expect(bar).toHaveCount(0);
  await page.getByRole("searchbox").fill("List Music");
  await page.locator(".history-card", { hasText: deliveredB.slice(0, 8).toUpperCase() }).click();
  await expect(page).toHaveURL(base + "/orders/" + deliveredB);
});
