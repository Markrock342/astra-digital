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
| Preorder / Queue | reservations + queue_number (ออกหลังจ่าย); สถานะสุดท้ายปัจจุบัน = PREORDER | **เป้า DB-DOC-02:** Admin fulfill → สถานะส่งแล้ว + delivered_* + ผูกของ · ดู §4.5 · **DB-DOC-05:** **มาร์คล็อก 11 พ.ย.:** `after_payment` + คิวรวมทั้งร้าน · ดู §4.7 |
| Chat / Notifications / Audit | มี | คง |
| Payment channel | มี | คง |

## 4. ตารางที่เสนอเพิ่ม / ปรับ (ยังไม่สร้างไฟล์ SQL ใน PR นี้)

### 4.0 Digital goods = ID + Password สองช่อง (Task DB-DOC-01)

แหล่ง REQ: ลูกค้าส่งสินค้าเป็น **ไอดี + พาสเวิร์ด** · ต้องเข้ารหัสทั้งคู่ · ไม่หลุดใน API สินค้า / staff / admin overview

#### 4.0.1 รูปเป้าบนตาราง `inventory` (แทร็ก A)

`secret` ปัจจุบันเป็น `NOT NULL` — **ห้าม** `ALTER TABLE … ADD … NOT NULL` สำหรับคอลัมน์ใหม่  
ต้อง **rebuild ตาราง** ผ่าน `executeSqliteMigration` + `PRAGMA defer_foreign_keys` (แบบ migration `004_commerce_ops.sql`)  
รวมคอลัมน์จาก DB-DOC-02 ใน rebuild **ครั้งเดียวกัน** (`reservation_id` + XOR CHECK)

```text
inventory (
  id PK,
  variant_id FK → variants,
  fingerprint TEXT NOT NULL UNIQUE,   -- ดูสูตรด้านล่าง
  login_id_enc TEXT NOT NULL,        -- AES-GCM (primitive เดิมของร้าน) ของ login/ID
  password_enc TEXT NOT NULL,        -- AES-GCM ของ password
  legacy_single_secret INTEGER NOT NULL DEFAULT 0,  -- 1 = ย้ายจาก secret ช่องเดียว
  order_id FK NULL → orders,
  reservation_id FK NULL → reservations,  -- จาก DB-DOC-02; XOR กับ order_id
  sold_at TEXT NULL,
  created_at ...
  CHECK (
    (order_id IS NOT NULL AND reservation_id IS NULL)
    OR (order_id IS NULL AND reservation_id IS NOT NULL)
    OR (order_id IS NULL AND reservation_id IS NULL)
  )
)
INDEX inventory_available (variant_id, order_id)
-- ไม่มีคอลัมน์ secret หลัง rebuild (ข้อมูลเก่าถูก map เป็นคู่ + ธง legacy)
```

#### 4.0.2 สูตร `fingerprint` (กันของซ้ำ + กันเดา offline)

Canonical ก่อน MAC: **JSON UTF-8** (ไม่ใช้ `\n` delimiter — ค่าที่มี `\n` ในช่องจะชน canonical ได้)  
**ห้าม trim `password`** (รักษาไบต์ที่ผู้ใช้/ผู้นำเข้าใส่); `login_id` เก็บตามที่นำเข้าโดยไม่ trim เพื่อ fingerprint

```text
canonical = UTF8( JSON({ "v": 1, "login": login_id, "password": password }) )
fingerprint = HMAC-SHA256( serverKey, canonical )
```

- `serverKey` = วัสดุเข้ารหัส inventory ฝั่งเซิร์ฟเวอร์ (ตระกูล `INVENTORY_KEY` / derivation ตาม shop DO) — **ห้าม** ใช้ SHA-256 เปล่า (ได้ dump DB แล้วเดารหัสผ่าน offline ได้)
- ต้องคิดจาก **ทั้งสองช่อง** เสมอ — ห้ามใช้แค่ login หรือแค่ password
- เก็บเฉพาะ digest ใน DB · ไม่เก็บ plaintext
- `UNIQUE(fingerprint)` คงเดิม → import คู่เดียวกันซ้ำไม่ได้
- ฟิลด์ `"v": 1` เผื่อเปลี่ยน canonical ภายหลังโดยไม่ชนของเก่าโดยไม่ตั้งใจ

#### 4.0.3 แผนย้ายแถว `secret` เดิม (ช่องเดียว) → สองช่อง

ของปัจจุบัน: `inventory.secret` = ciphertext ของสตริงเดียว (เดโมเป็นโค้ด `DEMO-…`)

ร้าน live ใช้ **S1 ฐานว่าง** แล้ว (`141ffad`) — แต่แผน backfill ยังต้องมีไว้ถ้าพบแถวบนฐานอื่น/เทสต์

| ขั้น | การกระทำ | หมายเหตุ |
|------|----------|----------|
| M0 | **นับแถว** `inventory` ที่มี `secret` ก่อนเขียน 005 — ถ้า `COUNT=0` ข้าม M1–M4 ได้ | บังคับก่อน apply |
| M1 | Rebuild `inventory` (+ `reservations` ถ้าคู่กับ DOC-02) ด้วย `executeSqliteMigration` | ไม่ใช้ ALTER ADD NOT NULL |
| M2 | Backfill: decrypt `secret` → plaintext เดิม (key ของ **DO/DB เดิม** เท่านั้น) | |
| M3 | Legacy ที่มาร์คล็อกแล้ว: `login_id = โค้ดเดิม`, `password = ""`, `legacy_single_secret = 1` | ไม่ invent password |
| M4 | คำนวณ fingerprint แบบ HMAC จากคู่ · encrypt → `login_id_enc` / `password_enc` | ชน UNIQUE → fail migration / รายงาน |
| M5 | DROP คอลัมน์ `secret` ใน rebuild เดียวกันเมื่อ map ครบ | ไม่คง dual-read ยาว |

**ข้อจำกัดสำคัญ (โยง DOC-04):** shop DO ใช้ S1 แล้ว — ไม่ทำ S2 re-encrypt ข้าม DO ในรอบนี้

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

### 4.5 Admin fulfill พรีออเดอร์ (Task DB-DOC-02)

แหล่ง REQ: พรีออเดอร์จ่ายแล้วรอของ · **Admin ส่งของทีหลัง** · เรียกซ้ำต้องไม่ส่งของซ้ำ

#### 4.5.1 สถานะ reservations (เป้า)

```text
PENDING_PAYMENT → PREORDER → DELIVERED
                 ↘ FAILED | CANCELLED
```

- เพิ่มสถานะ **`DELIVERED`** (= ส่งของแล้ว) ใน CHECK ของ `reservations.status`  
- SQLite **เปลี่ยน CHECK ไม่ได้ด้วย ALTER** → ต้อง **rebuild ตาราง `reservations`** ผ่าน `executeSqliteMigration` + FK deferral  
- คง `PREORDER` = จ่ายแล้ว รอ Admin ส่ง  
- คอลัมน์ใหม่บน `reservations` (มากับ rebuild เดียวกัน):

```text
delivered_at  TEXT NULL,           -- เมื่อเข้า DELIVERED
delivered_by  TEXT NULL REFERENCES users(id)  -- ADMIN เท่านั้น
```

#### 4.5.2 ผูกของกับ reservation — ข้อเสนอหลัก

**ขยาย `inventory` ด้วย `reservation_id` + XOR CHECK** — รวมใน **rebuild ครั้งเดียวกับ credential คู่ (DB-DOC-01)**  
ห้าม ALTER ADD แล้วหวัง NOT NULL / CHECK ใหม่บนตารางเดิมโดยไม่มี rebuild

```text
inventory (
  ...
  order_id TEXT NULL REFERENCES orders(id),
  reservation_id TEXT NULL REFERENCES reservations(id),
  CHECK (
    (order_id IS NOT NULL AND reservation_id IS NULL)
    OR (order_id IS NULL AND reservation_id IS NOT NULL)
    OR (order_id IS NULL AND reservation_id IS NULL)  -- ยังว่างในคลัง
  )
)
-- ว่างพร้อมขาย: order_id IS NULL AND reservation_id IS NULL
```

แผนเทสต์บน**ฐานที่มีข้อมูล** (โยง MU* / DOC-04): apply 005 แล้วแถว reservation/inventory เดิมครบ + CHECK ใหม่บังคับ

**ทางเลือกรอง:** ตาราง `allocations` แยก (แบบ D1) — รอบแรกไม่ใช้ถ้า XOR บน inventory พอ

#### 4.5.3 Transaction ส่งของ (idempotent)

API (มาร์คล็อก 11 พ.ย.): `POST /api/admin/reservations/:id/deliver` — ADMIN เท่านั้น

ใน `tx` เดียว:

1. โหลด reservation ด้วย `id` + ล็อกแถว (SQLite: อ่านใน tx เดียวกัน)  
2. ถ้า `status === 'DELIVERED'` แล้ว → **คืน metadata เดิมเท่านั้น** (`id`, `status`, `delivered_at`, `delivered_by`, จำนวนชิ้นที่ผูก) · **ไม่คืน credential** · ไม่ allocate เพิ่ม · ไม่เขียน delivered_* ซ้ำ  
3. ถ้า `status !== 'PREORDER'` → 409  
4. เลือก inventory ว่างตาม `variant_id` จำนวน `quantity` (`order_id IS NULL AND reservation_id IS NULL`)  
5. ถ้าไม่พอ → 409 สต็อกไม่พอ (ไม่เปลี่ยนสถานะ)  
6. `UPDATE inventory SET reservation_id=?, sold_at=CURRENT_TIMESTAMP WHERE id=? AND order_id IS NULL AND reservation_id IS NULL` ทีละชิ้น · ถ้าแถวไม่ถูกอัปเดต → abort ทั้ง tx  
7. `UPDATE reservations SET status='DELIVERED', delivered_at=..., delivered_by=adminId WHERE id=? AND status='PREORDER'` · ถ้า changes=0 → abort (แข่งกับ deliver อื่น)  
8. `notify` เจ้าของออเดอร์ · `audit`  
9. commit → คืน metadata ให้ ADMIN (สอดคล้อง K3 — admin ไม่ได้ plaintext)

Idempotency: สถานะ `DELIVERED` + แถว inventory ที่ `reservation_id` ชี้แล้ว = ความจริงหลัก

#### 4.5.4 สิทธิ์ (มาร์คล็อกแล้ว)

- เรียก deliver ได้เฉพาะ **ADMIN** (SOW: ผู้ดูแลเป็นคนส่ง) — STAFF ได้ 403  
- Staff/Admin list และ deliver response **ไม่คืน** credential plaintext

#### 4.5.5 เจ้าของอ่านรหัสพรีออเดอร์หลังส่งแล้ว

สถานะโค้ดปัจจุบัน: `orderDetail` เส้น reservation คืน `codes: []` เสมอ และผูก inventory แค่ `order_id`

เป้าหลัง DELIVERED:

1. Owner เรียก orderDetail ด้วย **reservation id** ของตน  
2. Server ตรวจ `reservations.user_id === owner` และ `status === 'DELIVERED'`  
3. อ่าน inventory ที่ `reservation_id = ?` แล้ว decrypt → คืน credential คู่ **เฉพาะเจ้าของ**  
4. Staff/Admin เรียก path เดียวกันได้เมตา แต่ `codes` ว่าง

เทสต์: K4 + P2 (deliver ซ้ำไม่มี credential ใน response admin)

### 4.6 รายงานอันดับผู้ซื้อ (Task DB-DOC-03)

จัดให้ตรงโค้ดบน main (`22657a2` + นับพรีออเดอร์) — เอกสารนี้เป็นสัญญา/เทสต์แผน ไม่ใช่ mask อีกต่อไป

#### 4.6.1 สิทธิ์และสัญญา API

- **เฉพาะ ADMIN** (401 ถ้าไม่ล็อกอิน · 403 ถ้า CUSTOMER/STAFF)  
- Query: `period=day|week|month|all` (default `all`) · `limit` จำนวนเต็ม 1–50 · **default `limit=10`** เมื่อไม่ส่ง  
- `limit` / `period` ผิดรูป → **400**  
- Response ต่อแถว: `{ rank, name, email, orders, spentSatang }` — **ชื่อและอีเมลเต็ม** (ไม่ mask) · **ห้ามส่ง `user id`**  
- ไม่ส่งรหัสสินค้า / credential

#### 4.6.2 เวลาและเขตเวลา

| period | ความหมาย (Asia/Bangkok, UTC+7) |
|--------|----------------------------------|
| `day` | ตั้งแต่ 00:00 ของวันปฏิทินปัจจุบันที่ Bangkok จนถึงตอนนี้ |
| `week` | ตั้งแต่ 00:00 วันจันทร์ของสัปดาห์ปฏิทิน Bangkok (ISO week แบบ Monday-start) จนถึงตอนนี้ |
| `month` | ตั้งแต่ 00:00 วันที่ 1 ของเดือนปฏิทิน Bangkok จนถึงตอนนี้ |
| `all` | ไม่กรองเวลา |

**คอลัมน์เวลาที่ใช้กรอง**

| แหล่งยอด | คอลัมน์ | เหตุผล |
|----------|---------|--------|
| ออเดอร์สำเร็จ | `orders.created_at` เมื่อ `status='DELIVERED'` | ของเดิม; index ตามด้านล่าง |
| พรีออเดอร์ที่จ่ายแล้ว / ส่งแล้ว | `reservations.created_at` เมื่อ `status IN ('PREORDER','DELIVERED')` | หลัง DOC-02 มี `DELIVERED` บน reservations |

**หมายเหตุสำคัญ:** กรองด้วย **`created_at` ของแถว** — **ไม่ใช่เวลาจ่าย / finalized_at** (ยังไม่มีคอลัมน์เวลาจ่ายแยก)

ค่า `created_at` ใน SQLite เป็น TEXT UTC แบบ `CURRENT_TIMESTAMP` — ขอบเขต Bangkok คำนวณที่ชั้นแอปแล้วเปรียบเทียบ

#### 4.6.3 การรวมยอด

```text
spent = SUM(orders.total WHERE DELIVERED และอยู่ในช่วง)
      + SUM(reservations.total WHERE status IN (PREORDER, DELIVERED) และอยู่ในช่วง)
orders_count = COUNT(orders…) + COUNT(reservations…)
จัดอันดับตาม spent DESC แล้ว orders_count DESC
```

Response = `name` + `email` เต็ม · ไม่มี `id`

#### 4.6.4 Index ที่ต้องเพิ่ม (ใน 005 หลัง #6/#7/#9 merge)

```sql
CREATE INDEX IF NOT EXISTS orders_status_created
  ON orders (status, created_at);

CREATE INDEX IF NOT EXISTS reservations_status_created
  ON reservations (status, created_at);
```

(โจทย์บังคับอย่างน้อย `orders(status, created_at)`; แนะนำคู่บน reservations ด้วยเพราะนับพรีออเดอร์)

### 4.7 นโยบายเลขคิวพรีออเดอร์ (Task DB-DOC-05)

SOW ยัง**ไม่ล็อก**ว่าออกคิวก่อนหรือหลังจ่าย → schema/แอปต้อง**รองรับทั้งสองโหมด** โดยเลือกโหมดผ่าน runtime flag (ไม่ต้องมีสองรูปตาราง)  
**มาร์คล็อก 11 พ.ย.:** `after_payment` + คิวรวมทั้งร้าน — ไม่ต้องทำโหมด `on_create` รอบนี้ เก็บไว้เป็นทางเลือกถ้าลูกค้าขอภายหลัง (เหตุผล: ไม่มีคิวผีจากคนจองไม่จ่าย ไม่ต้องมี expiry เลขคิวสะท้อนลำดับคนจ่ายจริง)

#### 4.7.1 คอลัมน์ / ความจริงที่มี

- `reservations.queue_number INTEGER NULL` + partial UNIQUE เมื่อ NOT NULL  
- `reservations` มี **`variant_id`** (FK → variants) — **ไม่มี `product_id`** บนตารางนี้  
- ของปัจจุบันในโค้ด: ออกคิวตอน **pay สำเร็จ** เข้า `PREORDER`

#### 4.7.2 สองโหมดที่รองรับ

| โหมด | ตอนออกคิว | พฤติกรรม |
|------|-----------|----------|
| `after_payment` (ปัจจุบัน) | เมื่อสถานะเข้า `PREORDER` หลังจ่ายสำเร็จ | คิว = คนที่จ่ายแล้วรอของ |
| `on_create` | เมื่อสร้าง reservation สถานะ `PENDING_PAYMENT` | คิวจองตั้งแต่ยังไม่จ่าย |

กฎเพิ่มถ้าวันหนึ่งเปิด `on_create`:

- **หมดอายุ:** ถ้ายัง `PENDING_PAYMENT` เกิน **30 นาที** หลัง `created_at` → เคลียร์ `queue_number=NULL` (คืนเลข) และยกเลิก/ล้มตามนโยบายสถานะ  
- FAILED/CANCELLED → คืนเลขทันที (`queue_number=NULL`)  
- **`queueBoard` ต้องกรองรายการที่ยังไม่จ่ายออก** — แสดงเฉพาะคิวที่จ่ายแล้ว (`PREORDER` / `DELIVERED`) ไม่โชว์ `PENDING_PAYMENT` แม้มีเลขคิว

สวิตช์เสนอ: `runtime_flags` คีย์ `preorder_queue_mode` = `after_payment` | `on_create`  
ค่าที่ใช้ = **`after_payment`** (ยังไม่ต้องสร้าง flag จนกว่าจะเปิด on_create)

#### 4.7.3 ขอบเขตคิว: รวมทั้งร้าน vs ต่อสินค้า

| แบบ | ความหมาย | Unique |
|-----|----------|--------|
| **shop-wide (ล็อกแล้ว)** | เลขคิววิ่งเดียวทั้งร้าน | คง `UNIQUE(queue_number)` partial ทั้งตาราง |
| per-variant (ไม่ทำรอบนี้) | เลขคิวแยกตาม `variant_id` | ต้องเป็น `UNIQUE(variant_id, queue_number)` — **ห้าม** อ้าง `product_id` บน reservations เพราะไม่มีคอลัมน์นี้ |

ตัวนับ shop-wide: `MAX(queue_number)+1` ใน tx + จัดการ UNIQUE collision ด้วย retry (เทส C3 ยังขาด)

#### 4.7.4 สิ่งที่ยังไม่เปลี่ยนในรอบเอกสารนี้

- ไม่แก้โค้ดออกคิว / `queueBoard` ใน PR นี้  
- ไม่สร้างตารางคิวแยก  
- ไม่เปิดโหมด `on_create`  

## 5. Constraints / Indexes ที่ควรมีในเป้า (สรุป)

| พื้นที่ | ต้องมี |
|---------|--------|
| Identity | users.email UNIQUE; sessions → users; role CHECK |
| Catalog | variants → products; price CHECK ตามของเดิม (`> 0` บน DO 001 — ข้อเสนอ `>= 0` ตัดทิ้งรอบนี้) |
| Inventory | fingerprint = HMAC-SHA256(serverKey, JSON canonical ของคู่ login+password); `login_id_enc`+`password_enc`+`legacy_single_secret` ผ่าน rebuild (ไม่ ALTER NOT NULL); รวม `reservation_id` XOR; index (variant_id, order_id) |
| Orders | UNIQUE(user_id, request_key); index (user_id, created_at); **index (status, created_at)** |
| Reservations | UNIQUE(user_id, request_key); **index (status, created_at)** แนะนำ |
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
