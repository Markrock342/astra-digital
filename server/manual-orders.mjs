/**
 * Orders created by an ADMIN in the back office for a customer who paid outside the
 * website (bank transfer / LINE). The order goes through the same settlement code as a
 * normal paid order (domain.mjs: pickUnitsForOrder / deliverPaidOrder /
 * settlePaidReservation), so stock, warranty, credentials, notifications, alerts,
 * reports and finance treat it like any other paid order. The customer's credit is
 * never touched (it is not a credit purchase).
 *
 * Money record ("paid outside the site", kept simple so it can be reconciled later):
 *  - payments row: provider 'offsite', provider_ref 'offsite:<orderId>' in live mode.
 *    In test mode (ASTRA_TEST_PAYMENTS) it is scoped as test money like every other
 *    test payment: provider 'sandbox', provider_ref 'sandbox:offsite:<orderId>'.
 *  - ledger PAYMENT_IN row (shop money, append-only) with actor_id = the admin.
 *  - manual_orders row: method, reference, note, slip, normal vs charged price, reason.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { assertAllowedImage } from "./file-store.mjs";

/** Payment methods an admin can record. Value = Thai label shown everywhere. */
export const MANUAL_ORDER_METHODS = { OFFSITE_TRANSFER: "โอนนอกเว็บ" };
/** 100,000 THB per unit, in satang (sanity cap for a typed price). */
export const MANUAL_ORDER_MAX_UNIT_PRICE = 10_000_000;
export const MANUAL_ORDER_AUDIT = "MANUAL_ORDER_CREATE";

/** Idempotent schema (no numbered migration). Called from commerce.mjs and cloud/worker.mjs. */
export function ensureManualOrders(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS manual_orders (
    id TEXT PRIMARY KEY,
    preorder INTEGER NOT NULL DEFAULT 0 CHECK (preorder IN (0,1)),
    user_id TEXT NOT NULL,
    admin_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    coupon_code TEXT,
    method TEXT NOT NULL DEFAULT 'OFFSITE_TRANSFER' CHECK (method IN ('OFFSITE_TRANSFER')),
    reference TEXT,
    note TEXT,
    slip_key TEXT,
    normal_unit_price INTEGER NOT NULL,
    unit_price INTEGER NOT NULL CHECK (unit_price > 0),
    price_reason TEXT,
    payment_id TEXT,
    test INTEGER NOT NULL DEFAULT 0 CHECK (test IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (admin_id, request_key)
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_manual_orders_user ON manual_orders(user_id, created_at)");
}

const shortId = (id) => String(id).slice(0, 8).toUpperCase();
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function createManualOrderApis({
  one,
  all,
  run,
  tx,
  fail,
  clean,
  integer,
  clock,
  requireAdmin,
  isAdmin,
  confirmPassword,
  buyableVariant,
  coupons,
  normalizeCouponCode,
  pickUnitsForOrder,
  deliverPaidOrder,
  settlePaidReservation,
  allowSandbox,
  fileStore,
  sendOrderConfirmation,
}) {
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      JSON.stringify(detail),
    );
  const optionalText = (value, max, label) => {
    if (value == null) return null;
    if (typeof value !== "string") fail(400, label + "ไม่ถูกต้อง");
    const text = value.trim();
    if (!text) return null;
    if (text.length > max) fail(400, label + "ยาวเกินไป");
    return text;
  };
  const optionalPrice = (value) =>
    value == null || value === ""
      ? null
      : integer(value, 1, MANUAL_ORDER_MAX_UNIT_PRICE, "ราคาต่อชิ้น");

  /** Customer an admin may create an order for (active CUSTOMER accounts only). */
  function loadCustomer(customerId) {
    const customer = one("SELECT id,role,name,email,COALESCE(status,'ACTIVE') AS status FROM users WHERE id=?", customerId);
    if (!customer || customer.role !== "CUSTOMER") fail(404, "ไม่พบลูกค้า");
    if (customer.status !== "ACTIVE") fail(409, "บัญชีลูกค้านี้ถูกระงับ สร้างออเดอร์ไม่ได้");
    return customer;
  }

  /**
   * One price rule for the preview and the order. The normal price comes from the
   * shared buyableVariant() path (never the client). A different price needs a reason;
   * a price of 0 or less is refused by integer(). Coupons use the customer's own limits.
   */
  function priceLine(
    customer,
    { variantId, quantity, unitPrice, priceReason, couponCode },
    { softCoupon = false, softReason = false } = {},
  ) {
    // Default price = what this customer would pay in the shop (sale / tag price included).
    const variant = buyableVariant(variantId, customer);
    const normalUnitPrice = variant.unitPrice;
    const unit = unitPrice ?? normalUnitPrice;
    if (!Number.isSafeInteger(unit) || unit <= 0)
      fail(400, "ราคาต่อชิ้นต้องมากกว่า 0 บาท กรุณาใส่ราคาที่เก็บจริง");
    const reasonMissing = unit !== normalUnitPrice && (!priceReason || priceReason.length < 3);
    if (reasonMissing && !softReason)
      fail(
        400,
        unit < normalUnitPrice
          ? "ราคาต่ำกว่าราคาปกติ กรุณาใส่เหตุผล"
          : "ราคาสูงกว่าราคาปกติ กรุณาใส่เหตุผล",
      );
    const subtotal = unit * quantity;
    let applied = null;
    let couponError = null;
    if (couponCode) {
      try {
        applied = coupons.evaluate({ id: customer?.id ?? "" }, couponCode, {
          productId: variant.product_id,
          subtotal,
        });
      } catch (error) {
        if (!softCoupon || error?.status !== 400) throw error;
        couponError = error.message;
      }
    }
    const discount = applied?.discount ?? 0;
    const total = subtotal - discount;
    if (total <= 0) fail(400, "ยอดรวมต้องมากกว่า 0 บาท");
    const preorder = !!variant.preorder;
    const stock = preorder
      ? null
      : pickUnitsForOrder({ variant_id: variant.id, warranty_days: variant.warranty_days ?? 0, quantity }).length;
    return {
      variant,
      preorder,
      normalUnitPrice,
      unitPrice: unit,
      priceChanged: unit !== normalUnitPrice,
      subtotal,
      discount,
      total,
      applied,
      couponCode: applied ? applied.code : null,
      couponError,
      reasonMissing,
      enoughStock: preorder || stock >= quantity,
    };
  }

  function readInput(input) {
    const customerId = clean(input.customerId, 1, 80, "ลูกค้า");
    const variantId = clean(input.variantId, 1, 80, "สินค้า");
    const quantity = integer(input.quantity, 1, 10, "จำนวน");
    if (input.couponCode != null && typeof input.couponCode !== "string")
      fail(400, "โค้ดส่วนลดไม่ถูกต้อง");
    const couponCode = normalizeCouponCode(input.couponCode) || null;
    const unitPrice = optionalPrice(input.unitPrice);
    const priceReason = optionalText(input.priceReason, 300, "เหตุผลที่เปลี่ยนราคา");
    return { customerId, variantId, quantity, couponCode, unitPrice, priceReason };
  }

  /** POST /api/admin/manual-orders/quote — preview only, nothing is written. */
  function adminManualOrderQuote(user, input = {}) {
    requireAdmin(user);
    const fields = readInput(input);
    const customer = loadCustomer(fields.customerId);
    const line = priceLine(customer, fields, { softCoupon: true, softReason: true });
    return {
      preorder: line.preorder,
      normalUnitPrice: line.normalUnitPrice,
      unitPrice: line.unitPrice,
      priceChanged: line.priceChanged,
      subtotal: line.subtotal,
      discount: line.discount,
      total: line.total,
      couponCode: line.couponCode,
      couponError: line.couponError,
      // The preview still prices a changed price; creating the order needs the reason.
      reasonMissing: line.reasonMissing,
      enoughStock: line.enoughStock,
      warrantyDays: line.variant.warranty_days ?? 0,
    };
  }

  function resultFor(row, replayed) {
    const table = row.preorder ? "reservations" : "orders";
    const order = one(
      `SELECT id,status,total,quantity,${row.preorder ? "queue_number" : "NULL AS queue_number"} FROM ${table} WHERE id=?`,
      row.id,
    );
    return {
      replayed,
      order: {
        id: order.id,
        status: order.status,
        total: order.total,
        quantity: order.quantity,
        preorder: !!row.preorder,
        queueNumber: order.queue_number ?? null,
      },
    };
  }

  /**
   * POST /api/admin/manual-orders — ADMIN + password. `requestKey` makes a double click
   * (or a retry after a lost response) return the first order instead of a second one.
   */
  function adminCreateManualOrder(user, input = {}, ctx = {}) {
    requireAdmin(user);
    const fields = readInput(input);
    const requestKey = clean(input.requestKey, 8, 128, "รหัสคำขอ");
    const method = input.method == null ? "OFFSITE_TRANSFER" : String(input.method);
    if (!MANUAL_ORDER_METHODS[method]) fail(400, "ช่องทางชำระไม่ถูกต้อง");
    const reference = clean(input.reference, 3, 120, "เลขอ้างอิงการโอน");
    const note = optionalText(input.note, 300, "หมายเหตุ");
    // Outside the transaction: a wrong password must still count toward the lockout.
    confirmPassword(user, input.currentPassword);
    const result = tx(() => {
      const prior = one(
        "SELECT * FROM manual_orders WHERE admin_id=? AND request_key=?",
        user.id,
        requestKey,
      );
      if (prior) {
        const sameUnit = fields.unitPrice == null
          ? prior.unit_price === prior.normal_unit_price
          : prior.unit_price === fields.unitPrice;
        if (
          prior.user_id !== fields.customerId ||
          prior.variant_id !== fields.variantId ||
          prior.quantity !== fields.quantity ||
          (prior.coupon_code ?? null) !== fields.couponCode ||
          !sameUnit
        )
          fail(409, "รหัสคำขอถูกใช้กับออเดอร์อื่นแล้ว");
        return resultFor(prior, true);
      }
      const customer = loadCustomer(fields.customerId);
      const line = priceLine(customer, fields);
      if (!line.enoughStock) fail(409, "สินค้าคงเหลือไม่เพียงพอ กรุณาเลือกจำนวนใหม่");
      const id = randomUUID();
      const table = line.preorder ? "reservations" : "orders";
      run(
        `INSERT INTO ${table}(id,user_id,variant_id,quantity,total,request_key,payment_hash,warranty_days,discount,coupon_code,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        customer.id,
        fields.variantId,
        fields.quantity,
        line.total,
        // Unique per customer by construction; never collides with a storefront key.
        "manual:" + id,
        // No payment link exists for this order; the hash only fills the column.
        hash(randomBytes(32).toString("hex")),
        line.variant.warranty_days ?? 0,
        line.discount,
        line.couponCode,
        new Date(clock()).toISOString().slice(0, 19).replace("T", " "),
      );
      if (line.applied)
        coupons.redeem({
          coupon: line.applied.coupon,
          userId: customer.id,
          orderId: line.preorder ? null : id,
          reservationId: line.preorder ? id : null,
          amount: line.discount,
        });
      const test = allowSandbox ? 1 : 0;
      const payment = {
        provider: test ? "sandbox" : "offsite",
        providerRef: (test ? "sandbox:" : "") + "offsite:" + id,
        idempotencyKey: "manual:" + id,
        label: "รับ" + MANUAL_ORDER_METHODS[method] + " (แอดมินสร้าง) " + id.slice(0, 8),
        actorId: user.id,
        staffText: " สร้างโดยแอดมิน (" + MANUAL_ORDER_METHODS[method] + ")",
      };
      let paymentId;
      let queueNumber = null;
      if (line.preorder) {
        const settled = settlePaidReservation(one("SELECT * FROM reservations WHERE id=?", id), payment);
        paymentId = settled.paymentId;
        queueNumber = settled.queueNumber;
      } else {
        const order = one("SELECT * FROM orders WHERE id=?", id);
        const units = pickUnitsForOrder(order);
        if (units.length < order.quantity) fail(409, "สินค้าคงเหลือไม่เพียงพอ กรุณาเลือกจำนวนใหม่");
        paymentId = deliverPaidOrder(order, units, payment);
      }
      run(
        `INSERT INTO manual_orders(id,preorder,user_id,admin_id,request_key,variant_id,quantity,coupon_code,method,
           reference,note,normal_unit_price,unit_price,price_reason,payment_id,test,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        line.preorder ? 1 : 0,
        customer.id,
        user.id,
        requestKey,
        fields.variantId,
        fields.quantity,
        line.couponCode,
        method,
        reference,
        note,
        line.normalUnitPrice,
        line.unitPrice,
        line.priceChanged ? fields.priceReason : null,
        paymentId,
        test,
        new Date(clock()).toISOString().slice(0, 19).replace("T", " "),
      );
      auditDetail(user, MANUAL_ORDER_AUDIT, id, {
        customerId: customer.id,
        variantId: fields.variantId,
        quantity: fields.quantity,
        method,
        reference,
        normalUnitPrice: line.normalUnitPrice,
        unitPrice: line.unitPrice,
        reason: line.priceChanged ? fields.priceReason : null,
        couponCode: line.couponCode,
        discount: line.discount,
        total: line.total,
        preorder: line.preorder,
        queueNumber,
        test: !!test,
      });
      return resultFor(one("SELECT * FROM manual_orders WHERE id=?", id), false);
    });
    // Same "order confirmed" email as a storefront payment (queued after commit).
    if (!result.replayed) sendOrderConfirmation?.(result.order.id, ctx);
    return result;
  }

  /** POST /api/admin/orders/:id/slip — optional transfer slip (JPEG/PNG/WebP), ADMIN only. */
  async function adminSetManualOrderSlip(user, id, { bytes, contentType } = {}) {
    requireAdmin(user);
    const orderId = clean(id, 1, 80, "คำสั่งซื้อ");
    const row = one("SELECT id,slip_key FROM manual_orders WHERE id=?", orderId);
    if (!row) fail(404, "ออเดอร์นี้ไม่ได้สร้างจากหลังบ้าน");
    if (!bytes || bytes.byteLength === 0) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
    const mime = assertAllowedImage(contentType, bytes, fail);
    // "slip-" keys are never served by the public /api/files route (hex-only keys).
    const key = "slip-" + randomUUID();
    await fileStore.put(key, bytes, mime);
    try {
      run("UPDATE manual_orders SET slip_key=? WHERE id=?", key, orderId);
      auditDetail(user, "MANUAL_ORDER_SLIP", orderId, { replaced: !!row.slip_key });
    } catch (error) {
      await fileStore.delete(key).catch(() => {});
      throw error;
    }
    if (row.slip_key) await fileStore.delete(row.slip_key).catch(() => {});
    return { slip: true };
  }

  /** GET /api/admin/orders/:id/slip — the slip image, ADMIN only. */
  async function adminManualOrderSlip(user, id) {
    requireAdmin(user);
    const orderId = clean(id, 1, 80, "คำสั่งซื้อ");
    const row = one("SELECT slip_key FROM manual_orders WHERE id=?", orderId);
    if (!row?.slip_key) fail(404, "ไม่พบสลิป");
    const file = await fileStore.get(row.slip_key);
    if (!file) fail(404, "ไม่พบสลิป");
    return file;
  }

  // ------------------------------------------------ markers on existing views

  const customerMarker = (row) => ({
    createdByAdmin: true,
    paymentMethod: row.method,
    paymentMethodLabel: MANUAL_ORDER_METHODS[row.method] ?? row.method,
  });
  function adminMarker(id) {
    const row = one(
      `SELECT m.*,u.name AS admin_name FROM manual_orders m LEFT JOIN users u ON u.id=m.admin_id WHERE m.id=?`,
      id,
    );
    if (!row) return null;
    return {
      ...customerMarker(row),
      adminName: row.admin_name ?? null,
      reference: row.reference,
      note: row.note,
      normalUnitPrice: row.normal_unit_price,
      unitPrice: row.unit_price,
      priceReason: row.price_reason,
      test: !!row.test,
      hasSlip: !!row.slip_key,
      createdAt: row.created_at,
    };
  }
  /** id -> manual_orders row, for a page of ids (one query). */
  function rowsFor(ids) {
    const list = [...new Set(ids.filter((x) => typeof x === "string"))];
    const map = new Map();
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      for (const row of all(
        `SELECT id,method FROM manual_orders WHERE id IN (${chunk.map(() => "?").join(",")})`,
        ...chunk,
      ))
        map.set(row.id, row);
    }
    return map;
  }
  const markList = (list) => {
    if (!Array.isArray(list) || !list.length) return list;
    const rows = rowsFor(list.map((o) => o?.id));
    return list.map((o) => (rows.has(o?.id) ? { ...o, ...customerMarker(rows.get(o.id)) } : o));
  };
  const markOne = (value) => {
    if (!value?.id) return value;
    const row = rowsFor([value.id]).get(value.id);
    return row ? { ...value, ...customerMarker(row) } : value;
  };

  /**
   * Add the "สร้างโดยแอดมิน" marker + method to the existing order views without
   * touching their queries. Runs before live.mjs wraps the service.
   */
  function hook(service) {
    const wrap = (name, fn) => {
      const original = service[name];
      if (typeof original !== "function") return;
      service[name] = (...args) => {
        const result = original(...args);
        return result && typeof result.then === "function" ? result.then(fn) : fn(result, args);
      };
    };
    wrap("orderDetail", markOne);
    wrap("orders", markList);
    wrap("orderReceipt", markOne);
    wrap("adminOrderReceipt", markOne);
    wrap("adminOrders", (page) => (page?.orders ? { ...page, orders: markList(page.orders) } : page));
    wrap("adminOverview", (data) => (data?.orders ? { ...data, orders: markList(data.orders) } : data));
    wrap("adminCustomerDetail", (data) =>
      data && Array.isArray(data.orders) ? { ...data, orders: markList(data.orders) } : data,
    );
    wrap("adminOrderDetail", (detail, args) => {
      if (!detail?.id) return detail;
      const manual = adminMarker(detail.id);
      if (!manual) return detail;
      const user = args?.[0];
      // Money details (price change, reason) stay ADMIN-only like the payment summary.
      const shown = isAdmin(user)
        ? manual
        : { ...customerMarker({ method: manual.paymentMethod }), adminName: manual.adminName, reference: manual.reference };
      const timeline = Array.isArray(detail.timeline)
        ? detail.timeline.map((e) =>
            e.event === "created" ? { ...e, actor: manual.adminName, actorRole: "ADMIN" } : e,
          )
        : detail.timeline;
      return { ...detail, timeline, manual: shown, ...customerMarker({ method: manual.paymentMethod }) };
    });
  }

  return {
    adminManualOrderQuote,
    adminCreateManualOrder,
    adminSetManualOrderSlip,
    adminManualOrderSlip,
    hook,
  };
}
