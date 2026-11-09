# PaymentAdapter + Fulfillment Flow (Proposed)

สถานะ: **ร่าง Task 0.3.2** — design only · **ห้าม activate** SlipOK / Gateway จนกว่า Client ยืนยัน provider + credentials  
เงิน: **integer satang** · ไม่ส่ง digital key ก่อน server ยืนยันว่า payment สำเร็จ  
คู่กับ: [erd-target.md](erd-target.md) · [auth-rbac.md](auth-rbac.md) · ของจริง sandbox ใน `server/domain.mjs` (`pay`, `topup`)

## 1. เป้าหมาย

1. มี **PaymentAdapter interface เดียว** เสียบ provider ได้ทีหลังโดยไม่แก้โดเมนจัดส่งหลัก  
2. คงคุณสมบัติที่เทสแล้ว: idempotent confirm, one-key-per-order-item, last-unit race safety  
3. แยกชัด sandbox เดโม กับ provider จริง — ของจริงยัง **BLOCKED**

## 2. PaymentAdapter (proposed interface)

ภาษาอธิบาย (TypeScript-shaped; ยังไม่ลงใน `packages/contracts` จนกว่า Phase 3):

```ts
/** amounts = integer satang */
export type Money = { amount: number; currency: "THB" };

export type CreatePaymentInput = {
  idempotencyKey: string;
  userId: string;
  orderId?: string;
  reservationId?: string;
  money: Money;
  returnUrl?: string; // reserved; unused until provider chosen
};

export type PaymentStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type PaymentResult = {
  paymentId: string;
  status: PaymentStatus;
  provider: string; // e.g. "sandbox" | future provider id
  providerRef?: string;
};

export type WebhookEvent = {
  provider: string;
  providerRef: string;
  status: PaymentStatus;
  rawType: string;
  /** server-verified; never trust client-relayed status alone */
  verified: true;
};

export interface PaymentAdapter {
  readonly providerId: string;
  createPayment(input: CreatePaymentInput): Promise<PaymentResult>;
  /** Optional until a real provider is selected */
  parseAndVerifyWebhook?(
    request: { headers: Headers; body: string },
  ): Promise<WebhookEvent>;
  getPayment?(providerRef: string): Promise<PaymentResult>;
}
```

### Adapter ที่อนุญาตใน Sprint 1 หลังปลดล็อกโค้ด

| Adapter | ใช้เมื่อไหร่ | Activate จริง? |
|---------|--------------|----------------|
| `SandboxPaymentAdapter` | เดโม/เทส — map จาก confirmation token + outcome ปัจจุบัน | ได้ (พฤติกรรมเดิม) |
| SlipOK / Gateway อื่น | หลัง Client เลือกและส่ง credentials | **ห้าม** จนกว่ามีลายลักษณ์ |

ห้าม hardcode credentials ในรีโปหรือแชท

## 3. Fulfillment flow (เป้าหมาย)

```text
1) createOrder (server price × qty, opaque confirmation / payment row PENDING)
2) client ส่ง intent ยืนยันจ่าย — ไม่ส่งราคา/สถานะเป็นความจริง
3) BEGIN transaction (D1/SQLite write lock หรือเทียบเท่า)
4) ถ้า order จัดส่งแล้ว → คืนของเดิม (idempotent)
5) ตรวจ ownership, payment token/idempotency, stock, credit/provider status
6) บันทึก payments = SUCCEEDED (unique idempotency_key)
7) ledger debit (unique reference) ถ้าใช้ wallet/sandbox credit
8) สร้าง allocations ครบตาม quantity จาก inventory_units ที่ยังว่าง
9) orders.status = DELIVERED + audit
10) COMMIT
11) คืน codes เฉพาะ owner
```

### กรณีผิดพลาด

| สถานการณ์ | ผล | Side effects |
|-----------|-----|--------------|
| outcome/provider = failed | order/payment FAILED | ไม่ debit · ไม่ allocate |
| สต็อกไม่พอ | OUT_OF_STOCK | ไม่ debit |
| เครดิตไม่พอ (sandbox wallet) | คง PENDING (ตามของเดิม) หรือ FAILED ตามนโยบายที่ล็อกใน Phase 4 | ไม่ allocate |
| replay confirm เดิม | คืน delivery เดิม | ไม่ allocate เพิ่ม |
| webhook ซ้ำ (อนาคต) | อ่านจาก UNIQUE(provider, provider_ref) | ไม่ทำซ้ำ |

**ไม่** จองสต็อกก่อนจ่ายใน Sprint นี้ (สต็อกใน UI เป็น advisory; ตรวจใน transaction ตอน confirm — ตรง architecture เดิม)

## 4. กฎ one-key-per-one-order-item

- 1 แถว `inventory_units` → อย่างมาก 1 แถว `allocations`
- 1 order ที่มี `quantity = N` → ได้ precisely N allocations ใน transaction เดียว
- Import โค้ด: `fingerprint = hash(code)` UNIQUE — ซ้ำทั้งก้อน rollback

## 5. Idempotency keys

| พื้นผิว | คีย์ | Unique ที่ |
|--------|------|-----------|
| สร้าง order | `(user_id, request_key)` | `orders` / `reservations` |
| สร้าง/ยืนยัน payment | `payments.idempotency_key` | `payments` |
| Provider webhook | `(provider, provider_ref)` | `payments` partial unique |
| Ledger debit/top-up | `ledger.reference` | `ledger` |

## 6. Mapping จากของปัจจุบัน → เป้าหมาย

| ของปัจจุบัน | เป้าหมาย |
|-------------|----------|
| `payment_hash` บน order + `pay(..., outcome)` | `SandboxPaymentAdapter` + แถว `payments` |
| `topup` presets | คงเป็น TEST ledger เท่านั้น จนกว่ามี provider จริง — **ไม่** แปลงเป็นเงินจริง |
| atomic allocate ใน `pay` | ย้ายเป็นขั้น fulfillment หลัง `PaymentResult.status === SUCCEEDED` |
| ไม่มี webhook | เพิ่มได้เมื่อมี adapter จริง; ต้องมี verify signature |

## 7. Security checklist

- [ ] ไม่เชื่อ status จาก client
- [ ] ไม่ส่ง key ถ้า payment ยังไม่ SUCCEEDED
- [ ] ไม่คืน unused inventory secrets
- [ ] Webhook ต้อง verify ก่อนเข้าโดเมน (เมื่อมี provider)
- [ ] Secrets เฉพาะ env / Cloudflare secret store

## 8. BLOCKERS / NOT DONE จนกว่า Client ตอบ

| Blocker | ต้องการจาก Client |
|---------|-------------------|
| เลือก provider เดียว | ชื่อ provider (เช่น SlipOK หรือ gateway อื่น) เป็นลายลักษณ์ |
| Credentials | ส่งผ่านช่องทางลับเข้า secret store — ไม่ผ่าน git/แชท |
| Webhook URL / signing secret | สำหรับ `parseAndVerifyWebhook` |
| นโยบายยอด/สกุลเงิน | ยืนยัน satang + THB หรืออื่น |

จนกว่านั้น: implement ได้แค่ interface + sandbox adapter + เทสที่มีอยู่/ขยายบน sandbox

## 9. ขั้นถัดไป

- Task **0.3.3**: Owner Approve ชุด design Phase 0 (Auth + ERD + Payment/Fulfillment) และตัดสินใจปลดล็อก Phase 1+  
- Phase 4 (หลังปลดล็อก): code interface + เทส race/retry/webhook-replay (sandbox ก่อน)
