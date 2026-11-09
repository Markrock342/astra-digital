# PaymentAdapter + Fulfillment Flow

สถานะ: **Approved** (design) · **Implemented Phase 4** (2026-11-09) — sandbox only  
**ห้าม activate** SlipOK / Gateway จนกว่า Client ยืนยัน provider + credentials  
เงิน: **integer satang** · ไม่ส่ง digital key ก่อน `payments.status = SUCCEEDED`  
โค้ด: `server/payment/adapters.mjs` · `server/d1/fulfillment.mjs` · types `@astra/contracts`  
คู่กับ: [erd-target.md](erd-target.md) · [auth-rbac.md](auth-rbac.md)

## 1. สิ่งที่ DONE

| รายการ | หลักฐาน |
|--------|---------|
| PaymentAdapter + `SandboxPaymentAdapter` | `server/payment/adapters.mjs` |
| SlipOK/Gateway ถูกบล็อก (501) | `blockedSlipOkAdapter` / `blockedGatewayAdapter` + เทส |
| Fulfillment บน schema D1: orders → payments → allocations | `server/d1/fulfillment.mjs` |
| Idempotent confirm / one-key-per-unit / last-unit contention / fail ไม่ allocate / IDOR | `tests/d1-fulfillment.test.mjs` |
| Legacy DO sandbox pay ยังผ่าน | `tests/commerce.test.mjs` |

หลักฐานรวม: `npm test` → **27 passed**

## 2. Adapter ที่อนุญาต

| Adapter | สถานะ |
|---------|--------|
| `SandboxPaymentAdapter` | เปิดใช้สำหรับเดโม/เทส |
| SlipOK / Gateway | **NOT DONE / BLOCKED** — `createPayment` / webhook → 501 |

## 3. Fulfillment flow (ของที่ implement แล้ว)

```text
createOrder → INSERT orders PENDING_PAYMENT + payments PENDING + confirmation_hash
confirmAndFulfill(success):
  BEGIN IMMEDIATE
  → ถ้า DELIVERED แล้วคืนของเดิม
  → ตรวจ owner + token hash
  → ถ้า failure: FAILED ไม่ debit/allocate
  → จอง inventory_units ว่างครบ quantity มิฉะนั้น OUT_OF_STOCK
  → ledger debit (unique reference)
  → payments SUCCEEDED + allocations ทีละหน่วย + orders DELIVERED
  COMMIT
  → คืน codes เฉพาะ owner
```

## 4. NOT DONE / BLOCKERS (รอ Client)

| Blocker | ต้องการ |
|---------|---------|
| เลือก provider เดียว | ลายลักษณ์จาก Client |
| Credentials | เข้า secret store เท่านั้น — ไม่ผ่าน git/แชท |
| Webhook verify | signing secret + URL |
| Cutover Worker → D1 payment path ใน production demo | งานแยกหลัง remote D1 |

## 5. Security checklist

- [x] ไม่เชื่อ status จาก client เป็นความจริง (ใช้ confirmation_hash + outcome sandbox ที่ server ตรวจ)
- [x] ไม่ส่ง key ถ้ายังไม่ SUCCEEDED/DELIVERED
- [x] ไม่คืน unused inventory ผ่าน catalog API (Phase 3)
- [x] Webhook provider จริงยังไม่เปิด (501)
- [x] ไม่มี credentials provider ในรีโป
