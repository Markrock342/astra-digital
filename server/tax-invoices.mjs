/**
 * Receipts in the shop's own company name + full tax invoices (ใบกำกับภาษีเต็มรูป).
 * Kept apart from domain.mjs / order-extras.mjs so parallel work merges cleanly.
 *
 * Settings (runtime_flags 'receipt-settings', admin › ตั้งค่า › ใบเสร็จและใบกำกับภาษี):
 *   legal name, 13-digit tax ID, head office / branch no., registered address, phone/email
 *   printed on documents, logo on/off, footer note, VAT-registered (7 %, prices include VAT),
 *   invoice number prefix.
 *
 * Modes (from the settings):
 *   TAX_INVOICE  VAT-registered AND legal name + valid tax ID + address set: a customer can
 *                request a full tax invoice for their own DELIVERED (paid) order; ADMIN issues
 *                (allocates the number) or rejects with a reason.
 *   RECEIPT      not VAT-registered: the customer may put their own / company name, tax ID and
 *                address on the ใบเสร็จรับเงิน (never called ใบกำกับภาษี). No admin step.
 *   OFF          VAT-registered but the company details are incomplete: nothing is offered.
 *
 * Revenue Code s.86/4: seller + buyer name / address / tax ID / head office or branch, the
 * words "ใบกำกับภาษี", sequential number, issue date, items with qty and unit price, VAT shown
 * separately. Prices include VAT: vat = round(total × 7 / 107) satang, pre-VAT = total − vat,
 * on the order's actual paid total (after discounts). Refunded / cancelled orders cannot request.
 *
 * Issued invoices are immutable snapshots (append-only tables, ensureTaxInvoices in
 * ensure-admin-fr.mjs). A mistake is fixed by voiding (tax_invoice_voids, with a reason) and
 * issuing a new invoice with a new number; numbers are never reused.
 */
import { randomUUID } from "node:crypto";

export const RECEIPT_SETTINGS_KEY = "receipt-settings";
/** VAT rate in basis points (7.00 %). */
export const VAT_RATE_BP = 700;
export const HEAD_OFFICE = "00000";
export const BUYER_TYPES = ["PERSON", "COMPANY"];
const DEFAULT_PREFIX = "INV";

/** VAT-inclusive split of a total in satang: vat = round(total*7/107), net = total - vat. */
export function vatSplit(total) {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError("total must be satang >= 0");
  const vat = Math.round((total * VAT_RATE_BP) / (10000 + VAT_RATE_BP));
  return { vat, net: total - vat };
}

/** Digits only ("0-1055-12345-67-8" → "0105512345678"). */
export const taxIdDigits = (value) => String(value ?? "").replace(/[\s-]/g, "");

/** Thai 13-digit tax ID / national ID with the mod-11 check digit. */
export function isValidThaiTaxId(value) {
  const id = taxIdDigits(value);
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

/** "00000" → สำนักงานใหญ่, "00012" → สาขาที่ 00012. */
export const branchLabel = (code) =>
  !code ? "" : code === HEAD_OFFICE ? "สำนักงานใหญ่" : "สาขาที่ " + code;

/** Head office or a 1–5 digit branch number, stored as five digits. */
export function normalizeBranch(input, fail, label = "สาขา") {
  if (input === undefined || input === null || input === "" || input === "HEAD" || input === HEAD_OFFICE)
    return HEAD_OFFICE;
  const text = String(input).trim();
  if (!/^\d{1,5}$/.test(text) || Number(text) < 1) fail(400, label + "ต้องเป็นเลข 5 หลัก (00001–99999)");
  return text.padStart(5, "0");
}

const text = (value, max, label, fail, { required = false, min = 1, multiline = false } = {}) => {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") fail(400, label + "ไม่ถูกต้อง");
  let v = value.replace(/\r\n?/g, "\n");
  // eslint-disable-next-line no-control-regex
  v = v.replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, multiline ? "" : " ");
  v = v.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!v) {
    if (required) fail(400, "กรุณากรอก" + label);
    return "";
  }
  if (v.length < min) fail(400, label + "สั้นเกินไป");
  if (v.length > max) fail(400, label + "ยาวเกิน " + max + " ตัวอักษร");
  return v;
};

/** Buyer details from a form: { type, name, taxId, branch, address }. */
export function normalizeBuyer(input, fail) {
  const source = input && typeof input === "object" ? input : {};
  const type = String(source.type ?? "");
  if (!BUYER_TYPES.includes(type)) fail(400, "กรุณาเลือกประเภทผู้ซื้อ (บุคคลธรรมดา หรือ นิติบุคคล)");
  const name = text(source.name, 200, type === "COMPANY" ? "ชื่อบริษัท / นิติบุคคล" : "ชื่อ-นามสกุล", fail, {
    required: true,
    min: 2,
  });
  const taxId = taxIdDigits(source.taxId);
  if (!taxId) fail(400, "กรุณากรอกเลขประจำตัวผู้เสียภาษี 13 หลัก");
  if (!isValidThaiTaxId(taxId)) fail(400, "เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (ต้องเป็นเลข 13 หลักที่ถูกต้อง)");
  const branch = type === "COMPANY" ? normalizeBranch(source.branch, fail, "เลขสาขาผู้ซื้อ") : null;
  const address = text(source.address, 400, "ที่อยู่", fail, { required: true, min: 10, multiline: true });
  return { type, name, taxId, branch, address };
}

const DEFAULTS = Object.freeze({
  legalName: "",
  taxId: "",
  branch: HEAD_OFFICE,
  address: "",
  phone: "",
  email: "",
  showLogo: false,
  footerNote: "",
  vatRegistered: false,
  invoicePrefix: DEFAULT_PREFIX,
  updatedAt: null,
});

const dbTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const bangkokYear = (ms) => new Date(ms + 7 * 3600000).getUTCFullYear();

export function createTaxInvoices({
  one,
  all,
  run,
  tx,
  fail,
  clock = () => Date.now(),
  requireUser,
  requireStaff,
  requireAdmin,
  isAdmin,
  notify,
  shopSettings,
  orderRefundState,
  moneyScope,
}) {
  const auditDetail = (userId, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      userId ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );
  const scope = () => (moneyScope().live ? "live" : "sandbox");
  const notifyAdmins = (title, body, link) => {
    for (const admin of all("SELECT id FROM users WHERE role='ADMIN' AND COALESCE(status,'ACTIVE')='ACTIVE'"))
      notify(admin.id, "tax_invoice", title, body, link);
  };

  // ---------------------------------------------------------------- settings

  /** Saved receipt settings merged over the defaults; `saved` = the admin has saved once. */
  function loadSettings() {
    let saved = null;
    try {
      const raw = one("SELECT value FROM runtime_flags WHERE key=?", RECEIPT_SETTINGS_KEY)?.value;
      if (raw) saved = JSON.parse(raw);
    } catch {
      saved = null;
    }
    const s = { ...DEFAULTS };
    if (saved && typeof saved === "object")
      for (const key of Object.keys(DEFAULTS))
        if (saved[key] !== undefined && typeof saved[key] === typeof DEFAULTS[key]) s[key] = saved[key];
        else if (key === "updatedAt" && typeof saved[key] === "string") s[key] = saved[key];
    return { ...s, saved: !!saved };
  }

  /** What is still missing before a full tax invoice can be offered. */
  function missingFor(s) {
    const missing = [];
    if (!s.legalName) missing.push("ชื่อนิติบุคคล / ชื่อผู้ประกอบการ");
    if (!isValidThaiTaxId(s.taxId)) missing.push("เลขประจำตัวผู้เสียภาษี 13 หลัก");
    if (!s.address) missing.push("ที่อยู่ตามที่จดทะเบียน");
    return missing;
  }
  function modeOf(s = loadSettings()) {
    if (!s.vatRegistered) return "RECEIPT";
    return missingFor(s).length ? "OFF" : "TAX_INVOICE";
  }

  /**
   * Seller block for receipts and invoices: these settings first, then the older shop
   * settings fields (order-extras.mjs aliases) as the fallback.
   */
  function sellerBlock(fallback = {}) {
    const s = loadSettings();
    const shop = shopSettings() ?? {};
    const pick = (value, alt) => (value ? value : alt || "");
    return {
      legalName: pick(s.legalName, fallback.legalName),
      taxId: pick(s.taxId, fallback.taxId),
      branch: s.legalName || s.taxId ? s.branch : "",
      branchLabel: s.legalName || s.taxId ? branchLabel(s.branch) : "",
      address: pick(s.address, fallback.address),
      phone: pick(s.phone, fallback.phone),
      email: pick(s.email, fallback.email),
      logoUrl: s.showLogo && typeof shop.logoUrl === "string" ? shop.logoUrl : null,
      footerNote: s.footerNote,
      vatRegistered: s.saved ? s.vatRegistered : fallback.vatRegistered === true,
    };
  }

  function settingsView() {
    const s = loadSettings();
    const shop = shopSettings() ?? {};
    const year = bangkokYear(clock());
    const next =
      (one("SELECT COALESCE(MAX(seq),0) AS n FROM tax_invoices WHERE scope=? AND year=?", scope(), year)?.n ?? 0) + 1;
    const { saved, ...settings } = s;
    return {
      settings,
      saved,
      mode: modeOf(s),
      missing: s.vatRegistered ? missingFor(s) : [],
      logoUrl: typeof shop.logoUrl === "string" ? shop.logoUrl : null,
      shopName: typeof shop.shopName === "string" && shop.shopName !== "ร้านค้า" ? shop.shopName : "ASIA EXTRA",
      nextNumber: formatNumber(s.invoicePrefix, year, next),
      testMode: scope() === "sandbox",
    };
  }

  function adminReceiptSettings(user) {
    requireAdmin(user);
    return settingsView();
  }

  function adminSaveReceiptSettings(user, input = {}) {
    requireAdmin(user);
    const current = loadSettings();
    const next = { ...current };
    delete next.saved;
    next.legalName = text(input.legalName, 200, "ชื่อนิติบุคคล", fail);
    const taxId = taxIdDigits(input.taxId);
    if (taxId && !isValidThaiTaxId(taxId)) fail(400, "เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (ต้องเป็นเลข 13 หลักที่ถูกต้อง)");
    next.taxId = taxId;
    next.branch = normalizeBranch(input.branch, fail, "เลขสาขา");
    next.address = text(input.address, 400, "ที่อยู่", fail, { multiline: true });
    next.phone = text(input.phone, 40, "เบอร์โทร", fail);
    next.email = text(input.email, 120, "อีเมล", fail);
    if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) fail(400, "อีเมลไม่ถูกต้อง");
    next.footerNote = text(input.footerNote, 300, "ข้อความท้ายเอกสาร", fail, { multiline: true });
    for (const key of ["showLogo", "vatRegistered"]) {
      if (input[key] === undefined) continue;
      if (typeof input[key] !== "boolean") fail(400, "ค่าตั้งค่าไม่ถูกต้อง");
      next[key] = input[key];
    }
    const prefix = String(input.invoicePrefix ?? next.invoicePrefix ?? DEFAULT_PREFIX)
      .trim()
      .toUpperCase();
    if (!/^[A-Z][A-Z0-9-]{0,9}$/.test(prefix)) fail(400, "อักษรนำหน้าเลขที่ต้องเป็น A–Z, 0–9 หรือ - ไม่เกิน 10 ตัว");
    next.invoicePrefix = prefix;
    if (next.vatRegistered) {
      const missing = missingFor(next);
      if (missing.length) fail(400, "จดทะเบียน VAT ต้องกรอก: " + missing.join(", "));
    }
    next.updatedAt = dbTime(clock());
    const changed = {};
    for (const key of Object.keys(DEFAULTS))
      if (key !== "updatedAt" && next[key] !== current[key]) changed[key] = { from: current[key], to: next[key] };
    run(
      "INSERT INTO runtime_flags(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      RECEIPT_SETTINGS_KEY,
      JSON.stringify(next),
    );
    auditDetail(user.id, "RECEIPT_SETTINGS", null, { fields: Object.keys(changed).join(", ") || "-" });
    return settingsView();
  }

  // ------------------------------------------------------------------ orders

  function loadOrder(orderId) {
    const select = (table) =>
      one(
        `SELECT o.*,p.name AS product,v.label AS option_label
         FROM ${table} o JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id
         WHERE o.id=?`,
        orderId,
      );
    const order = select("orders");
    if (order) return { ...order, preorder: false };
    const reservation = select("reservations");
    return reservation ? { ...reservation, preorder: true } : null;
  }
  const orderIdOf = (id) => {
    if (typeof id !== "string" || !id.trim() || id.length > 80) fail(400, "คำสั่งซื้อไม่ถูกต้อง");
    return id.trim();
  };
  const ownOrder = (user, id) => {
    requireUser(user);
    const row = loadOrder(orderIdOf(id));
    if (!row || row.user_id !== user.id) fail(404, "ไม่พบคำสั่งซื้อ");
    return row;
  };
  const anyOrder = (id) => {
    const row = loadOrder(orderIdOf(id));
    if (!row) fail(404, "ไม่พบคำสั่งซื้อ");
    return row;
  };
  const paymentColumn = (row) => (row.preorder ? "reservation_id" : "order_id");

  function loadCheckoutDelivered(checkoutId) {
    const selectLine = (alias) =>
      `${alias}.id, ${alias}.user_id, ${alias}.variant_id, ${alias}.quantity, ${alias}.total, ${alias}.status,
       ${alias}.created_at, ${alias}.discount, ${alias}.coupon_code, ${alias}.checkout_id, ${alias}.checkout_line,
       ${alias}.warranty_days, p.name AS product, v.label AS option_label`;
    return all(
      `SELECT * FROM (
         SELECT ${selectLine("o")}, 0 AS preorder, COALESCE(o.checkout_line, 0) AS line_no
         FROM orders o JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id
         WHERE o.checkout_id=? AND o.status='DELIVERED'
         UNION ALL
         SELECT ${selectLine("r")}, 1 AS preorder, COALESCE(r.checkout_line, 0) AS line_no
         FROM reservations r JOIN variants v ON v.id=r.variant_id JOIN products p ON p.id=v.product_id
         WHERE r.checkout_id=? AND r.status='DELIVERED'
       ) ORDER BY line_no, id`,
      checkoutId,
      checkoutId,
    ).map((r) => ({ ...r, preorder: !!r.preorder }));
  }

  /** Multi-line delivered checkout → one tax invoice; else per-order (legacy). */
  function taxScope(row) {
    if (!row?.checkout_id) return { kind: "order", rows: [row], anchor: row, checkoutId: null };
    const lines = loadCheckoutDelivered(row.checkout_id);
    if (lines.length <= 1) return { kind: "order", rows: [row], anchor: row, checkoutId: null };
    return { kind: "checkout", rows: lines, anchor: lines[0], checkoutId: row.checkout_id };
  }

  /** Why this order cannot get a tax invoice / buyer details now (null = it can). */
  function blockedReason(row, mode) {
    const scopeInfo = taxScope(row);
    for (const line of scopeInfo.rows) {
      if (line.status !== "DELIVERED") return "ขอได้เฉพาะคำสั่งซื้อที่ชำระเงินและได้รับสินค้าแล้ว";
      if (orderRefundState(line.id, line.preorder)?.refundStatus)
        return "คำสั่งซื้อที่คืนเงินแล้วขอใบกำกับภาษีไม่ได้";
      if (mode === "TAX_INVOICE" && scope() === "live") {
        const paid = one(
          `SELECT SUM(CASE WHEN provider='sandbox' THEN 1 ELSE 0 END) AS test, COUNT(*) AS n
           FROM payments WHERE ${paymentColumn(line)}=? AND status='SUCCEEDED'`,
          line.id,
        );
        if (paid?.n > 0 && paid.test === paid.n) return "คำสั่งซื้อทดสอบออกใบกำกับภาษีไม่ได้";
      }
    }
    return null;
  }

  const requestRow = (orderId, checkoutId = null) => {
    if (checkoutId) {
      const byCheckout = one("SELECT * FROM tax_invoice_requests WHERE checkout_id=?", checkoutId);
      if (byCheckout) return byCheckout;
    }
    return one("SELECT * FROM tax_invoice_requests WHERE order_id=?", orderId);
  };
  const buyerOf = (r) =>
    r && r.buyer_type && r.buyer_name
      ? {
          type: r.buyer_type,
          name: r.buyer_name,
          taxId: r.buyer_tax_id ?? "",
          branch: r.buyer_branch ?? null,
          branchLabel: branchLabel(r.buyer_branch),
          address: r.buyer_address ?? "",
        }
      : null;
  const requestView = (r) =>
    r
      ? {
          status: r.status,
          buyer: buyerOf(r),
          reason: r.reason ?? null,
          requestedAt: r.requested_at ?? null,
          updatedAt: r.updated_at,
          resolvedAt: r.resolved_at ?? null,
        }
      : null;
  const invoiceList = (orderId, checkoutId = null) =>
    all(
      `SELECT i.id,i.number,i.issued_at,i.total,i.vat,i.scope,i.checkout_id,v.reason AS void_reason,v.created_at AS voided_at
       FROM tax_invoices i LEFT JOIN tax_invoice_voids v ON v.invoice_id=i.id
       WHERE i.order_id=? OR (? IS NOT NULL AND i.checkout_id=?)
       ORDER BY i.issued_at DESC, i.seq DESC`,
      orderId,
      checkoutId,
      checkoutId,
    ).map((i) => ({
      id: i.id,
      number: i.number,
      issuedAt: i.issued_at,
      total: i.total,
      vat: i.vat,
      testMode: i.scope === "sandbox",
      checkoutId: i.checkout_id ?? null,
      voided: i.voided_at ? { reason: i.void_reason, at: i.voided_at } : null,
    }));
  const activeInvoice = (orderId, checkoutId = null) =>
    one(
      `SELECT i.* FROM tax_invoices i
       WHERE (i.order_id=? OR (? IS NOT NULL AND i.checkout_id=?))
         AND NOT EXISTS (SELECT 1 FROM tax_invoice_voids v WHERE v.invoice_id=i.id)
       ORDER BY i.issued_at DESC, i.seq DESC LIMIT 1`,
      orderId,
      checkoutId,
      checkoutId,
    );

  function stateFor(row) {
    const mode = modeOf();
    const scopeInfo = taxScope(row);
    const request = requestRow(scopeInfo.anchor.id, scopeInfo.checkoutId);
    const invoices = invoiceList(scopeInfo.anchor.id, scopeInfo.checkoutId);
    const active = invoices.find((i) => !i.voided) ?? null;
    const blocked = mode === "OFF" ? "ร้านยังไม่เปิดให้ขอใบกำกับภาษี" : blockedReason(row, mode);
    return {
      mode,
      eligible: !blocked && !active,
      blockedReason: blocked,
      checkoutId: scopeInfo.checkoutId,
      lineCount: scopeInfo.rows.length,
      request: requestView(request),
      invoices,
      activeInvoice: active,
    };
  }

  /** GET /api/orders/:id/tax-invoice — the buyer's own order. */
  function myTaxInvoice(user, id) {
    return stateFor(ownOrder(user, id));
  }

  const upsertBuyer = (
    row,
    buyer,
    status,
    actorId,
    { requested = false, keepRequested = false, checkoutId = null } = {},
  ) => {
    const now = dbTime(clock());
    const scopeInfo = taxScope(row);
    const anchorId = scopeInfo.anchor.id;
    const cid = checkoutId ?? scopeInfo.checkoutId;
    run(
      `INSERT INTO tax_invoice_requests(order_id,preorder,user_id,buyer_type,buyer_name,buyer_tax_id,buyer_branch,buyer_address,
         status,reason,invoice_id,requested_at,updated_at,updated_by,checkout_id)
       VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,?)
       ON CONFLICT(order_id) DO UPDATE SET
         buyer_type=excluded.buyer_type, buyer_name=excluded.buyer_name, buyer_tax_id=excluded.buyer_tax_id,
         buyer_branch=excluded.buyer_branch, buyer_address=excluded.buyer_address, status=excluded.status,
         reason=CASE WHEN excluded.status=tax_invoice_requests.status THEN tax_invoice_requests.reason ELSE NULL END,
         requested_at=CASE WHEN ? THEN tax_invoice_requests.requested_at ELSE COALESCE(excluded.requested_at, tax_invoice_requests.requested_at) END,
         updated_at=excluded.updated_at, updated_by=excluded.updated_by,
         checkout_id=COALESCE(excluded.checkout_id, tax_invoice_requests.checkout_id)`,
      anchorId,
      scopeInfo.anchor.preorder ? 1 : 0,
      row.user_id,
      buyer.type,
      buyer.name,
      buyer.taxId,
      buyer.branch,
      buyer.address,
      status,
      requested ? now : null,
      now,
      actorId,
      cid,
      keepRequested ? 1 : 0,
    );
  };

  /**
   * POST /api/orders/:id/tax-invoice { type, name, taxId, branch, address } — TAX_INVOICE mode:
   * (re)submits the request (PENDING); RECEIPT mode: saves the buyer for the ใบเสร็จรับเงิน.
   */
  function requestTaxInvoice(user, id, input = {}) {
    const row = ownOrder(user, id);
    const mode = modeOf();
    if (mode === "OFF") fail(409, "ร้านยังไม่เปิดให้ขอใบกำกับภาษี");
    const blocked = blockedReason(row, mode);
    if (blocked) fail(409, blocked);
    const buyer = normalizeBuyer(input, fail);
    const scopeInfo = taxScope(row);
    tx(() => {
      const existing = requestRow(scopeInfo.anchor.id, scopeInfo.checkoutId);
      if (existing?.status === "ISSUED" || activeInvoice(scopeInfo.anchor.id, scopeInfo.checkoutId))
        fail(409, "ออกใบกำกับภาษีให้คำสั่งซื้อนี้แล้ว หากข้อมูลผิดกรุณาติดต่อร้าน");
      if (mode === "RECEIPT") {
        upsertBuyer(row, buyer, "SAVED", user.id, { checkoutId: scopeInfo.checkoutId });
        auditDetail(user.id, "RECEIPT_BUYER_SAVE", scopeInfo.anchor.id, {
          checkoutId: scopeInfo.checkoutId,
        });
        return;
      }
      const wasPending = existing?.status === "PENDING";
      upsertBuyer(row, buyer, "PENDING", user.id, {
        requested: !wasPending,
        keepRequested: wasPending,
        checkoutId: scopeInfo.checkoutId,
      });
      auditDetail(user.id, wasPending ? "TAX_INVOICE_REQUEST_UPDATE" : "TAX_INVOICE_REQUEST", scopeInfo.anchor.id, {
        checkoutId: scopeInfo.checkoutId,
      });
      if (!wasPending)
        notifyAdmins(
          "คำขอใบกำกับภาษี",
          "ออเดอร์ #" +
            (scopeInfo.checkoutId || scopeInfo.anchor.id).slice(0, 8).toUpperCase() +
            (scopeInfo.kind === "checkout" ? " (" + scopeInfo.rows.length + " รายการ)" : "") +
            " · " +
            buyer.name,
          "/admin/orders/" + scopeInfo.anchor.id,
        );
    });
    return stateFor(row);
  }

  // ------------------------------------------------------------------- admin

  function adminTaxInvoice(user, id) {
    requireStaff(user);
    const row = anyOrder(id);
    const customer = one("SELECT name,email FROM users WHERE id=?", row.user_id) ?? {};
    const state = stateFor(row);
    return {
      ...state,
      canIssue: isAdmin(user) && state.mode === "TAX_INVOICE" && !state.blockedReason && !state.activeInvoice,
      missing: state.mode === "OFF" ? missingFor(loadSettings()) : [],
      order: { id: row.id, total: row.total, status: row.status, preorder: row.preorder },
      customer: { name: customer.name ?? "", email: customer.email ?? "" },
    };
  }

  /** POST /api/admin/orders/:id/tax-invoice/buyer — save buyer details (no issue). */
  function adminSaveTaxInvoiceBuyer(user, id, input = {}) {
    requireAdmin(user);
    const row = anyOrder(id);
    const buyer = normalizeBuyer(input, fail);
    tx(() => {
      const existing = requestRow(row.id);
      if (existing?.status === "ISSUED" || activeInvoice(row.id))
        fail(409, "ออกใบกำกับภาษีแล้ว ต้องยกเลิกใบเดิมก่อนแก้ข้อมูลผู้ซื้อ");
      upsertBuyer(row, buyer, existing?.status ?? "SAVED", user.id, { keepRequested: true });
      auditDetail(user.id, "TAX_INVOICE_BUYER_SAVE", row.id, null);
    });
    return adminTaxInvoice(user, id);
  }

  /** Next number inside the caller's transaction: prefix + Bangkok year + running no. per scope. */
  function formatNumber(prefix, year, seq) {
    return (scope() === "sandbox" ? "TEST-" : "") + prefix + year + "-" + String(seq).padStart(6, "0");
  }

  /**
   * POST /api/admin/orders/:id/tax-invoice/issue [{ buyer }] — ADMIN. Allocates the number
   * atomically and stores the full snapshot. Optional `buyer` is saved first (same transaction).
   */
  function adminIssueTaxInvoice(user, id, input = {}) {
    requireAdmin(user);
    const row = anyOrder(id);
    const settings = loadSettings();
    const mode = modeOf(settings);
    if (mode !== "TAX_INVOICE")
      fail(
        409,
        mode === "RECEIPT"
          ? "ร้านยังไม่ได้ตั้งค่าเป็นผู้จดทะเบียน VAT จึงออกใบกำกับภาษีไม่ได้"
          : "กรอกข้อมูลบริษัทให้ครบก่อน: " + missingFor(settings).join(", "),
      );
    const blocked = blockedReason(row, mode);
    if (blocked) fail(409, blocked);
    const given = input.buyer ? normalizeBuyer(input.buyer, fail) : null;
    const scopeInfo = taxScope(row);
    const invoice = tx(() => {
      const existing = requestRow(scopeInfo.anchor.id, scopeInfo.checkoutId);
      if (activeInvoice(scopeInfo.anchor.id, scopeInfo.checkoutId))
        fail(409, "ออเดอร์นี้มีใบกำกับภาษีที่ใช้งานอยู่แล้ว");
      if (given)
        upsertBuyer(row, given, existing?.status ?? "SAVED", user.id, {
          keepRequested: true,
          checkoutId: scopeInfo.checkoutId,
        });
      const buyer = buyerOf(requestRow(scopeInfo.anchor.id, scopeInfo.checkoutId));
      if (!buyer || !isValidThaiTaxId(buyer.taxId) || !buyer.address)
        fail(400, "กรอกข้อมูลผู้ซื้อให้ครบก่อนออกใบกำกับภาษี");
      const now = clock();
      const year = bangkokYear(now);
      const sc = scope();
      const seq = one("SELECT COALESCE(MAX(seq),0)+1 AS n FROM tax_invoices WHERE scope=? AND year=?", sc, year).n;
      const number = formatNumber(settings.invoicePrefix, year, seq);
      const items = scopeInfo.rows.map((line) => {
        const lineDiscount = Number.isSafeInteger(line.discount) && line.discount > 0 ? line.discount : 0;
        const lineSubtotal = line.total + lineDiscount;
        const base = {
          description: line.product,
          option: line.option_label,
          quantity: line.quantity,
          unitPrice: Math.round(lineSubtotal / Math.max(1, line.quantity)),
          amount: lineSubtotal,
        };
        return scopeInfo.kind === "checkout"
          ? { ...base, orderId: line.id, discount: lineDiscount, total: line.total }
          : base;
      });
      const discount = scopeInfo.rows.reduce(
        (n, line) => n + (Number.isSafeInteger(line.discount) && line.discount > 0 ? line.discount : 0),
        0,
      );
      const subtotal = items.reduce((n, i) => n + i.amount, 0);
      const total = scopeInfo.rows.reduce((n, line) => n + line.total, 0);
      const { vat, net } = vatSplit(total);
      const shop = shopSettings() ?? {};
      const seller = {
        shopName: typeof shop.shopName === "string" && shop.shopName !== "ร้านค้า" ? shop.shopName : "ASIA EXTRA",
        legalName: settings.legalName,
        taxId: settings.taxId,
        branch: settings.branch,
        address: settings.address,
        phone: settings.phone || (typeof shop.phone === "string" ? shop.phone : ""),
        email: settings.email || (typeof shop.email === "string" ? shop.email : ""),
        logoUrl: settings.showLogo && typeof shop.logoUrl === "string" ? shop.logoUrl : null,
        footerNote: settings.footerNote,
      };
      const paidAt =
        one(
          `SELECT MIN(COALESCE(finalized_at,created_at)) AS at FROM payments WHERE ${paymentColumn(scopeInfo.anchor)}=? AND status='SUCCEEDED'`,
          scopeInfo.anchor.id,
        )?.at ?? null;
      const invoiceId = randomUUID();
      run(
        `INSERT INTO tax_invoices(id,number,scope,year,seq,order_id,preorder,user_id,seller,buyer_type,buyer_name,buyer_tax_id,
           buyer_branch,buyer_address,items,subtotal,discount,total,vat_rate,vat,net,paid_at,issued_at,issued_by,checkout_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        invoiceId,
        number,
        sc,
        year,
        seq,
        scopeInfo.anchor.id,
        scopeInfo.anchor.preorder ? 1 : 0,
        row.user_id,
        JSON.stringify(seller),
        buyer.type,
        buyer.name,
        buyer.taxId,
        buyer.type === "COMPANY" ? buyer.branch || HEAD_OFFICE : null,
        buyer.address,
        JSON.stringify(items),
        subtotal,
        discount,
        total,
        VAT_RATE_BP,
        vat,
        net,
        paidAt,
        dbTime(now),
        user.id,
        scopeInfo.checkoutId,
      );
      run(
        `UPDATE tax_invoice_requests SET status='ISSUED',reason=NULL,invoice_id=?,resolved_at=?,resolved_by=? WHERE order_id=?`,
        invoiceId,
        dbTime(now),
        user.id,
        scopeInfo.anchor.id,
      );
      auditDetail(user.id, "TAX_INVOICE_ISSUE", scopeInfo.anchor.id, {
        number,
        checkoutId: scopeInfo.checkoutId,
        lineCount: scopeInfo.rows.length,
      });
      notify(
        row.user_id,
        "order",
        "ออกใบกำกับภาษีแล้ว",
        "ใบกำกับภาษีเลขที่ " +
          number +
          " สำหรับคำสั่งซื้อ #" +
          (scopeInfo.checkoutId || scopeInfo.anchor.id).slice(0, 8).toUpperCase() +
          " ดูและพิมพ์ได้ที่หน้าคำสั่งซื้อ",
        "/orders/" + scopeInfo.anchor.id,
      );
      return { id: invoiceId, number };
    });
    return { invoice, state: adminTaxInvoice(user, id) };
  }

  /** POST /api/admin/orders/:id/tax-invoice/reject { reason } — ADMIN, PENDING requests only. */
  function adminRejectTaxInvoice(user, id, input = {}) {
    requireAdmin(user);
    const row = anyOrder(id);
    const reason = text(input.reason, 300, "เหตุผล", fail, { required: true, min: 3 });
    tx(() => {
      const existing = requestRow(row.id);
      if (existing?.status !== "PENDING") fail(409, "ไม่มีคำขอใบกำกับภาษีที่รอดำเนินการ");
      const now = dbTime(clock());
      run(
        "UPDATE tax_invoice_requests SET status='REJECTED',reason=?,resolved_at=?,resolved_by=? WHERE order_id=?",
        reason,
        now,
        user.id,
        row.id,
      );
      auditDetail(user.id, "TAX_INVOICE_REJECT", row.id, { reason });
      notify(
        row.user_id,
        "order",
        "คำขอใบกำกับภาษีไม่ผ่าน",
        "คำสั่งซื้อ #" + row.id.slice(0, 8).toUpperCase() + " · " + reason + " · แก้ข้อมูลแล้วส่งใหม่ได้ที่หน้าคำสั่งซื้อ",
        "/orders/" + row.id,
      );
    });
    return adminTaxInvoice(user, id);
  }

  /** POST /api/admin/tax-invoices/:invoiceId/void { reason } — ADMIN. Adds a void row; never edits the invoice. */
  function adminVoidTaxInvoice(user, invoiceIdRaw, input = {}) {
    requireAdmin(user);
    const invoiceId = orderIdOf(invoiceIdRaw);
    const reason = text(input.reason, 300, "เหตุผล", fail, { required: true, min: 3 });
    const orderId = tx(() => {
      const inv = one("SELECT id,number,order_id,user_id FROM tax_invoices WHERE id=?", invoiceId);
      if (!inv) fail(404, "ไม่พบใบกำกับภาษี");
      if (one("SELECT 1 AS n FROM tax_invoice_voids WHERE invoice_id=?", invoiceId))
        fail(409, "ใบกำกับภาษีนี้ถูกยกเลิกแล้ว");
      const now = dbTime(clock());
      run(
        "INSERT INTO tax_invoice_voids(id,invoice_id,reason,voided_by,created_at) VALUES(?,?,?,?,?)",
        randomUUID(),
        invoiceId,
        reason,
        user.id,
        now,
      );
      run(
        "UPDATE tax_invoice_requests SET status='VOIDED',reason=?,resolved_at=?,resolved_by=? WHERE order_id=? AND invoice_id=?",
        reason,
        now,
        user.id,
        inv.order_id,
        invoiceId,
      );
      auditDetail(user.id, "TAX_INVOICE_VOID", inv.order_id, { number: inv.number, reason });
      notify(
        inv.user_id,
        "order",
        "ยกเลิกใบกำกับภาษี",
        "ใบกำกับภาษีเลขที่ " + inv.number + " ถูกยกเลิก · " + reason,
        "/orders/" + inv.order_id,
      );
      return inv.order_id;
    });
    return adminTaxInvoice(user, orderId);
  }

  /** GET /api/admin/tax-invoices?status=PENDING|ISSUED|REJECTED */
  function adminTaxInvoices(user, query = {}) {
    requireStaff(user);
    const status = String(query.status ?? "PENDING").toUpperCase();
    if (!["PENDING", "ISSUED", "REJECTED"].includes(status)) fail(400, "สถานะไม่ถูกต้อง");
    const counts = {
      pending: one("SELECT COUNT(*) AS n FROM tax_invoice_requests WHERE status='PENDING'").n,
    };
    if (status === "ISSUED") {
      const invoices = all(
        `SELECT i.id,i.number,i.order_id,i.issued_at,i.buyer_name,i.buyer_tax_id,i.total,i.vat,i.net,
                v.reason AS void_reason,v.created_at AS voided_at
         FROM tax_invoices i LEFT JOIN tax_invoice_voids v ON v.invoice_id=i.id
         WHERE i.scope=? ORDER BY i.year DESC, i.seq DESC LIMIT 300`,
        scope(),
      ).map((i) => ({
        id: i.id,
        number: i.number,
        orderId: i.order_id,
        issuedAt: i.issued_at,
        buyerName: i.buyer_name,
        buyerTaxId: i.buyer_tax_id,
        total: i.total,
        vat: i.vat,
        net: i.net,
        voided: i.voided_at ? { reason: i.void_reason, at: i.voided_at } : null,
      }));
      return { status, counts, invoices, mode: modeOf() };
    }
    const requests = all(
      `SELECT r.*,u.name AS customer_name,u.email AS customer_email,
              COALESCE(o.total,rv.total) AS total
       FROM tax_invoice_requests r
       LEFT JOIN users u ON u.id=r.user_id
       LEFT JOIN orders o ON o.id=r.order_id
       LEFT JOIN reservations rv ON rv.id=r.order_id
       WHERE r.status=? AND (o.id IS NOT NULL OR rv.id IS NOT NULL)
       ORDER BY COALESCE(r.requested_at,r.updated_at) ${status === "PENDING" ? "ASC" : "DESC"} LIMIT 300`,
      status,
    ).map((r) => ({
      orderId: r.order_id,
      status: r.status,
      buyer: buyerOf(r),
      reason: r.reason ?? null,
      requestedAt: r.requested_at ?? r.updated_at,
      resolvedAt: r.resolved_at ?? null,
      total: r.total,
      customer: { name: r.customer_name ?? "", email: r.customer_email ?? "" },
    }));
    return { status, counts, requests, mode: modeOf() };
  }

  // --------------------------------------------------------------- documents

  function documentView(inv, orderRow) {
    const voided = one("SELECT reason,created_at FROM tax_invoice_voids WHERE invoice_id=?", inv.id);
    let seller = {};
    let items = [];
    try {
      seller = JSON.parse(inv.seller);
      items = JSON.parse(inv.items);
    } catch {
      // Stored by this module; unreadable JSON would be a bug, show what we have.
    }
    return {
      id: inv.id,
      number: inv.number,
      title: "ใบเสร็จรับเงิน/ใบกำกับภาษี",
      testMode: inv.scope === "sandbox",
      orderId: inv.order_id,
      orderNumber: inv.order_id.slice(0, 8).toUpperCase(),
      orderedAt: orderRow?.created_at ?? null,
      paidAt: inv.paid_at,
      issuedAt: inv.issued_at,
      seller: { ...seller, branchLabel: branchLabel(seller.branch) },
      buyer: {
        type: inv.buyer_type,
        name: inv.buyer_name,
        taxId: inv.buyer_tax_id,
        branch: inv.buyer_branch,
        branchLabel: branchLabel(inv.buyer_branch),
        address: inv.buyer_address,
      },
      items,
      subtotal: inv.subtotal,
      discount: inv.discount,
      total: inv.total,
      vatRate: inv.vat_rate / 100,
      vat: inv.vat,
      net: inv.net,
      voided: voided ? { reason: voided.reason, at: voided.created_at } : null,
    };
  }

  function findInvoice(row, invoiceId) {
    if (invoiceId) {
      const inv = one("SELECT * FROM tax_invoices WHERE id=? AND order_id=?", String(invoiceId).slice(0, 80), row.id);
      if (!inv) fail(404, "ไม่พบใบกำกับภาษี");
      return inv;
    }
    const inv =
      activeInvoice(row.id) ??
      one("SELECT * FROM tax_invoices WHERE order_id=? ORDER BY issued_at DESC, seq DESC LIMIT 1", row.id);
    if (!inv) fail(404, "ยังไม่มีใบกำกับภาษีสำหรับคำสั่งซื้อนี้");
    return inv;
  }

  /** GET /api/orders/:id/tax-invoice/document[?invoice=] — owner only. */
  function taxInvoiceDocument(user, id, invoiceId) {
    const row = ownOrder(user, id);
    return documentView(findInvoice(row, invoiceId), row);
  }
  /** GET /api/admin/orders/:id/tax-invoice/document[?invoice=] — staff. */
  function adminTaxInvoiceDocument(user, id, invoiceId) {
    requireStaff(user);
    const row = anyOrder(id);
    return documentView(findInvoice(row, invoiceId), row);
  }

  /**
   * Extra fields for the existing receipt (order-extras.mjs buildReceipt): the buyer block on
   * a ใบเสร็จรับเงิน (RECEIPT mode only) and the active tax invoice number, if any.
   */
  function receiptExtras(row) {
    const mode = modeOf();
    const request = requestRow(row.id);
    const active = activeInvoice(row.id);
    return {
      buyer: mode === "RECEIPT" && row.status === "DELIVERED" ? buyerOf(request) : null,
      taxInvoiceMode: mode,
      taxInvoice: active ? { id: active.id, number: active.number } : null,
    };
  }

  return {
    loadSettings,
    modeOf,
    sellerBlock,
    receiptExtras,
    adminReceiptSettings,
    adminSaveReceiptSettings,
    myTaxInvoice,
    requestTaxInvoice,
    taxInvoiceDocument,
    adminTaxInvoice,
    adminSaveTaxInvoiceBuyer,
    adminIssueTaxInvoice,
    adminRejectTaxInvoice,
    adminVoidTaxInvoice,
    adminTaxInvoices,
    adminTaxInvoiceDocument,
  };
}

// --------------------------------------------------------------------- routes

const SEGMENT = "([A-Za-z0-9_-]{1,80})";
const MY = new RegExp("^/api/orders/" + SEGMENT + "/tax-invoice$");
const MY_DOC = new RegExp("^/api/orders/" + SEGMENT + "/tax-invoice/document$");
const ADMIN = new RegExp("^/api/admin/orders/" + SEGMENT + "/tax-invoice$");
const ADMIN_DOC = new RegExp("^/api/admin/orders/" + SEGMENT + "/tax-invoice/document$");
const ADMIN_ACTION = new RegExp("^/api/admin/orders/" + SEGMENT + "/tax-invoice/(buyer|issue|reject)$");
const ADMIN_VOID = new RegExp("^/api/admin/tax-invoices/" + SEGMENT + "/void$");

/**
 * HTTP routes (api-handler.mjs calls this once). Returns [status, data] or null.
 *   GET  /api/orders/:id/tax-invoice                 customer state
 *   POST /api/orders/:id/tax-invoice                 { type, name, taxId, branch, address }
 *   GET  /api/orders/:id/tax-invoice/document        [?invoice=<id>]
 *   GET  /api/admin/receipt-settings                 ADMIN
 *   POST /api/admin/receipt-settings                 ADMIN
 *   GET  /api/admin/tax-invoices?status=             staff
 *   GET  /api/admin/orders/:id/tax-invoice           staff
 *   GET  /api/admin/orders/:id/tax-invoice/document  staff [?invoice=<id>]
 *   POST /api/admin/orders/:id/tax-invoice/buyer     ADMIN
 *   POST /api/admin/orders/:id/tax-invoice/issue     ADMIN [{ buyer }]
 *   POST /api/admin/orders/:id/tax-invoice/reject    ADMIN { reason }
 *   POST /api/admin/tax-invoices/:invoiceId/void     ADMIN { reason }
 */
export function routeTaxInvoices(service, { method, path, user, input, url }) {
  if (!path.includes("tax-invoice") && path !== "/api/admin/receipt-settings") return null;
  let m;
  if (method === "GET") {
    if (path === "/api/admin/receipt-settings") return [200, service.adminReceiptSettings(user)];
    if (path === "/api/admin/tax-invoices")
      return [200, service.adminTaxInvoices(user, { status: url.searchParams.get("status") ?? "PENDING" })];
    if ((m = MY.exec(path))) return [200, service.myTaxInvoice(user, m[1])];
    if ((m = MY_DOC.exec(path)))
      return [200, { invoice: service.taxInvoiceDocument(user, m[1], url.searchParams.get("invoice")) }];
    if ((m = ADMIN.exec(path))) return [200, service.adminTaxInvoice(user, m[1])];
    if ((m = ADMIN_DOC.exec(path)))
      return [200, { invoice: service.adminTaxInvoiceDocument(user, m[1], url.searchParams.get("invoice")) }];
    return null;
  }
  if (method === "POST") {
    if (path === "/api/admin/receipt-settings") return [200, service.adminSaveReceiptSettings(user, input)];
    if ((m = MY.exec(path))) return [200, service.requestTaxInvoice(user, m[1], input)];
    if ((m = ADMIN_ACTION.exec(path))) {
      if (m[2] === "buyer") return [200, service.adminSaveTaxInvoiceBuyer(user, m[1], input)];
      if (m[2] === "issue") return [200, service.adminIssueTaxInvoice(user, m[1], input)];
      return [200, service.adminRejectTaxInvoice(user, m[1], input)];
    }
    if ((m = ADMIN_VOID.exec(path))) return [200, service.adminVoidTaxInvoice(user, m[1], input)];
  }
  return null;
}
