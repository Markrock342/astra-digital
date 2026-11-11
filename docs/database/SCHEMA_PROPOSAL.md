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
| Digital Keys | `inventory` | คงชื่อบน DO; เอกสาร map ไป `inventory_units` ของ D1 ถ้าจะ sync |
| Stock allocation | `inventory.order_id` | คงรอบแรก · **ทางเลือกภายหลัง:** แยก `allocations` |
| Orders | 1 variant / แถว | คงจนกว่ามีตะกร้าหลายชิ้น |
| Order Items | ไม่มี | เพิ่มเมื่อ Mark ล็อก multi-item checkout |
| Cart | ไม่มีฝั่ง DB | รอบแรก: client/Bank · หรือ `cart_items(user_id, variant_id, qty)` หลังล็อก |
| Payments | มี | คง |
| Payment Events | ไม่มี | เสนอ `payment_events` append-only ก่อนเปิด webhook จริง |
| Preorder / Queue | reservations + queue_number | คง |
| Chat / Notifications / Audit | มี | คง |
| Payment channel | มี | คง |

## 4. ตารางที่เสนอเพิ่ม (ยังไม่สร้างไฟล์ SQL ใน PR นี้)

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

### 4.6 รายงานอันดับผู้ซื้อ (Task DB-DOC-03)

ของปัจจุบัน: `GET /api/rankings/buyers` สาธารณะ · นับแค่ `orders.status='DELIVERED'` · ส่ง `id` ผู้ใช้ · ไม่มีตัวกรองช่วงเวลา

#### 4.6.1 สิทธิ์และสัญญา API (เป้า)

- **เฉพาะ ADMIN** (401 ถ้าไม่ล็อกอิน · 403 ถ้าไม่ใช่แอดมิน)  
- Query: `period=day|week|month|all` (default `all`) · `limit` จำนวนเต็ม 1–50  
- Response ต่อแถว: `{ rank, nameMasked, orders, spentSatang }` — **ห้ามส่ง `user id`**  
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
| ออเดอร์พร้อมส่งที่สำเร็จ | `orders.created_at` เมื่อ `status='DELIVERED'` | ของเดิมมีอยู่แล้ว; index ตามด้านล่าง |
| พรีออเดอร์ที่**จ่ายแล้ว** | `reservations.created_at` เมื่อ `status IN ('PREORDER','DELIVERED')` | นับยอดที่จ่ายแล้ว แม้ Admin ยังไม่ส่งของ; ถ้า Mark อยากนับเฉพาะหลังส่งของ ให้ล็อกเป็น `DELIVERED` อย่างเดียวทีหลัง |

หมายเหตุ: ค่า `created_at` ใน SQLite ปัจจุบันเป็น TEXT UTC แบบ `CURRENT_TIMESTAMP` — การตัดช่วง Bangkok ทำที่ชั้นแอปด้วยการคำนวณขอบเขตเป็น UTC แล้วเปรียบเทียบสตริง/unix ตามที่ implement เลือก (ระบุในเทสต์ด้วย fixture เวลาชัด)

#### 4.6.3 การรวมยอด

```text
spent = SUM(orders.total WHERE DELIVERED และอยู่ในช่วง)
      + SUM(reservations.total WHERE status IN (PREORDER, DELIVERED) และอยู่ในช่วง)
orders_count = COUNT(orders…) + COUNT(reservations…)
จัดอันดับตาม spent DESC แล้ว orders_count DESC
```

ชื่อใน response = mask แบบเดิม (`ab***c`) · ไม่มี `id`

#### 4.6.4 Index ที่ต้องเพิ่ม (migration ถัดไป)

```sql
CREATE INDEX IF NOT EXISTS orders_status_created
  ON orders (status, created_at);

CREATE INDEX IF NOT EXISTS reservations_status_created
  ON reservations (status, created_at);
```

(โจทย์บังคับอย่างน้อย `orders(status, created_at)`; แนะนำคู่บน reservations ด้วยเพราะนับพรีออเดอร์)

## 5. Constraints / Indexes ที่ควรมีในเป้า (สรุป)

| พื้นที่ | ต้องมี |
|---------|--------|
| Identity | users.email UNIQUE; sessions → users; role CHECK |
| Catalog | variants → products; price CHECK ตามของเดิม (`> 0` บน DO 001 — ข้อเสนอ `>= 0` ตัดทิ้งรอบนี้ตาม Owner) |
| Inventory | fingerprint UNIQUE; index (variant_id, order_id) |
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
