import { randomUUID, createHash } from "node:crypto";
import { ApiError } from "../domain.mjs";
import { createSandboxPaymentAdapter } from "../payment/adapters.mjs";

const fail = (status, message) => {
  throw new ApiError(status, message);
};

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Order + payment + allocation on D1 target schema (sandbox provider only).
 */
export function createD1Fulfillment(db, { transaction } = {}) {
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const tx =
    transaction ??
    ((fn) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });

  const payments = createSandboxPaymentAdapter({ db, transaction: tx });

  function balanceOf(userId) {
    return one(
      "SELECT COALESCE(SUM(amount),0) AS value FROM ledger WHERE user_id=?",
      userId,
    ).value;
  }

  function deliveryFor(orderId, userId) {
    const order = one(
      "SELECT * FROM orders WHERE id=? AND user_id=?",
      orderId,
      userId,
    );
    if (!order) fail(404, "ไม่พบคำสั่งซื้อ");
    const codes =
      order.status === "DELIVERED"
        ? all(
            `SELECT u.secret AS code
             FROM allocations a
             JOIN inventory_units u ON u.id = a.inventory_unit_id
             WHERE a.order_id=? AND a.user_id=?
             ORDER BY a.allocated_at ASC, a.id ASC`,
            orderId,
            userId,
          ).map((row) => row.code)
        : [];
    return {
      id: order.id,
      status: order.status,
      total: order.total,
      quantity: order.quantity,
      codes,
    };
  }

  function createOrder(userId, { variantId, quantity = 1, requestKey }) {
    if (!userId) fail(401, "กรุณาเข้าสู่ระบบก่อนดำเนินการ");
    if (!requestKey) fail(400, "รหัสคำขอไม่ถูกต้อง");
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10)
      fail(400, "จำนวนไม่ถูกต้อง");

    return tx(() => {
      const prior = one(
        "SELECT * FROM orders WHERE user_id=? AND request_key=?",
        userId,
        requestKey,
      );
      if (prior) {
        if (prior.variant_id !== variantId || prior.quantity !== quantity)
          fail(409, "รหัสคำขอถูกใช้กับคำสั่งซื้ออื่นแล้ว");
        const existingPay = one(
          "SELECT * FROM payments WHERE order_id=? AND user_id=?",
          prior.id,
          userId,
        );
        return {
          ...deliveryFor(prior.id, userId),
          paymentId: existingPay?.id ?? null,
          paymentToken: null,
        };
      }
      const variant = one("SELECT * FROM variants WHERE id=?", variantId);
      if (!variant) fail(404, "ไม่พบสินค้า");
      const id = randomUUID();
      const total = variant.price * quantity;
      run(
        `INSERT INTO orders(
          id, user_id, variant_id, quantity, total, status, request_key, created_at
        ) VALUES(?,?,?,?,?,'PENDING_PAYMENT',?,CURRENT_TIMESTAMP)`,
        id,
        userId,
        variantId,
        quantity,
        total,
        requestKey,
      );
      run(
        "INSERT INTO audit(user_id,action,entity_id) VALUES(?,?,?)",
        userId,
        "CREATE_ORDER",
        id,
      );

      const idempotencyKey = "pay:" + userId + ":" + requestKey;
      const confirmationToken =
        randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
      const paymentId = randomUUID();
      run(
        `INSERT INTO payments(
          id, order_id, reservation_id, user_id, amount, currency, status,
          provider, provider_ref, idempotency_key, confirmation_hash, created_at
        ) VALUES(?,?,NULL,?,?,'THB','PENDING','sandbox',?,?,?,CURRENT_TIMESTAMP)`,
        paymentId,
        id,
        userId,
        total,
        "sandbox:" + paymentId,
        idempotencyKey,
        hash(confirmationToken),
      );
      return {
        ...deliveryFor(id, userId),
        paymentId,
        paymentToken: confirmationToken,
      };
    });
  }

  function confirmAndFulfill(userId, { orderId, paymentToken, outcome }) {
    if (!userId) fail(401, "กรุณาเข้าสู่ระบบก่อนดำเนินการ");
    if (!["success", "failure"].includes(outcome))
      fail(400, "ผลการทดลองไม่ถูกต้อง");

    return tx(() => {
      const order = one(
        "SELECT * FROM orders WHERE id=? AND user_id=?",
        orderId,
        userId,
      );
      if (!order) fail(404, "ไม่พบคำสั่งซื้อ");
      if (order.status === "DELIVERED") return deliveryFor(orderId, userId);
      if (order.status !== "PENDING_PAYMENT")
        fail(409, "คำสั่งซื้อนี้ไม่สามารถชำระเงินได้");

      const payment = one(
        "SELECT * FROM payments WHERE order_id=? AND user_id=?",
        orderId,
        userId,
      );
      if (!payment) fail(404, "ไม่พบรายการชำระเงิน");
      if (payment.confirmation_hash !== hash(paymentToken ?? ""))
        fail(403, "ข้อมูลยืนยันการชำระเงินไม่ถูกต้อง");
      if (payment.status === "SUCCEEDED") return deliveryFor(orderId, userId);

      if (outcome === "failure") {
        run(
          "UPDATE payments SET status='FAILED', finalized_at=CURRENT_TIMESTAMP WHERE id=?",
          payment.id,
        );
        run("UPDATE orders SET status='FAILED' WHERE id=?", orderId);
        run(
          "INSERT INTO audit(user_id,action,entity_id) VALUES(?,?,?)",
          userId,
          "PAYMENT_FAILED",
          orderId,
        );
        return deliveryFor(orderId, userId);
      }

      const available = all(
        `SELECT u.id, u.secret
         FROM inventory_units u
         LEFT JOIN allocations a ON a.inventory_unit_id = u.id
         WHERE u.variant_id=? AND a.id IS NULL
         ORDER BY u.created_at ASC, u.id ASC
         LIMIT ?`,
        order.variant_id,
        order.quantity,
      );
      if (available.length !== order.quantity) {
        run("UPDATE orders SET status='OUT_OF_STOCK' WHERE id=?", orderId);
        run(
          "INSERT INTO audit(user_id,action,entity_id) VALUES(?,?,?)",
          userId,
          "OUT_OF_STOCK",
          orderId,
        );
        return deliveryFor(orderId, userId);
      }

      if (balanceOf(userId) < order.total)
        fail(409, "เครดิตทดลองไม่เพียงพอ กรุณาเติมเครดิตก่อน");

      const ledgerRef = "debit:" + orderId;
      if (!one("SELECT id FROM ledger WHERE reference=?", ledgerRef)) {
        run(
          `INSERT INTO ledger(id,user_id,amount,reference,label,kind,created_at)
           VALUES(?,?,?,?,?,'DEMO_CREDIT',CURRENT_TIMESTAMP)`,
          randomUUID(),
          userId,
          -order.total,
          ledgerRef,
          "ชำระคำสั่งซื้อ (sandbox)",
        );
      }

      run(
        "UPDATE payments SET status='SUCCEEDED', finalized_at=CURRENT_TIMESTAMP WHERE id=?",
        payment.id,
      );

      for (const unit of available) {
        run(
          `INSERT INTO allocations(id,inventory_unit_id,order_id,user_id,allocated_at)
           VALUES(?,?,?,?,CURRENT_TIMESTAMP)`,
          randomUUID(),
          unit.id,
          orderId,
          userId,
        );
      }

      run("UPDATE orders SET status='DELIVERED' WHERE id=?", orderId);
      run(
        "INSERT INTO audit(user_id,action,entity_id) VALUES(?,?,?)",
        userId,
        "PAYMENT_AND_DELIVERY",
        orderId,
      );
      return deliveryFor(orderId, userId);
    });
  }

  function credit(userId, amount, reference) {
    run(
      `INSERT INTO ledger(id,user_id,amount,reference,label,kind,created_at)
       VALUES(?,?,?,?,?,'DEMO_CREDIT',CURRENT_TIMESTAMP)`,
      randomUUID(),
      userId,
      amount,
      reference,
      "เครดิตทดลอง",
    );
  }

  return {
    payments,
    createOrder,
    confirmAndFulfill,
    deliveryFor,
    credit,
    balanceOf,
  };
}
