// Order extras through the real UI: first option label + usage instructions in the product
// editor, instructions only after delivery, "แจ้งปัญหาบัญชีนี้" into the shop chat and the
// admin inbox, and the printable receipt (customer + admin).
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, buyer, buyerToken, productId, deliveredId, pendingId;
const adminPassword = randomBytes(24).toString("hex");
const USAGE = "เปิดแอปแล้วกดเข้าสู่ระบบ\n- ใช้ ID และรหัสผ่านจากหน้าออเดอร์\n- <b>ห้ามเปลี่ยนรหัส</b>";
const LOGIN = "extras-e2e@stream.test";
const PASSWORD = "Pw-Extras-777";

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const auth = service.register({ name: "Extras Buyer", email: "extras-ui@example.invalid", password: "Extras-ui-Pass-123" });
  buyerToken = auth.token;
  buyer = service.session(buyerToken);
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(context, token) {
  await context.clearCookies();
  await context.addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("1. admin creates a product with a first option name, warranty and usage instructions", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/products/new");
  await page.getByLabel("ชื่อสินค้า").fill("Extras Stream");
  await page.getByLabel("รายละเอียด").fill("บัญชีสตรีมมิ่งทดสอบวิธีใช้งาน");
  const label = page.getByLabel("ชื่อตัวเลือกแรก");
  await expect(label).toHaveAttribute("placeholder", "1 เดือน");
  await expect(label).toHaveAttribute("required", "");
  await label.fill("1 เดือน");
  await page.getByLabel("ราคาตัวเลือกแรก (บาท)").fill("89");
  await page.getByLabel("วันรับประกัน").fill("30");
  await page.getByLabel("วิธีใช้งานหลังซื้อ", { exact: true }).fill(USAGE);
  // Live preview renders it as text: bullets, no HTML.
  const preview = page.getByLabel("ตัวอย่างวิธีใช้งานหลังซื้อ");
  await expect(preview.locator("li")).toHaveCount(2);
  await expect(preview).toContainText("<b>ห้ามเปลี่ยนรหัส</b>");
  await expect(preview.locator("b")).toHaveCount(0);
  await expect(page.locator(".product-preview")).toContainText("1 เดือน");
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/(?!new$)[^/]+$/);
  productId = page.url().split("/").pop();
  await expect(page.getByLabel("วิธีใช้งานหลังซื้อ", { exact: true })).toHaveValue(USAGE);

  const [variant] = service.adminProductVariants(service.session(adminToken), productId).variants;
  expect([variant.label, variant.price, variant.warranty_days]).toEqual(["1 เดือน", 8900, 30]);

  await page.getByLabel("เปิดขายสินค้า").check();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกสินค้าแล้ว")).toBeVisible();
  service.importCodes(service.session(adminToken), { variantId: variant.id, items: [{ loginId: LOGIN, password: PASSWORD }] });

  // The product page never shows the instructions.
  await page.goto(base + "/products/" + productId);
  await expect(page.getByRole("heading", { name: "Extras Stream" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("ห้ามเปลี่ยนรหัส");
});

test("2. a pending order shows no instructions and no report button", async ({ page }) => {
  const [variant] = service.productDetail(productId).variants;
  pendingId = service.createOrder(buyer, { variantId: variant.id, quantity: 1, requestKey: "extras-ui-pending-1" }).id;
  await as(page.context(), buyerToken);
  await page.goto(base + "/orders/" + pendingId);
  await expect(page.getByRole("heading", { name: "บันทึกคำสั่งซื้อแล้ว" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("ห้ามเปลี่ยนรหัส");
  await expect(page.getByRole("button", { name: "แจ้งปัญหาบัญชีนี้" })).toHaveCount(0);
});

test("3. after delivery the buyer sees the instructions and reports a problem through the chat", async ({ page, browser }) => {
  await as(page.context(), buyerToken);
  const [variant] = service.productDetail(productId).variants;
  const order = service.createOrder(buyer, { variantId: variant.id, quantity: 1, requestKey: "extras-ui-ready-01" });
  await page.goto(base + "/checkout/" + order.id);
  await page.getByRole("button", { name: /^ชำระเงิน/ }).click();
  await expect(page).toHaveURL(new RegExp("/orders/" + order.id + "$"));
  deliveredId = order.id;
  const number = order.id.slice(0, 8).toUpperCase();

  const guide = page.getByLabel("วิธีใช้งานหลังซื้อ");
  await expect(guide).toBeVisible();
  await expect(guide.locator("li")).toHaveCount(2);
  await expect(guide).toContainText("<b>ห้ามเปลี่ยนรหัส</b>");
  await expect(guide.locator("b")).toHaveCount(0);
  // Next to the delivered account.
  await expect(page.locator(".delivered-codes")).toContainText("วิธีใช้งานหลังซื้อ");

  await page.getByRole("button", { name: "แจ้งปัญหาบัญชีนี้" }).click();
  const panel = page.getByRole("dialog", { name: "แชทกับร้าน" });
  await expect(panel).toBeVisible();
  const box = panel.getByLabel("ข้อความ");
  await expect(box).toHaveValue(new RegExp("ออเดอร์: #" + number));
  await expect(box).toHaveValue(/สินค้า: Extras Stream · 1 เดือน/);
  await expect(box).toHaveValue(/ส่งของเมื่อ: \d/);
  await expect(box).toHaveValue(/ประกัน: อยู่ในประกันถึง /);
  await expect(box).toHaveValue(/อาการ: เข้าไม่ได้/);
  const reasons = panel.getByRole("radiogroup", { name: "อาการที่พบ" });
  for (const reason of ["เข้าไม่ได้", "รหัสผิด", "โดนเปลี่ยนรหัส", "อื่นๆ"])
    await expect(reasons.getByText(reason, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noHorizontalScroll(page)).toBe(true);
  await reasons.getByText("รหัสผิด", { exact: true }).click();
  await expect(box).toHaveValue(/อาการ: รหัสผิด/);
  await box.press("End");
  await box.pressSequentially("ลองแล้ว 3 ครั้ง");
  await panel.getByRole("button", { name: "ส่ง" }).click();
  await expect(panel.locator(".chat-bubble").last()).toContainText("อาการ: รหัสผิด");
  await expect(panel.locator(".chat-bubble").last()).toContainText("ลองแล้ว 3 ครั้ง");
  await expect(panel.locator(".chat-bubble").last().locator(".chat-order-tag")).toContainText(number);
  await expect(panel.getByRole("radiogroup", { name: "อาการที่พบ" })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const stored = service.db.prepare("SELECT order_id, report_reason, body FROM chat_messages WHERE order_id=?").all(order.id);
  expect(stored).toHaveLength(1);
  expect(stored[0].report_reason).toBe("wrong_password");
  expect(stored[0].body).not.toContain(PASSWORD);

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await as(adminContext, adminToken);
  const admin = await adminContext.newPage();
  await admin.goto(base + "/admin/chat");
  const thread = admin.locator(".admin-chat-thread", { hasText: "Extras Buyer" });
  await expect(thread).toContainText("แจ้งปัญหาออเดอร์ #" + number);
  await thread.click();
  const tag = admin.locator(".admin-chat-room .chat-order-tag");
  await expect(tag).toContainText("ออเดอร์ #" + number + " · รหัสผิด");
  await tag.click();
  await expect(admin).toHaveURL(base + "/admin/orders/" + order.id);
  await adminContext.close();
});

test("4. receipt: printable page for the buyer, linked from the order and history", async ({ page }) => {
  await as(page.context(), buyerToken);
  await page.goto(base + "/orders");
  await expect(page.locator(".history-card")).toHaveCount(2);
  // Only the paid order offers a receipt.
  await expect(page.locator(".history-item-actions .receipt-link")).toHaveCount(1);
  await page.goto(base + "/orders/" + deliveredId);
  await page.locator(".order-meta").getByRole("link", { name: "ใบเสร็จ" }).click();
  await expect(page).toHaveURL(base + "/orders/" + deliveredId + "/receipt");
  const paper = page.locator(".receipt-paper");
  await expect(page.getByRole("heading", { name: "ใบยืนยันการสั่งซื้อ / ใบเสร็จรับเงิน (อย่างย่อ)" })).toBeVisible();
  await expect(paper).toContainText("#" + deliveredId.slice(0, 8).toUpperCase());
  await expect(paper).toContainText("Extras Buyer");
  await expect(paper).toContainText("extras-ui@example.invalid");
  await expect(paper).toContainText("Extras Stream");
  await expect(paper).toContainText("1 เดือน");
  await expect(paper).toContainText("ชำระเงินแล้ว");
  await expect(paper).toContainText("ไม่ใช่ใบกำกับภาษีเต็มรูปแบบ");
  await expect(paper.locator(".receipt-grand")).toContainText("89.00");
  for (const secret of [LOGIN, PASSWORD, "ห้ามเปลี่ยนรหัส"]) await expect(page.locator("body")).not.toContainText(secret);
  // No site navigation, header, footer or chat on the receipt.
  await expect(page.locator(".storefront-shell, .merchant-shell, .chat-fab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ดาวน์โหลด PDF / พิมพ์" })).toBeEnabled();
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => {
      window.__printed += 1;
    };
  });
  await page.getByRole("button", { name: "ดาวน์โหลด PDF / พิมพ์" }).click();
  expect(await page.evaluate(() => window.__printed)).toBe(1);

  // Print layout: toolbar hidden, paper only.
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".receipt-toolbar")).toBeHidden();
  await expect(paper).toBeVisible();
  const pdf = await page.pdf({ format: "A4" });
  expect(pdf.length).toBeGreaterThan(1000);
  await page.emulateMedia({ media: "screen" });

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    const bg = await paper.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgb(255, 255, 255)");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Someone else's receipt is not found.
  const other = service.register({ name: "Other", email: "other-ui@example.invalid", password: "Other-ui-Pass-123" });
  await as(page.context(), other.token);
  await page.goto(base + "/orders/" + deliveredId + "/receipt");
  await expect(page.locator(".receipt-paper")).toContainText("ไม่พบคำสั่งซื้อ");
});

test("5. admin opens the receipt from the order detail", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/orders/" + deliveredId);
  await page.getByRole("link", { name: "ใบเสร็จ" }).click();
  await expect(page).toHaveURL(base + "/admin/orders/" + deliveredId + "/receipt");
  await expect(page.locator(".receipt-paper")).toContainText("Extras Buyer");
  await expect(page.locator(".receipt-paper")).toContainText("ชำระเงินแล้ว");
  await expect(page.locator("body")).not.toContainText(PASSWORD);
  await page.getByRole("link", { name: "กลับไปที่ออเดอร์" }).click();
  await expect(page).toHaveURL(base + "/admin/orders/" + deliveredId);
});
