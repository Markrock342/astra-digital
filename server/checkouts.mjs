/**
 * Multi-item checkout: several basket lines bought together under one order number.
 *
 * Each line is still a normal order (or preorder reservation) made by createOrder, so stock,
 * delivery, refunds, receipts, warranty and expiry stay per line. A `checkouts` row ties them
 * together (orders.checkout_id / reservations.checkout_id):
 *
 *   POST /api/checkouts            { lines:[{variantId,quantity,deliveryInputs?}], requestKey }
 *   GET  /api/checkouts/:id        → { id, created_at, orders:[order detail…] }
 *   POST /api/checkouts/:id/pay    { tokens:{orderId:paymentToken}, outcome }
 *
 * Create runs in one transaction: one bad line (closed, sold out, …) creates nothing.
 * Pay checks the credit against the sum due first, then pays each unpaid line through the normal
 * `pay` (its own transaction). Multi-line success suppresses per-line email/notify and sends one
 * customer email + one customer notify + one staff notify batch (link `/checkouts/:id`).
 * A line that runs out of stock at pay time is marked OUT_OF_STOCK without a charge; that line is
 * named in the checkout email. Single-line checkouts keep per-order `/orders/:id` behaviour.
 * A basket coupon is evaluated against eligible lines (min_total / % / max_discount), then
 * split across those lines; one coupon_redemptions row is stored per checkout_id.
 * With `pay` the summary page pays in the same request; not enough credit rolls the whole
 * checkout back (no order left waiting).
 */
export const CHECKOUT_MAX_LINES = 20;

export function ensureCheckouts(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS checkouts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, request_key)
  )`);
  for (const table of ["orders", "reservations"]) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === "checkout_id")) db.exec(`ALTER TABLE ${table} ADD COLUMN checkout_id TEXT`);
    if (!cols.some((c) => c.name === "checkout_line")) db.exec(`ALTER TABLE ${table} ADD COLUMN checkout_line INTEGER`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_checkout ON ${table}(checkout_id) WHERE checkout_id IS NOT NULL`);
  }
}

export function hookCheckouts(
  service,
  {
    one,
    all,
    run,
    tx,
    fail,
    randomUUID,
    requireUser,
    publicUser,
    notify,
    notifyStaffRoles,
    quoteBasketCoupon,
    redeemBasketCoupon,
  },
) {
  const lineIds = (userId, checkoutId) =>
    all(
      `SELECT id, created_at FROM orders WHERE checkout_id=? AND user_id=?
       UNION ALL SELECT id, created_at FROM reservations WHERE checkout_id=? AND user_id=?
       ORDER BY created_at, id`,
      checkoutId,
      userId,
      checkoutId,
      userId,
    ).map((r) => r.id);

  function view(user, checkoutId) {
    const row = one("SELECT id, created_at FROM checkouts WHERE id=? AND user_id=?", checkoutId, user.id);
    if (!row) fail(404, "ไม่พบคำสั่งซื้อ");
    // Order of the basket: creation order, kept by the line number in request_key.
    const orders = lineIds(user.id, checkoutId)
      .map((id) => service.orderDetail(user, id))
      .sort((a, b) => (a.checkout_line ?? 0) - (b.checkout_line ?? 0));
    return { id: row.id, created_at: row.created_at, orders };
  }

  function cleanLines(input) {
    const lines = Array.isArray(input.lines) ? input.lines : [];
    if (!lines.length) fail(400, "กรุณาเลือกสินค้าอย่างน้อย 1 รายการ");
    if (lines.length > CHECKOUT_MAX_LINES) fail(400, `สั่งได้ครั้งละไม่เกิน ${CHECKOUT_MAX_LINES} รายการ`);
    const seen = new Set();
    for (const line of lines) {
      if (!line || typeof line.variantId !== "string") fail(400, "สินค้าไม่ถูกต้อง");
      if (seen.has(line.variantId)) fail(400, "มีสินค้าซ้ำในตะกร้า");
      seen.add(line.variantId);
    }
    return lines;
  }

  /** Basket coupon preview: { valid, code, discount, lines:[{ variantId, discount }] }. */
  service.checkoutCoupon = (user, input = {}) => {
    requireUser(user);
    service.assertEmailVerified?.(user);
    const lines = cleanLines(input);
    try {
      if (!quoteBasketCoupon) fail(500, "ระบบคูปองยังไม่พร้อม");
      const result = quoteBasketCoupon(user, input.code, lines);
      return {
        valid: true,
        code: result.code,
        discount: result.discount,
        subtotal: result.subtotal,
        total: result.total,
        lines: result.lines.map((l) => ({ variantId: l.variantId, discount: l.discount })),
      };
    } catch (error) {
      if (error && error.status === 400) return { valid: false, reason: error.message };
      throw error;
    }
  };

  service.createCheckout = (user, input = {}, options) => {
    requireUser(user);
    service.assertEmailVerified?.(user);
    const requestKey = typeof input.requestKey === "string" ? input.requestKey.trim() : "";
    if (requestKey.length < 8 || requestKey.length > 100) fail(400, "รหัสคำขอไม่ถูกต้อง");
    const lines = cleanLines(input);
    if (input.couponCode != null && typeof input.couponCode !== "string") fail(400, "โค้ดส่วนลดไม่ถูกต้อง");
    // "pay": summary page → pay in one step (sandbox outcome); nothing is left waiting when it fails.
    const payNow = input.pay === "success" || input.pay === "failure" ? input.pay : null;
    const existing = one("SELECT id FROM checkouts WHERE user_id=? AND request_key=?", user.id, requestKey);
    if (existing) return withTokens(view(user, existing.id), {});
    let basketQuote = null;
    if (input.couponCode && input.couponCode.trim()) {
      basketQuote = service.checkoutCoupon(user, { code: input.couponCode, lines });
      if (!basketQuote.valid) fail(400, basketQuote.reason);
    }
    const discountByVariant = new Map((basketQuote?.lines || []).map((l) => [l.variantId, l.discount]));
    const id = randomUUID();
    const tokens = {};
    tx(() => {
      run("INSERT INTO checkouts (id, user_id, request_key) VALUES (?,?,?)", id, user.id, requestKey);
      const created = [];
      lines.forEach((line, i) => {
        const lineDiscount = discountByVariant.has(line.variantId) ? discountByVariant.get(line.variantId) : null;
        const order = service.createOrder(user, {
          variantId: line.variantId,
          quantity: line.quantity,
          requestKey: requestKey + ":" + i,
          ...(lineDiscount != null
            ? { basketCoupon: { code: basketQuote.code, discount: lineDiscount } }
            : {}),
          ...(line.deliveryInputs ? { deliveryInputs: line.deliveryInputs } : {}),
        });
        const table = order.preorder ? "reservations" : "orders";
        run(`UPDATE ${table} SET checkout_id=?, checkout_line=? WHERE id=? AND user_id=?`, id, i, order.id, user.id);
        if (order.paymentToken) tokens[order.id] = order.paymentToken;
        created.push(order);
      });
      if (basketQuote?.valid && basketQuote.discount > 0) {
        const anchor = created.find((o) => (o.discount || 0) > 0) || created[0];
        redeemBasketCoupon?.({
          code: basketQuote.code,
          userId: user.id,
          checkoutId: id,
          orderId: anchor.preorder ? null : anchor.id,
          reservationId: anchor.preorder ? anchor.id : null,
          amount: basketQuote.discount,
        });
      }
      if (payNow === "success") {
        const sum = view(user, id).orders.reduce((n, o) => n + due(o), 0);
        if (publicUser(user).balance < sum) fail(409, "เครดิตไม่เพียงพอ กรุณาเติมเครดิตหรือเลือกช่องทางอื่น");
      }
    });
    if (payNow) return service.payCheckout(user, id, { tokens, outcome: payNow }, options);
    return withTokens(view(user, id), tokens);
  };
  const withTokens = (result, tokens) => ({
    ...result,
    orders: result.orders.map((o) => (tokens[o.id] ? { ...o, paymentToken: tokens[o.id] } : o)),
  });

  service.checkout = (user, checkoutId) => {
    requireUser(user);
    return view(user, String(checkoutId));
  };

  /** Amount a line still needs at checkout (0 = nothing to pay now). */
  const due = (o) =>
    o.status !== "PENDING_PAYMENT" ? 0 : o.preorder ? (o.amountDue ?? o.total) : o.total;

  service.payCheckout = (user, checkoutId, input = {}, options) => {
    requireUser(user);
    service.assertEmailVerified?.(user);
    const current = view(user, String(checkoutId));
    const tokens = input.tokens && typeof input.tokens === "object" ? input.tokens : {};
    const payable = current.orders.filter((o) => due(o) > 0 || (o.status === "PENDING_PAYMENT" && !o.preorder));
    if (!payable.length) return current;
    if (input.outcome === "success") {
      const sum = payable.reduce((n, o) => n + due(o), 0);
      if (publicUser(user).balance < sum) fail(409, "เครดิตทดลองไม่เพียงพอ กรุณาเติมเครดิตก่อน");
    }
    for (const o of payable) {
      if (typeof tokens[o.id] !== "string") fail(403, "ข้อมูลยืนยันการชำระเงินไม่ถูกต้อง");
    }
    const multi = payable.length > 1 && input.outcome === "success";
    for (const o of payable)
      service.pay(
        user,
        o.id,
        {
          paymentToken: tokens[o.id],
          outcome: input.outcome,
          ...(multi ? { suppressNotifications: true } : {}),
        },
        options,
      );
    const result = view(user, current.id);
    if (multi) {
      const paidOk = result.orders.filter((o) => o.status === "DELIVERED" || o.status === "PREORDER");
      const oos = result.orders.filter((o) => o.status === "OUT_OF_STOCK");
      if (paidOk.length) {
        const names = paidOk.map((o) => o.name || o.label || o.id.slice(0, 8)).join(", ");
        const oosNote = oos.length
          ? " · ของหมดไม่ได้ตัดเงิน: " + oos.map((o) => o.name || o.label || o.id.slice(0, 8)).join(", ")
          : "";
        notify?.(
          user.id,
          "code_delivery",
          "ส่งโค้ดสำเร็จ",
          "คำสั่งซื้อ " + current.id.slice(0, 8) + " · " + names + oosNote,
          "/checkouts/" + current.id,
        );
        notifyStaffRoles?.(
          "order_new",
          "ออเดอร์ใหม่",
          "คำสั่งซื้อ " + current.id.slice(0, 8) + " · " + paidOk.length + " รายการ" + oosNote,
          "/admin/orders/" + paidOk[0].id,
        );
        service.sendCheckoutConfirmation?.(current.id, options);
      } else if (oos.length) {
        // All lines OOS: still one customer note (no charge) — no success email.
        notify?.(
          user.id,
          "order",
          "สินค้าหมดขณะชำระ",
          "คำสั่งซื้อ " + current.id.slice(0, 8) + " ของหมดทุกบรรทัด ไม่ได้ตัดเงิน",
          "/checkouts/" + current.id,
        );
      }
    }
    return result;
  };
}
