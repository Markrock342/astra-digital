/**
 * Customer order extras (kept apart from domain.mjs so parallel work merges cleanly):
 * - usage instructions per product ("วิธีใช้งานหลังซื้อ"): admin-only on the catalog,
 *   shown to the buyer only on a delivered order.
 * - report-an-account-problem chat messages linked to an order (3 per order per 24 h).
 * - order confirmation / short receipt data (never credentials).
 * Schema: ensureOrderExtras() in ensure-admin-fr.mjs.
 */

export const USAGE_INSTRUCTIONS_MAX = 2000;

/** Reason codes for "แจ้งปัญหาบัญชีนี้"; the Thai text is what admins read. */
export const REPORT_REASONS = Object.freeze({
  cannot_login: "เข้าไม่ได้",
  wrong_password: "รหัสผิด",
  password_changed: "โดนเปลี่ยนรหัส",
  other: "อื่นๆ",
});
export const REPORTS_PER_ORDER_PER_DAY = 3;

/**
 * Plain text only: newlines kept, other control characters dropped, trimmed.
 * Paragraphs (blank line) and "- " / "• " bullets are the only structure; the
 * storefront renders it as text, never as HTML.
 */
export function normalizeUsageInstructions(value, fail) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(400, "วิธีใช้งานหลังซื้อไม่ถูกต้อง");
  const text = value
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > USAGE_INSTRUCTIONS_MAX)
    fail(400, `วิธีใช้งานหลังซื้อยาวเกิน ${USAGE_INSTRUCTIONS_MAX} ตัวอักษร`);
  return text || null;
}

const SETTINGS_ALIASES = {
  legalName: ["legalName", "companyName", "businessName", "legalEntityName"],
  taxId: ["taxId", "taxID", "vatId", "taxNumber"],
  address: ["address", "legalAddress", "businessAddress", "companyAddress"],
};

const firstText = (source, keys) => {
  for (const key of keys) {
    const v = source?.[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
};

/** Optional numeric order field written by other features (coupons); 0 when absent. */
const optionalAmount = (row, keys) => {
  for (const key of keys) {
    const v = row?.[key];
    if (Number.isSafeInteger(v) && v > 0) return v;
  }
  return 0;
};

export function createOrderExtras({
  one,
  all,
  run,
  fail,
  clean,
  clock = () => Date.now(),
  requireUser,
  requireStaff,
  isStaff,
  isAdmin,
  settings,
  orderRefundState,
  // Receipt settings + buyer details (tax-invoices.mjs); optional so older callers keep working.
  taxInvoices = null,
  // ใบเสร็จคำสั่งซื้อ approval gate + payment channel (order-receipts.mjs).
  orderReceipts = null,
}) {
  /** Ready-stock order or preorder row, with product + option, or null. */
  function loadOrderRow(orderId) {
    const select = (table) =>
      one(
        `SELECT o.*,p.id AS product_id,p.name AS product,p.usage_instructions,v.label AS option_label
         FROM ${table} o JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id
         WHERE o.id=?`,
        orderId,
      );
    const order = select("orders");
    if (order) return { ...order, preorder: false };
    const reservation = select("reservations");
    return reservation ? { ...reservation, preorder: true } : null;
  }

  /** First delivery time: reservations keep it; ready stock uses the first unit's sold_at. */
  function deliveredAtOf(row) {
    if (row.status !== "DELIVERED") return null;
    if (row.delivered_at) return row.delivered_at;
    return (
      one(
        `SELECT MIN(sold_at) AS t FROM inventory WHERE ${row.preorder ? "reservation_id" : "order_id"}=?`,
        row.id,
      )?.t ?? row.created_at
    );
  }

  /**
   * Extra fields for the buyer's own order page. Usage instructions and the delivery
   * date only once the order is delivered.
   */
  function customerOrderExtras(orderId, ownerView) {
    if (!ownerView) return {};
    const row = loadOrderRow(orderId);
    if (!row || row.status !== "DELIVERED") return {};
    return {
      usageInstructions: row.usage_instructions || null,
      deliveredAt: deliveredAtOf(row),
    };
  }

  // ------------------------------------------------------------ report issue

  const dbTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

  /**
   * Validates an order link on a customer chat message. Returns null when the message
   * is not a report, else { orderId, reason }. Only the owner of a delivered order can
   * report it, at most REPORTS_PER_ORDER_PER_DAY times in 24 hours.
   */
  function chatReportLink(user, input) {
    if (input?.orderId === undefined || input?.orderId === null || input?.orderId === "")
      return null;
    if (isStaff(user)) fail(400, "แจ้งปัญหาได้เฉพาะลูกค้าเจ้าของออเดอร์");
    const orderId = clean(input.orderId, 1, 80, "คำสั่งซื้อ");
    const reason = typeof input.reportReason === "string" ? input.reportReason : "";
    if (!REPORT_REASONS[reason]) fail(400, "กรุณาเลือกอาการที่พบ");
    const row = loadOrderRow(orderId);
    if (!row || row.user_id !== user.id) fail(404, "ไม่พบคำสั่งซื้อ");
    if (row.status !== "DELIVERED") fail(409, "แจ้งปัญหาได้เฉพาะออเดอร์ที่ได้รับสินค้าแล้ว");
    const recent = one(
      "SELECT COUNT(*) AS n FROM chat_messages WHERE order_id=? AND report_reason IS NOT NULL AND created_at>?",
      orderId,
      dbTime(clock() - 86400000),
    ).n;
    if (recent >= REPORTS_PER_ORDER_PER_DAY)
      fail(
        429,
        `แจ้งปัญหาออเดอร์นี้ครบ ${REPORTS_PER_ORDER_PER_DAY} ครั้งใน 24 ชั่วโมงแล้ว กรุณารอทีมงานตอบในแชท`,
      );
    return { orderId, reason };
  }

  /** Stores the link on the new message and marks the thread with the latest order. */
  function attachChatReport(threadId, messageId, link) {
    if (!link) return;
    run(
      "UPDATE chat_messages SET order_id=?,report_reason=? WHERE id=?",
      link.orderId,
      link.reason,
      messageId,
    );
    run("UPDATE chat_threads SET order_id=? WHERE id=?", link.orderId, threadId);
  }

  // ----------------------------------------------------------------- receipt

  function shopBlock() {
    const s = settings() ?? {};
    const legacy = {
      name: typeof s.shopName === "string" && s.shopName !== "ร้านค้า" ? s.shopName : "ASIA EXTRA",
      legalName: firstText(s, SETTINGS_ALIASES.legalName),
      taxId: firstText(s, SETTINGS_ALIASES.taxId),
      address: firstText(s, SETTINGS_ALIASES.address),
      email: firstText(s, ["email", "contactEmail"]),
      phone: firstText(s, ["phone"]),
      line: firstText(s, ["line"]),
      vatRegistered: s.vatRegistered === true,
    };
    // ตั้งค่า › ใบเสร็จและใบกำกับภาษี first; the older shop settings fields are the fallback.
    return taxInvoices ? { ...legacy, ...taxInvoices.sellerBlock(legacy) } : legacy;
  }

  function paymentOf(row) {
    const column = row.preorder ? "reservation_id" : "order_id";
    const paid = one(
      `SELECT MIN(COALESCE(finalized_at,created_at)) AS at, COUNT(*) AS n FROM payments WHERE ${column}=? AND status='SUCCEEDED'`,
      row.id,
    );
    const paidState = paid.n > 0 || row.status === "DELIVERED" || row.status === "PREORDER";
    const status = paidState
      ? "PAID"
      : row.status === "PENDING_PAYMENT"
        ? "PENDING"
        : row.status === "CANCELLED"
          ? "CANCELLED"
          : "UNPAID";
    return { status, paidAt: paid.at ?? null };
  }

  function buildReceipt(row, { includeRefund }) {
    const customer = one("SELECT name,email FROM users WHERE id=?", row.user_id) ?? {};
    const discount = optionalAmount(row, ["discount", "discount_total", "discount_amount"]);
    const subtotal = optionalAmount(row, ["subtotal"]) || row.total + discount;
    const payment = paymentOf(row);
    const refund = includeRefund
      ? orderRefundState(row.id, row.preorder)
      : { refundStatus: null, refundedTotal: 0 };
    return {
      id: row.id,
      number: row.id.slice(0, 8).toUpperCase(),
      preorder: row.preorder,
      status: row.status,
      createdAt: row.created_at,
      paidAt: payment.paidAt,
      deliveredAt: deliveredAtOf(row),
      issuedAt: dbTime(clock()),
      shop: shopBlock(),
      customer: {
        name: customer.name ?? "",
        // Placeholder addresses of system accounts are not shown on paper.
        email: customer.email && !customer.email.endsWith(".local") ? customer.email : "",
      },
      item: {
        product: row.product,
        option: row.option_label,
        quantity: row.quantity,
        unitPrice: Math.round(subtotal / row.quantity),
        subtotal,
        discount,
        couponCode: typeof row.coupon_code === "string" ? row.coupon_code : null,
      },
      total: row.total,
      paymentStatus: payment.status,
      refundStatus: refund.refundStatus ?? null,
      refundedTotal: refund.refundedTotal ?? 0,
      paymentMethodLabel: orderReceipts?.paymentMethodLabelForOrder?.(row) ?? null,
      // Buyer block (ใบเสร็จรับเงิน / approved order-receipt) + tax invoice number.
      ...(taxInvoices ? taxInvoices.receiptExtras(row) : {}),
      ...(orderReceipts ? orderReceipts.receiptExtras(row) : {}),
    };
  }

  /** GET /api/orders/:id/receipt — the buyer's own order only; gated until approved. */
  function orderReceipt(user, id) {
    requireUser(user);
    const orderId = clean(id, 1, 80, "คำสั่งซื้อ");
    const row = loadOrderRow(orderId);
    if (!row || row.user_id !== user.id) fail(404, "ไม่พบคำสั่งซื้อ");
    if (orderReceipts) orderReceipts.assertCustomerDownload(user, orderId);
    return buildReceipt(row, { includeRefund: true });
  }

  /** GET /api/admin/orders/:id/receipt — staff; refund figures stay ADMIN-only. */
  function adminOrderReceipt(user, id) {
    requireStaff(user);
    const orderId = clean(id, 1, 80, "คำสั่งซื้อ");
    const row = loadOrderRow(orderId);
    if (!row) fail(404, "ไม่พบคำสั่งซื้อ");
    return buildReceipt(row, { includeRefund: isAdmin(user) });
  }

  return {
    customerOrderExtras,
    chatReportLink,
    attachChatReport,
    orderReceipt,
    adminOrderReceipt,
  };
}
