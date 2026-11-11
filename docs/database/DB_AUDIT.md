# DB-01 — Database Audit

สถานะ: Draft for Mark Review  
ฐานโค้ด: `9eebc6f` (+ งานบน `feat/nott-database-audit`)  
ผู้รับผิดชอบ: NOTT (Database) · Architecture ล็อกโดย Mark  
**ยังไม่ Deploy Migration / ไม่เปลี่ยน Production DB**

## 1. ภาพรวมที่พบในรีโป

รีโปมี **สองแทร็ก schema** (dual-track) ตาม ADR เดิม:

| แทร็ก | ที่อยู่ | Runtime | ใช้จริงตอนนี้ |
|-------|---------|---------|----------------|
| **A — หลัก** | `server/migrations/001–004` | Node `.data/commerce.sqlite` + Cloudflare **Durable Object** SQLite | ใช่ — Worker + local commerce |
| **B — เป้า brief เดิม** | `db/migrations/0001–0002` | Cloudflare **D1** (`db/wrangler.jsonc`) | แทร็กเงา / ยังไม่ cutover Worker หลัก |

อ้างอิง ADR: [../architecture/adr-d1-migration-path.md](../architecture/adr-d1-migration-path.md)

## 2. Durable Object SQLite (แทร็ก A)

### 2.1 จุดเข้า

| เรื่อง | ไฟล์ | บรรทัดโดยประมาณ |
|--------|------|------------------|
| DO class + apply migrations | `cloud/worker.mjs` | 42–74 (constructor), 59–63 (รายชื่อ 001–004) |
| แยกพื้นที่ด้วยคุกกี้ | `cloud/worker.mjs` | 20–40 (`astra_space`), 170–172 `getByName("client:"+space)` |
| presentation vs client | `cloud/worker.mjs` | 78–79, 170–172 |
| helper upgrade ที่ defer FK | `server/sqlite-migrations.mjs` | ทั้งไฟล์ (1–18) — แทนที่ `PRAGMA foreign_keys` ใน migration |
| local Node DB | `server/commerce.mjs` | เปิด `.data/commerce.sqlite` + apply migrations |

### 2.2 ความเสี่ยงสำคัญ: สต็อกไม่ร่วมกัน

```text
เบราว์เซอร์ A → cookie astra_space=X → DO idFromName("client:X") → SQLite คนละก้อน
เบราว์เซอร์ B → cookie astra_space=Y → DO คนละก้อน → inventory ไม่แชร์
```

อ้างอิง: `cloud/worker.mjs` บรรทัด ~170–172  
ข้อเสนอที่อิงโจทย์น็อต (รอ Mark ล็อก): **ฐานร้านเดียว** — ชี้ DO ชื่อคงที่; แยกลูกค้าด้วย session เท่านั้น · **ยังไม่แก้ในรอบ Review นี้**

### 2.3 Migration 001–004 (สรุป)

| ไฟล์ | สร้าง/เปลี่ยนหลัก |
|------|-------------------|
| `001_initial.sql` | users, sessions, products, variants, orders, inventory, ledger, audit + index inventory_available / orders_owner |
| `002_reviews.sql` | reviews (order_id UNIQUE) |
| `003_reference_layout.sql` | products.hidden_seed/preorder, users.username, runtime_flags, reservations |
| `004_commerce_ops.sql` | rebuild users(+STAFF), payments, payment_channel, queue_number, ledger.kind, chat_*, notifications |

**กติการอบนี้:** ไม่แก้เนื้อหาไฟล์ `004_commerce_ops.sql` — ปรับ schema ใหม่ต้องเป็น migration ถัดไปหลัง Mark ล็อก

### 2.4 ตารางปัจจุบัน (แทร็ก A หลัง 004)

| ตาราง | บทบาท | Constraints / Index สำคัญ |
|-------|--------|---------------------------|
| users | บัญชี + role CUSTOMER\|ADMIN\|STAFF | email UNIQUE NOCASE; username partial unique |
| sessions | เซสชัน | token_hash PK → users |
| products | สินค้า | category เป็น **TEXT** (ไม่มีตาราง categories) |
| variants | ตัวเลือก + ราคา satang | FK product; price CHECK |
| orders | ออเดอร์ 1 variant / แถว | UNIQUE(user_id, request_key); ไม่มี order_items |
| inventory | Digital key เข้ารหัส | fingerprint UNIQUE; order_id = allocation แบบฝังคอลัมน์ |
| reservations | พรีออเดอร์ | UNIQUE(user_id, request_key); queue_number partial unique |
| payments | บันทึกการจ่าย | idempotency_key UNIQUE; partial unique (provider, provider_ref); ผูก order **หรือ** reservation |
| payment_channel | ช่องทางเดียว | id CHECK = primary; provider unset\|sandbox\|slipok\|gateway |
| ledger | เครดิตทดลอง | reference UNIQUE; kind DEFAULT DEMO_CREDIT |
| reviews | รีวิว | order_id UNIQUE |
| audit | ปูม | AUTOINCREMENT |
| runtime_flags | ตั้งค่าร้าน | key PK |
| chat_threads / chat_messages | แชทในเว็บ | index ตาม thread |
| notifications | แจ้งเตือนในเว็บ | index ตาม user |

ไม่มีตาราง: `categories`, `cart` / `cart_items`, `order_items`, `payment_events`, `allocations` (แยก)

## 3. D1 (แทร็ก B)

| ไฟล์ | หมายเหตุ |
|------|----------|
| `db/migrations/0001_init.sql` | schema เป้า: `inventory_units` + `allocations` แยกจาก DO `inventory` |
| `db/migrations/0002_commerce_ops.sql` | STAFF, payment_channel, queue_number, ledger.kind — **ไม่มี** ตาราง payments ซ้ำ (payments อยู่ใน 0001 แล้ว) แต่ **ไม่มี** chat/notifications ซ้ำใน 0002 (อยู่ใน 0001) |
| `db/wrangler.jsonc` | config แยกจาก Worker หลัก |

### ความต่างที่เสี่ยงสับสน

| หัวข้อ | DO (A) | D1 (B) |
|--------|--------|--------|
| Digital keys | `inventory` + `order_id` | `inventory_units` + `allocations` |
| users.role หลัง ops | มี STAFF (004) | มี STAFF (0002) |
| orders.payment_hash | มีใน 001 | ไม่มีใน 0001 (ย้ายความจริงไป payments) |
| variants.price | CHECK `> 0` ใน 001 | CHECK `>= 0` ใน 0001 |

## 4. จุดซ้ำซ้อน / เสี่ยงสูญหาย

1. **สองรูป inventory** — ถ้า cutover โดยไม่ map ข้อมูล จะสูญเสียความหมาย allocation  
2. **users rebuild ใน 004 / 0002** — `DROP TABLE users` แล้วสร้างใหม่; ต้องมี FK deferral (มีแล้วใน `sqlite-migrations.mjs` + เทส `tests/migration-upgrade.test.mjs`)  
3. **astra_space multi-DB** — ข้อมูลเดโมกระจายหลาย DO; รวมร้านเดียวต้องมีแผนรวม/ทิ้ง tenant เก่า  
4. **payments คู่กับ payment_hash บน orders/reservations** — ความจริงการยืนยันจ่ายยังพึ่ง hash บนออเดอร์; ตาราง payments เป็น audit/ledger ชั้นเพิ่ม  
5. **D1 0002 ไม่ mirror ทุกอย่างของ 004 แบบ 1:1** — ต้องระบุในแผนว่าแทร็ก B แช่แข็ง

## 5. จุดที่ต้องปรับปรุง (ยังไม่ลงมือในรอบนี้)

| # | ปรับปรุง | อ้างอิง | ระดับ |
|---|----------|---------|--------|
| P1 | รวมฐานร้านเดียวที่ Worker entry | `cloud/worker.mjs` ~170–172 | Architecture (Mark) |
| P2 | เอกสาร ERD/Schema ให้ครบโมดูลโจทย์ (Cart/Order Items/…) | ชุด `docs/database/*` | Review pack นี้ |
| P3 | แผน migration ถัดไปโดยไม่แก้ไฟล์ 004 | `MIGRATION_PLAN.md` | หลังล็อก |
| P4 | เสริม payment_events / แยก allocations ถ้า Mark ล็อกเป้า | SCHEMA_PROPOSAL | Blocker |
| P5 | คงกฎ: โค้ดห้ามโผล่ API สินค้า · ไม่เปิด SlipOK/Gateway | domain + payment adapters | นโยบายคงเดิม |

## 6. เทสที่มีแล้วที่เกี่ยวกับ DB

| ไฟล์ | ครอบคลุม |
|------|----------|
| `tests/commerce.test.mjs` | fingerprint, concurrent last key, ownership, idempotent pay/topup |
| `tests/nott-ops.test.mjs` | queue unique path, chat scope, payment_channel, no secrets in product |
| `tests/local-migrate.test.mjs` | apply ถึง 004 บน `.data` |
| `tests/migration-upgrade.test.mjs` | 004 บนฐานมีข้อมูล + FK rollback |
| `tests/d1-*.test.mjs` | แทร็ก B fulfillment / catalog ไม่รั่ว secret |

## 7. Blockers ส่ง Mark

1. ยืนยัน **ฐานร้านเดียวบน DO** (ไม่ย้าย D1) ตามข้อเสนอน็อตหรือไม่  
2. เป้าหมายตารางใหม่: categories / cart / order_items / payment_events / allocations แยก — ล็อกชุดไหนในรอบถัดไป  
3. แทร็ก D1: แช่แข็งเป็นเอกสารเงาจนกว่าจะมี cutover plan ใช่หรือไม่  

ค่าเริ่มต้นที่ใช้ออกแบบเอกสารชุดนี้ (อิงโจทย์ Owner): **(1) ใช่ — DO ร้านเดียว (2) ใส่ใน ERD/Proposal ครบ แต่ยังไม่ migrate (3) ใช่ — แช่แข็ง D1**
