# DB-03 — Data Integrity & Transactions

สถานะ: Draft for Mark Review  
อิงโค้ด: `server/domain.mjs`, `server/payment/adapters.mjs`, เทส commerce / nott-ops / d1-fulfillment / migration-upgrade

## 1. แผนที่ความเสี่ยง → การป้องกันปัจจุบัน → ช่องว่าง

### 1.1 ซื้อพร้อมกันได้ Digital Key เดียวกัน

| | |
|--|--|
| **ป้องกันปัจจุบัน** | เลือกแถว `inventory` ที่ `order_id IS NULL` แล้ว `UPDATE … SET order_id=? WHERE id=? AND order_id IS NULL` ภายใน `tx` / `transactionSync` (`domain.mjs` pay path ~881) |
| **เสริมด้วย schema** | `fingerprint` UNIQUE — กัน import โค้ดซ้ำ |
| **ช่องว่าง** | หลาย DO (astra_space) = คนละสต็อก → “แข่งกัน” ไม่เกิดข้ามเบราว์เซอร์จนกว่าจะรวมร้านเดียว |
| **Idempotency** | pay ซ้ำเมื่อสถานะ DELIVERED คืนโค้ดเดิม ไม่ allocate เพิ่ม (เทส commerce) |

### 1.2 Stock ติดลบ / ตัดซ้ำ

| | |
|--|--|
| **ป้องกัน** | นับหน่วยว่างจากแถว inventory ไม่มีคอลัมน์ stock ตัวเลขที่ลดเอง; ถ้าจำนวนว่าง ≠ quantity → OUT_OF_STOCK |
| **ช่องว่าง** | ไม่มี CHECK ระดับตารางว่าจำนวน allocate ≤ ของที่มี — พึ่ง transaction ในแอป |

### 1.3 Payment Callback ซ้ำ

| | |
|--|--|
| **ปัจจุบัน** | Sandbox ใช้ `paymentToken` + `payment_hash` บนออเดอร์; ตาราง `payments.idempotency_key` UNIQUE และ partial unique `(provider, provider_ref)` |
| **ช่องว่าง** | ยังไม่มี webhook จริง / ตาราง `payment_events` — ต้องมีก่อนเปิด SlipOK/Gateway |
| **นโยบาย** | ยังไม่เปิด SlipOK/Gateway จนกว่าลูกค้าเลือก |

### 1.4 Order เปลี่ยนสถานะผิดลำดับ

| | |
|--|--|
| **สถานะ orders** | PENDING_PAYMENT → DELIVERED \| FAILED \| OUT_OF_STOCK \| CANCELLED |
| **สถานะ reservations** | PENDING_PAYMENT → PREORDER \| FAILED \| CANCELLED |
| **ป้องกัน** | pay ตรวจสถานะก่อนทำงาน; DELIVERED/PREORDER แล้วเรียกซ้ำ = no-op สำเร็จ |
| **ช่องว่าง** | ไม่มีตาราง state machine / ไม่มี DB trigger บังคับ transition — พึ่งแอป |

### 1.5 Preorder Queue หมายเลขซ้ำ

| | |
|--|--|
| **ป้องกัน** | `UNIQUE` partial บน `queue_number`; assign ใน tx ด้วย `MAX+1` (`nextQueueNumber`) |
| **ช่องว่าง** | `MAX+1` ภายใต้ concurrency สูงอาจชนแล้ว retry — ควรจับ UNIQUE constraint แล้วคำนวณใหม่ (ระบุใน Test Plan) |

### 1.6 เข้าถึงข้อมูลข้ามบัญชี

| พื้นที่ | กฎ |
|---------|-----|
| ออเดอร์/โค้ด | owner เท่านั้นที่เห็น codes; STAFF ดูเมตาได้แต่ codes ว่าง |
| คิว | `queueBoard` = STAFF/ADMIN; `myQueue` = ของตัวเอง |
| แชท | เจ้าของ thread หรือ staff; ห้ามอ่าน thread คนอื่น |
| แจ้งเตือน | filter `user_id` |
| อันดับผู้ซื้อ | aggregate + ปิดบังชื่อ; ไม่เปิดรหัสสินค้า |
| สินค้า API | ไม่มี secret / DEMO-KEY |

Role **ไม่รับจาก body ฝั่ง client** (`withoutClientPrivileges` / `auth-policy.mjs`)

### 1.7 Migration ทำให้ข้อมูลเดิมเสียหาย

| | |
|--|--|
| **ป้องกัน** | `executeSqliteMigration` + `PRAGMA defer_foreign_keys` + `foreign_key_check` (`sqlite-migrations.mjs`) |
| **เทส** | `tests/migration-upgrade.test.mjs` — 004 บนฐานมีข้อมูล; FK พังต้อง rollback marker |
| **กติกา** | รอบนี้ห้าม deploy migration ใหม่; ไม่แก้ไฟล์ 004 |

## 2. Transaction boundaries ที่แนะนำให้คงไว้

1. **สร้างออเดอร์** — insert order/reservation + เก็บ payment_hash ใน tx เดียว  
2. **จ่ายสำเร็จ (สินค้าพร้อมส่ง)** — ตรวจสถานะ → จอง inventory ว่าง → หัก ledger DEMO_CREDIT → ตั้ง DELIVERED → บันทึก payments → notify  
3. **จ่ายพรีออเดอร์** — หักเครดิต (ถ้ามี) → PREORDER + queue_number → payments → notify  
4. **Import โค้ด** — ตรวจ fingerprint ซ้ำทั้งชุดแล้ว insert ใน tx (fail ทั้งก้อนถ้าซ้ำ)  
5. **Migration** — ทั้งไฟล์ใน tx ของ DO; ตรวจ FK ก่อน commit ทาง logic ของ helper  

## 3. Idempotency keys

| การกระทำ | คีย์ |
|----------|------|
| สร้างออเดอร์ | `(user_id, request_key)` |
| เติมเครดิตทดลอง | `ledger.reference` = topup-… |
| แถว payments | `idempotency_key` (เช่น `pay:order:<id>`) |
| Provider callback (อนาคต) | `(provider, provider_ref)` + event log |

## 4. สิทธิ์คิว / แชท / อันดับ (ตามข้อตกลงน็อต)

- คงตรวจสิทธิ์ฝั่ง server ทุกครั้ง  
- รหัสสินค้าห้ามโผล่ใน API สินค้า  
- ไม่เปิด SlipOK/Gateway ในชั้น integrity นี้  

## 5. สิ่งที่ขอ Mark ล็อก (ถ้าจะ harden เพิ่ม)

- บังคับ state transition ที่ DB หรือพอที่แอป?  
- เพิ่ม `payment_events` ก่อนมี webhook หรือไม่?  
- หลังรวมร้านเดียว: แผนทดสอบ race ข้ามผู้ใช้บน DO เดียวเป็น DoD ของงาน Worker
