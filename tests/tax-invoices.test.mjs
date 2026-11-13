// Receipts in the shop's company name + full tax invoices (server/tax-invoices.mjs):
// tax ID checksum, VAT split, modes (not VAT-registered → receipt only), own delivered order
// only, sequential numbering, reject / void, immutable issued records, PDPA, HTTP routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createCommerceCore } from "../server/domain.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { ensureTaxInvoices, TAX_INVOICE_APPEND_ONLY_TRIGGERS } from "../server/ensure-admin-fr.mjs";
import {
  isValidThaiTaxId,
  normalizeBuyer,
  vatSplit,
  RECEIPT_SETTINGS_KEY,
} from "../server/tax-invoices.mjs";

const SHOP_TAX_ID = "0105556123453";
const BUYER_TAX_ID = "0105561000003";
const PERSON_TAX_ID = "1234567890121";
const COMPANY = {
  legalName: "บริษัท เอเชีย เอ็กซ์ตร้า จำกัด",
  taxId: SHOP_TAX_ID,
  branch: "HEAD",
  address: "99/1 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110",
  phone: "02-123-4567",
  email: "billing@example.invalid",
  footerNote: "ขอบคุณที่ใช้บริการ",
  vatRegistered: true,
};
const BUYER = {
  type: "COMPANY",
  name: "บริษัท ผู้ซื้อ จำกัด",
  taxId: "0-1055-61000-00-3",
  branch: "2",
  address: "1 ถนนพระราม 4 แขวงสีลม เขตบางรัก กรุงเทพฯ 10500",
};

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const status = (code) => (e) => e.status === code;
const BOSS_PW = "Boss-Invoice-Pass-123";

function fixture(t, { vat = true } = {}) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const auth = s.register({ name: "Invoice Buyer", email: "inv-buyer@example.invalid", password: "Invoice-buyer-Pass-123" });
  const user = s.session(auth.token);
  const otherAuth = s.register({ name: "Other Buyer", email: "inv-other@example.invalid", password: "Other-buyer-Pass-123" });
  const other = s.session(otherAuth.token);
  const adminAuth = s.demoMerchant();
  const salt = randomBytes(16).toString("hex");
  s.db
    .prepare("UPDATE users SET password_hash=? WHERE id=?")
    .run(salt + ":" + scryptSync(BOSS_PW, salt, 64).toString("hex"), s.session(adminAuth.token).id);
  const admin = s.session(adminAuth.token);
  const staffAuth = s.register({ name: "Invoice Staff", email: "inv-staff@example.invalid", password: "Staff-only-Password-123" });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const product = s.saveProduct(admin, {
    name: "Invoice Stream",
    description: "บัญชีทดสอบใบกำกับภาษี",
    category: "streaming",
    price: 10700,
    active: true,
    firstLabel: "1 เดือน",
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  s.importCodes(admin, {
    variantId,
    items: Array.from({ length: 12 }, (_, i) => ({ loginId: "inv-acc-" + i, password: "pw-" + i })),
  });
  if (vat) s.adminSaveReceiptSettings(admin, COMPANY);
  // Enough test credit for a dozen orders.
  for (let i = 0; i < 2; i++) s.topup(user, { amount: 1000, requestKey: "inv-topup-000" + i });
  let n = 0;
  const buy = (who = user, pay = true) => {
    const order = s.createOrder(who, { variantId, quantity: 1, requestKey: "inv-order-" + ++n });
    return pay ? s.pay(who, order.id, { paymentToken: order.paymentToken, outcome: "success" }) : order;
  };
  return { s, user, other, admin, staff, variantId, buy, token: auth.token, adminToken: adminAuth.token, staffToken: staffAuth.token, otherToken: otherAuth.token };
}

const call = async (s, method, path, token, body) => {
  const handle = createAPIHandler(s);
  const response = await handle(
    new Request("http://127.0.0.1" + path, {
      method,
      headers: {
        ...(token ? { Cookie: "astra_session=" + token } : {}),
        "Content-Type": "application/json",
        "X-Astra-Request": "1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, data: await response.json() };
};

test("Thai tax ID checksum and buyer validation", () => {
  for (const id of [SHOP_TAX_ID, BUYER_TAX_ID, PERSON_TAX_ID, "0-1055-61000-00-3", "3 1010 01234 56 5"])
    assert.equal(isValidThaiTaxId(id), true, id);
  for (const id of ["0105556123454", "3101001234567", "123456789012", "12345678901234", "abcdefghijklm", "", null])
    assert.equal(isValidThaiTaxId(id), false, String(id));

  const company = normalizeBuyer(BUYER, fail);
  assert.deepEqual(company, { ...BUYER, taxId: BUYER_TAX_ID, branch: "00002" });
  assert.equal(normalizeBuyer({ ...BUYER, branch: "HEAD" }, fail).branch, "00000");
  const person = normalizeBuyer({ type: "PERSON", name: "สมชาย ใจดี", taxId: PERSON_TAX_ID, branch: "5", address: "10 หมู่ 2 ต.บางพลี อ.บางพลี สมุทรปราการ" }, fail);
  assert.equal(person.branch, null, "individuals have no branch");
  assert.throws(() => normalizeBuyer({ ...BUYER, taxId: "0105561000004" }, fail), status(400));
  assert.throws(() => normalizeBuyer({ ...BUYER, taxId: "" }, fail), status(400));
  assert.throws(() => normalizeBuyer({ ...BUYER, type: "ALIEN" }, fail), status(400));
  assert.throws(() => normalizeBuyer({ ...BUYER, branch: "123456" }, fail), status(400));
  assert.throws(() => normalizeBuyer({ ...BUYER, address: "สั้น" }, fail), status(400));
  assert.throws(() => normalizeBuyer({ ...BUYER, name: "" }, fail), status(400));
});

test("VAT split: vat = round(total*7/107) satang, net + vat = total", () => {
  assert.deepEqual(vatSplit(10700), { vat: 700, net: 10000 });
  assert.deepEqual(vatSplit(9900), { vat: 648, net: 9252 });
  assert.deepEqual(vatSplit(0), { vat: 0, net: 0 });
  assert.deepEqual(vatSplit(1), { vat: 0, net: 1 });
  assert.deepEqual(vatSplit(8), { vat: 1, net: 7 });
  for (let total = 0; total < 50000; total += 37) {
    const { vat, net } = vatSplit(total);
    assert.equal(vat + net, total);
    assert.equal(vat, Math.round((total * 7) / 107));
    assert.ok(Number.isSafeInteger(vat) && Number.isSafeInteger(net));
  }
  assert.throws(() => vatSplit(-1));
  assert.throws(() => vatSplit(1.5));
});

test("settings: admin only, VAT needs legal name + valid tax ID + address, audited", async (t) => {
  const { s, admin, staff, user, adminToken, token } = fixture(t, { vat: false });
  assert.throws(() => s.adminReceiptSettings(staff), status(403));
  assert.throws(() => s.adminSaveReceiptSettings(user, COMPANY), (e) => e.status === 401 || e.status === 403);
  assert.throws(() => s.adminSaveReceiptSettings(admin, { ...COMPANY, address: "" }), status(400));
  assert.throws(() => s.adminSaveReceiptSettings(admin, { ...COMPANY, taxId: "0105556123454" }), status(400));
  assert.throws(() => s.adminSaveReceiptSettings(admin, { ...COMPANY, branch: "000001" }), status(400));
  assert.throws(() => s.adminSaveReceiptSettings(admin, { ...COMPANY, invoicePrefix: "ใบ" }), status(400));
  const fresh = s.adminReceiptSettings(admin);
  assert.equal(fresh.mode, "RECEIPT");
  assert.equal(fresh.saved, false);
  const saved = s.adminSaveReceiptSettings(admin, { ...COMPANY, branch: "3", invoicePrefix: "ax", showLogo: true });
  assert.equal(saved.mode, "TAX_INVOICE");
  assert.equal(saved.settings.branch, "00003");
  assert.equal(saved.settings.invoicePrefix, "AX");
  assert.match(saved.nextNumber, /^TEST-AX\d{4}-000001$/);
  assert.ok(s.db.prepare("SELECT 1 FROM audit WHERE action='RECEIPT_SETTINGS'").get());
  // Over HTTP: admin yes, customer no.
  assert.equal((await call(s, "GET", "/api/admin/receipt-settings", adminToken)).status, 200);
  assert.equal((await call(s, "GET", "/api/admin/receipt-settings", token)).status, 403);
  assert.equal((await call(s, "POST", "/api/admin/receipt-settings", token, COMPANY)).status, 403);
  // Feature flag.
  assert.equal((await call(s, "GET", "/api/health")).data.features.taxInvoices, true);
});

test("not VAT-registered: buyer details go on a ใบเสร็จรับเงิน, never a tax invoice", (t) => {
  const { s, user, admin, buy } = fixture(t, { vat: false });
  s.adminSaveReceiptSettings(admin, { ...COMPANY, vatRegistered: false });
  const order = buy();
  const state = s.myTaxInvoice(user, order.id);
  assert.equal(state.mode, "RECEIPT");
  assert.equal(state.eligible, true);
  const saved = s.requestTaxInvoice(user, order.id, BUYER);
  assert.equal(saved.request.status, "SAVED");
  assert.equal(saved.request.buyer.name, BUYER.name);
  assert.throws(() => s.adminIssueTaxInvoice(admin, order.id), status(409));
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tax_invoices").get().n, 0);
  assert.equal(s.adminTaxInvoices(admin, { status: "PENDING" }).requests.length, 0, "no admin review in receipt mode");
  const receipt = s.orderReceipt(user, order.id);
  assert.equal(receipt.buyer.name, BUYER.name);
  assert.equal(receipt.buyer.taxId, BUYER_TAX_ID);
  assert.equal(receipt.taxInvoice, null);
  assert.equal(receipt.taxInvoiceMode, "RECEIPT");
  assert.equal(receipt.shop.legalName, COMPANY.legalName, "receipt carries the company name");
  assert.equal(receipt.shop.taxId, SHOP_TAX_ID);
  assert.equal(receipt.shop.branchLabel, "สำนักงานใหญ่");
  assert.equal(receipt.shop.vatRegistered, false);

  // VAT-registered but company details incomplete (e.g. written by an older version): OFF.
  s.db
    .prepare("UPDATE runtime_flags SET value=? WHERE key=?")
    .run(JSON.stringify({ vatRegistered: true, legalName: "X" }), RECEIPT_SETTINGS_KEY);
  const off = s.myTaxInvoice(user, order.id);
  assert.equal(off.mode, "OFF");
  assert.equal(off.eligible, false);
  assert.throws(() => s.requestTaxInvoice(user, order.id, BUYER), status(409));
  assert.throws(() => s.adminIssueTaxInvoice(admin, order.id), status(409));
});

test("only the owner's own delivered, not refunded order can request", async (t) => {
  const { s, user, other, admin, staff, buy, token, otherToken, staffToken } = fixture(t);
  const pending = buy(user, false);
  assert.throws(() => s.requestTaxInvoice(user, pending.id, BUYER), status(409));
  assert.equal(s.myTaxInvoice(user, pending.id).eligible, false);
  const order = buy();
  assert.throws(() => s.requestTaxInvoice(other, order.id, BUYER), status(404));
  assert.throws(() => s.myTaxInvoice(other, order.id), status(404));
  assert.equal((await call(s, "GET", "/api/orders/" + order.id + "/tax-invoice", otherToken)).status, 404);
  assert.equal((await call(s, "GET", "/api/orders/" + order.id + "/tax-invoice")).status, 401);
  assert.equal((await call(s, "GET", "/api/admin/orders/" + order.id + "/tax-invoice", token)).status, 403);
  assert.equal((await call(s, "GET", "/api/admin/orders/" + order.id + "/tax-invoice", staffToken)).status, 200);
  // Staff can look, only ADMIN issues / rejects.
  const requested = await call(s, "POST", "/api/orders/" + order.id + "/tax-invoice", token, BUYER);
  assert.equal(requested.status, 200);
  assert.equal(requested.data.request.status, "PENDING");
  assert.throws(() => s.adminIssueTaxInvoice(staff, order.id), status(403));
  assert.equal((await call(s, "POST", "/api/admin/orders/" + order.id + "/tax-invoice/issue", staffToken, {})).status, 403);
  assert.throws(() => s.adminRejectTaxInvoice(staff, order.id, { reason: "ไม่ผ่าน" }), status(403));
  // Admins are notified once per new request (an edit while pending does not re-notify).
  const bell = () => s.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='tax_invoice' AND user_id=?").get(admin.id).n;
  assert.equal(bell(), 1);
  s.requestTaxInvoice(user, order.id, { ...BUYER, name: "บริษัท ผู้ซื้อ (ไทย) จำกัด" });
  assert.equal(bell(), 1);
  assert.equal(s.adminTaxInvoices(admin, { status: "PENDING" }).requests[0].buyer.name, "บริษัท ผู้ซื้อ (ไทย) จำกัด");
  // Refunded orders cannot request.
  const refunded = buy();
  s.refundOrder(admin, refunded.id, { amount: 10700, reasonCode: "ACCOUNT_BROKEN", destination: "CREDIT", requestKey: "inv-refund-0001" });
  assert.throws(() => s.requestTaxInvoice(user, refunded.id, BUYER), status(409));
  assert.equal(s.myTaxInvoice(user, refunded.id).eligible, false);
  assert.throws(() => s.adminIssueTaxInvoice(admin, refunded.id, { buyer: BUYER }), status(409));
});

test("issue: snapshot with VAT split, sequential numbers, one active per order, reject + void", async (t) => {
  const { s, user, admin, buy, token, adminToken } = fixture(t);
  const year = new Date(Date.now() + 7 * 3600000).getUTCFullYear();
  // Discount: VAT is on the paid total.
  const order = buy();
  s.db.prepare("UPDATE orders SET discount=1000, total=9700 WHERE id=?").run(order.id);
  s.requestTaxInvoice(user, order.id, BUYER);
  const issued = await call(s, "POST", "/api/admin/orders/" + order.id + "/tax-invoice/issue", adminToken, {});
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  assert.equal(issued.data.invoice.number, `TEST-INV${year}-000001`);
  const doc = (await call(s, "GET", "/api/orders/" + order.id + "/tax-invoice/document", token)).data.invoice;
  assert.equal(doc.title, "ใบเสร็จรับเงิน/ใบกำกับภาษี");
  assert.equal(doc.testMode, true);
  assert.deepEqual([doc.subtotal, doc.discount, doc.total, doc.vat, doc.net, doc.vatRate], [10700, 1000, 9700, 635, 9065, 7]);
  assert.deepEqual(doc.items, [{ description: "Invoice Stream", option: "1 เดือน", quantity: 1, unitPrice: 10700, amount: 10700 }]);
  assert.equal(doc.seller.legalName, COMPANY.legalName);
  assert.equal(doc.seller.taxId, SHOP_TAX_ID);
  assert.equal(doc.seller.branchLabel, "สำนักงานใหญ่");
  assert.equal(doc.buyer.taxId, BUYER_TAX_ID);
  assert.equal(doc.buyer.branchLabel, "สาขาที่ 00002");
  assert.ok(doc.issuedAt && doc.paidAt);
  assert.equal(s.myTaxInvoice(user, order.id).request.status, "ISSUED");
  assert.equal(s.orderReceipt(user, order.id).taxInvoice.number, doc.number);
  // Customer notified, audited.
  assert.ok(s.db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND title='ออกใบกำกับภาษีแล้ว' AND link=?").get(user.id, "/orders/" + order.id));
  assert.ok(s.db.prepare("SELECT 1 FROM audit WHERE action='TAX_INVOICE_ISSUE' AND entity_id=?").get(order.id));

  // Second issue on the same order: refused, no number consumed; customer cannot re-request.
  assert.throws(() => s.adminIssueTaxInvoice(admin, order.id), status(409));
  assert.throws(() => s.requestTaxInvoice(user, order.id, BUYER), status(409));
  assert.throws(() => s.adminSaveTaxInvoiceBuyer(admin, order.id, BUYER), status(409));

  // Repeated issues across orders: 2..6 in order, no gaps, all unique. Admin issues directly
  // from the order page (buyer saved in the same call, no customer request needed).
  const numbers = [doc.number];
  for (let i = 0; i < 5; i++) {
    const o = buy();
    assert.throws(() => s.adminIssueTaxInvoice(admin, o.id), status(400), "buyer details required");
    numbers.push(s.adminIssueTaxInvoice(admin, o.id, { buyer: { ...BUYER, type: "PERSON", name: "ลูกค้า " + i, taxId: PERSON_TAX_ID } }).invoice.number);
  }
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6].map((n) => `TEST-INV${year}-` + String(n).padStart(6, "0")));
  const seqs = s.db.prepare("SELECT seq FROM tax_invoices ORDER BY seq").all().map((r) => r.seq);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6]);

  // Reject a pending request with a reason; the customer can fix and resend.
  const rejected = buy();
  s.requestTaxInvoice(user, rejected.id, BUYER);
  assert.throws(() => s.adminRejectTaxInvoice(admin, rejected.id, { reason: "" }), status(400));
  const r = s.adminRejectTaxInvoice(admin, rejected.id, { reason: "ที่อยู่ไม่ครบ" });
  assert.equal(r.request.status, "REJECTED");
  assert.equal(s.myTaxInvoice(user, rejected.id).request.reason, "ที่อยู่ไม่ครบ");
  assert.throws(() => s.adminRejectTaxInvoice(admin, rejected.id, { reason: "ซ้ำ" }), status(409));
  assert.ok(s.db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND title='คำขอใบกำกับภาษีไม่ผ่าน'").get(user.id));
  assert.equal(s.requestTaxInvoice(user, rejected.id, BUYER).request.status, "PENDING");
  assert.equal(s.myTaxInvoice(user, rejected.id).request.reason, null);

  // Void: a new row, the invoice itself is unchanged; a new invoice gets the next number.
  const before = s.db.prepare("SELECT * FROM tax_invoices WHERE number=?").get(doc.number);
  const voided = s.adminVoidTaxInvoice(admin, doc.id, { reason: "ชื่อผู้ซื้อผิด" });
  assert.equal(voided.request.status, "VOIDED");
  assert.deepEqual(s.db.prepare("SELECT * FROM tax_invoices WHERE number=?").get(doc.number), before);
  assert.throws(() => s.adminVoidTaxInvoice(admin, doc.id, { reason: "ซ้ำ" }), status(409));
  const old = s.taxInvoiceDocument(user, order.id, doc.id);
  assert.equal(old.voided.reason, "ชื่อผู้ซื้อผิด");
  assert.equal(s.myTaxInvoice(user, order.id).eligible, true, "can request again after a void");
  s.requestTaxInvoice(user, order.id, { ...BUYER, name: "บริษัท ผู้ซื้อที่ถูกต้อง จำกัด" });
  const again = s.adminIssueTaxInvoice(admin, order.id).invoice.number;
  assert.equal(again, `TEST-INV${year}-000007`);
  assert.equal(s.taxInvoiceDocument(user, order.id).number, again, "default document is the active one");
  assert.equal(s.myTaxInvoice(user, order.id).invoices.length, 2);
  const list = s.adminTaxInvoices(admin, { status: "ISSUED" }).invoices;
  assert.equal(list.length, 7);
  assert.equal(list.find((i) => i.number === doc.number).voided.reason, "ชื่อผู้ซื้อผิด");
  for (const action of ["TAX_INVOICE_REQUEST", "TAX_INVOICE_REJECT", "TAX_INVOICE_VOID", "TAX_INVOICE_ISSUE"])
    assert.ok(s.db.prepare("SELECT 1 FROM audit WHERE action=?").get(action), action);
});

test("issued records are immutable; settings changes never alter them; health counts the triggers", (t) => {
  const { s, user, admin, buy } = fixture(t);
  ensureTaxInvoices(s.db);
  ensureTaxInvoices(s.db);
  const order = buy();
  s.requestTaxInvoice(user, order.id, BUYER);
  const { invoice } = s.adminIssueTaxInvoice(admin, order.id);
  s.adminVoidTaxInvoice(admin, invoice.id, { reason: "ทดสอบยกเลิก" });
  for (const table of ["tax_invoices", "tax_invoice_voids"]) {
    assert.throws(() => s.db.prepare(`UPDATE ${table} SET id=id`).run(), /append-only/, table + " update");
    assert.throws(() => s.db.prepare(`DELETE FROM ${table}`).run(), /append-only/, table + " delete");
  }
  // Numbers are UNIQUE at the database level too.
  const row = s.db.prepare("SELECT * FROM tax_invoices").get();
  assert.throws(() =>
    s.db
      .prepare("INSERT INTO tax_invoices(id,number,scope,year,seq,order_id,user_id,seller,buyer_type,buyer_name,buyer_tax_id,buyer_address,items,subtotal,total,vat_rate,vat,net,issued_at) VALUES('x',?,?,?,?,?,?,'{}','PERSON','a','b','c','[]',0,0,700,0,0,'t')")
      .run(row.number, row.scope, row.year, row.seq + 1, row.order_id, row.user_id),
  );
  assert.throws(() =>
    s.db
      .prepare("INSERT INTO tax_invoices(id,number,scope,year,seq,order_id,user_id,seller,buyer_type,buyer_name,buyer_tax_id,buyer_address,items,subtotal,total,vat_rate,vat,net,issued_at) VALUES('y','other',?,?,?,?,?,'{}','PERSON','a','b','c','[]',0,0,700,0,0,'t')")
      .run(row.scope, row.year, row.seq, row.order_id, row.user_id),
  );
  // A later settings change does not rewrite the issued document.
  s.adminSaveReceiptSettings(admin, { ...COMPANY, legalName: "บริษัท ชื่อใหม่ จำกัด", address: "ที่อยู่ใหม่ เลขที่ 2 กรุงเทพฯ 10200" });
  const doc = s.taxInvoiceDocument(user, order.id, invoice.id);
  assert.equal(doc.seller.legalName, COMPANY.legalName);
  assert.equal(doc.seller.address, COMPANY.address);
  const check = s.adminSystemHealth(admin).checks.find((c) => c.id === "append_only");
  assert.equal(check.ok, true);
  assert.match(check.detail, /ครบ 18/);
  assert.equal(TAX_INVOICE_APPEND_ONLY_TRIGGERS.length, 4);
  s.db.exec("DROP TRIGGER tax_invoices_append_only_delete");
  assert.match(s.adminSystemHealth(admin).checks.find((c) => c.id === "append_only").detail, /tax_invoices_append_only_delete/);
  ensureTaxInvoices(s.db);
  assert.equal(s.adminSystemHealth(admin).checks.find((c) => c.id === "append_only").ok, true);
});

test("PDPA: buyer details exported; deletion clears requests but keeps issued invoices", (t) => {
  const { s, user, admin, buy } = fixture(t);
  const issuedOrder = buy();
  s.requestTaxInvoice(user, issuedOrder.id, BUYER);
  const { invoice } = s.adminIssueTaxInvoice(admin, issuedOrder.id);
  const pendingOrder = buy();
  s.requestTaxInvoice(user, pendingOrder.id, { ...BUYER, name: "บริษัท รออนุมัติ จำกัด" });
  const exported = s.exportMyData(user);
  assert.equal(exported.taxInvoiceRequests.length, 2);
  assert.equal(exported.taxInvoices[0].number, invoice.number);
  assert.equal(exported.taxInvoices[0].buyer_tax_id, BUYER_TAX_ID);

  const request = s.requestAccountDeletion(user, {});
  s.approvePrivacyDeletion(admin, request.id, { currentPassword: BOSS_PW });
  const rows = s.db.prepare("SELECT * FROM tax_invoice_requests WHERE user_id=?").all(user.id);
  assert.ok(rows.every((r) => r.buyer_name === null && r.buyer_tax_id === null && r.buyer_address === null));
  assert.equal(rows.find((r) => r.order_id === pendingOrder.id).status, "REJECTED");
  const kept = s.db.prepare("SELECT * FROM tax_invoices WHERE id=?").get(invoice.id);
  assert.equal(kept.buyer_name, BUYER.name, "issued tax invoice is a legal record and stays");
  assert.equal(s.adminTaxInvoiceDocument(admin, issuedOrder.id).number, invoice.number);
});

test("live mode: own number sequence without TEST-, test-paid orders refused", (t) => {
  const { s, user, admin, buy } = fixture(t);
  const order = buy();
  s.requestTaxInvoice(user, order.id, BUYER);
  s.adminIssueTaxInvoice(admin, order.id);
  const sandboxPaid = buy();
  const adminPassword = "Live-admin-Password-123";
  const live = createCommerceCore({ db: s.db, allowSandbox: false, seed: false, adminPassword });
  const owner = live.session(live.login({ email: "admin@astra.local", password: adminPassword }).token);
  const view = live.adminReceiptSettings(owner);
  assert.equal(view.testMode, false);
  assert.match(view.nextNumber, /^INV\d{4}-000001$/);
  assert.equal(live.adminTaxInvoices(owner, { status: "ISSUED" }).invoices.length, 0, "test invoices are not listed live");
  assert.throws(() => live.adminIssueTaxInvoice(owner, sandboxPaid.id, { buyer: BUYER }), status(409));
});
