# DB-02 — ERD (Digital Goods)

สถานะ: Draft for Mark Review  
แหล่งความจริงปัจจุบัน: แทร็ก A (`server/migrations`)  
เอกสารคู่: [SCHEMA_PROPOSAL.md](SCHEMA_PROPOSAL.md) · อ้างอิงเดิม [../architecture/erd-target.md](../architecture/erd-target.md) (ไม่แทนที่)

## 1. หลักการ

1. เงินทุกชนิด = **integer satang**  
2. Digital key เก็บเป็น ciphertext; **fingerprint UNIQUE**; API สินค้าห้ามมี secret  
3. Client ไม่ใช่ความจริงของ role / ราคา / สต็อก / สถานะจ่าย  
4. Ledger เดโม = **DEMO_CREDIT** เท่านั้น  
5. ช่องทางจ่ายเดียว (`payment_channel`); SlipOK/Gateway ยังไม่เปิด  
6. ERD ด้านล่างแสดงทั้ง **ของที่มีแล้ว** และ **ที่เสนอเพิ่ม** (เส้นประในคำอธิบาย)

## 2. แผนภาพความสัมพันธ์ (เชิงตรรกะ)

```text
users ──┬── sessions
        ├── ledger (DEMO_CREDIT)
        ├── orders ──────┬── [order_items?] ── variants
        │                ├── payments ── [payment_events?]
        │                └── inventory (allocated via order_id)
        ├── reservations ── payments / queue_number
        ├── chat_threads ── chat_messages
        └── notifications

[categories?] ── products ── variants ── inventory
payment_channel (singleton primary)
audit (append-only)
runtime_flags

[cart / cart_items?] — ยังไม่มีใน runtime; เสนอใน SCHEMA_PROPOSAL
```

## 3. โมดูลตามโจทย์ DB-02

### 3.1 Users / Sessions / Roles

| Entity | ตาราง | ความสัมพันธ์ |
|--------|-------|----------------|
| User | `users` | 1—N sessions, orders, reservations, ledger, notifications, chat_threads |
| Session | `sessions` | N—1 users |
| Role | คอลัมน์ `users.role` | CHECK: CUSTOMER \| ADMIN \| STAFF |

### 3.2 Products / Categories / Variants

| Entity | สถานะ |
|--------|--------|
| Product | `products` มีแล้ว |
| Category | **ตอนนี้** `products.category` TEXT · **เป้า ERD** อาจแยก `categories` (ดู Proposal) |
| Variant | `variants` N—1 products; ราคา satang |

### 3.3 Digital Keys / Stock Inventory

| Entity | ตารางปัจจุบัน | เป้าหลัง DB-DOC-01 |
|--------|----------------|---------------------|
| Digital credential unit | `inventory` มี `secret` ช่องเดียว | `login_id_enc` + `password_enc` (เข้ารหัสทั้งคู่); `fingerprint = HMAC-SHA256(serverKey, JSON{v,login,password})` UNIQUE; `legacy_single_secret` |
| Allocation | คอลัมน์ `inventory.order_id` | คง + `reservation_id` XOR (rebuild ครั้งเดียวกับ credential) |
| Legacy `secret` | ciphertext สตริงเดียว NOT NULL | **rebuild** ตารางผ่าน `executeSqliteMigration` (ห้าม ALTER ADD NOT NULL); แผน §4.0.3 |

รายละเอียดสูตร fingerprint / ย้ายข้อมูล / พื้นที่ห้ามรั่ว: [SCHEMA_PROPOSAL.md](SCHEMA_PROPOSAL.md) §4.0

### 3.4 Orders / Order Items

| Entity | สถานะ |
|--------|--------|
| Order | `orders` — ผูก `variant_id` + `quantity` โดยตรง (= 1 line item โดยนัย) |
| Order Item | **ยังไม่มีตาราง** — เสนอเพิ่มเมื่อ Mark ต้องการตะกร้าหลายสินค้าต่อออเดอร์ |

### 3.5 Payments / Payment Events

| Entity | สถานะ |
|--------|--------|
| Payment | `payments` — idempotency_key UNIQUE; ผูก order หรือ reservation |
| Payment Event | **ยังไม่มี** — เสนอ append-only สำหรับ callback/webhook ซ้ำ |
| Channel | `payment_channel` singleton |

### 3.6 Preorders / Queue

| Entity | ตาราง |
|--------|--------|
| Preorder | `reservations` |
| Queue number | `reservations.queue_number` + UNIQUE partial |

### 3.7 Chat / Notifications / Audit

| Entity | ตาราง |
|--------|--------|
| Thread / Message | `chat_threads`, `chat_messages` |
| Notification | `notifications` |
| Audit log | `audit` |

## 4. Cardinality สั้นๆ

- User 1—N Order; Order N—1 Variant (ปัจจุบัน)  
- Variant 1—N Inventory unit; Inventory unit 0—1 Order (เมื่อขายแล้ว)  
- Reservation 0—1 queue_number (หลังจ่ายสำเร็จสถานะ PREORDER)  
- Payment ผูกได้แค่ Order **หรือ** Reservation อย่างใดอย่างหนึ่ง (CHECK)  
- Chat thread N—1 User; Message N—1 Thread  

## 5. สิ่งที่อยู่นอก ERD รอบนี้

- SlipOK / Gateway tables จริง  
- การย้ายข้อมูล live หลาย DO → ร้านเดียว (อยู่ MIGRATION_PLAN / Architecture)  
- Frontend cart state (Bank)
