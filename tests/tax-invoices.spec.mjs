// Receipts in the shop's company name + full tax invoices through the real UI:
// admin sets the company + VAT → customer requests on the order page → admin issues from the
// back office → customer opens the printable ใบเสร็จรับเงิน/ใบกำกับภาษี with number and VAT line.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, adminToken, buyerToken, orderId, invoiceNumber;
const adminPassword = randomBytes(24).toString("hex");
const LEGAL = "บริษัท เอเชีย เอ็กซ์ตร้า จำกัด";
const SHOP_TAX_ID = "0105556123453";
const BUYER_NAME = "บริษัท ผู้ซื้อทดสอบ จำกัด";
const BUYER_TAX_ID = "0105561000003";

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  const admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const product = service.saveProduct(admin, {
    name: "Invoice Stream",
    description: "บัญชีทดสอบใบกำกับภาษี",
    category: "streaming",
    price: 10700,
    active: true,
    firstLabel: "1 เดือน",
  });
  const variantId = service.adminProductVariants(admin, product.id).variants[0].id;
  service.importCodes(admin, { variantId, items: [{ loginId: "inv-e2e@stream.test", password: "Pw-Invoice-1" }] });
  const auth = service.register({ name: "Invoice Buyer", email: "invoice-ui@example.invalid", password: "Invoice-ui-Pass-123" });
  buyerToken = auth.token;
  const buyer = service.session(buyerToken);
  const order = service.createOrder(buyer, { variantId, quantity: 1, requestKey: "invoice-ui-order-1" });
  service.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  orderId = order.id;
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

test("1. admin sets the company details and VAT registration", async ({ page }) => {
  await as(page.context(), adminToken);
  // Before: a delivered order offers only the buyer on a ใบเสร็จรับเงิน.
  await page.goto(base + "/admin/settings/receipts");
  await expect(page.getByRole("heading", { name: "ใบเสร็จและใบกำกับภาษี" })).toBeVisible();
  await expect(page.locator(".reference-subnav .active")).toHaveText("ใบเสร็จและใบกำกับภาษี");
  await expect(page.locator(".tax-status-card")).toContainText("ออกเฉพาะใบเสร็จรับเงิน");
  await page.getByLabel("ชื่อนิติบุคคล / ชื่อผู้ประกอบการ").fill(LEGAL);
  const taxId = page.getByLabel("เลขประจำตัวผู้เสียภาษี (13 หลัก)");
  await taxId.fill("0105556123454");
  await expect(page.getByText("เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง")).toBeVisible();
  await taxId.fill(SHOP_TAX_ID);
  await expect(page.getByText("เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "สำนักงานใหญ่" })).toBeChecked();
  await page.getByLabel("ที่อยู่ตามที่จดทะเบียน").fill("99/1 ถนนสุขุมวิท แขวงคลองเตย\nเขตคลองเตย กรุงเทพฯ 10110");
  await page.getByLabel("เบอร์โทรบนเอกสาร").fill("02-123-4567");
  await page.getByRole("switch", { name: "จดทะเบียนภาษีมูลค่าเพิ่ม" }).click();
  await page.getByLabel("ข้อความท้ายเอกสาร (ไม่บังคับ)").fill("ขอบคุณที่ใช้บริการ ASIA EXTRA");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกการตั้งค่าใบเสร็จแล้ว")).toBeVisible();
  await expect(page.locator(".tax-status-card")).toContainText("ลูกค้าขอใบกำกับภาษีเต็มรูปได้");
  await expect(page.locator(".tax-status-card")).toContainText(/TEST-INV\d{4}-000001/);
  // White cards on the cool-grey admin background.
  const card = page.locator(".tax-settings-card").first();
  expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(service.db.prepare("SELECT 1 AS n FROM audit WHERE action='RECEIPT_SETTINGS'").get()).toBeTruthy();
});

test("2. the customer requests a tax invoice on their delivered order", async ({ page }) => {
  await as(page.context(), buyerToken);
  await page.goto(base + "/orders/" + orderId);
  const card = page.getByRole("region", { name: "ใบกำกับภาษีเต็มรูป" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "ขอใบกำกับภาษี" }).click();
  await expect(card.getByRole("radio", { name: "นิติบุคคล / บริษัท" })).toBeChecked();
  await card.getByLabel("ชื่อบริษัท / นิติบุคคล").fill(BUYER_NAME);
  const taxId = card.getByLabel("เลขประจำตัวผู้เสียภาษี (13 หลัก)");
  await taxId.fill("0105561000004");
  await expect(card.getByText("เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง")).toBeVisible();
  await taxId.fill("0-1055-61000-00-3");
  await card.getByRole("radio", { name: "สาขาที่" }).check();
  await card.getByLabel("เลขสาขา 5 หลัก").fill("2");
  await card.getByLabel("ที่อยู่").fill("1 ถนนพระราม 4 แขวงสีลม เขตบางรัก กรุงเทพฯ 10500");
  // Phone width, both themes: no horizontal scroll while the form is open.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    expect(await noHorizontalScroll(page)).toBe(true);
  }
  const darkBg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(darkBg).not.toBe("rgb(255, 255, 255)");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await card.getByRole("button", { name: "ส่งคำขอใบกำกับภาษี" }).click();
  await expect(card).toContainText("ส่งคำขอแล้ว รอร้านออกใบกำกับภาษี");
  await expect(card.locator(".tax-pill")).toHaveText("รอออก");
  await expect(card).toContainText(BUYER_NAME);
  await expect(card).toContainText(BUYER_TAX_ID);
  await expect(card).toContainText("สาขาที่ 00002");
  const row = service.db.prepare("SELECT status,buyer_tax_id,buyer_branch FROM tax_invoice_requests WHERE order_id=?").get(orderId);
  expect(row).toEqual({ status: "PENDING", buyer_tax_id: BUYER_TAX_ID, buyer_branch: "00002" });
});

test("3. the admin reviews the request and issues the tax invoice", async ({ page }) => {
  await as(page.context(), adminToken);
  await page.goto(base + "/admin/tax-invoices");
  await expect(page.getByRole("heading", { name: "ใบกำกับภาษี", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /รอออก/ })).toContainText("1");
  const short = orderId.slice(0, 8).toUpperCase();
  await expect(page.locator(".reference-table")).toContainText(BUYER_NAME);
  await page.getByRole("link", { name: short }).click();
  await expect(page).toHaveURL(base + "/admin/orders/" + orderId);
  const card = page.getByRole("region", { name: "ใบกำกับภาษี" });
  await expect(card).toContainText("ลูกค้าขอใบกำกับภาษี · รอออก");
  await expect(card).toContainText(BUYER_NAME);
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "ออกใบกำกับภาษี", exact: true }).click();
  await expect(page.getByText("ออกใบกำกับภาษีแล้ว ลูกค้าได้แจ้งเตือน")).toBeVisible();
  await expect(card.locator(".alert-badge").first()).toHaveText("ออกใบกำกับภาษีแล้ว");
  const invoice = service.db.prepare("SELECT number,vat,net,total FROM tax_invoices WHERE order_id=?").get(orderId);
  expect(invoice.number).toMatch(/^TEST-INV\d{4}-000001$/);
  expect([invoice.vat, invoice.net, invoice.total]).toEqual([700, 10000, 10700]);
  invoiceNumber = invoice.number;
  await expect(card).toContainText(invoiceNumber);
  // Issued list.
  await page.goto(base + "/admin/tax-invoices");
  await page.getByRole("tab", { name: "ออกแล้ว" }).click();
  await expect(page.locator(".reference-table")).toContainText(invoiceNumber);
  expect(service.db.prepare("SELECT 1 AS n FROM audit WHERE action='TAX_INVOICE_ISSUE' AND entity_id=?").get(orderId)).toBeTruthy();
});

test("4. the customer opens the printable ใบกำกับภาษี with its number and VAT line", async ({ page }) => {
  await as(page.context(), buyerToken);
  await page.goto(base + "/orders/" + orderId);
  const card = page.getByRole("region", { name: "ใบกำกับภาษีเต็มรูป" });
  await expect(card).toContainText(invoiceNumber);
  await card.getByRole("link", { name: "ดู / พิมพ์ใบกำกับภาษี" }).click();
  await expect(page).toHaveURL(base + "/orders/" + orderId + "/tax-invoice");
  const paper = page.locator(".receipt-paper");
  await expect(page.getByRole("heading", { name: "ใบเสร็จรับเงิน/ใบกำกับภาษี" })).toBeVisible();
  await expect(paper).toContainText(invoiceNumber);
  await expect(paper).toContainText(LEGAL);
  await expect(paper).toContainText(SHOP_TAX_ID);
  await expect(paper).toContainText("สำนักงานใหญ่");
  await expect(paper).toContainText(BUYER_NAME);
  await expect(paper).toContainText(BUYER_TAX_ID);
  await expect(paper).toContainText("สาขาที่ 00002");
  await expect(paper).toContainText("Invoice Stream");
  await expect(paper.locator(".tax-vat-row")).toContainText("ภาษีมูลค่าเพิ่ม 7%");
  await expect(paper.locator(".tax-vat-row")).toContainText("7.00");
  await expect(paper).toContainText("มูลค่าก่อนภาษีมูลค่าเพิ่ม");
  await expect(paper).toContainText("100.00");
  await expect(paper.locator(".receipt-grand")).toContainText("107.00");
  await expect(paper).toContainText("เอกสารทดสอบ");
  await expect(paper).toContainText("ขอบคุณที่ใช้บริการ ASIA EXTRA");
  await expect(page.locator("body")).not.toContainText("Pw-Invoice-1");
  await expect(page.locator(".storefront-shell, .merchant-shell, .chat-fab")).toHaveCount(0);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    expect(await paper.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    expect(await paper.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(17, 19, 24)");
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Print: toolbar hidden, A4 PDF renders.
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".receipt-toolbar")).toBeHidden();
  await expect(paper).toBeVisible();
  expect((await page.pdf({ format: "A4" })).length).toBeGreaterThan(1000);
  await page.emulateMedia({ media: "screen" });

  // The short receipt now points at the issued invoice (after order-receipt approval).
  const buyer = service.session(buyerToken);
  const admin = service.session(adminToken);
  service.requestOrderReceipt(buyer, orderId, {
    type: "COMPANY",
    name: BUYER_NAME,
    taxId: BUYER_TAX_ID,
    branch: "2",
    address: "1 ถนนพระราม 4 แขวงสีลม เขตบางรัก กรุงเทพฯ 10500",
  });
  service.adminApproveOrderReceipt(admin, orderId);
  await page.goto(base + "/orders/" + orderId + "/receipt");
  await expect(page.locator(".receipt-foot")).toContainText(invoiceNumber);
  await expect(page.locator(".receipt-shop")).toContainText(LEGAL);

  // Nobody else can open it.
  const other = service.register({ name: "Other", email: "other-invoice@example.invalid", password: "Other-ui-Pass-123" });
  await as(page.context(), other.token);
  await page.goto(base + "/orders/" + orderId + "/tax-invoice");
  await expect(page.locator(".receipt-paper")).toContainText("ไม่พบคำสั่งซื้อ");
});
