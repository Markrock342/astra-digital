// Admin back-office screens: preorder toggle (FR-P3), server-filtered orders,
// customers (edit / ban) and products (FR-O, FR-C, FR-P1).
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, buyer, buyerToken, adminToken, paidOrder;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  const auth = service.register({
    name: "Lists Buyer",
    email: "lists-buyer@example.invalid",
    password: "Lists-buyer-Password-123",
  });
  buyerToken = auth.token;
  buyer = service.session(auth.token);
  service.register({
    name: "Quiet Window",
    email: "quiet-window@example.invalid",
    password: "Quiet-window-Password-123",
  });
  service.topup(buyer, { amount: 500, requestKey: "lists-e2e-topup-0001" });
  const order = service.createOrder(buyer, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "lists-e2e-order-0001",
  });
  paidOrder = service.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(page, token) {
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" },
  ]);
}
const noSideScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("demo-only menus are gone", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/orders");
  const subnav = page.getByRole("navigation", { name: "เมนูย่อย" });
  await expect(subnav).toContainText("คิวพรีออเดอร์");
  for (const gone of ["เช่าไอดี", "แจ้งปัญหา", "รับ OTP"]) await expect(subnav).not.toContainText(gone);
  await page.goto(base + "/admin/settings");
  const settings = page.getByRole("navigation", { name: "เมนูย่อย" });
  for (const gone of ["บอท LINE", "โดเมน", "แพ็กเกจ", "จัดส่ง"]) await expect(settings).not.toContainText(gone);
});

test("admin switches a product to preorder from the form and filters by type", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/products/stream-plus");
  await page.getByText("พรีออเดอร์", { exact: true }).click();
  await page.getByRole("button", { name: /บันทึก/ }).first().click();
  await expect(page.getByText("บันทึกสินค้าแล้ว")).toBeVisible();
  const saved = service.adminProducts(service.session(adminToken), { q: "DISNEY" }).products[0];
  expect(saved.preorder).toBe(true);
  // Filter the product list by type.
  await page.goto(base + "/admin/products");
  await page.getByLabel("ประเภท").selectOption("preorder");
  await expect(page.locator(".admin-list-table tbody")).toContainText("DISNEY");
  await page.getByLabel("ประเภท").selectOption("ready");
  await expect(page.locator(".admin-list-table tbody")).not.toContainText("DISNEY");
  // Back to ready stock so the rest of the suite is unaffected.
  await page.goto(base + "/admin/products/stream-plus");
  await page.getByText("พร้อมส่ง", { exact: true }).click();
  await page.getByRole("button", { name: /บันทึก/ }).first().click();
  await expect(page.getByText("บันทึกสินค้าแล้ว")).toBeVisible();
});

test("orders filter on the server and the detail page reveals credentials with audit", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/orders");
  const table = page.locator(".admin-list-table tbody");
  await expect(table).toContainText("Lists Buyer");
  await page.getByLabel("สถานะ").selectOption("PENDING_PAYMENT");
  await expect(table).not.toContainText("Lists Buyer");
  await page.getByRole("button", { name: "ล้างตัวกรอง" }).click();
  await page.getByLabel("ค้นเลขออเดอร์ ลูกค้า หรือสินค้า").fill("lists-buyer");
  await expect(table.locator("tr")).toHaveCount(1);
  await table.locator("tr").first().click();
  await expect(page).toHaveURL(new RegExp("/admin/orders/" + paidOrder.id + "$"));
  await expect(page.locator(".admin-timeline")).toContainText("ชำระเงินสำเร็จ");
  // Seed stock is a license code: masked until revealed.
  await expect(page.locator(".admin-credential-list")).toContainText("***");
  await page.getByRole("button", { name: /แสดงรหัส/ }).click();
  await expect(page.locator(".admin-credential-list")).not.toContainText("***");
  const audit = service.db
    .prepare("SELECT COUNT(*) AS n FROM audit WHERE action='REVEAL_ORDER_CREDENTIALS' AND entity_id=?")
    .get(paidOrder.id).n;
  expect(audit).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
});

test("admin edits and bans a customer, who is signed out", async ({ page, browser }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/customers");
  const table = page.locator(".admin-list-table tbody");
  await expect(table).toContainText("Quiet Window");
  await page.getByLabel("ออเดอร์").selectOption("true");
  await expect(table).not.toContainText("Quiet Window");
  await expect(table).toContainText("Lists Buyer");
  await table.getByText("Lists Buyer").click();
  await expect(page.locator(".admin-stat-row")).toContainText("เครดิตคงเหลือ");
  await page.getByLabel("นามสกุล").fill("ใจดี");
  await page.getByLabel("เบอร์โทร").fill("0812345678");
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  await expect(page.getByRole("heading", { name: "Lists ใจดี" })).toBeVisible();
  await expect(page.locator(".admin-timeline")).toContainText("แก้ นามสกุล, เบอร์โทร");

  await page.getByRole("button", { name: "แบนบัญชี" }).click();
  await page.getByLabel(/เหตุผล/).fill("ทดสอบการแบน");
  await page.getByRole("button", { name: "ยืนยันแบน" }).click();
  await expect(page.locator(".admin-callout")).toContainText("ทดสอบการแบน");
  expect(service.session(buyerToken)).toBeNull();

  const customer = await browser.newPage();
  await customer.goto(base + "/login");
  await customer.locator('input[name="username"]').fill("lists-buyer@example.invalid");
  await customer.locator('input[name="password"]').fill("Lists-buyer-Password-123");
  await customer.locator("form").getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(customer.getByRole("alert")).toContainText("ถูกระงับ");
  await customer.close();

  await page.getByRole("button", { name: /ยกเลิกการแบน/ }).click();
  await expect(page.locator(".admin-callout")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
});

test("finance lists real money with timestamps and hides demo credit by default", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/payments");
  await expect(page.getByRole("heading", { name: "การเงิน" })).toBeVisible();
  const table = page.locator(".admin-list-table tbody");
  await expect(table).toContainText("รับชำระ");
  await expect(table).not.toContainText("เครดิตทดลอง");
  await expect(page.locator(".finance-stats")).toContainText("฿100.00");
  await page.getByLabel("ประเภทรายการ").selectOption("DEMO_CREDIT");
  await expect(table).toContainText("เครดิตทดลอง");
  await page.getByLabel("ประเภทรายการ").selectOption("");
  await page.getByRole("button", { name: "วันนี้" }).click();
  await expect(table).toContainText("รับชำระ");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
});

test("dashboard reads server numbers, audit log lists admin actions, unpaid order can be cancelled", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin");
  await expect(page.locator(".reference-admin-metrics")).toContainText("ยอดขาย");
  await expect(page.locator(".reference-admin-metrics")).not.toContainText("เลือกเอง");
  await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
  await expect(page.locator(".reference-admin-metrics")).toContainText("฿100.00");

  const unpaid = service.createOrder(buyer, { variantId: "stream-plus-30", quantity: 1, requestKey: "lists-e2e-unpaid-01" });
  await page.goto(base + "/admin/orders/" + unpaid.id);
  await page.getByRole("button", { name: "ยกเลิกออเดอร์" }).click();
  await page.getByLabel(/เหตุผลที่ยกเลิก/).fill("ลูกค้าขอยกเลิก");
  await page.getByRole("button", { name: "ยืนยันยกเลิกออเดอร์" }).click();
  await expect(page.getByText("ยกเลิกออเดอร์แล้ว")).toBeVisible();

  await page.goto(base + "/admin/settings/audit");
  await expect(page.locator(".admin-list-table tbody")).toContainText("ลูกค้าขอยกเลิก");
  await expect(page.locator(".admin-list-table tbody")).toContainText("เปลี่ยนสถานะลูกค้า");
  await page.goto(base + "/admin/settings/account");
  await expect(page.getByRole("heading", { name: "บัญชีแอดมิน" })).toBeVisible();
});

test("preorder queue filters by product and delivers several queues at once", async ({ page }) => {
  const admin = service.session(adminToken);
  const queued = [];
  for (const key of ["lists-batch-01", "lists-batch-02"]) {
    const r = service.createOrder(buyer, { variantId: "cinema-max-90", quantity: 1, requestKey: key });
    service.topup(buyer, { amount: 300, requestKey: key + "-topup" });
    queued.push(service.pay(buyer, r.id, { paymentToken: r.paymentToken, outcome: "success" }));
  }
  service.importCodes(admin, {
    variantId: "cinema-max-90",
    items: [
      { loginId: "batch-a@stream.test", password: "Pw-BA" },
      { loginId: "batch-b@stream.test", password: "Pw-BB" },
    ],
  });
  await as(page, adminToken);
  await page.goto(base + "/admin/preorders");
  await page.getByLabel("สินค้า").selectOption({ index: 1 });
  for (const q of queued) await page.getByLabel("เลือกคิว #" + q.queueNumber).check();
  await page.getByRole("button", { name: "ส่งที่เลือก 2 คิว" }).click();
  await page.getByRole("button", { name: "ยืนยันส่ง 2 คิว" }).click();
  await expect(page.getByText("ส่งของแล้ว 2 คิว")).toBeVisible();
  for (const q of queued) expect(service.orderDetail(buyer, q.id).status).toBe("DELIVERED");

  // Internal note on the order: saved for staff, never shown to the customer.
  await page.goto(base + "/admin/orders/" + queued[0].id);
  await page.getByLabel("หมายเหตุภายใน").fill("ลูกค้าขอส่งด่วน");
  await page.getByRole("button", { name: "บันทึกหมายเหตุ" }).click();
  await expect(page.getByText("บันทึกหมายเหตุแล้ว")).toBeVisible();
  expect(JSON.stringify(service.orderDetail(buyer, queued[0].id))).not.toContain("ส่งด่วน");
});

test("product images UI resizes to webp and sends raw bytes (upload API mocked until W5)", async ({ page }) => {
  await as(page, adminToken);
  const uploads = [];
  await page.route("**/api/health", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, features: { ...body.features, uploads: true } } });
  });
  await page.route("**/api/admin/products/stream-plus/images", async (route) => {
    const req = route.request();
    uploads.push({ type: req.headers()["content-type"], bytes: req.postDataBuffer()?.length ?? 0, head: req.postDataBuffer()?.subarray(0, 12).toString("latin1") });
    await route.fulfill({ json: { image: { id: "img-" + uploads.length, url: "/brand/og.png" } } });
  });
  await page.goto(base + "/admin/products/stream-plus");
  await expect(page.getByRole("heading", { name: "รูปสินค้า" })).toBeVisible();
  // 1x1 PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
  await page.getByLabel("เลือกรูปสินค้า").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".product-image-grid figure")).toHaveCount(1);
  await expect(page.locator(".product-image-badge")).toHaveText("ปก");
  expect(uploads[0].type).toBe("image/webp");
  expect(uploads[0].head.startsWith("RIFF") && uploads[0].head.endsWith("WEBP")).toBe(true);
  await page.getByLabel("เลือกรูปสินค้า").setInputFiles({ name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(page.getByRole("alert")).toContainText("รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");
  expect(uploads.length).toBe(1);
});

test("admin adds another admin, grants and removes admin rights with a confirm step", async ({ page, browser }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/settings/team");
  await expect(page.getByText("เจ้าของร้าน")).toBeVisible();
  await page.getByLabel("ชื่อ", { exact: true }).fill("แอดมินสำรอง");
  await page.getByLabel("อีเมลสำหรับเข้าสู่ระบบ").fill("backup-admin@example.invalid");
  await page.getByLabel("สิทธิ์").selectOption("ADMIN");
  // A new admin needs the acting admin's password again.
  await page.getByLabel(/รหัสผ่านของคุณ/).fill(adminPassword);
  await page.getByRole("button", { name: "เพิ่มบัญชี" }).click();
  const temp = (await page.locator(".admin-temp-password code").textContent()).trim();
  const row = page.locator(".settings-row", { hasText: "backup-admin@example.invalid" });
  await expect(row).toContainText("แอดมิน");

  // The new admin can open finance, which staff never see.
  const other = await browser.newPage();
  const token = service.login({ email: "backup-admin@example.invalid", password: temp }).token;
  await other.context().addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
  await other.goto(base + "/admin/payments");
  await expect(other.getByRole("heading", { name: "การเงิน", exact: true })).toBeVisible();
  await other.close();

  // Remove admin rights: first click only asks, the second applies.
  await row.getByRole("button", { name: "ถอดสิทธิ์แอดมิน" }).click();
  await row.getByRole("button", { name: "ยืนยันถอดสิทธิ์แอดมิน" }).click();
  await expect(row).toContainText("ทีมงาน");
  await expect(row.getByRole("button", { name: "ให้สิทธิ์แอดมิน" })).toBeVisible();
  // The owner row and the signed-in admin have no role buttons.
  await expect(page.locator(".settings-row", { hasText: "admin@astra.local" }).getByRole("button")).toHaveCount(0);
});
