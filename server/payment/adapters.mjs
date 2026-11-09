import { randomUUID, createHash } from "node:crypto";
import { ApiError } from "../domain.mjs";

const fail = (status, message) => {
  throw new ApiError(status, message);
};

/**
 * Sandbox adapter only — SlipOK/Gateway stay blocked until Client confirms provider.
 * @returns {import('../../packages/contracts/src/payment.ts').PaymentAdapter & {
 *   confirmSandbox(input: { paymentId: string, confirmationToken: string, outcome: 'success'|'failure' }): Promise<import('../../packages/contracts/src/payment.ts').PaymentResult>
 * }}
 */
export function createSandboxPaymentAdapter({ db, transaction }) {
  const one = (sql, ...params) => db.prepare(sql).get(...params);
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

  function rowToResult(row) {
    return {
      paymentId: row.id,
      status: row.status,
      provider: row.provider,
      providerRef: row.provider_ref ?? undefined,
    };
  }

  return {
    providerId: "sandbox",

    async createPayment(input) {
      if (!input?.idempotencyKey || !input.userId || !input.money)
        fail(400, "ข้อมูลการชำระเงินไม่ครบ");
      if (!Number.isSafeInteger(input.money.amount) || input.money.amount < 0)
        fail(400, "ยอดเงินไม่ถูกต้อง");
      if (input.money.currency !== "THB") fail(400, "สกุลเงินไม่รองรับ");
      if (!input.orderId && !input.reservationId)
        fail(400, "ต้องระบุคำสั่งซื้อหรือพรีออเดอร์");
      if (input.orderId && input.reservationId)
        fail(400, "ระบุได้เพียงคำสั่งซื้อหรือพรีออเดอร์อย่างใดอย่างหนึ่ง");

      return tx(() => {
        const existing = one(
          "SELECT * FROM payments WHERE idempotency_key=?",
          input.idempotencyKey,
        );
        if (existing) {
          if (
            existing.user_id !== input.userId ||
            existing.amount !== input.money.amount ||
            (existing.order_id ?? null) !== (input.orderId ?? null) ||
            (existing.reservation_id ?? null) !== (input.reservationId ?? null)
          )
            fail(409, "รหัสคำขอนี้ถูกใช้กับรายการชำระอื่นแล้ว");
          return rowToResult(existing);
        }
        const confirmationToken = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
        const id = randomUUID();
        const providerRef = "sandbox:" + id;
        run(
          `INSERT INTO payments(
            id, order_id, reservation_id, user_id, amount, currency, status,
            provider, provider_ref, idempotency_key, confirmation_hash, created_at
          ) VALUES(?,?,?,?,?,?,'PENDING','sandbox',?,?,?,CURRENT_TIMESTAMP)`,
          id,
          input.orderId ?? null,
          input.reservationId ?? null,
          input.userId,
          input.money.amount,
          input.money.currency,
          providerRef,
          input.idempotencyKey,
          createHash("sha256").update(confirmationToken).digest("hex"),
        );
        const result = rowToResult(one("SELECT * FROM payments WHERE id=?", id));
        result.confirmationToken = confirmationToken;
        return result;
      });
    },

    async getPayment(providerRef) {
      const row = one("SELECT * FROM payments WHERE provider_ref=?", providerRef);
      if (!row) fail(404, "ไม่พบรายการชำระเงิน");
      return rowToResult(row);
    },

    async parseAndVerifyWebhook() {
      fail(
        501,
        "Webhook ของผู้ให้บริการยังไม่เปิดใช้ — รอ Client ยืนยัน provider",
      );
    },

    async confirmSandbox({ paymentId, confirmationToken, outcome }) {
      if (!["success", "failure"].includes(outcome))
        fail(400, "ผลการทดลองไม่ถูกต้อง");
      return tx(() => {
        const row = one("SELECT * FROM payments WHERE id=?", paymentId);
        if (!row) fail(404, "ไม่พบรายการชำระเงิน");
        if (row.provider !== "sandbox") fail(403, "ไม่ใช่การชำระแบบ sandbox");
        if (
          row.confirmation_hash !==
          createHash("sha256").update(confirmationToken ?? "").digest("hex")
        )
          fail(403, "ข้อมูลยืนยันการชำระเงินไม่ถูกต้อง");
        if (row.status === "SUCCEEDED" || row.status === "FAILED")
          return rowToResult(row);
        if (row.status !== "PENDING") fail(409, "สถานะการชำระไม่ถูกต้อง");
        const status = outcome === "success" ? "SUCCEEDED" : "FAILED";
        run(
          "UPDATE payments SET status=?, finalized_at=CURRENT_TIMESTAMP WHERE id=?",
          status,
          paymentId,
        );
        return rowToResult(one("SELECT * FROM payments WHERE id=?", paymentId));
      });
    },
  };
}

/** Real providers stay inert until Client chooses one in writing. */
export function createBlockedProviderAdapter(providerId) {
  return {
    providerId,
    async createPayment() {
      fail(
        501,
        `Provider ${providerId} ยังไม่เปิดใช้ — รอ Client ยืนยันและส่ง credentials`,
      );
    },
    async parseAndVerifyWebhook() {
      fail(501, `Webhook ${providerId} ยังไม่เปิดใช้`);
    },
  };
}

export const blockedSlipOkAdapter = createBlockedProviderAdapter("slipok");
export const blockedGatewayAdapter = createBlockedProviderAdapter("gateway");
