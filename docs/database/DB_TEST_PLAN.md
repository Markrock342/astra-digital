# DB-05 — Database Test Plan

สถานะ: Draft for Mark Review  
เป้าหมาย: ครอบคลุม Acceptance ของโจทย์ + map ไปเทสที่มี/ที่ต้องเพิ่ม  
**รอบนี้ยังไม่บังคับเขียนเทสใหม่ทั้งหมด** — แผนนี้เป็นสัญญาให้ Mark ตรวจก่อนลงมือหลังล็อก schema

## 1. แมปโจทย์ → เคส

| หัวข้อโจทย์ | เคสหลัก | มีในรีโปแล้ว? | ช่องว่าง |
|-------------|---------|----------------|----------|
| Foreign Key Integrity | migrate แล้ว `PRAGMA foreign_key_check` ว่าง; insert orphan ต้องพัง | บางส่วน (`migration-upgrade`, helper) | เคส orphan ต่อตารางใหม่เมื่อมี 005+ |
| Unique Constraints | fingerprint, request_key, idempotency_key, queue_number, email | commerce / nott-ops | เคสชัดเจนต่อ payment_events ถ้าเพิ่ม |
| Concurrent Orders | คนสุดท้ายแข่ง key เดียว | commerce + d1-fulfillment | หลังร้านเดียว: แข่งข้ามสอง session บน DO เดียวกัน |
| Digital Key Allocation | 1 หน่วย = 1 ออเดอร์; pay ซ้ำไม่เพิ่ม | commerce, d1-fulfillment | — |
| Duplicate Payment Events | idempotent pay; unique provider_ref | บางส่วน | ต้องมีเมื่อมี webhook/events |
| Migration Upgrade | 004 บนฐานมีข้อมูล | migration-upgrade.test.mjs | ทำซ้ำแบบเดียวกันทุกไฟล์ใหม่ |
| Data Preservation | users/orders/keys/balances คงหลัง upgrade | migration-upgrade | backup restore smoke (manual/local) |
| Authorization / Isolation | อ่านออเดอร์คนอื่น 404; staff ไม่เห็นโค้ด; แชทข้ามบัญชี 403; สินค้าไม่มี secret | commerce, nott-ops, d1-catalog | คิวไม่ซ้ำ (C3), แจ้งเตือนไม่หลุดข้ามบัญชี (A4), สิทธิ์ ranking (A5 ขยาย) = **ยังขาด** |

## 2. เคสเชิงลบที่ต้องผ่านเสมอ

1. Import โค้ด/คู่ credential ซ้ำ (fingerprint) → 409 ทั้งชุด ไม่ค้างครึ่งทาง  
2. Forged paymentToken → 403 ไม่ส่งโค้ด ไม่หักเครดิต  
3. Customer เรียก staff queue / admin → 403  
4. Product list/detail JSON ไม่มี `secret` / `DEMO-KEY` / login / password / `*_enc`  
5. ตั้ง payment_channel เป็น slipok/gateway โดยไม่มีสิทธิ์ตามนโยบาย → บล็อก; pay ไม่เดินบน provider จริง  

### 2.1 เคส credential คู่ (DB-DOC-01 — สถานะ: ออกแบบแล้ว · implement **ยังขาด**)

| ID | สถานการณ์ | คาดหวัง |
|----|-----------|---------|
| K1 | `GET /api/products` และ `GET /api/products/:id` หลังมีคอลัมน์สองช่อง | JSON ไม่มี `secret`, `login_id`, `password`, `login_id_enc`, `password_enc`, plaintext |
| K2 | Staff เรียก `GET /api/staff/orders` และดู orderDetail ของลูกค้า | ไม่มี credential คู่ / codes |
| K3 | Admin overview / inventory admin path / admin deliver ซ้ำ | ไม่ส่ง plaintext หรือ enc fields; deliver ซ้ำได้แค่ metadata (ดู P* ใน DOC-02) |
| K4 | Owner อ่านออเดอร์/พรีออเดอร์ตัวเองหลัง DELIVERED | ได้ login+password ของตนเท่านั้น; user อื่น 404 |

## 3. เคส Migration (local เท่านั้นจนกว่าจะได้รับอนุญาต)

| ID | ขั้นตอน | ผ่านเมื่อ |
|----|---------|-----------|
| M1 | สร้าง fixture แบบ legacy ก่อน 004 → apply 004 | แถวเดิมครบ + schema_migrations มี 004 |
| M2 | ใส่ FK พังระหว่าง rebuild | ไม่มี marker 004; ข้อมูลแม่ไม่หาย (ตามเทสปัจจุบัน) |
| M3 | (อนาคต) fixture หลัง 004 → apply 005 | คอลัมน์/ตารางใหม่มี; แถวเก่าครบ |
| M4 | รัน migrate สองครั้ง | ไม่พัง; marker ไม่ซ้ำ |
| MU5 | ก่อน 005: `COUNT(*)` แถว `inventory` ที่มี secret เก่า | บันทึกจำนวน; ถ้า 0 ข้าม legacy backfill |
| MU6 | ฐานมีข้อมูล → rebuild inventory ผ่าน `executeSqliteMigration` (credential + `reservation_id` XOR) | แถวเดิมครบ; `login_id_enc`/`password_enc`/`legacy_single_secret` ถูกต้อง; FK ไม่พัง |

## 4. เคส Concurrent / Allocation

| ID | สถานการณ์ | คาดหวัง |
|----|-----------|---------|
| C1 | สต็อก 1 หน่วย สองผู้ซื้อ pay พร้อมกัน | คนหนึ่ง DELIVERED คนหนึ่ง OUT_OF_STOCK |
| C2 | pay สำเร็จแล้ว pay ซ้ำ | โค้ดชุดเดิม; ledger/inventory ไม่เพิ่ม |
| C3 | สองพรีออเดอร์ได้ queue_number คนละเลข | UNIQUE ไม่ชน หรือ retry สำเร็จ — **สถานะเทสต์: ยังขาด** (ยังไม่มี automated case ชัดในรีโป) |

## 5. เคส Authorization / Data Isolation

| ID | สถานการณ์ | คาดหวัง |
|----|-----------|---------|
| A1 | User B อ่าน order ของ A | 404 |
| A2 | Staff อ่าน order ของ A | 200 แต่ codes=[] |
| A3 | User อ่าน chat ของคนอื่น | 403 |
| A4 | notifications ของ user อื่น | ไม่ปนใน list — **สถานะเทสต์: ยังขาด** (ยังไม่มีเคสข้ามบัญชีโดยตรง) |
| A5 | rankings | เงื่อนไขขั้นต่ำเดิม: ไม่มีรหัสสินค้า / mask ชื่อ — มีบางส่วนใน nott-ops · **ยังขาด:** 401/403 เมื่อไม่ใช่แอดมิน + ตัวกรองช่วงวัน/สัปดาห์/เดือน/ทั้งหมด |

## 6. เคส Admin fulfill พรีออเดอร์ (DB-DOC-02 — ออกแบบแล้ว · implement **ยังขาด**)

| ID | สถานการณ์ | คาดหวัง |
|----|-----------|---------|
| P1 | Admin deliver reservation สถานะ PREORDER สต็อกพอ | status=DELIVERED; มี delivered_at/by; inventory.reservation_id ถูกผูกตาม quantity; response เป็น metadata ไม่มี credential |
| P2 | เรียก deliver ซ้ำหลังสำเร็จ | ไม่ allocate เพิ่ม; คืน metadata เดิมเท่านั้น (ไม่มี credential); inventory นับเท่าเดิม |
| P3 | Customer/Staff เรียก deliver | 401/403 (STAFF ไม่ได้ — ADMIN เท่านั้น) |
| P4 | สต็อกไม่พอตอน deliver | 409; reservation ยัง PREORDER; inventory ไม่ถูกผูก |
| P5 | Owner อ่าน orderDetail reservation หลัง DELIVERED | ได้ login+password ของตน; คนอื่น 404 |
| P6 | ฐานมีข้อมูล → rebuild reservations CHECK + inventory XOR | แถวเดิมครบ; DELIVERED/XOR ใช้ได้ |

## 7. เกณฑ์ผ่านรอบ Review (เอกสาร)

งาน Review ผ่านเมื่อ Mark ยอมรับแผนนี้และชุด docs อื่น — **ยังไม่ต้องมีเทสใหม่ครบทุกแถว**  
หลังล็อก schema: เปิด Task implement เทสตามช่องว่างคอลัมน์ “ช่องว่าง” โดยอ้าง ID ในตารางนี้

## 8. นอกขอบเขต

- E2E Frontend (Bank)  
- Penetration test เต็มรูปแบบ  
- Load test production  
- Deploy migration บน production
