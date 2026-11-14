/**
 * Coupons / discount codes.
 *
 * Money rules (see docs/modules/finance-money-rules.md):
 *  - The discount is worked out on the server only, from the coupon row and the
 *    variant price in the database. A price or discount sent by the client is never read.
 *  - createOrder re-validates the code inside its own transaction and stores
 *    `discount` (satang) and `coupon_code` on the order or preorder. `total` is the
 *    discounted amount, so pay (amount == total), refunds (cap = paid − refunded),
 *    revenue (payments − refunds) and receipts all agree without extra rules.
 *  - The discount never takes a total below MIN_PAYABLE (฿1): orders.total has
 *    CHECK(total > 0) and a ฿0 order would skip the payment step.
 *  - Limits count redemption rows whose released_at is NULL. The count and the insert
 *    run in the createOrder transaction (BEGIN IMMEDIATE / Durable Object
 *    transactionSync), so two orders can never both take the last use.
 *
 * releaseCouponForOrder(orderId, reason) — see the comment on the function.
 */
export const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$/;
/** Smallest amount a discounted order may cost, in satang (฿1). */
export const MIN_PAYABLE = 100;
const MAX_MONEY = 10_000_000; // ฿100,000 in satang
const BKK_MS = 7 * 3600000;

/** Upper-case, trimmed code, or "" when the input is not a string. */
export const normalizeCouponCode = (value) =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const thb = (satang) => {
  const baht = satang / 100;
  return (
    "฿" +
    baht.toLocaleString("en-US", {
      minimumFractionDigits: Number.isInteger(baht) ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
};
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const msOf = (sql) => Date.parse(sql.replace(" ", "T") + "Z");
/** UTC "YYYY-MM-DD HH:MM:SS" → Bangkok wall time "YYYY-MM-DDTHH:MM" (form value). */
export const bangkokLocal = (sql) =>
  sql ? new Date(msOf(sql) + BKK_MS).toISOString().slice(0, 16) : null;
/** Thai date + time in Bangkok, e.g. "1 ธ.ค. 2569 00:00". */
const thaiDateTime = (sql) =>
  new Date(msOf(sql)).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function createCouponApis({
  requireAdmin,
  requireUser,
  one,
  all,
  run,
  tx,
  fail,
  clean,
  randomUUID,
  clock = () => Date.now(),
  moneyScope,
}) {
  const now = () => sqlTime(clock());
  const audit = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      detail ? JSON.stringify(detail) : null,
    );
  const reject = (message) => fail(400, message);

  // ------------------------------------------------------------------ evaluation

  const activeUses = (couponId) =>
    one(
      "SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id=? AND released_at IS NULL",
      couponId,
    ).n;
  const activeUserUses = (couponId, userId) =>
    one(
      "SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id=? AND user_id=? AND released_at IS NULL",
      couponId,
      userId,
    ).n;
  /** A paid order or preorder already exists for this customer. */
  const hasPaidOrder = (userId) =>
    !!one(
      `SELECT 1 AS x FROM orders WHERE user_id=? AND status='DELIVERED'
       UNION ALL SELECT 1 FROM reservations WHERE user_id=? AND status IN ('PREORDER','DELIVERED')
       UNION ALL SELECT 1 FROM payments WHERE user_id=? AND status='SUCCEEDED'
       LIMIT 1`,
      userId,
      userId,
      userId,
    );

  /** Discount in satang before the ฿1 floor. */
  const rawDiscount = (coupon, subtotal) => {
    if (coupon.type === "PERCENT") {
      const d = Math.floor((subtotal * coupon.value) / 100);
      return coupon.max_discount ? Math.min(d, coupon.max_discount) : d;
    }
    return Math.min(coupon.value, subtotal);
  };

  /**
   * Validate `code` for one line (product + subtotal in satang) and the signed-in
   * customer. Throws ApiError(400) with a Thai reason the customer can act on.
   * Must run inside the order transaction when the result is used to place an order.
   */
  function evaluate(user, rawCode, { productId, subtotal }) {
    const code = normalizeCouponCode(rawCode);
    if (!code) reject("กรุณาใส่โค้ดส่วนลด");
    if (!COUPON_CODE_RE.test(code)) reject("ไม่พบโค้ดส่วนลดนี้");
    const coupon = one("SELECT * FROM coupons WHERE code=?", code);
    if (!coupon) reject("ไม่พบโค้ดส่วนลดนี้");
    const at = now();
    if (!coupon.active) reject("โค้ดนี้ถูกปิดใช้งานแล้ว");
    if (coupon.starts_at && at < coupon.starts_at)
      reject("โค้ดนี้ยังไม่เริ่มใช้ เริ่มใช้ได้ " + thaiDateTime(coupon.starts_at));
    if (coupon.ends_at && at > coupon.ends_at) reject("โค้ดนี้หมดอายุแล้ว");
    if (coupon.usage_limit != null && activeUses(coupon.id) >= coupon.usage_limit)
      reject("โค้ดนี้ถูกใช้ครบจำนวนแล้ว");
    if (
      coupon.scope === "PRODUCTS" &&
      !one(
        "SELECT 1 AS x FROM coupon_products WHERE coupon_id=? AND product_id=?",
        coupon.id,
        productId,
      )
    )
      reject("โค้ดนี้ใช้กับสินค้านี้ไม่ได้");
    if (coupon.per_user_limit != null && activeUserUses(coupon.id, user.id) >= coupon.per_user_limit)
      reject(
        coupon.per_user_limit === 1
          ? "คุณใช้โค้ดนี้ไปแล้ว"
          : "คุณใช้โค้ดนี้ครบ " + coupon.per_user_limit + " ครั้งแล้ว",
      );
    if (coupon.first_order_only && hasPaidOrder(user.id))
      reject("โค้ดนี้ใช้ได้เฉพาะคำสั่งซื้อแรกของบัญชีเท่านั้น");
    if (subtotal < coupon.min_total)
      reject(
        "ยอดสั่งซื้อขั้นต่ำ " +
          thb(coupon.min_total) +
          " (ขาดอีก " +
          thb(coupon.min_total - subtotal) +
          ")",
      );
    const discount = Math.min(rawDiscount(coupon, subtotal), subtotal - MIN_PAYABLE);
    if (discount <= 0)
      reject("ยอดสั่งซื้อนี้ใช้โค้ดไม่ได้ ต้องชำระอย่างน้อย " + thb(MIN_PAYABLE));
    return { coupon, code: coupon.code, subtotal, discount, total: subtotal - discount };
  }

  /**
   * Basket coupon: min_total / % / max_discount against the sum of eligible lines
   * (scope ALL = all lines; PRODUCTS = matching products only). Discount is split
   * by subtotal share; leftover satang goes to the last eligible line. Each line
   * stays at least MIN_PAYABLE.
   * `lines` = [{ variantId, productId, subtotal, quantity? }]
   */
  function evaluateBasket(user, rawCode, lines = []) {
    if (!Array.isArray(lines) || !lines.length) reject("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ");
    const code = normalizeCouponCode(rawCode);
    if (!code) reject("กรุณาใส่โค้ดส่วนลด");
    if (!COUPON_CODE_RE.test(code)) reject("ไม่พบโค้ดส่วนลดนี้");
    const coupon = one("SELECT * FROM coupons WHERE code=?", code);
    if (!coupon) reject("ไม่พบโค้ดส่วนลดนี้");
    const at = now();
    if (!coupon.active) reject("โค้ดนี้ถูกปิดใช้งานแล้ว");
    if (coupon.starts_at && at < coupon.starts_at)
      reject("โค้ดนี้ยังไม่เริ่มใช้ เริ่มใช้ได้ " + thaiDateTime(coupon.starts_at));
    if (coupon.ends_at && at > coupon.ends_at) reject("โค้ดนี้หมดอายุแล้ว");
    if (coupon.usage_limit != null && activeUses(coupon.id) >= coupon.usage_limit)
      reject("โค้ดนี้ถูกใช้ครบจำนวนแล้ว");
    if (coupon.per_user_limit != null && activeUserUses(coupon.id, user.id) >= coupon.per_user_limit)
      reject(
        coupon.per_user_limit === 1
          ? "คุณใช้โค้ดนี้ไปแล้ว"
          : "คุณใช้โค้ดนี้ครบ " + coupon.per_user_limit + " ครั้งแล้ว",
      );
    if (coupon.first_order_only && hasPaidOrder(user.id))
      reject("โค้ดนี้ใช้ได้เฉพาะคำสั่งซื้อแรกของบัญชีเท่านั้น");

    const eligible = [];
    for (const line of lines) {
      if (!line || typeof line.variantId !== "string" || typeof line.productId !== "string")
        reject("สินค้าไม่ถูกต้อง");
      const subtotal = Math.trunc(Number(line.subtotal) || 0);
      if (subtotal <= 0) reject("ยอดสินค้าไม่ถูกต้อง");
      if (coupon.scope === "PRODUCTS") {
        if (
          !one(
            "SELECT 1 AS x FROM coupon_products WHERE coupon_id=? AND product_id=?",
            coupon.id,
            line.productId,
          )
        )
          continue;
      }
      eligible.push({
        variantId: line.variantId,
        productId: line.productId,
        subtotal,
        index: line.index,
      });
    }
    if (!eligible.length) reject("โค้ดนี้ใช้กับสินค้าในตะกร้าไม่ได้");
    const basketSubtotal = eligible.reduce((n, l) => n + l.subtotal, 0);
    if (basketSubtotal < coupon.min_total)
      reject(
        "ยอดสั่งซื้อขั้นต่ำ " +
          thb(coupon.min_total) +
          " (ขาดอีก " +
          thb(coupon.min_total - basketSubtotal) +
          ")",
      );
    const maxDiscount = basketSubtotal - eligible.length * MIN_PAYABLE;
    if (maxDiscount <= 0)
      reject("ยอดสั่งซื้อนี้ใช้โค้ดไม่ได้ ต้องชำระอย่างน้อย " + thb(MIN_PAYABLE));
    let discount = Math.min(rawDiscount(coupon, basketSubtotal), maxDiscount);
    if (discount <= 0)
      reject("ยอดสั่งซื้อนี้ใช้โค้ดไม่ได้ ต้องชำระอย่างน้อย " + thb(MIN_PAYABLE));

    const allocated = eligible.map((l) => ({ ...l, discount: 0 }));
    let left = discount;
    for (let i = 0; i < allocated.length; i++) {
      const isLast = i === allocated.length - 1;
      let share = isLast ? left : Math.floor((discount * allocated[i].subtotal) / basketSubtotal);
      const cap = allocated[i].subtotal - MIN_PAYABLE;
      if (share > cap) share = Math.max(0, cap);
      allocated[i].discount = share;
      left -= share;
    }
    if (left > 0) {
      for (let i = allocated.length - 1; i >= 0 && left > 0; i--) {
        const room = allocated[i].subtotal - MIN_PAYABLE - allocated[i].discount;
        const add = Math.min(Math.max(0, room), left);
        allocated[i].discount += add;
        left -= add;
      }
    }
    discount = allocated.reduce((n, l) => n + l.discount, 0);
    if (discount <= 0)
      reject("ยอดสั่งซื้อนี้ใช้โค้ดไม่ได้ ต้องชำระอย่างน้อย " + thb(MIN_PAYABLE));
    return {
      coupon,
      code: coupon.code,
      subtotal: basketSubtotal,
      discount,
      total: basketSubtotal - discount,
      lines: allocated.map((l) => ({
        variantId: l.variantId,
        discount: l.discount,
        subtotal: l.subtotal,
        index: l.index,
      })),
    };
  }

  /** Write the redemption row for a new order (call inside the order transaction). */
  function redeem({ coupon, userId, orderId = null, reservationId = null, checkoutId = null, amount }) {
    run(
      "INSERT INTO coupon_redemptions(id,coupon_id,code,user_id,order_id,reservation_id,amount,created_at,checkout_id) VALUES(?,?,?,?,?,?,?,?,?)",
      randomUUID(),
      coupon.id,
      coupon.code,
      userId,
      orderId,
      reservationId,
      amount,
      now(),
      checkoutId ?? null,
    );
  }

  /**
   * releaseCouponForOrder(orderId, reason?) → { released, code, amount }
   *
   * Gives the coupon use back when an order or preorder ends WITHOUT being paid
   * (admin cancel, failed payment, out of stock at pay time, auto-expiry of unpaid
   * orders). Contract:
   *  - orderId is an orders.id or reservations.id. Unknown ids and orders without a
   *    coupon return { released: false }.
   *  - Idempotent: a second call returns { released: false } and changes nothing.
   *  - Never releases an order that has a SUCCEEDED payment (a paid-then-refunded
   *    order keeps its use; refunds already cap at the discounted paid amount).
   *  - Does not open its own transaction: one guarded UPDATE, so it is atomic on its
   *    own. Call it inside the same transaction that moves the order to its unpaid
   *    terminal status, so both commit or neither does.
   *  - The order row keeps `discount` and `coupon_code` as a record of what was offered.
   */
  function releaseCouponForOrder(orderId, reason = "CANCELLED") {
    let row = one(
      `SELECT r.id,r.code,r.amount,r.checkout_id FROM coupon_redemptions r
       WHERE (r.order_id=? OR r.reservation_id=?) AND r.released_at IS NULL`,
      orderId,
      orderId,
    );
    if (!row) {
      const checkoutId = one(
        `SELECT checkout_id FROM orders WHERE id=? AND checkout_id IS NOT NULL
         UNION ALL SELECT checkout_id FROM reservations WHERE id=? AND checkout_id IS NOT NULL`,
        orderId,
        orderId,
      )?.checkout_id;
      if (checkoutId)
        row = one(
          `SELECT r.id,r.code,r.amount,r.checkout_id FROM coupon_redemptions r
           WHERE r.checkout_id=? AND r.released_at IS NULL`,
          checkoutId,
        );
    }
    if (!row) return { released: false, code: null, amount: 0 };

    if (row.checkout_id) {
      // Basket redemption: release only when nothing in the checkout was paid and no
      // coupon line is still waiting to pay (cancel / expire / OOS every discounted line).
      const paid = one(
        `SELECT 1 AS x FROM payments p
         JOIN orders o ON o.id=p.order_id AND o.checkout_id=?
         WHERE p.status='SUCCEEDED'
         UNION ALL
         SELECT 1 FROM payments p
         JOIN reservations r ON r.id=p.reservation_id AND r.checkout_id=?
         WHERE p.status='SUCCEEDED'
         LIMIT 1`,
        row.checkout_id,
        row.checkout_id,
      );
      if (paid) return { released: false, code: null, amount: 0 };
      const pending = one(
        `SELECT 1 AS x FROM orders
         WHERE checkout_id=? AND status='PENDING_PAYMENT' AND COALESCE(coupon_code,'')!=''
         UNION ALL
         SELECT 1 FROM reservations
         WHERE checkout_id=? AND status='PENDING_PAYMENT' AND COALESCE(coupon_code,'')!=''
         LIMIT 1`,
        row.checkout_id,
        row.checkout_id,
      );
      if (pending) return { released: false, code: null, amount: 0 };
    } else {
      const paid = one(
        `SELECT 1 AS x FROM payments p
         WHERE (p.order_id=? OR p.reservation_id=?) AND p.status='SUCCEEDED'`,
        orderId,
        orderId,
      );
      if (paid) return { released: false, code: null, amount: 0 };
    }

    const changed = run(
      "UPDATE coupon_redemptions SET released_at=?, released_reason=? WHERE id=? AND released_at IS NULL",
      now(),
      String(reason ?? "CANCELLED").slice(0, 60),
      row.id,
    ).changes;
    return { released: !!changed, code: row.code, amount: changed ? row.amount : 0 };
  }

  // ------------------------------------------------------------------ admin

  const statusOf = (coupon, uses, at = now()) => {
    if (!coupon.active) return "disabled";
    if (coupon.ends_at && at > coupon.ends_at) return "expired";
    if (coupon.usage_limit != null && uses >= coupon.usage_limit) return "used_up";
    if (coupon.starts_at && at < coupon.starts_at) return "scheduled";
    return "active";
  };
  const paidRedemptionSql = `EXISTS (SELECT 1 FROM payments p
      WHERE (p.order_id=r.order_id OR p.reservation_id=r.reservation_id) AND p.status='SUCCEEDED'${
        moneyScope ? " AND " + moneyScope.payment("p.") : ""
      })`;
  function publicCoupon(row, at = now()) {
    const stats = one(
      `SELECT COUNT(*) AS uses,
              COALESCE(SUM(CASE WHEN ${paidRedemptionSql} THEN r.amount ELSE 0 END),0) AS given,
              COALESCE(SUM(CASE WHEN ${paidRedemptionSql} THEN 1 ELSE 0 END),0) AS paid
       FROM coupon_redemptions r WHERE r.coupon_id=? AND r.released_at IS NULL`,
      row.id,
    );
    const products = all(
      `SELECT cp.product_id AS id, p.name FROM coupon_products cp
       LEFT JOIN products p ON p.id=cp.product_id WHERE cp.coupon_id=? ORDER BY p.name`,
      row.id,
    );
    return {
      id: row.id,
      code: row.code,
      type: row.type,
      value: row.value,
      maxDiscount: row.max_discount ?? null,
      minTotal: row.min_total,
      startsAt: row.starts_at ?? null,
      endsAt: row.ends_at ?? null,
      startsAtLocal: bangkokLocal(row.starts_at),
      endsAtLocal: bangkokLocal(row.ends_at),
      usageLimit: row.usage_limit ?? null,
      perUserLimit: row.per_user_limit ?? null,
      scope: row.scope,
      products: products.map((p) => ({ id: p.id, name: p.name ?? p.id })),
      firstOrderOnly: !!row.first_order_only,
      active: !!row.active,
      createdBy: row.created_by_name ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? null,
      uses: stats.uses,
      paidUses: stats.paid,
      discountGiven: stats.given,
      status: statusOf(row, stats.uses, at),
    };
  }
  const loadRow = (id) =>
    one(
      "SELECT c.*,u.name AS created_by_name FROM coupons c LEFT JOIN users u ON u.id=c.created_by WHERE c.id=?",
      id,
    );
  const STATUSES = ["active", "scheduled", "expired", "used_up", "disabled"];

  function adminCoupons(user, query = {}) {
    requireAdmin(user);
    const q = String(query.q ?? "").trim().toUpperCase().slice(0, 32);
    const status = String(query.status ?? "").trim();
    if (status && !STATUSES.includes(status)) fail(400, "สถานะไม่ถูกต้อง");
    const at = now();
    const rows = all(
      `SELECT c.*,u.name AS created_by_name FROM coupons c LEFT JOIN users u ON u.id=c.created_by
       ${q ? "WHERE c.code LIKE ? ESCAPE '\\'" : ""}
       ORDER BY c.created_at DESC, c.rowid DESC LIMIT 500`,
      ...(q ? ["%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%"] : []),
    ).map((row) => publicCoupon(row, at));
    const counts = { all: rows.length };
    for (const key of STATUSES) counts[key] = rows.filter((c) => c.status === key).length;
    return { coupons: status ? rows.filter((c) => c.status === status) : rows, counts };
  }

  function adminCoupon(user, id) {
    requireAdmin(user);
    const row = loadRow(clean(id, 1, 80, "คูปอง"));
    if (!row) fail(404, "ไม่พบคูปอง");
    return { coupon: publicCoupon(row) };
  }

  /** Bangkok wall time from the form ("YYYY-MM-DDTHH:MM" or a date) → UTC SQL. */
  function bangkokInput(value, label, endOfDay) {
    if (value == null || value === "") return null;
    const text = String(value).trim();
    let ms;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text))
      ms = Date.parse(text + (endOfDay ? "T23:59:59" : "T00:00:00") + "+07:00");
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text))
      ms = Date.parse(text + (text.length === 16 ? (endOfDay ? ":59" : ":00") : "") + "+07:00");
    if (!Number.isFinite(ms)) fail(400, label + "ไม่ถูกต้อง");
    return sqlTime(ms);
  }
  const optionalInt = (value, min, max, label) => {
    if (value == null || value === "") return null;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) fail(400, label + "ไม่ถูกต้อง");
    return n;
  };
  const bool = (value, fallback) =>
    value === undefined ? fallback : value === true || value === 1 || value === "on";

  /** Validated column values from the admin form (money fields in satang). */
  function parseInput(input, current = null) {
    const pick = (key, fallback) => (input[key] === undefined ? fallback : input[key]);
    const code = normalizeCouponCode(pick("code", current?.code ?? ""));
    if (!COUPON_CODE_RE.test(code))
      fail(400, "โค้ดต้องเป็น A–Z, 0–9 หรือ - ยาว 3–32 ตัว และไม่ขึ้นต้นหรือลงท้ายด้วย -");
    const type = String(pick("type", current?.type ?? ""));
    if (!["PERCENT", "FIXED"].includes(type)) fail(400, "กรุณาเลือกประเภทส่วนลด");
    const value =
      type === "PERCENT"
        ? optionalInt(pick("value", current?.value), 1, 90, "เปอร์เซ็นต์ส่วนลด (1–90) ")
        : optionalInt(pick("value", current?.value), MIN_PAYABLE, MAX_MONEY, "จำนวนเงินส่วนลด ");
    if (value == null) fail(400, type === "PERCENT" ? "กรุณาใส่เปอร์เซ็นต์ส่วนลด" : "กรุณาใส่จำนวนเงินส่วนลด");
    const maxDiscount =
      type === "PERCENT"
        ? optionalInt(pick("maxDiscount", current?.max_discount), MIN_PAYABLE, MAX_MONEY, "ส่วนลดสูงสุด ")
        : null;
    const minTotal = optionalInt(pick("minTotal", current?.min_total), 0, MAX_MONEY, "ยอดขั้นต่ำ ") ?? 0;
    const startsAt =
      input.startsAt === undefined ? (current?.starts_at ?? null) : bangkokInput(input.startsAt, "วันเริ่ม", false);
    const endsAt =
      input.endsAt === undefined ? (current?.ends_at ?? null) : bangkokInput(input.endsAt, "วันหมดอายุ", true);
    if (startsAt && endsAt && endsAt <= startsAt) fail(400, "วันหมดอายุต้องอยู่หลังวันเริ่ม");
    const usageLimit = optionalInt(pick("usageLimit", current?.usage_limit), 1, 1_000_000, "จำนวนสิทธิ์ทั้งหมด ");
    const perUserLimit = optionalInt(pick("perUserLimit", current?.per_user_limit), 1, 1000, "จำนวนครั้งต่อคน ");
    const scope = String(pick("scope", current?.scope ?? "ALL"));
    if (!["ALL", "PRODUCTS"].includes(scope)) fail(400, "ขอบเขตสินค้าไม่ถูกต้อง");
    let productIds = [];
    if (scope === "PRODUCTS") {
      const raw =
        input.productIds === undefined && current
          ? all("SELECT product_id FROM coupon_products WHERE coupon_id=?", current.id).map((r) => r.product_id)
          : input.productIds;
      if (!Array.isArray(raw) || raw.length === 0) fail(400, "กรุณาเลือกสินค้าที่ใช้โค้ดได้อย่างน้อย 1 รายการ");
      if (raw.length > 200) fail(400, "เลือกสินค้าได้ไม่เกิน 200 รายการ");
      productIds = [...new Set(raw.map((v) => clean(v, 1, 80, "สินค้า")))];
      for (const pid of productIds)
        if (!one("SELECT id FROM products WHERE id=?", pid)) fail(400, "ไม่พบสินค้า " + pid);
    }
    return {
      code,
      type,
      value,
      max_discount: maxDiscount,
      min_total: minTotal,
      starts_at: startsAt,
      ends_at: endsAt,
      usage_limit: usageLimit,
      per_user_limit: perUserLimit,
      scope,
      first_order_only: bool(input.firstOrderOnly, !!current?.first_order_only) ? 1 : 0,
      active: bool(input.active, current ? !!current.active : true) ? 1 : 0,
      productIds,
    };
  }
  const assertCodeFree = (code, exceptId = null) => {
    const taken = one("SELECT id FROM coupons WHERE code=?", code);
    if (taken && taken.id !== exceptId) fail(409, "โค้ด " + code + " มีอยู่แล้ว");
  };
  const writeProducts = (couponId, productIds) => {
    run("DELETE FROM coupon_products WHERE coupon_id=?", couponId);
    for (const pid of productIds)
      run("INSERT INTO coupon_products(coupon_id,product_id) VALUES(?,?)", couponId, pid);
  };
  const insertCoupon = (user, values) => {
    const id = randomUUID();
    run(
      `INSERT INTO coupons(id,code,type,value,max_discount,min_total,starts_at,ends_at,usage_limit,
         per_user_limit,scope,first_order_only,active,created_by,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      values.code,
      values.type,
      values.value,
      values.max_discount,
      values.min_total,
      values.starts_at,
      values.ends_at,
      values.usage_limit,
      values.per_user_limit,
      values.scope,
      values.first_order_only,
      values.active,
      user.id,
      now(),
    );
    writeProducts(id, values.productIds);
    return id;
  };
  const AUDIT_FIELDS = [
    "code",
    "type",
    "value",
    "max_discount",
    "min_total",
    "starts_at",
    "ends_at",
    "usage_limit",
    "per_user_limit",
    "scope",
    "first_order_only",
    "active",
  ];

  function adminCreateCoupon(user, input = {}) {
    requireAdmin(user);
    return tx(() => {
      const values = parseInput(input);
      assertCodeFree(values.code);
      const id = insertCoupon(user, values);
      const detail = Object.fromEntries(AUDIT_FIELDS.map((f) => [f, values[f]]));
      if (values.productIds.length) detail.products = values.productIds.length;
      audit(user, "COUPON_CREATE", id, detail);
      return { coupon: publicCoupon(loadRow(id)) };
    });
  }

  function adminUpdateCoupon(user, id, input = {}) {
    requireAdmin(user);
    const couponId = clean(id, 1, 80, "คูปอง");
    return tx(() => {
      const current = loadRow(couponId);
      if (!current) fail(404, "ไม่พบคูปอง");
      const values = parseInput(input, current);
      assertCodeFree(values.code, couponId);
      const beforeProducts = all(
        "SELECT product_id FROM coupon_products WHERE coupon_id=? ORDER BY product_id",
        couponId,
      ).map((r) => r.product_id);
      run(
        `UPDATE coupons SET code=?,type=?,value=?,max_discount=?,min_total=?,starts_at=?,ends_at=?,
           usage_limit=?,per_user_limit=?,scope=?,first_order_only=?,active=?,updated_at=? WHERE id=?`,
        values.code,
        values.type,
        values.value,
        values.max_discount,
        values.min_total,
        values.starts_at,
        values.ends_at,
        values.usage_limit,
        values.per_user_limit,
        values.scope,
        values.first_order_only,
        values.active,
        now(),
        couponId,
      );
      writeProducts(couponId, values.productIds);
      const changed = {};
      for (const field of AUDIT_FIELDS)
        if ((current[field] ?? null) !== (values[field] ?? null))
          changed[field] = { from: current[field] ?? null, to: values[field] ?? null };
      const afterProducts = [...values.productIds].sort();
      if (JSON.stringify(beforeProducts) !== JSON.stringify(afterProducts))
        changed.products = { from: beforeProducts.length, to: afterProducts.length };
      audit(user, current.active && !values.active ? "COUPON_DISABLE" : "COUPON_UPDATE", couponId, {
        code: values.code,
        changed,
      });
      return { coupon: publicCoupon(loadRow(couponId)) };
    });
  }

  function adminDisableCoupon(user, id) {
    requireAdmin(user);
    const couponId = clean(id, 1, 80, "คูปอง");
    return tx(() => {
      const current = loadRow(couponId);
      if (!current) fail(404, "ไม่พบคูปอง");
      if (current.active) {
        run("UPDATE coupons SET active=0, updated_at=? WHERE id=?", now(), couponId);
        audit(user, "COUPON_DISABLE", couponId, { code: current.code });
      }
      return { coupon: publicCoupon(loadRow(couponId)) };
    });
  }

  /** Copy as a new, switched-off coupon with a free code (CODE-COPY, CODE-COPY2…). */
  function adminDuplicateCoupon(user, id) {
    requireAdmin(user);
    const couponId = clean(id, 1, 80, "คูปอง");
    return tx(() => {
      const source = loadRow(couponId);
      if (!source) fail(404, "ไม่พบคูปอง");
      let code = "";
      for (let n = 1; n < 100 && !code; n++) {
        const suffix = "-COPY" + (n === 1 ? "" : n);
        const candidate = source.code.slice(0, 32 - suffix.length).replace(/-+$/, "") + suffix;
        if (!one("SELECT id FROM coupons WHERE code=?", candidate)) code = candidate;
      }
      if (!code) fail(409, "ตั้งชื่อโค้ดสำเนาไม่ได้ กรุณาสร้างใหม่");
      const productIds = all("SELECT product_id FROM coupon_products WHERE coupon_id=?", couponId).map(
        (r) => r.product_id,
      );
      const newId = insertCoupon(user, { ...source, code, active: 0, productIds });
      audit(user, "COUPON_CREATE", newId, { code, duplicatedFrom: source.code, active: 0 });
      return { coupon: publicCoupon(loadRow(newId)) };
    });
  }

  function adminCouponRedemptions(user, id) {
    requireAdmin(user);
    const couponId = clean(id, 1, 80, "คูปอง");
    if (!one("SELECT id FROM coupons WHERE id=?", couponId)) fail(404, "ไม่พบคูปอง");
    return {
      redemptions: all(
        `SELECT r.id,r.code,r.amount,r.created_at,r.released_at,r.released_reason,
                COALESCE(r.order_id,r.reservation_id) AS order_id,
                CASE WHEN r.reservation_id IS NOT NULL THEN 1 ELSE 0 END AS preorder,
                COALESCE(o.status,v.status) AS order_status,
                COALESCE(o.total,v.total) AS order_total,
                u.id AS customer_id,u.name AS customer,u.email AS customer_email,
                ${paidRedemptionSql} AS paid
         FROM coupon_redemptions r
         LEFT JOIN orders o ON o.id=r.order_id
         LEFT JOIN reservations v ON v.id=r.reservation_id
         LEFT JOIN users u ON u.id=r.user_id
         WHERE r.coupon_id=?
         ORDER BY r.created_at DESC, r.rowid DESC LIMIT 500`,
        couponId,
      ).map((r) => ({ ...r, preorder: !!r.preorder, paid: !!r.paid })),
    };
  }

  return {
    evaluate,
    evaluateBasket,
    redeem,
    releaseCouponForOrder,
    adminCoupons,
    adminCoupon,
    adminCreateCoupon,
    adminUpdateCoupon,
    adminDisableCoupon,
    adminDuplicateCoupon,
    adminCouponRedemptions,
  };
}
