/**
 * Preorder modes per product (admin › สินค้า › วิธีจอง). Industry reference: Shopify preorder
 * apps (PreProduct, STOQ, Essential Preorder) offer pay-now / deposit+balance / charge-later.
 * We keep pay-now and add deposit and a free reservation; charge-later needs a stored card,
 * which PromptPay / bank transfer cannot do.
 *
 *  - full    (default, unchanged): pay the whole price → queue number → staff delivers from
 *            ออเดอร์ › คิวพรีออเดอร์ (deliverReservation).
 *  - deposit (มัดจำ): pay the deposit → queue number. When stock is ready the shop "calls" the
 *            queue: one unit is held per called reservation and the customer pays the balance
 *            (total − deposit) within the pay window → delivered with the held unit.
 *  - free    (จองฟรี): no payment → queue number straight away. When called, pay the full price
 *            within the window → delivered.
 *
 * Calling: N = units that can be sold now, minus units still owed to paid full-mode
 * reservations of the same option (they paid everything, so they keep priority). Called in
 * queue order; never skips someone whose quantity does not fit (fairness). Calls happen on
 * stock import, on the admin button "เรียกคิว", and on the lazy tick below.
 *
 * Tick: the same request-driven sweep that expires unpaid orders (pending-expiry.mjs, at most
 * once a minute — no cron). It sends one reminder ~2 hours before pay_by, lapses called
 * reservations past pay_by (unit released, deposit per the product's policy, next called)
 * and calls the queue for options that have free stock.
 *
 * Closed shop (ตั้งค่า › ร้านปิดอยู่): nobody can pay, so nothing lapses or gets reminded while
 * closed. On reopen every called reservation's pay_by moves later by the time the shop was
 * closed during its window (we extend, we do not "pause and resume"), so a customer always
 * gets the full window of open-shop time.
 *
 * Money: integer satang. Deposit and balance are separate `payments` rows
 * (payments.purpose = 'deposit' | 'balance'), so a real gateway can settle each one on its
 * own later; gross revenue = deposit + balance = the locked total, never counted twice.
 * Refunds are new REFUND ledger rows (append-only), never updates.
 * Reservation status keeps its CHECK values (PENDING_PAYMENT / PREORDER / DELIVERED /
 * FAILED / CANCELLED); the extra state lives in `stage`.
 */

import { randomUUID } from "node:crypto";

export const PREORDER_MODES = ["full", "deposit", "free"];
export const LAPSE_POLICIES = ["refund_credit", "keep"];
export const DEPOSIT_TYPES = ["percent", "fixed"];
export const PAY_WINDOW_DEFAULT = 24;
export const PAY_WINDOW_MIN = 1;
export const PAY_WINDOW_MAX = 168;
export const DEPOSIT_PERCENT_MIN = 1;
export const DEPOSIT_PERCENT_MAX = 90;
/** A fixed deposit never takes more than this share of the locked total (same cap as percent). */
export const DEPOSIT_CAP_PERCENT = 90;
export const REMIND_BEFORE_MS = 2 * 3600 * 1000;
export const MAX_OPEN_LIMIT = 100;
export const QUEUE_LIMIT_MAX = 10000;
export const DEFAULT_PREORDER_SETTINGS = Object.freeze({
  mode: "full",
  depositType: "percent",
  depositValue: 30,
  payWindowHours: PAY_WINDOW_DEFAULT,
  lapsePolicy: "refund_credit",
  maxPerCustomer: null,
  queueLimit: null,
});
/** Open reservations one customer may hold per product when the admin left it empty. */
export const defaultMaxOpen = (mode) => (mode === "free" ? 1 : null);

const CLOSED_FLAG = "preorder-shop-closed-at";

/** Idempotent schema (no numbered migration). Called from commerce.mjs and cloud/worker.mjs. */
export function ensurePreorderModes(db) {
  const has = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  const add = (table, column, ddl) => {
    if (!has(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  // One row per product that left the default (full). No foreign key, like customer tags:
  // demo cleanup / PDPA deletion can remove products freely.
  db.exec(`CREATE TABLE IF NOT EXISTS preorder_settings (
    product_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'full',
    deposit_type TEXT NOT NULL DEFAULT 'percent',
    deposit_value INTEGER NOT NULL DEFAULT 30,
    pay_window_hours INTEGER NOT NULL DEFAULT 24,
    lapse_policy TEXT NOT NULL DEFAULT 'refund_credit',
    max_per_customer INTEGER,
    queue_limit INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT
  )`);
  // Snapshot of the terms the customer saw when reserving + the queue stage.
  add("reservations", "preorder_mode", "TEXT");
  add("reservations", "deposit", "INTEGER NOT NULL DEFAULT 0");
  add("reservations", "deposit_paid", "INTEGER NOT NULL DEFAULT 0");
  add("reservations", "pay_window_hours", "INTEGER");
  add("reservations", "lapse_policy", "TEXT");
  // queued | called | delivered | lapsed | cancelled | shop_cancelled (NULL = full mode).
  add("reservations", "stage", "TEXT");
  add("reservations", "called_at", "TEXT");
  add("reservations", "pay_by", "TEXT");
  add("reservations", "reminded_at", "TEXT");
  add("reservations", "ended_at", "TEXT");
  // 'deposit' | 'balance' for the split preorder payments (NULL = a normal full payment).
  add("payments", "purpose", "TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_reservations_stage ON reservations(stage, pay_by) WHERE stage IS NOT NULL",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_reservations_variant_stage ON reservations(variant_id, stage, queue_number) WHERE stage IS NOT NULL",
  );
}

/** ms → SQLite CURRENT_TIMESTAMP text (UTC "YYYY-MM-DD HH:MM:SS"). */
export const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const msOf = (sql) => Date.parse(String(sql).replace(" ", "T") + "Z");
const thb = (satang) =>
  "฿" + (satang / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (id) => String(id).slice(0, 8);

/**
 * Deposit (satang) for a locked total. Percent: total × pct / 100, rounded half up to the
 * satang. Fixed: value × quantity. Both capped at 90% of the total (rounded down) so there is
 * always a balance to pay; 0 when the total is 0.
 */
export function depositFor(settings, total, quantity = 1) {
  if (!Number.isSafeInteger(total) || total <= 0) return 0;
  const cap = Math.floor((total * DEPOSIT_CAP_PERCENT) / 100);
  const raw =
    settings.depositType === "fixed"
      ? settings.depositValue * quantity
      : Math.round((total * settings.depositValue) / 100);
  return Math.max(0, Math.min(raw, cap));
}

export function createPreorders({
  one,
  all,
  run,
  tx,
  fail,
  clock,
  shopSettings,
  notify,
  notifyStaffRoles,
  insertLedgerEntry,
  requireAdmin,
  requireStaff,
  requireUser,
  inventoryOrderSql,
  nextQueueNumber,
  releaseCouponForOrder,
  emitAlert = () => {},
  bump = () => {},
  sendEmail = () => {},
}) {
  const auditDetail = (user, action, entity, detail = null) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );
  const nowSql = () => sqlTime(clock());
  // Emails wait until the transaction that called / reminded committed (flushEmails).
  let pendingEmails = [];
  const queueEmail = (kind, r) => pendingEmails.push([kind, r]);
  function flushEmails() {
    const list = pendingEmails;
    pendingEmails = [];
    for (const [kind, r] of list) {
      try {
        sendEmail(kind, r);
      } catch (error) {
        console.error("Preorder email skipped:", error?.message);
      }
    }
  }
  const dropEmails = () => {
    pendingEmails = [];
  };
  const freeUnitSql =
    "order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0";

  // ----------------------------------------------------------------- product settings

  function productSettings(productId) {
    const row = one("SELECT * FROM preorder_settings WHERE product_id=?", productId);
    if (!row) return { ...DEFAULT_PREORDER_SETTINGS };
    return {
      mode: PREORDER_MODES.includes(row.mode) ? row.mode : "full",
      depositType: DEPOSIT_TYPES.includes(row.deposit_type) ? row.deposit_type : "percent",
      depositValue: row.deposit_value,
      payWindowHours: row.pay_window_hours,
      lapsePolicy: LAPSE_POLICIES.includes(row.lapse_policy) ? row.lapse_policy : "refund_credit",
      maxPerCustomer: row.max_per_customer ?? null,
      queueLimit: row.queue_limit ?? null,
    };
  }
  /** Lowest regular price of the product's active options (fixed deposit must stay below it). */
  const lowestPrice = (productId) =>
    one(
      "SELECT MIN(price) AS n FROM variants WHERE product_id=? AND COALESCE(active,1)=1 AND price>0",
      productId,
    )?.n ?? null;

  /** Storefront: what a customer must know before reserving (preorder products only). */
  function publicTerms(product) {
    if (!product?.preorder) return null;
    const s = productSettings(product.id);
    if (s.mode === "full") return { mode: "full" };
    return {
      mode: s.mode,
      depositType: s.mode === "deposit" ? s.depositType : null,
      depositValue: s.mode === "deposit" ? s.depositValue : null,
      depositCapPercent: DEPOSIT_CAP_PERCENT,
      payWindowHours: s.payWindowHours,
      lapsePolicy: s.mode === "deposit" ? s.lapsePolicy : null,
      maxPerCustomer: s.maxPerCustomer ?? defaultMaxOpen(s.mode),
    };
  }

  const productOf = (productId) => {
    if (typeof productId !== "string" || !productId.trim() || productId.length > 80)
      fail(400, "รหัสสินค้าไม่ถูกต้อง");
    const product = one("SELECT id,name,preorder FROM products WHERE id=?", productId.trim());
    if (!product) fail(404, "ไม่พบสินค้า");
    return product;
  };

  function adminPreorderSettings(user, productId) {
    requireAdmin(user);
    const product = productOf(productId);
    return {
      productId: product.id,
      preorder: !!product.preorder,
      settings: productSettings(product.id),
      lowestPrice: lowestPrice(product.id),
      limits: {
        payWindow: [PAY_WINDOW_MIN, PAY_WINDOW_MAX],
        depositPercent: [DEPOSIT_PERCENT_MIN, DEPOSIT_PERCENT_MAX],
        maxPerCustomer: MAX_OPEN_LIMIT,
        queueLimit: QUEUE_LIMIT_MAX,
      },
      open: one(
        `SELECT COUNT(*) AS n FROM reservations r JOIN variants v ON v.id=r.variant_id
         WHERE v.product_id=? AND r.status IN ('PENDING_PAYMENT','PREORDER')`,
        product.id,
      ).n,
    };
  }

  const wholeNumber = (value, label) => {
    const n = typeof value === "string" && /^\s*\d{1,9}\s*$/.test(value) ? Number(value) : value;
    if (!Number.isSafeInteger(n)) fail(400, label + "ต้องเป็นจำนวนเต็ม");
    return n;
  };
  const optionalLimit = (value, max, label) => {
    if (value === null || value === undefined || value === "") return null;
    const n = wholeNumber(value, label);
    if (n < 1 || n > max) fail(400, label + "ต้องอยู่ระหว่าง 1–" + max);
    return n;
  };

  /** PATCH /api/admin/products/:id/preorder — ADMIN; applies to new reservations only. */
  function adminSavePreorderSettings(user, productId, input = {}) {
    requireAdmin(user);
    const product = productOf(productId);
    if (!product.preorder) fail(409, "ตั้งวิธีจองได้เฉพาะสินค้าพรีออเดอร์");
    const mode = String(input.mode ?? "");
    if (!PREORDER_MODES.includes(mode)) fail(400, "กรุณาเลือกวิธีจอง");
    const before = productSettings(product.id);
    const next = { ...before, mode };
    if (mode === "deposit") {
      const depositType = String(input.depositType ?? "");
      if (!DEPOSIT_TYPES.includes(depositType)) fail(400, "กรุณาเลือกแบบมัดจำ");
      const value = wholeNumber(input.depositValue, "ยอดมัดจำ");
      if (depositType === "percent") {
        if (value < DEPOSIT_PERCENT_MIN || value > DEPOSIT_PERCENT_MAX)
          fail(400, `มัดจำเป็นเปอร์เซ็นต์ต้องอยู่ระหว่าง ${DEPOSIT_PERCENT_MIN}–${DEPOSIT_PERCENT_MAX}%`);
      } else {
        if (value <= 0) fail(400, "มัดจำต้องมากกว่า 0 บาท");
        const lowest = lowestPrice(product.id);
        if (lowest != null && value >= lowest)
          fail(400, "มัดจำต้องน้อยกว่าราคาตัวเลือกที่ถูกที่สุด (" + thb(lowest) + ")");
      }
      next.depositType = depositType;
      next.depositValue = value;
    }
    if (mode !== "full") {
      const hours = wholeNumber(input.payWindowHours ?? PAY_WINDOW_DEFAULT, "เวลาชำระ");
      if (hours < PAY_WINDOW_MIN || hours > PAY_WINDOW_MAX)
        fail(400, `เวลาชำระหลังเรียกคิวต้องอยู่ระหว่าง ${PAY_WINDOW_MIN}–${PAY_WINDOW_MAX} ชั่วโมง`);
      next.payWindowHours = hours;
    }
    if (mode === "deposit") {
      const policy = String(input.lapsePolicy ?? "");
      if (!LAPSE_POLICIES.includes(policy)) fail(400, "กรุณาเลือกว่าจะทำอย่างไรกับมัดจำเมื่อไม่ชำระ");
      next.lapsePolicy = policy;
    }
    next.maxPerCustomer = optionalLimit(input.maxPerCustomer, MAX_OPEN_LIMIT, "จำนวนคิวต่อบัญชี");
    next.queueLimit = optionalLimit(input.queueLimit, QUEUE_LIMIT_MAX, "จำนวนคิวสูงสุด");
    tx(() => {
      run(
        `INSERT INTO preorder_settings(product_id,mode,deposit_type,deposit_value,pay_window_hours,lapse_policy,max_per_customer,queue_limit,updated_at,updated_by)
         VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(product_id) DO UPDATE SET mode=excluded.mode, deposit_type=excluded.deposit_type,
           deposit_value=excluded.deposit_value, pay_window_hours=excluded.pay_window_hours,
           lapse_policy=excluded.lapse_policy, max_per_customer=excluded.max_per_customer,
           queue_limit=excluded.queue_limit, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
        product.id,
        next.mode,
        next.depositType,
        next.depositValue,
        next.payWindowHours,
        next.lapsePolicy,
        next.maxPerCustomer,
        next.queueLimit,
        nowSql(),
        user.id,
      );
      const changed = {};
      for (const key of Object.keys(next))
        if (before[key] !== next[key]) changed[key] = { from: before[key], to: next[key] };
      auditDetail(user, "PRODUCT_PREORDER_SETTINGS", product.id, { changed });
    });
    return adminPreorderSettings(user, product.id);
  }

  // ----------------------------------------------------------------- reserving

  /**
   * createOrder, preorder branch (inside its transaction): limits + the snapshot columns.
   * Returns null for full mode (the old insert, unchanged).
   */
  function reservationTerms(user, variant, total, quantity) {
    const s = productSettings(variant.product_id);
    const maxOpen = s.maxPerCustomer ?? defaultMaxOpen(s.mode);
    if (maxOpen) {
      const open = one(
        `SELECT COUNT(*) AS n FROM reservations r JOIN variants v ON v.id=r.variant_id
         WHERE r.user_id=? AND v.product_id=? AND r.status IN ('PENDING_PAYMENT','PREORDER')`,
        user.id,
        variant.product_id,
      ).n;
      if (open >= maxOpen)
        fail(409, "จองสินค้านี้ได้สูงสุด " + maxOpen + " คิวต่อบัญชี (รวมคิวที่ยังรออยู่)");
    }
    if (s.queueLimit) {
      const waiting = one(
        `SELECT COUNT(*) AS n FROM reservations r JOIN variants v ON v.id=r.variant_id
         WHERE v.product_id=? AND r.status IN ('PENDING_PAYMENT','PREORDER')`,
        variant.product_id,
      ).n;
      if (waiting >= s.queueLimit) fail(409, "คิวจองสินค้านี้เต็มแล้ว");
    }
    if (s.mode === "full") return { mode: "full" };
    return {
      mode: s.mode,
      deposit: s.mode === "deposit" ? depositFor(s, total, quantity) : 0,
      payWindowHours: s.payWindowHours,
      lapsePolicy: s.mode === "deposit" ? s.lapsePolicy : null,
    };
  }

  /** Free mode (or a deposit that rounds to 0): straight into the queue, no payment. */
  function enterQueue(reservationId) {
    const r = one("SELECT * FROM reservations WHERE id=?", reservationId);
    const queueNumber = nextQueueNumber();
    run(
      "UPDATE reservations SET status='PREORDER', stage='queued', queue_number=? WHERE id=? AND status='PENDING_PAYMENT'",
      queueNumber,
      reservationId,
    );
    notify(r.user_id, "preorder_queue", "ได้รับเลขคิวพรีออเดอร์", "คิวของคุณคือ #" + queueNumber, "/orders/" + r.id);
    notifyStaffRoles(
      "preorder_queue_admin",
      "คิวพรีออเดอร์ใหม่",
      "คิว #" + queueNumber + " · " + short(r.id) + " · จองฟรี",
      "/admin/orders/" + r.id,
    );
    callForVariant(r.variant_id);
    return queueNumber;
  }

  /** Deposit paid (inside pay's transaction, after settlePaidReservation recorded it). */
  function afterDepositPaid(o, paymentId) {
    run("UPDATE payments SET purpose='deposit' WHERE id=?", paymentId);
    run(
      "UPDATE reservations SET stage='queued', deposit_paid=? WHERE id=? AND status='PREORDER'",
      o.deposit,
      o.id,
    );
    // Stock may already be waiting (imported before anyone reserved): call right away.
    callForVariant(o.variant_id);
  }

  // ----------------------------------------------------------------- calling

  /**
   * Call the next queued reservations of one option, as many as free units allow. Runs in
   * the caller's transaction. Returns the called rows (for emails after the commit).
   */
  function callForVariant(variantId) {
    const queued = all(
      `SELECT * FROM reservations WHERE variant_id=? AND status='PREORDER' AND stage='queued'
       ORDER BY queue_number ASC, created_at ASC`,
      variantId,
    );
    if (!queued.length) return [];
    const freeUnits = one(
      `SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND ${freeUnitSql}
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now', '+' || COALESCE((SELECT warranty_days FROM variants WHERE id=?),0) || ' days'))`,
      variantId,
      variantId,
    ).n;
    // Paid-in-full reservations of this option are delivered by staff: their units stay free.
    const owedToFull = one(
      `SELECT COALESCE(SUM(quantity),0) AS n FROM reservations
       WHERE variant_id=? AND status='PREORDER' AND COALESCE(preorder_mode,'full')='full'`,
      variantId,
    ).n;
    let left = freeUnits - owedToFull;
    const called = [];
    const now = clock();
    for (const r of queued) {
      if (left < r.quantity) break;
      const units = all(
        `SELECT id FROM inventory WHERE variant_id=? AND ${freeUnitSql}
           AND (expires_at IS NULL OR datetime(expires_at) > datetime('now', '+' || ? || ' days'))
         ORDER BY ${inventoryOrderSql()} LIMIT ?`,
        variantId,
        r.warranty_days ?? 0,
        r.quantity,
      );
      if (units.length < r.quantity) break;
      for (const unit of units) {
        const held = run(
          `UPDATE inventory SET reservation_id=? WHERE id=? AND ${freeUnitSql}`,
          r.id,
          unit.id,
        );
        if (!held.changes) fail(409, "สต็อกเปลี่ยนระหว่างเรียกคิว กรุณาลองใหม่");
      }
      const hours = r.pay_window_hours ?? PAY_WINDOW_DEFAULT;
      const payBy = now + hours * 3600 * 1000;
      run(
        `UPDATE reservations SET stage='called', called_at=?, pay_by=?, reminded_at=?
         WHERE id=? AND status='PREORDER' AND stage='queued'`,
        sqlTime(now),
        sqlTime(payBy),
        // A window of 2 hours or less: the call itself is the reminder.
        hours * 3600 * 1000 <= REMIND_BEFORE_MS ? sqlTime(now) : null,
        r.id,
      );
      left -= r.quantity;
      const due = r.total - (r.deposit_paid ?? 0);
      const row = { ...r, stage: "called", pay_by: sqlTime(payBy), called_at: sqlTime(now) };
      if (due <= 0) {
        // Nothing left to pay (e.g. a 100% coupon on a free reservation): deliver now.
        deliverHeld(row, null);
        continue;
      }
      notify(
        r.user_id,
        "preorder_called",
        r.preorder_mode === "free" ? "ของพร้อมแล้ว ชำระเพื่อรับสินค้า" : "ของพร้อมแล้ว ชำระส่วนที่เหลือ",
        "คิว #" + r.queue_number + " · ชำระ " + thb(due) + " ภายใน " + hours + " ชั่วโมง",
        "/orders/" + r.id,
      );
      called.push({ ...row, due });
    }
    for (const r of called) queueEmail("preorder_called", r);
    return called;
  }

  /** Called + paid: the held units become the customer's. Inside the caller's transaction. */
  function deliverHeld(r, actorId) {
    const now = nowSql();
    const bound = run(
      "UPDATE inventory SET sold_at=? WHERE reservation_id=? AND sold_at IS NULL AND COALESCE(defective,0)=0",
      now,
      r.id,
    ).changes;
    if (bound < r.quantity) fail(409, "สินค้าที่กันไว้ไม่ครบ กรุณาติดต่อร้าน");
    run(
      `UPDATE reservations SET status='DELIVERED', stage='delivered', delivered_at=?, delivered_by=?,
         warranty_until=CASE WHEN COALESCE(warranty_days,0)>0
           THEN datetime(?,'+'||warranty_days||' days') END
       WHERE id=? AND status='PREORDER'`,
      now,
      actorId,
      now,
      r.id,
    );
    notify(
      r.user_id,
      "order",
      "พรีออเดอร์พร้อมใช้งานแล้ว",
      "รหัสสินค้าถูกจัดส่งแล้ว กดดูคำสั่งซื้อเพื่อรับรหัส",
      "/orders/" + r.id,
    );
  }

  /** Release held units (lapse / cancel). Units that were already delivered are never touched. */
  const releaseHeld = (reservationId) =>
    run(
      "UPDATE inventory SET reservation_id=NULL WHERE reservation_id=? AND sold_at IS NULL",
      reservationId,
    ).changes;

  // ----------------------------------------------------------------- paying the balance

  /** Balance (deposit mode) or full price (free mode) a called customer still owes. */
  const balanceDue = (r) => Math.max(0, r.total - (r.deposit_paid ?? 0));

  /**
   * pay() for a reservation in stage 'called' (inside pay's transaction, token and outcome
   * already checked, test credit already confirmed by the caller's checks below).
   */
  function payBalance(user, o, { balance }) {
    if (o.pay_by && msOf(o.pay_by) <= clock() && shopSettings().shopOpen !== false)
      fail(409, "หมดเวลาชำระส่วนที่เหลือแล้ว");
    const amount = balanceDue(o);
    if (balance < amount) fail(409, "เครดิตทดลองไม่เพียงพอ กรุณาเติมเครดิตก่อน");
    if (amount)
      insertLedgerEntry({
        userId: user.id,
        amount: -amount,
        reference: "preorder-balance:" + o.id,
        label: "ชำระสินค้าสั่งจอง " + short(o.id),
        kind: "DEMO_CREDIT",
        direction: "out",
        orderId: o.id,
      });
    const paymentId = recordPayment(o, amount, "balance", {});
    deliverHeld(o, null);
    notifyStaffRoles(
      "order_new",
      "พรีออเดอร์ชำระครบแล้ว",
      "คิว #" + o.queue_number + " · " + short(o.id) + " ชำระส่วนที่เหลือและส่งของแล้ว",
      "/admin/orders/" + o.id,
    );
    emitAlert("order_paid", { id: o.id, variantId: o.variant_id, quantity: o.quantity, total: amount });
    auditDetail(user, "PREORDER_BALANCE_PAID", o.id, { amount, paymentId });
    return paymentId;
  }

  /** One SUCCEEDED payment row (+ PAYMENT_IN when > 0) for a deposit or balance. */
  function recordPayment(o, amount, purpose, payment) {
    const paymentId = randomUUID();
    const provider = payment.provider ?? "sandbox";
    const providerRef = payment.providerRef ?? "sandbox:preorder-" + purpose + ":" + o.id;
    run(
      `INSERT INTO payments(
        id, order_id, reservation_id, user_id, amount, currency, status,
        provider, provider_ref, idempotency_key, created_at, finalized_at, purpose
      ) VALUES(?,NULL,?,?,?,'THB','SUCCEEDED',?,?,?,?,?,?)`,
      paymentId,
      o.id,
      o.user_id,
      amount,
      provider,
      providerRef,
      payment.idempotencyKey ?? "pay:reservation-" + purpose + ":" + o.id,
      nowSql(),
      nowSql(),
      purpose,
    );
    if (amount)
      insertLedgerEntry({
        userId: o.user_id,
        amount,
        reference: "payment-in:" + paymentId,
        label: (purpose === "balance" ? "รับชำระส่วนที่เหลือพรีออเดอร์ " : "รับมัดจำพรีออเดอร์ ") + short(o.id),
        kind: "PAYMENT_IN",
        direction: "in",
        orderId: o.id,
        paymentId,
        providerRef,
      });
    return paymentId;
  }

  // ----------------------------------------------------------------- ending a reservation

  /** Deposit back to shop credit as a new REFUND ledger row (never an update). */
  function refundDeposit(r, actorId, reason) {
    const paid = r.deposit_paid ?? 0;
    if (!paid) return 0;
    const already = one(
      "SELECT COALESCE(SUM(amount),0) AS n FROM ledger WHERE order_id=? AND kind='REFUND'",
      r.id,
    ).n;
    const amount = paid - already;
    if (amount <= 0) return 0;
    const payment = one(
      "SELECT id FROM payments WHERE reservation_id=? AND status='SUCCEEDED' AND purpose='deposit' ORDER BY rowid DESC LIMIT 1",
      r.id,
    );
    insertLedgerEntry({
      userId: r.user_id,
      amount,
      reference: "preorder-deposit-refund:" + r.id,
      label: "คืนมัดจำพรีออเดอร์เข้าเครดิต " + short(r.id),
      kind: "REFUND",
      direction: "in",
      orderId: r.id,
      paymentId: payment?.id ?? null,
      actorId,
      reason,
    });
    return amount;
  }

  /**
   * End a queued / called reservation (lapse, customer cancel, shop cancel). Inside a
   * transaction. Returns { refunded, kept, called } or null when it was not open.
   */
  function endReservation(r, { stage, refund, actor = null, reason }) {
    const changed = run(
      `UPDATE reservations SET status='CANCELLED', stage=?, ended_at=?
       WHERE id=? AND status='PREORDER' AND stage IN ('queued','called')`,
      stage,
      nowSql(),
      r.id,
    ).changes;
    if (!changed) return null;
    const wasCalled = r.stage === "called";
    const released = releaseHeld(r.id);
    const refunded = refund ? refundDeposit(r, actor?.id ?? null, reason) : 0;
    const kept = refund ? 0 : r.deposit_paid ?? 0;
    releaseCouponForOrder(r.id, stage === "lapsed" ? "PREORDER_LAPSED" : "PREORDER_CANCELLED");
    const called = released || wasCalled ? callForVariant(r.variant_id) : [];
    return { refunded, kept, released, called };
  }

  const endedText = (r, result) =>
    "คิว #" +
    r.queue_number +
    (result.refunded
      ? " · คืนมัดจำ " + thb(result.refunded) + " เข้าเครดิตแล้ว"
      : result.kept
        ? " · ร้านเก็บมัดจำ " + thb(result.kept) + " ตามเงื่อนไข"
        : "");

  function lapse(r) {
    const refund = (r.lapse_policy ?? "refund_credit") !== "keep";
    const result = endReservation(r, { stage: "lapsed", refund, reason: "หมดเวลาชำระส่วนที่เหลือ" });
    if (!result) return null;
    notify(r.user_id, "preorder_lapsed", "หมดเวลาชำระพรีออเดอร์", endedText(r, result), "/orders/" + r.id);
    auditDetail(null, "PREORDER_LAPSED", r.id, {
      payBy: r.pay_by,
      policy: refund ? "refund_credit" : "keep",
      refunded: result.refunded,
      kept: result.kept,
      calledNext: result.called.map((c) => c.id),
    });
    return result;
  }

  /** POST /api/orders/:id/cancel — the customer leaves the queue while still waiting. */
  function cancelMyReservation(user, id, input = {}) {
    requireUser(user);
    const reason =
      typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 300) : null;
    const result = tx(() => {
      const r = one("SELECT * FROM reservations WHERE id=? AND user_id=?", String(id ?? ""), user.id);
      if (!r) fail(404, "ไม่พบคำสั่งซื้อ");
      if (r.status !== "PREORDER" || r.stage !== "queued")
        fail(409, "ยกเลิกได้เฉพาะคิวที่ยังรอของอยู่");
      const refund = (r.lapse_policy ?? "refund_credit") !== "keep";
      const ended = endReservation(r, { stage: "cancelled", refund, actor: user, reason: reason ?? "ลูกค้ายกเลิกคิว" });
      if (!ended) fail(409, "ยกเลิกได้เฉพาะคิวที่ยังรอของอยู่");
      notify(r.user_id, "preorder_cancelled", "ยกเลิกการจองแล้ว", endedText(r, ended), "/orders/" + r.id);
      notifyStaffRoles(
        "preorder_queue_admin",
        "ลูกค้ายกเลิกคิวพรีออเดอร์",
        "คิว #" + r.queue_number + " · " + short(r.id),
        "/admin/orders/" + r.id,
      );
      auditDetail(user, "PREORDER_CANCEL_CUSTOMER", r.id, {
        reason,
        refunded: ended.refunded,
        kept: ended.kept,
      });
      return ended;
    });
    return { id, status: "CANCELLED", refunded: result.refunded, kept: result.kept };
  }

  /** POST /api/admin/preorders/:id/cancel — ADMIN; always refunds the whole deposit to credit. */
  function adminCancelReservation(user, id, input = {}) {
    requireAdmin(user);
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length < 3 || reason.length > 300) fail(400, "กรุณาใส่เหตุผล 3–300 ตัวอักษร");
    const result = tx(() => {
      const r = one("SELECT * FROM reservations WHERE id=?", String(id ?? ""));
      if (!r) fail(404, "ไม่พบพรีออเดอร์");
      if (r.status !== "PREORDER" || !["queued", "called"].includes(r.stage))
        fail(409, "ยกเลิกได้เฉพาะคิวแบบมัดจำ/จองฟรีที่ยังไม่ส่งของ (คิวแบบจ่ายเต็มใช้การคืนเงิน)");
      const ended = endReservation(r, { stage: "shop_cancelled", refund: true, actor: user, reason });
      if (!ended) fail(409, "คิวนี้เปลี่ยนสถานะไปแล้ว");
      notify(
        r.user_id,
        "preorder_cancelled",
        "ร้านยกเลิกการจองของคุณ",
        "คิว #" + r.queue_number + (ended.refunded ? " · คืนมัดจำ " + thb(ended.refunded) + " เข้าเครดิตแล้ว" : ""),
        "/orders/" + r.id,
      );
      auditDetail(user, "PREORDER_CANCEL_SHOP", r.id, {
        reason,
        refunded: ended.refunded,
        stage: r.stage,
        calledNext: ended.called.map((c) => c.id),
      });
      return ended;
    });
    return { id, status: "CANCELLED", refunded: result.refunded, calledNext: result.called.length };
  }

  /** POST /api/admin/preorders/call {variantId?} — STAFF: call the queue as far as stock allows. */
  function adminCallQueue(user, input = {}) {
    requireStaff(user);
    const variantId =
      typeof input.variantId === "string" && input.variantId.trim() ? input.variantId.trim() : null;
    const productId =
      typeof input.productId === "string" && input.productId.trim() ? input.productId.trim() : null;
    const result = tx(() => {
      const variants = variantId
        ? [{ variant_id: variantId }]
        : all(
            `SELECT DISTINCT r.variant_id FROM reservations r JOIN variants v ON v.id=r.variant_id
             WHERE r.status='PREORDER' AND r.stage='queued'${productId ? " AND v.product_id=?" : ""}`,
            ...(productId ? [productId] : []),
          );
      const called = variants.flatMap((v) => callForVariant(v.variant_id));
      const waiting = one(
        "SELECT COUNT(*) AS n FROM reservations WHERE status='PREORDER' AND stage='queued'",
      ).n;
      auditDetail(user, "PREORDER_CALL", variantId ?? productId ?? "all", {
        called: called.map((c) => c.id),
      });
      return { called: called.length, queueNumbers: called.map((c) => c.queue_number), waiting };
    });
    return result;
  }

  // ----------------------------------------------------------------- tick

  /** Lapse this one reservation now if its window ran out (pay / retry call this first). */
  function lapseIfDue(user, id) {
    if (!user || typeof id !== "string" || !id) return false;
    try {
      if (shopSettings().shopOpen === false) return false;
      const r = one(
        "SELECT * FROM reservations WHERE id=? AND user_id=? AND status='PREORDER' AND stage='called' AND pay_by<=?",
        id,
        user.id,
        nowSql(),
      );
      if (!r) return false;
      const done = tx(() => lapse(r));
      if (done) bump(["orders", "notify", "customers", "catalog"]);
      return !!done;
    } catch (error) {
      console.error("Preorder lapse check failed:", error.message);
      return false;
    }
  }

  /**
   * Reminders, lapses and calls. Runs from the pending-order sweep (at most once a minute)
   * or directly in tests. Never throws into the request.
   */
  function tick() {
    try {
      if (shopSettings().shopOpen === false) return { reminded: 0, lapsed: 0, called: 0 };
      const now = clock();
      const reminders = all(
        `SELECT * FROM reservations WHERE status='PREORDER' AND stage='called' AND reminded_at IS NULL
           AND pay_by>? AND pay_by<=? LIMIT 200`,
        sqlTime(now),
        sqlTime(now + REMIND_BEFORE_MS),
      );
      const due = all(
        "SELECT * FROM reservations WHERE status='PREORDER' AND stage='called' AND pay_by<=? ORDER BY pay_by LIMIT 200",
        sqlTime(now),
      );
      const variants = all(
        "SELECT DISTINCT variant_id FROM reservations WHERE status='PREORDER' AND stage='queued' LIMIT 200",
      );
      if (!reminders.length && !due.length && !variants.length) return { reminded: 0, lapsed: 0, called: 0 };
      const result = tx(() => {
        let reminded = 0;
        for (const r of reminders) {
          const marked = run(
            "UPDATE reservations SET reminded_at=? WHERE id=? AND reminded_at IS NULL AND stage='called'",
            sqlTime(now),
            r.id,
          ).changes;
          if (!marked) continue;
          const minutes = Math.max(1, Math.round((msOf(r.pay_by) - now) / 60000));
          notify(
            r.user_id,
            "preorder_reminder",
            "ใกล้หมดเวลาชำระพรีออเดอร์",
            "คิว #" + r.queue_number + " · ชำระ " + thb(balanceDue(r)) + " ภายใน " +
              (minutes >= 60 ? Math.round(minutes / 60) + " ชั่วโมง" : minutes + " นาที"),
            "/orders/" + r.id,
          );
          queueEmail("preorder_reminder", { ...r, due: balanceDue(r) });
          reminded++;
        }
        let lapsed = 0;
        let called = 0;
        for (const r of due) {
          const done = lapse(r);
          if (done) {
            lapsed++;
            called += done.called.length;
          }
        }
        for (const v of variants) called += callForVariant(v.variant_id).length;
        return { reminded, lapsed, called };
      });
      flushEmails();
      if (result.reminded || result.lapsed || result.called) bump(["orders", "notify", "customers", "catalog"]);
      return result;
    } catch (error) {
      dropEmails();
      console.error("Preorder tick failed:", error.message);
      return { reminded: 0, lapsed: 0, called: 0, error: error.message };
    }
  }

  /**
   * saveSettings → shop switch changed. Closing remembers when; reopening moves every called
   * reservation's pay_by later by the closed time inside its window.
   */
  function onShopOpenChange(wasOpen, isOpen) {
    if (wasOpen === isOpen) return 0;
    const now = clock();
    if (!isOpen) {
      run(
        "INSERT INTO runtime_flags(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        CLOSED_FLAG,
        String(now),
      );
      return 0;
    }
    const closedAt = Number(one("SELECT value FROM runtime_flags WHERE key=?", CLOSED_FLAG)?.value ?? 0);
    run("DELETE FROM runtime_flags WHERE key=?", CLOSED_FLAG);
    if (!closedAt || closedAt >= now) return 0;
    return tx(() => {
      let moved = 0;
      for (const r of all(
        "SELECT id,called_at,pay_by,pay_window_hours FROM reservations WHERE status='PREORDER' AND stage='called'",
      )) {
        const payBy = msOf(r.pay_by);
        if (!(payBy > closedAt)) continue; // already due before the shop closed
        const from = Math.max(closedAt, msOf(r.called_at) || closedAt);
        const shift = now - from;
        if (shift <= 0) continue;
        const next = payBy + shift;
        run(
          "UPDATE reservations SET pay_by=?, reminded_at=CASE WHEN ? THEN NULL ELSE reminded_at END WHERE id=?",
          sqlTime(next),
          next - now > REMIND_BEFORE_MS && (r.pay_window_hours ?? PAY_WINDOW_DEFAULT) * 3600000 > REMIND_BEFORE_MS ? 1 : 0,
          r.id,
        );
        auditDetail(null, "PREORDER_PAY_BY_EXTENDED", r.id, {
          from: r.pay_by,
          to: sqlTime(next),
          closedMinutes: Math.round(shift / 60000),
        });
        moved++;
      }
      return moved;
    });
  }

  // ----------------------------------------------------------------- views

  /** Extra fields for orderDetail of a reservation (owner and staff). */
  function reservationView(r) {
    const mode = r.preorder_mode ?? "full";
    if (mode === "full") return { preorderMode: "full", amountDue: r.total };
    const due = balanceDue(r);
    const amountDue =
      r.status === "PENDING_PAYMENT" ? r.deposit : r.status === "PREORDER" && r.stage === "called" ? due : 0;
    const ahead =
      r.status === "PREORDER" && r.stage === "queued"
        ? one(
            `SELECT COUNT(*) AS n FROM reservations WHERE variant_id=? AND status='PREORDER'
               AND stage IN ('queued','called') AND queue_number < ?`,
            r.variant_id,
            r.queue_number,
          ).n
        : null;
    return {
      preorderMode: mode,
      stage: r.stage ?? null,
      deposit: r.deposit ?? 0,
      depositPaid: r.deposit_paid ?? 0,
      balanceDue: due,
      amountDue,
      payBy: r.pay_by ?? null,
      calledAt: r.called_at ?? null,
      endedAt: r.ended_at ?? null,
      payWindowHours: r.pay_window_hours ?? PAY_WINDOW_DEFAULT,
      lapsePolicy: mode === "deposit" ? (r.lapse_policy ?? "refund_credit") : null,
      queueAhead: ahead,
    };
  }

  /** Deposits held for reservations not delivered yet (a liability, not extra revenue). */
  function depositsHeld(moneyScope) {
    const pay = moneyScope ? moneyScope.payment("p.") : "1=1";
    const led = moneyScope ? moneyScope.ledger("l.") : "1=1";
    const paid = one(
      `SELECT COALESCE(SUM(p.amount),0) AS n, COUNT(DISTINCT r.id) AS count FROM payments p
       JOIN reservations r ON r.id=p.reservation_id
       WHERE p.purpose='deposit' AND p.status='SUCCEEDED' AND r.status='PREORDER' AND ${pay}`,
    );
    const refunded = one(
      `SELECT COALESCE(SUM(ABS(l.amount)),0) AS n FROM ledger l JOIN reservations r ON r.id=l.order_id
       WHERE l.kind='REFUND' AND r.status='PREORDER' AND r.preorder_mode='deposit' AND ${led}`,
    ).n;
    return { amount: Math.max(0, paid.n - refunded), reservations: paid.count };
  }

  return {
    productSettings,
    publicTerms,
    adminPreorderSettings,
    adminSavePreorderSettings,
    reservationTerms,
    enterQueue,
    afterDepositPaid,
    callForVariant,
    payBalance,
    balanceDue,
    releaseHeld,
    cancelMyReservation,
    adminCancelReservation,
    adminCallQueue,
    lapseIfDue,
    tick,
    onShopOpenChange,
    reservationView,
    depositsHeld,
    flushEmails,
    dropEmails,
  };
}
