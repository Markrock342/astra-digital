# กติกาเงินในระบบ + สเปกที่รอผู้ให้บริการรับเงินจริง

สถานะ: ใช้กับ branch `feat/finance-hardening` · ผู้ตัดสินใจเรื่อง provider, นโยบายกระเป๋าเงิน และการถอน: **Mark**

## 1. กติกาที่ใช้แล้วในโค้ด (`server/money.mjs`)

| เรื่อง | กติกา |
|---|---|
| ยอดเครดิตลูกค้า | `SUM(net)` ของแถว wallet: `DEMO_CREDIT`, `TOPUP`, `PURCHASE`, `ADJUSTMENT` และ `REFUND` ที่ `direction='in'` (คืนเข้าเครดิต) ใช้สูตรเดียวทั้งฝั่งลูกค้า (`publicUser`, `/api/ledger`) และฝั่งแอดมิน |
| ห้ามติดลบ | ตรวจในทรานแซกชันเดียวกับการตัดเงิน (`pay`, ปรับลดเครดิต) |
| ยอดขาย (FR-F10) | `payments.status='SUCCEEDED'` − แถว `REFUND` ทั้งสองทิศ ใช้สูตรเดียวกันในการ์ด กราฟรายวัน รายงาน และ `adminOverview` |
| คืนนอกระบบ | `REFUND` `direction='out'` ลดรายได้ ไม่แตะกระเป๋าลูกค้า เลขอ้างอิงการโอนเก็บใน `provider_ref` |
| เงินทดสอบ (livemode) | โหมดทดสอบ (`ASTRA_TEST_PAYMENTS=on`) นับเงินทดสอบทุกตัวเลข โหมดจริงตัดออกทุกสูตรและทุก CSV: payment `provider='sandbox'`, แถว ledger ที่ผูกกับ payment นั้น, แถว `provider_ref` ขึ้นต้น `sandbox:` และ `DEMO_CREDIT` |
| append-only | trigger ห้าม UPDATE/DELETE ใน `ledger` และ `audit` ยกเว้นการล้างข้อมูลสาธิตครั้งเดียวตอนปิดโหมดทดสอบ ซึ่ง drop/สร้าง trigger ใหม่ในทรานแซกชันเดียวกัน ไม่มีโค้ดไหน UPDATE `ledger.status` สถานะ PENDING/REFUNDED ใน CHECK ยังไม่ถูกใช้ การคืนเงินเป็นแถวใหม่เสมอ |

## 2. สิ่งที่ยังไม่ทำ (รอ Mark เลือก provider)

ไม่สร้างโค้ดส่วนนี้จนกว่า Mark จะเลือกช่องทางรับเงินและนโยบายถอนเงิน

1. **Webhook event store**: ตาราง `payment_events(id, provider, provider_event_id UNIQUE, type, raw_body, signature, received_at, processed_at, error)` เก็บข้อมูลดิบก่อนประมวลผล
2. **ตรวจลายเซ็น** ด้วย secret ของ provider ก่อนอ่าน body · ปฏิเสธ event ที่เก่ากว่า 5 นาที
3. **Idempotent** ตาม `provider_event_id` และ `payments.idempotency_key`
4. **ตรวจยอดและสกุลเงิน** ให้ตรงกับออเดอร์ก่อนเปลี่ยนสถานะ ไม่ตรงให้ค้างไว้ในคิวรอตรวจ
5. **State machine** `payments`: PENDING → SUCCEEDED / FAILED / CANCELLED เท่านั้น เขียน `PAYMENT_IN` (+ `FEE` ถ้ามี) เมื่อ SUCCEEDED
6. **สลิปโอน** (ถ้าเลือก): เลขอ้างอิงธนาคาร UNIQUE กันสลิปซ้ำ · คิวรอแอดมินตรวจ
7. **คืนเงินผ่าน provider**: ตอนนี้มีแค่ "เครดิตร้าน" และ "คืนนอกระบบ" ถ้า provider รองรับ refund API ให้เพิ่มปลายทางที่สามโดยเขียน `REFUND` สถานะ PENDING เป็นแถวใหม่ แล้วเขียนแถวยืนยันเมื่อ webhook ตอบกลับ (ไม่ UPDATE แถวเดิม)
8. **ถอน / จ่ายออก (FR-F7)** และ **กระทบยอด (FR-F8)**: รูปแบบและหลักฐานให้ Mark กำหนด
9. **วันเปิดร้านจริง**: ลบ `ASTRA_TEST_PAYMENTS` ออกจาก `wrangler.jsonc` ตัวเลขทุกหน้าจะตัดเงินทดสอบอัตโนมัติ ไม่ต้องลบข้อมูล
