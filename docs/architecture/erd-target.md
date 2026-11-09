# ERD เป้าหมาย — NOTT Sprint 1 (Design only)

สถานะ: **Approved** โดย Owner (2026-11-09) — ส่วน design ของ Task 0.3.3  
ยังไม่ใช่ migration ที่รันได้จนกว่าปลดล็อก Phase 1  
เป้าหมาย runtime ตาม brief: **Cloudflare D1** (ของปัจจุบัน = Durable Object SQLite / local SQLite)  
เงินทั้งหมดเป็น **integer satang** (ของเดิมในรีโปใช้จำนวนเต็มแบบเดียวกัน เช่นราคา `10000`, top-up `amount * 100`)  
อิง: `server/migrations/001–003`, [auth-rbac.md](auth-rbac.md), [../modules/nott-gap-map.md](../modules/nott-gap-map.md)

## 1. หลักการออกแบบ

1. ขยายจาก schema เดโมที่มีอยู่ — ไม่ทิ้งกฎที่เทสแล้ว (fingerprint unique, ledger.reference unique, owner-scoped orders)
2. แยกตาราง `payments` และ `allocations` ให้ตรงชื่อ brief โดยไม่ทำลายความหมายของ inventory ปัจจุบัน
3. `chat` / `notifications` ใน Sprint 1 = **schema ขั้นต่ำ (placeholder)** — ยังไม่ implement API ลึก
4. Client ห้ามเป็นแหล่งความจริงของ role / ราคา / สถานะจ่าย / การ allocate
5. Phase 1 จะแปลงเอกสารนี้เป็น migration D1 จริงหลังเกต 0.3.3

## 2. แผนภาพความสัมพันธ์ (เชิงตรรกะ)

```text
users ──┬── sessions
        ├── ledger
        ├── orders ──┬── payments
        │            ├── allocations ── inventory_units
        │            └── reviews
        ├── reservations (preorder) ── payments (optional link)
        ├── chat_threads ── chat_messages
        └── notifications

products ── variants ── inventory_units
audit (append-only)
```

ชื่อ `inventory_units` = วิวัฒนาการจากตาราง `inventory` ปัจจุบัน (เก็บโค้ดเข้ารหัสรายหน่วย)

## 3. ตารางเป้าหมาย

### 3.1 Identity

| ตาราง | คอลัมน์หลัก | Constraints / Indexes |
|-------|-------------|------------------------|
| `users` | id PK, email UNIQUE NOCASE, username NULL UNIQUE, name, password_hash, role CHECK(`CUSTOMER\|ADMIN`) DEFAULT CUSTOMER, created_at | partial unique username WHERE NOT NULL |
| `sessions` | token_hash PK, user_id FK→users, expires_at | index (user_id), index (expires_at) สำหรับ purge |

### 3.2 Catalog

| ตาราง | คอลัมน์หลัก | Constraints / Indexes |
|-------|-------------|------------------------|
| `products` | id PK, name, category, description, art, featured, active 0/1, hidden_seed 0/1, preorder 0/1 | index (active, hidden_seed) |
| `variants` | id PK, product_id FK, label, price INTEGER CHECK(price >= 0) | index (product_id); อนุญาต price=0 สำหรับ preorder ฟรีตามของเดิม |

### 3.3 Orders & payments

| ตาราง | คอลัมน์หลัก | Constraints / Indexes |
|-------|-------------|------------------------|
| `orders` | id PK, user_id FK, variant_id FK, quantity 1–10, total INTEGER >=0, status CHECK(PENDING_PAYMENT, DELIVERED, FAILED, CANCELLED, OUT_OF_STOCK), request_key, created_at | **UNIQUE(user_id, request_key)**; index (user_id, created_at) |
| `payments` | id PK, order_id FK NULL, reservation_id FK NULL, user_id FK, amount INTEGER, currency DEFAULT `THB`, status CHECK(PENDING, SUCCEEDED, FAILED, CANCELLED), provider TEXT DEFAULT `sandbox`, provider_ref NULL, idempotency_key NOT NULL, confirmation_hash NULL, created_at, finalized_at NULL | **UNIQUE(idempotency_key)**; **UNIQUE(provider, provider_ref) WHERE provider_ref IS NOT NULL**; CHECK อย่างน้อยหนึ่งใน order_id/reservation_id |

หมายเหตุ: ของปัจจุบันเก็บ `payment_hash` บน orders/reservations — เป้าหมายย้ายความจริงของการยืนยันจ่ายมาที่ `payments` โดย Phase 1 อาจเริ่มด้วยคอลัมน์คู่ขนานแล้วค่อยตัดของเก่า

### 3.4 Inventory & allocations

| ตาราง | คอลัมน์หลัก | Constraints / Indexes |
|-------|-------------|------------------------|
| `inventory_units` | id PK, variant_id FK, fingerprint UNIQUE, secret (AES-GCM ciphertext), created_at | index (variant_id) สำหรับนับสต็อกว่างผ่าน allocations |
| `allocations` | id PK, inventory_unit_id FK UNIQUE, order_id FK, user_id FK, allocated_at | **UNIQUE(inventory_unit_id)** = one unit → one allocation; index (order_id); **เป้าหมาย one-key-per-one-order-item** เสริมด้วยเช็คจำนวน allocations ต่อ order = quantity ภายใน transaction |

ของปัจจุบัน: `inventory.order_id` / `sold_at` ทำหน้าที่ allocation — ตาราง `allocations` ทำให้ brief และ audit trail ชัดขึ้น

### 3.5 Preorder

| ตาราง | คอลัมน์หลัก | Constraints / Indexes |
|-------|-------------|------------------------|
| `reservations` | คงความหมายเดิม (preorder queue): user_id, variant_id, quantity, total, status PENDING_PAYMENT\|PREORDER\|FAILED\|CANCELLED, request_key, created_at | **UNIQUE(user_id, request_key)** |

ไม่สร้างโค้ดก่อน fulfillment จริง

### 3.6 Ledger, reviews, audit

| ตาราง | บทบาท | Unique / กฎ |
|-------|--------|--------------|
| `ledger` | TEST credit / future settlement entries | **UNIQUE(reference)** idempotent top-up/debit |
| `reviews` | รีวิวหลัง DELIVERED | **UNIQUE(order_id)**; owner-only ในชั้น domain |
| `audit` | append-only actions | index (created_at); ไม่แก้ย้อนหลัง |

### 3.7 Chat & notifications (placeholder Sprint 1)

| ตาราง | คอลัมน์ขั้นต่ำ | ขอบเขต Sprint 1 |
|-------|----------------|-----------------|
| `chat_threads` | id, user_id FK, status OPEN\|CLOSED, created_at | สร้างตารางได้ใน Phase 1 — **ไม่มี** API ข้อความจริงนอก stub |
| `chat_messages` | id, thread_id FK, sender_type USER\|STAFF\|SYSTEM, body, created_at | 同上 |
| `notifications` | id, user_id FK, kind, title, body, read_at NULL, created_at | index (user_id, created_at) — API อ่าน/ทำเครื่องหมายอ่านเป็นงานถัดไป |

## 4. ตารางเทียบของเดิม → เป้าหมาย

| ของเดิม (มีแล้ว) | เป้าหมาย | หมายเหตุ migration |
|------------------|----------|-------------------|
| `users`, `sessions` | คง + ตรง Auth design | ต่ำ |
| `products`, `variants` | คง (price >= 0) | ตรวจ variant ราคา 0 |
| `orders` | คง statuses; ย้าย payment_hash ไป `payments` ตามเฟส | กลาง |
| `inventory` | เปลี่ยนชื่อ/มุมมองเป็น `inventory_units` + `allocations` | สูง — ต้องมีแผนข้อมูล |
| `reservations` | คง | ต่ำ |
| `ledger`, `reviews`, `audit`, `runtime_flags` | คง (flags เป็น operational) | ต่ำ |
| — | `payments` ใหม่ | ใหม่ |
| — | `chat_*`, `notifications` ใหม่ | placeholder |

## 5. Invariants ที่ต้องมีใน transaction (โดเมน)

1. ยืนยันจ่ายสำเร็จครั้งแรกเท่านั้นที่สร้าง debit ledger + allocations  
2. จำนวน `allocations` ต่อ order = `orders.quantity`  
3. หน่วย inventory ที่ถูก allocate แล้วห้าม allocate ซ้ำ (`inventory_unit_id` UNIQUE)  
4. `fingerprint` ห้ามซ้ำทั้งคลัง (กัน import โค้ดซ้ำ)  
5. Replay payment ด้วย `idempotency_key` / confirmation เดิม → คืนผลเดิม ไม่สร้าง allocation เพิ่ม  
6. สต็อกไม่พอ → `OUT_OF_STOCK` โดยไม่ debit  
7. Unused `secret` ห้ามออก API สาธารณะหรือรายการ admin แบบ plaintext

## 6. นอกขอบเขตเอกสารนี้

- SQL migration ไฟล์ที่ apply ได้ (ไป Phase 1)
- การย้ายข้อมูล live จาก DO → D1
- Provider-specific payment columns เกิน `provider` / `provider_ref`
- Full chat realtime / push notifications

## 7. ขั้นถัดไป

- [x] Task **0.3.2** PaymentAdapter + Fulfillment flow  
- [x] Task **0.3.3** Approve design (ERD + Payment) — 2026-11-09  
- [ ] ปลดล็อก Phase 1+ (รอ Owner ข้อ 2) → แล้วจึงเขียน migration D1
