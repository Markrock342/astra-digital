// Small UX round A: no public stock numbers, notification deep links, copy /
// resend credentials from the admin order detail, unsaved-changes guard.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, buyer, buyerToken, adminToken, order;
const adminPassword = randomBytes(24).toString("hex");
const PASSWORD = "E2e-Pair-Pass-77";
const LOGIN = "uxa-pair@example.invalid";

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const admin = service.session(adminToken);
  // One ID + password pair on sale, so the order has something to reveal and copy.
  service.db
    .prepare("DELETE FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL")
    .run("stream-plus-30");
  service.importCodes(admin, { variantId: "stream-plus-30", items: [{ loginId: LOGIN, password: PASSWORD }] });
  const auth = service.register({ name: "UXA Buyer", email: "uxa-buyer@example.invalid", password: "Uxa-buyer-Password-123" });
  buyerToken = auth.token;
  buyer = service.session(auth.token);
  const created = service.createOrder(buyer, { variantId: "stream-plus-30", quantity: 1, requestKey: "uxa-e2e-order-0001" });
  order = service.pay(buyer, created.id, { paymentToken: created.paymentToken, outcome: "success" });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(page, token) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("storefront gets a stock status, never a number, and still sells", async ({ page }) => {
  for (const path of ["/api/products", "/api/products/stream-plus"]) {
    const text = await (await page.request.get(base + path)).text();
    expect(text).not.toMatch(/"stock"\s*:/);
    expect(text).toMatch(/"stockStatus"/);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/products/stream-plus");
  // stream-plus-30 is sold out now (its only account was bought); another option has seed stock.
  const variants = service.productDetail("stream-plus").variants;
  const soldOut = variants.find((v) => v.id === "stream-plus-30");
  const onSale = variants.find((v) => v.available);
  expect(soldOut.stockStatus).toBe("out");
  const options = page.getByRole("group", { name: "ตัวเลือก" });
  await expect(options.getByRole("button", { name: soldOut.label })).toContainText("สินค้าหมด");
  await options.getByRole("button", { name: onSale.label }).click();
  const plus = page.getByRole("button", { name: "เพิ่มจำนวน" });
  for (let i = 0; i < 3; i++) await plus.click();
  await expect(page.locator(".reference-buy-row .quantity-control")).toContainText("4");
  expect(await noSideScroll(page)).toBe(true);
});

test("customer bell opens the linked order and marks it read", async ({ page }) => {
  await as(page, buyerToken);
  await page.goto(base + "/");
  await page.getByRole("button", { name: /^แจ้งเตือน/ }).click();
  await page.getByRole("dialog", { name: "แจ้งเตือน" }).getByText("ส่งโค้ดสำเร็จ").click();
  await expect(page).toHaveURL(new RegExp("/orders/" + order.id + "$"));
  await expect
    .poll(() =>
      service.db.prepare("SELECT read_at FROM notifications WHERE user_id=? AND kind='code_delivery'").get(buyer.id).read_at,
    )
    .not.toBeNull();
});

test("admin reveals, copies and resends credentials with a confirm step", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await as(page, adminToken);
  // The admin bell links to the order itself.
  await page.goto(base + "/admin");
  await page.getByRole("button", { name: /^แจ้งเตือน/ }).click();
  await page.getByRole("dialog", { name: "แจ้งเตือน" }).getByText("ออเดอร์ใหม่").first().click();
  await expect(page).toHaveURL(new RegExp("/admin/orders/" + order.id + "$"));

  const list = page.locator(".admin-credential-list");
  await expect(list).not.toContainText(PASSWORD);
  await expect(list.getByRole("button", { name: /^คัดลอก/ })).toHaveCount(0);
  await page.getByRole("button", { name: /แสดงรหัส/ }).click();
  await page.getByLabel("เหตุผลที่เปิดดูรหัส").selectOption("ลูกค้าขอให้ส่งรหัสอีกครั้ง");
  await page.getByRole("button", { name: "แสดงรหัส", exact: true }).click();
  await expect(list).toContainText(PASSWORD);
  await list.getByRole("button", { name: "คัดลอกรหัสผ่าน" }).click();
  await expect(page.getByRole("status")).toContainText("คัดลอกรหัสผ่านแล้ว");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PASSWORD);
  await list.getByRole("button", { name: "คัดลอก ID" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LOGIN);

  // Resend: confirm first; cancelling sends nothing.
  await page.getByRole("button", { name: "ส่งรหัสให้ลูกค้าอีกครั้ง" }).click();
  const confirmBox = page.getByRole("group", { name: "ยืนยันส่งรหัสให้ลูกค้าอีกครั้ง" });
  await expect(confirmBox).toContainText("ไม่ส่งรหัสผ่านในแชท");
  await confirmBox.getByRole("button", { name: "ยกเลิก" }).click();
  const resends = () =>
    service.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='RESEND_CREDENTIALS' AND entity_id=?").get(order.id).n;
  expect(resends()).toBe(0);
  await page.getByRole("button", { name: "ส่งรหัสให้ลูกค้าอีกครั้ง" }).click();
  await confirmBox.getByRole("button", { name: "ยืนยันส่งให้ลูกค้า" }).click();
  await expect(page.getByRole("status")).toContainText("ส่งรหัสให้ลูกค้าอีกครั้งแล้ว");
  expect(resends()).toBe(1);
  await expect(page.locator(".admin-activity")).toContainText("ส่งรหัสให้ลูกค้าอีกครั้ง");
  const chat = service.db
    .prepare("SELECT m.body FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id WHERE t.user_id=? ORDER BY m.rowid DESC LIMIT 1")
    .get(buyer.id).body;
  expect(chat).toContain("/orders/" + order.id);
  expect(chat).not.toContain(PASSWORD);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
});

test("customer follows the resend notification and the chat link to the order", async ({ page }) => {
  await as(page, buyerToken);
  await page.goto(base + "/");
  await page.getByRole("button", { name: /^แจ้งเตือน/ }).click();
  await page.getByRole("dialog", { name: "แจ้งเตือน" }).getByText("ร้านส่งข้อมูลบัญชีให้อีกครั้ง").click();
  await expect(page).toHaveURL(new RegExp("/orders/" + order.id + "$"));
  await page.goto(base + "/");
  await page.getByRole("button", { name: "แชทกับร้าน" }).click();
  const panel = page.getByRole("dialog", { name: "แชทกับร้าน" });
  await expect(panel).not.toContainText(PASSWORD);
  await panel.getByRole("link", { name: "/orders/" + order.id }).click();
  await expect(page).toHaveURL(new RegExp("/orders/" + order.id + "$"));
});

test("product editor asks before leaving with unsaved changes; saving clears it", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/products/stream-plus");
  const name = page.getByLabel("ชื่อสินค้า");
  await expect(name).toHaveValue(/.+/);
  const original = await name.inputValue();

  // Clean form: leaving needs no confirm.
  let dialogs = 0;
  const countDialogs = (d) => {
    dialogs += 1;
    void d.accept();
  };
  page.on("dialog", countDialogs);
  await page.locator(".editor-save-bar").getByRole("link", { name: "ยกเลิก" }).click();
  await expect(page).toHaveURL(/\/admin\/products$/);
  expect(dialogs).toBe(0);
  page.off("dialog", countDialogs);

  // Dirty form: in-app navigation asks; "cancel" stays on the page with the edit.
  await page.goto(base + "/admin/products/stream-plus");
  await name.fill(original + " แก้");
  let message = "";
  page.once("dialog", (d) => {
    message = d.message();
    void d.dismiss();
  });
  await page.locator(".editor-save-bar").getByRole("link", { name: "ยกเลิก" }).click();
  await expect.poll(() => message).toBe("มีการแก้ไขที่ยังไม่บันทึก ออกจากหน้านี้?");
  await expect(page).toHaveURL(/\/admin\/products\/stream-plus$/);
  await expect(name).toHaveValue(original + " แก้");

  // Tab close / reload: the beforeunload handler blocks while dirty.
  await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    dispatchEvent(e);
    document.body.dataset.unloadBlocked = String(e.defaultPrevented);
  });
  await expect(page.locator("body")).toHaveAttribute("data-unload-blocked", "true");

  // Typing it back to the saved value is clean again.
  await name.fill(original);
  await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    dispatchEvent(e);
    document.body.dataset.unloadBlocked = String(e.defaultPrevented);
  });
  await expect(page.locator("body")).toHaveAttribute("data-unload-blocked", "false");

  // The back link asks too; accepting leaves.
  await name.fill(original + " แก้");
  page.once("dialog", (d) => void d.accept());
  await page.locator(".back-link").first().click();
  await expect(page).toHaveURL(/\/admin\/products$/);

  // Saving clears the dirty state: no confirm on the way out afterwards.
  await page.goto(base + "/admin/products/stream-plus");
  await name.fill(original + " ใหม่");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกสินค้าแล้ว")).toBeVisible();
  page.on("dialog", countDialogs);
  await page.locator(".back-link").first().click();
  await expect(page).toHaveURL(/\/admin\/products$/);
  expect(dialogs).toBe(0);
  page.off("dialog", countDialogs);
  // Put the name back for anything that runs later.
  const admin = service.session(adminToken);
  const p = service.adminProducts(admin, { q: original + " ใหม่" }).products[0];
  expect(p).toBeTruthy();
  await page.goto(base + "/admin/products/stream-plus");
  await name.fill(original);
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกสินค้าแล้ว")).toBeVisible();
});
