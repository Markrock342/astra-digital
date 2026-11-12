// Admin back-office screens: preorder toggle (FR-P3), server-filtered orders,
// customers (edit / ban) and products (FR-O, FR-C, FR-P1).
import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";
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
  await page.getByLabel("เหตุผลที่เปิดดูรหัส").selectOption("ลูกค้าแจ้งว่าเข้าใช้งานไม่ได้");
  await page.getByRole("button", { name: "แสดงรหัส", exact: true }).click();
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
  await page.goto(base + "/admin");
  await page.getByRole("link", { name: "ทีมงาน", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/team$/);
  await expect(page.getByText("เจ้าของร้าน")).toBeVisible();
  await page.getByLabel("ชื่อ", { exact: true }).fill("แอดมินสำรอง");
  await page.getByLabel("อีเมลสำหรับเข้าสู่ระบบ").fill("backup-admin@example.invalid");
  await page.getByLabel("สิทธิ์").selectOption("ADMIN");
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

  // Lower to staff: first click only asks, the second applies.
  await row.getByRole("button", { name: "ลดเป็นทีมงาน" }).click();
  await row.getByRole("button", { name: "ยืนยันตั้งเป็นทีมงาน" }).click();
  await expect(row).toContainText("ทีมงาน");
  await expect(row.getByRole("button", { name: "ให้สิทธิ์แอดมิน" })).toBeVisible();
  // The owner row and the signed-in admin have no role buttons.
  await expect(page.locator(".settings-row", { hasText: "admin@astra.local" }).getByRole("button")).toHaveCount(0);
});

test("admin gives a customer who already signed up staff rights, then takes them back", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/team");
  await page.getByLabel("ค้นหาลูกค้า").fill("Quiet");
  const hit = page.locator(".settings-row", { hasText: "quiet-window@example.invalid" });
  await hit.getByRole("button", { name: "ตั้งเป็นทีมงาน" }).click();
  await hit.getByRole("button", { name: "ยืนยันตั้งเป็นทีมงาน" }).click();
  const row = page.locator(".settings-row", { hasText: "quiet-window@example.invalid" });
  await expect(row).toContainText("ทีมงาน");
  // The same password now opens the back office.
  const login = service.login({ email: "quiet-window@example.invalid", password: "Quiet-window-Password-123" });
  assert.equal(service.session(login.token).role, "STAFF");
  await row.getByRole("button", { name: "กลับเป็นลูกค้า" }).click();
  await row.getByRole("button", { name: "ยืนยันเปลี่ยนกลับเป็นลูกค้า" }).click();
  await expect(page.locator(".settings-row", { hasText: "quiet-window@example.invalid" })).toHaveCount(0);
  assert.equal(service.session(login.token).role, "CUSTOMER");
});

// ---------------------------------------------------------------- Products + stock round

function makeProduct(name, labels) {
  const admin = service.session(adminToken);
  const product = service.saveProduct(admin, {
    name,
    description: "สินค้าทดสอบรายการสินค้า",
    category: "streaming",
    price: 5000,
    active: true,
  });
  const first = service.adminProductVariants(admin, product.id).variants[0];
  service.updateVariant(admin, first.id, { label: labels[0] });
  const variants = [first.id];
  for (const label of labels.slice(1))
    variants.push(service.createVariant(admin, product.id, { label, price: 9900 }).id);
  return { id: product.id, variants };
}

test("products list shows stock per option, bulk actions ask first, duplicate opens the draft", async ({ page }) => {
  const admin = service.session(adminToken);
  const alpha = makeProduct("Bulk Alpha", ["Alpha 30 วัน", "Alpha 90 วัน"]);
  const beta = makeProduct("Bulk Beta", ["Beta 30 วัน"]);
  service.importCodes(admin, {
    variantId: alpha.variants[0],
    items: [1, 2, 3, 4, 5].map((n) => ({ loginId: "alpha-" + n + "@list.test", password: "Pw-" + n })),
  });
  await as(page, adminToken);
  await page.goto(base + "/admin/products");
  await page.getByLabel("ค้นชื่อสินค้า").fill("Bulk");
  const table = page.locator(".admin-list-table tbody");
  await expect(table.locator("tr")).toHaveCount(2);
  // The empty 90-day option is visible even though the product total is 5.
  const alphaRow = table.locator("tr", { hasText: "Bulk Alpha" });
  await expect(alphaRow.locator(".variant-stock-line", { hasText: "Alpha 30 วัน" })).toContainText("5");
  await expect(alphaRow.locator(".variant-stock-line", { hasText: "Alpha 90 วัน" })).toContainText("หมด");

  await page.getByLabel("เลือก Bulk Alpha").check();
  await page.getByLabel("เลือก Bulk Beta").check();
  const bar = page.getByRole("region", { name: "จัดการสินค้าที่เลือก" });
  await expect(bar).toContainText("เลือก 2 สินค้า");
  await bar.getByRole("button", { name: "ตั้งเป็นสินค้าแนะนำ", exact: true }).click();
  // Nothing changes until the confirm button.
  expect(service.db.prepare("SELECT featured FROM products WHERE id=?").get(alpha.id).featured).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await bar.getByRole("button", { name: "ยืนยันตั้งเป็นสินค้าแนะนำ 2 สินค้า" }).click();
  await expect(page.getByRole("status")).toContainText("ตั้งเป็นสินค้าแนะนำแล้ว 2 สินค้า");
  for (const id of [alpha.id, beta.id])
    expect(service.db.prepare("SELECT featured FROM products WHERE id=?").get(id).featured).toBe(1);
  await expect(alphaRow).toContainText("แนะนำ");

  await page.getByLabel("เลือก Bulk Beta").check();
  await bar.getByRole("button", { name: "ปิดขาย", exact: true }).click();
  await bar.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  expect(service.db.prepare("SELECT active FROM products WHERE id=?").get(beta.id).active).toBe(1);
  await bar.getByRole("button", { name: "ปิดขาย", exact: true }).click();
  await bar.getByRole("button", { name: "ยืนยันปิดขาย 1 สินค้า" }).click();
  await expect(page.getByRole("status")).toContainText("ปิดขายแล้ว 1 สินค้า");
  expect(service.db.prepare("SELECT active FROM products WHERE id=?").get(beta.id).active).toBe(0);
  expect(
    service.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='PRODUCT_BULK_DEACTIVATE' AND entity_id=?").get(beta.id).n,
  ).toBe(1);

  await page.getByLabel("เลือก Bulk Alpha").check();
  await bar.getByRole("button", { name: "คัดลอกสินค้า", exact: true }).click();
  await bar.getByRole("button", { name: "ยืนยันคัดลอกเป็นฉบับร่าง" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bulk Alpha (สำเนา)" })).toBeVisible();
  const copyId = page.url().split("/").pop();
  expect(copyId).not.toBe(alpha.id);
  const copy = service.db.prepare("SELECT active,featured FROM products WHERE id=?").get(copyId);
  expect({ ...copy }).toEqual({ active: 0, featured: 0 });
  await expect(page.locator(".variant-manager")).toContainText("Alpha 90 วัน");
  await expect(page.locator(".variant-manager").getByRole("button", { name: /สต็อก 0/ })).toHaveCount(2);
});

test("stock import previews each line, skips duplicates and sends long pastes in batches of 100", async ({ page }) => {
  const admin = service.session(adminToken);
  const product = makeProduct("Import Preview", ["Import 30 วัน"]);
  service.importCodes(admin, { variantId: product.variants[0], items: [{ loginId: "already@import.test", password: "Old-pw" }] });
  const lines = Array.from({ length: 148 }, (_, i) => `bulk-${i + 1}@import.test\tPw-${i + 1}`);
  lines.push("BULK-7@import.test\tanother-pw"); // repeat of line 7 (case differs)
  lines.push("already@import.test\tNew-pw"); // already in stock
  lines.push("no-password@import.test"); // invalid
  await as(page, adminToken);
  await page.goto(base + "/admin/products/" + product.id);
  const manager = page.locator(".variant-manager");
  await manager.getByRole("button", { name: /สต็อก 1/ }).click();
  await manager.getByLabel("เติมสต็อก Import 30 วัน").fill(lines.join("\n"));
  await expect(manager).toContainText("พร้อมเติม 151 บัญชี");
  await expect(manager).toContainText("แบ่งส่ง 2 ชุด");
  await manager.getByRole("button", { name: /ตรวจ 151 รายการ/ }).click();
  const summary = manager.getByLabel("สรุปผลตรวจ");
  await expect(summary).toContainText("พร้อมเพิ่ม 148");
  await expect(summary).toContainText("ซ้ำในรายการ 1");
  await expect(summary).toContainText("มีในระบบแล้ว 1");
  await expect(summary).toContainText("รูปแบบผิด 1");
  await manager.getByRole("button", { name: "มีปัญหา 3" }).click();
  const preview = manager.locator(".stock-import-table");
  await expect(preview).toContainText("ซ้ำกับบรรทัด 7");
  await expect(preview).toContainText("มีในสต็อกตัวเลือกนี้แล้ว");
  await expect(preview).toContainText("ไม่มีรหัสผ่าน");
  // Passwords are never sent back; only the masked marker.
  await expect(manager).not.toContainText("New-pw");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Turning the skip off blocks the whole batch while problems remain.
  await manager.getByLabel("ข้ามบัญชีซ้ำ").uncheck();
  await expect(manager.getByRole("button", { name: "เพิ่ม 148 บัญชี" })).toBeDisabled();
  await manager.getByLabel("ข้ามบัญชีซ้ำ").check();
  const audits = service.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='IMPORT_CODES' AND entity_id=?");
  const before = audits.get(product.variants[0]).n;
  await manager.getByRole("button", { name: "เพิ่ม 148 บัญชี" }).click();
  await expect(page.getByRole("status")).toContainText("นำเข้า 148 บัญชีสำเร็จ · ข้าม 3 รายการ");
  expect(
    service.db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE variant_id=?").get(product.variants[0]).n,
  ).toBe(149);
  expect(audits.get(product.variants[0]).n).toBe(before + 2);
  await expect(manager.getByRole("button", { name: /สต็อก 149/ })).toBeVisible();
});

test("warranty per option shows on the storefront and on the order for the customer and the admin", async ({ page }) => {
  const admin = service.session(adminToken);
  const product = makeProduct("Warranty Stream", ["Warranty 30 วัน"]);
  service.importCodes(admin, { variantId: product.variants[0], items: [{ loginId: "warranty@stream.test", password: "Pw-W" }] });
  await as(page, adminToken);
  await page.goto(base + "/admin/products/" + product.id);
  const manager = page.locator(".variant-manager");
  await expect(manager).toContainText("ไม่มีประกัน");
  await manager.getByRole("button", { name: "แก้" }).first().click();
  await manager.getByLabel("วันรับประกัน", { exact: true }).fill("30");
  await manager.getByRole("button", { name: "บันทึก" }).click();
  await expect(manager).toContainText("รับประกัน 30 วัน");

  await page.goto(base + "/products/" + product.id);
  await expect(page.locator(".reference-variants")).toContainText("รับประกัน 30 วัน");

  // Its own customer: the earlier ban test signs "Lists Buyer" out.
  const auth = service.register({
    name: "Warranty Buyer",
    email: "warranty-buyer@example.invalid",
    password: "Warranty-buyer-Password-123",
  });
  const customer = service.session(auth.token);
  const customerToken = auth.token;
  service.topup(customer, { amount: 300, requestKey: "lists-warranty-topup" });
  const order = service.createOrder(customer, { variantId: product.variants[0], quantity: 1, requestKey: "lists-warranty-01" });
  service.pay(customer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  // Changing the option afterwards does not move the sold order's warranty.
  service.updateVariant(admin, product.variants[0], { warranty_days: 0 });

  await as(page, customerToken);
  await page.goto(base + "/orders/" + order.id);
  await expect(page.locator(".warranty-status")).toContainText("รับประกันถึง");
  await as(page, adminToken);
  await page.goto(base + "/admin/orders/" + order.id);
  await expect(page.locator(".warranty-status")).toContainText("รับประกันถึง");

  service.db.prepare("UPDATE orders SET warranty_until=datetime('now','-1 day') WHERE id=?").run(order.id);
  await page.reload();
  await expect(page.locator(".warranty-status")).toContainText("หมดประกันแล้ว");
  await as(page, customerToken);
  await page.goto(base + "/orders/" + order.id);
  await expect(page.locator(".warranty-status")).toContainText("หมดประกันแล้ว");
});
