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
| คูปอง (`server/coupons.mjs`) | ส่วนลดคิดฝั่งเซิร์ฟเวอร์จากแถว `coupons` + ราคาในฐานข้อมูลเท่านั้น ไม่อ่านราคา/ส่วนลดที่ client ส่งมา `createOrder` ตรวจโค้ดซ้ำในทรานแซกชันเดียวกับการสร้างออเดอร์ แล้วเก็บ `discount` (สตางค์) และ `coupon_code` บน `orders`/`reservations` โดย `total` = ยอดหลังหักส่วนลด ดังนั้น pay (ยอดต้องเท่า `total`), คืนเงิน (สูงสุด paid − refunded), ยอดขาย (payments − refunds) และใบเสร็จตรงกันเอง ยอดหลังหักต้องไม่ต่ำกว่า ฿1 (`orders.total > 0`) |
| ส่วนลดในรายงาน | `salesReport.totals.discounts` = ผลรวม `discount` ของออเดอร์ที่มี payment SUCCEEDED ในช่วงเวลา (ตามขอบเขตเงินทดสอบเดียวกัน) เป็นตัวเลขแยก ไม่หักจากยอดขายซ้ำ เพราะยอดขายคือยอดที่จ่ายจริงอยู่แล้ว |
| สิทธิ์คูปอง | นับจากแถว `coupon_redemptions` ที่ `released_at IS NULL` นับและเขียนในทรานแซกชันเดียวกับ `createOrder` จึงไม่มีการใช้สิทธิ์สุดท้ายซ้ำ ออเดอร์ที่ยังไม่ชำระนับเป็น 1 สิทธิ์จนกว่าจะถูกคืน |

### `releaseCouponForOrder(orderId, reason?)` — สำหรับงานที่ปิดออเดอร์ที่ยังไม่ชำระ (เช่น หมดเวลาชำระอัตโนมัติ)

- อยู่บน service (`service.releaseCouponForOrder`) และส่งเข้า `createAdminCustomerApis` แล้ว
- `orderId` เป็น `orders.id` หรือ `reservations.id` · `reason` เป็นข้อความสั้น (≤ 60) เช่น `EXPIRED` เก็บใน `coupon_redemptions.released_reason`
- คืนค่า `{ released, code, amount }` · id ที่ไม่มี หรือออเดอร์ที่ไม่ได้ใช้โค้ด ได้ `{ released: false }`
- เรียกซ้ำได้ (idempotent) ครั้งที่สองได้ `released: false`
- ไม่คืนสิทธิ์ให้ออเดอร์ที่มี payment `SUCCEEDED` (ออเดอร์ที่ชำระแล้วแล้วคืนเงินยังนับว่าใช้สิทธิ์)
- ไม่เปิดทรานแซกชันเอง (เป็น UPDATE เดียวที่มีเงื่อนไข) ให้เรียก **ในทรานแซกชันเดียวกับ** การเปลี่ยนสถานะออเดอร์เป็นสถานะจบแบบไม่ชำระ
- ถูกเรียกแล้วใน: `adminCancelOrder` (`CANCELLED`), `pay` ผลไม่สำเร็จ (`PAYMENT_FAILED`), สินค้าหมดตอนจ่าย (`OUT_OF_STOCK`)
- แถวออเดอร์ยังเก็บ `discount`/`coupon_code` ไว้เป็นประวัติ

### Endpoint คูปอง

| Method | Path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| POST | `/api/coupons/check` `{code, variantId, quantity}` | ลูกค้าที่ล็อกอิน | `{valid:true, code, subtotal, discount, total}` หรือ `{valid:false, reason}` · จำกัด 15 ครั้ง/บัญชี และ 40 ครั้ง/IP ต่อ 10 นาที (นับรวม `POST /api/orders` ที่ส่ง `couponCode`) |
| POST | `/api/orders` `{…, couponCode?}` | ลูกค้า | ตรวจโค้ดซ้ำในทรานแซกชัน ผลลัพธ์มี `discount`, `subtotal`, `coupon_code` |
| GET | `/api/admin/coupons?q=&status=` | ADMIN | `status`: `active` / `scheduled` / `expired` / `used_up` / `disabled` · มี `counts` |
| GET | `/api/admin/coupons/:id` · `/api/admin/coupons/:id/redemptions` | ADMIN | |
| POST | `/api/admin/coupons` | ADMIN | audit `COUPON_CREATE` · เงินเป็นสตางค์ · เวลาเป็นเวลาไทย `YYYY-MM-DDTHH:MM` |
| PATCH | `/api/admin/coupons/:id` | ADMIN | audit `COUPON_UPDATE` (หรือ `COUPON_DISABLE` ถ้าปิดใช้งาน) |
| POST | `/api/admin/coupons/:id/disable` · `/duplicate` | ADMIN | `COUPON_DISABLE` · สำเนาเป็นโค้ด `-COPY` ปิดไว้ก่อน (`COUPON_CREATE`) |

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
