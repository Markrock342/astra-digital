# DB-02 — Schema Proposal

สถานะ: Draft for Mark Review  
คู่กับ: [ERD.md](ERD.md) · [DB_AUDIT.md](DB_AUDIT.md)  
ข้อจำกัดรอบนี้: **ไม่แก้** `server/migrations/004_commerce_ops.sql` · **ไม่ Deploy** migration จริง

## 1. ทิศทางที่เสนอ (อิงโจทย์)

| หัวข้อ | ข้อเสนอ |
|--------|---------|
| Runtime หลัก | คง **Durable Object SQLite** — ยังไม่ย้าย D1 |
| Isolation | เป้า: **ฐานร้านเดียว**; แยกลูกค้าด้วย session (ไม่ใช่ astra_space ต่อสต็อก) |
| ไฟล์ 001–004 | คงไว้เป็นประวัติ; ของใหม่เป็น `005_*.sql` หลังล็อกเท่านั้น |
| D1 track | **แช่แข็ง** เป็นเอกสารเงา จนกว่า Mark สั่ง sync/cutover |
| เงิน | integer satang ทั้งราคา / ledger / payments |
| Ledger | `kind='DEMO_CREDIT'` — ไม่ใช่เงินร้านจริง |
| Payment | ช่องทางเดียว; เปิดได้ sandbox; ไม่เปิด SlipOK/Gateway ในรอบนี้ |

## 2. สิ่งที่คงจาก schema ปัจจุบัน (ต้องไม่ทำลาย)

| กฎ | ที่มา |
|----|--------|
| `inventory.fingerprint` UNIQUE | กันโค้ดซ้ำในคลัง |
| allocate ด้วย `UPDATE … WHERE order_id IS NULL` ใน transaction | กันสองคนได้ key เดียวกัน |
| `UNIQUE(user_id, request_key)` บน orders/reservations | idempotent สร้างออเดอร์ |
| `payments.idempotency_key` UNIQUE + partial unique provider_ref | กันจ่าย/callback ซ้ำ |
| `reservations.queue_number` partial UNIQUE | กันเลขคิวซ้ำ |
| Owner-scoped order/code APIs | กันอ่านข้ามบัญชี |
| Product API ไม่มี secret | domain `products` / `productDetail` |

## 3. Mapping โมดูลโจทย์ → schema

| โมดูลโจทย์ | ของปัจจุบัน | ข้อเสนอ |
|------------|-------------|--------|
| Users / Sessions / Roles | มีครบ (+STAFF) | คง |
| Products / Variants | มี | คง |
| Categories | `products.category` TEXT | **ตัวเลือก A (แนะนำรอบแรก):** คง TEXT · **B:** เพิ่ม `categories` + FK ภายหลัง |
| Digital Keys | `inventory.secret` ช่องเดียว | **เป้า (DB-DOC-01):** สองช่องเข้ารหัส — ดู §4.0 |
| Stock allocation | `inventory.order_id` | คงรอบแรก · **ทางเลือกภายหลัง:** แยก `allocations` |
| Orders | 1 variant / แถว | คงจนกว่ามีตะกร้าหลายชิ้น |
| Order Items | ไม่มี | เพิ่มเมื่อ Mark ล็อก multi-item checkout |
| Cart | ไม่มีฝั่ง DB | รอบแรก: client/Bank · หรือ `cart_items(user_id, variant_id, qty)` หลังล็อก |
| Payments | มี | คง |
| Payment Events | ไม่มี | เสนอ `payment_events` append-only ก่อนเปิด webhook จริง |
| Preorder / Queue | reservations + queue_number | คง |
| Chat / Notifications / Audit | มี | คง |
| Payment channel | มี | คง |

## 4. ตารางที่เสนอเพิ่ม / ปรับ (ยังไม่สร้างไฟล์ SQL ใน PR นี้)

### 4.0 Digital goods = ID + Password สองช่อง (Task DB-DOC-01)

แหล่ง REQ: ลูกค้าส่งสินค้าเป็น **ไอดี + พาสเวิร์ด** · ต้องเข้ารหัสทั้งคู่ · ไม่หลุดใน API สินค้า / staff / admin overview

#### 4.0.1 รูปเป้าบนตาราง `inventory` (แทร็ก A)

```text
inventory (
  id PK,
  variant_id FK → variants,
  fingerprint TEXT NOT NULL UNIQUE,   -- ดูสูตรด้านล่าง
  login_id_enc TEXT NOT NULL,        -- AES-GCM (หรือ primitive เดิมของร้าน) ของ login/ID
  password_enc TEXT NOT NULL,        -- AES-GCM ของ password
  -- secret TEXT  (คอลัมน์เดิม) → เลิกใช้หลัง migrate แล้ว DROP ในขั้นถัดไปถ้าปลอดภัย
  order_id FK NULL → orders,
  sold_at TEXT NULL,
  created_at ...
)
INDEX inventory_available (variant_id, order_id)
```

ทางเลือกชื่อคอลัมน์ตามโจทย์: `login_id_enc`, `password_enc` (แนะนำให้ตรงนี้)

#### 4.0.2 สูตร `fingerprint` (กันของซ้ำ)

Canonical string ก่อน hash (UTF-8, trim ทั้งสองช่อง, คั่นด้วย `\n`):

```text
fingerprint = SHA-256( "v1\n" || trim(login_id) || "\n" || trim(password) )
```

- ต้องคิดจาก **ทั้งสองช่อง** เสมอ — ห้ามใช้แค่ login หรือแค่ password  
- เก็บเฉพาะ digest ใน DB · ไม่เก็บ plaintext  
- `UNIQUE(fingerprint)` คงเดิม → import คู่เดียวกันซ้ำไม่ได้  
- เวอร์ชัน prefix `v1` เผื่อเปลี่ยน canonical ภายหลังโดยไม่ชนของเก่าโดยไม่ตั้งใจ

#### 4.0.3 แผนย้ายแถว `secret` เดิม (ช่องเดียว) → สองช่อง

ของปัจจุบัน: `inventory.secret` = ciphertext ของสตริงเดียว (เดโมเป็นโค้ด `DEMO-…`)

| ขั้น | การกระทำ | หมายเหตุ |
|------|----------|----------|
| M0 | เพิ่มคอลัมน์ `login_id_enc`, `password_enc` แบบ NULL ได้ชั่วคราว + คง `secret` | migration 005 (ยังไม่ทำใน PR นี้) |
| M1 | Backfill แถวเก่า: decrypt `secret` → ได้ plaintext เดิม | ใช้ key ของ **DO/DB เดิม** เท่านั้น |
| M2 | แปลงเป็นคู่ credential ตามกฎ legacy: `login_id = plaintext`, `password = ""` **หรือ** `login_id = "code"`, `password = plaintext` | **ต้องให้ Mark/Owner ล็อกกฎ legacy หนึ่งแบบก่อน backfill จริง** — ค่าแนะนำชั่วคราว: `login_id = legacy_code`, `password = ""` (ว่างที่เข้ารหัสได้) เพื่อไม่ invent password |
| M3 | คำนวณ fingerprint ใหม่จากคู่ที่ได้ · ชน UNIQUE ให้ fail migration / รายงานแถวซ้ำ | |
| M4 | encrypt → เขียน `login_id_enc` / `password_enc` · ตรวจอ่านกลับได้ในเทส | |
| M5 | แอปอ่านสองช่องเป็นหลัก; `secret` เป็น fallback อ่านอย่างเดียวชั่วคราว | |
| M6 | เมื่อไม่มีโค้ดพึ่ง `secret` แล้ว → DROP `secret` ใน migration ถัดไป | |

**ข้อจำกัดสำคัญ (โยง DOC-04):** ถ้าย้ายไป DO ชื่อ `shop` ที่ `INVENTORY_KEY` derive คนละ `ctx.id` → **decrypt ของเก่าไม่ได้** ต้อง export→re-encrypt→import หรือเริ่มฐานว่าง — อย่ารัน backfill ข้าม DO โดยคิดว่า key เดิมใช้ได้

#### 4.0.4 พื้นที่ API ที่ห้ามรั่ว (เกณฑ์เทสต์)

| Surface | ต้องไม่มี |
|---------|-----------|
| `GET /api/products`, `GET /api/products/:id` | `secret`, `login_id`, `password`, `login_id_enc`, `password_enc`, plaintext DEMO |
| Staff: `GET /api/staff/orders`, staff `orderDetail` | credential ทั้งคู่ (codes/login/password ว่างหรือไม่ส่ง) |
| Admin overview / inventory list ถ้ามี | ไม่ส่ง plaintext; ถ้าต้องโชว์สถานะสต็อกใช้ count เท่านั้น |
| Owner order detail หลังส่งของแล้ว | ส่งได้เฉพาะเจ้าของออเดอร์ ในรูปแบบชัดเจน เช่น `{ loginId, password }` หลัง decrypt ฝั่งเซิร์ฟเวอร์ |

เทสต์ที่ต้องมีตอน implement (ยังไม่เขียนใน Task นี้): ดู [DB_TEST_PLAN.md](DB_TEST_PLAN.md) หัวข้อ **K1–K4**

### 4.1 `payment_events` (แนะนำก่อนเปิด gateway)

```text
payment_events(
  id PK,
  payment_id FK → payments,
  event_type TEXT,          -- created|callback|succeeded|failed|duplicate_ignored
  provider_ref TEXT,
  payload_hash TEXT,        -- ไม่เก็บ secret ดิบ
  created_at
)
INDEX (payment_id, created_at)
UNIQUE optional (payment_id, event_type, provider_ref) ตามนโยบาย idempotency
```

### 4.2 `order_items` (เมื่อล็อกตะกร้าหลายสินค้า)

```text
order_items(
  id PK,
  order_id FK → orders,
  variant_id FK → variants,
  quantity INT,
  unit_price_satang INT,
  line_total_satang INT
)
-- แล้วค่อย deprecate orders.variant_id / quantity / total เป็นส่วนหัวสรุป
```

### 4.3 `categories` (optional)

```text
categories(id PK, name, slug UNIQUE)
products.category_id FK NULL  -- migrate จาก TEXT ทีหลัง
```

### 4.4 `cart_items` (optional)

```text
cart_items(
  user_id FK,
  variant_id FK,
  quantity INT,
  PRIMARY KEY (user_id, variant_id)
)
```

## 5. Constraints / Indexes ที่ควรมีในเป้า (สรุป)

| พื้นที่ | ต้องมี |
|---------|--------|
| Identity | users.email UNIQUE; sessions → users; role CHECK |
| Catalog | variants → products; price >= 0 (อนุญาต 0 สำหรับพรีออเดอร์ฟรีตามของเดิม) |
| Inventory | fingerprint UNIQUE จากคู่ login+password; `login_id_enc`+`password_enc` NOT NULL หลัง migrate; index (variant_id, order_id) |
| Orders | UNIQUE(user_id, request_key); index (user_id, created_at) |
| Payments | idempotency_key UNIQUE; partial unique (provider, provider_ref); XOR order/reservation |
| Queue | partial unique queue_number |
| Chat/Notify | index ตาม thread / user |

## 6. สิ่งที่ **ไม่** ทำในรอบ Review

- ไม่เขียน/commit ไฟล์ `005_*.sql` เพื่อ deploy  
- ไม่แก้ Worker ให้ร้านเดียวจนกว่า Mark Approve ข้อ Architecture  
- ไม่เปิด SlipOK/Gateway  
- ไม่ลบแทร็ก D1 ออกจากรีโป (แค่แช่แข็งในเอกสาร)

## 7. คำถามยืนยันจาก Mark (สั้น)

1. รับตัวเลือก Categories = TEXT ต่อไปในรอบถัดไป หรือแยกตารางทันทีหลัง Review?  
2. รับ `payment_events` เป็น migration แรกหลังล็อกหรือยังไม่จำเป็นจนกว่ามี webhook?  
3. ยืนยัน timeline แก้ `cloud/worker.mjs` ให้ฐานร้านเดียว?
