# DB-04 — Migration Plan

สถานะ: Draft for Mark Review · อัปเดตตามผลตรวจ 11 พ.ย. (**DB-DOC-04**)  
**ช่วงนี้ยังไม่อนุญาต Deploy Migration จริงหรือเปลี่ยน Production DB**  
**น็อตห้ามแตะ** `cloud/worker.mjs` เรื่อง shop DO ในรอบนี้ — มาร์คกำลังแก้; เอกสารนี้ส่ง**แบบ**ให้ล็อกก่อน

## 1. ของเดิมที่ต้องเก็บไว้

### แทร็ก A (หลัก — DO / local SQLite)

| ลำดับ | ไฟล์ | เหตุผลเก็บ |
|-------|------|------------|
| 1 | `server/migrations/001_initial.sql` | ฐานต้นทาง |
| 2 | `server/migrations/002_reviews.sql` | reviews |
| 3 | `server/migrations/003_reference_layout.sql` | preorder / username / flags |
| 4 | `server/migrations/004_commerce_ops.sql` | STAFF / payments / queue / chat / notifications — **ห้ามแก้ไฟล์นี้** |

ตัวช่วย apply: `server/sqlite-migrations.mjs` (FK deferral บนฐานที่มีข้อมูล — แทร็ก A)

### แทร็ก B (D1 — แช่แข็ง)

| ลำดับ | ไฟล์ | หมายเหตุ |
|-------|------|----------|
| 1 | `db/migrations/0001_init.sql` | schema เป้าเดิม |
| 2 | `db/migrations/0002_commerce_ops.sql` | **ใช้กับฐานใหม่/ว่างเท่านั้น** — ยังพังบนฐานที่มีข้อมูล (`FOREIGN KEY constraint failed`); ไม่มี helper deferral แบบแทร็ก A |

ไม่ลบออกจากรีโป — แต่ **ไม่ cutover** ในแผนรอบนี้

## 2. การย้ายเข้า DO ชื่อ `shop` กับกุญแจเข้ารหัสคลัง

### 2.1 ข้อเท็จจริงจากโค้ด

ใน `cloud/worker.mjs` กุญแจถอดรหัสคลัง derive จาก Durable Object id:

```text
key = HMAC-SHA256(INVENTORY_KEY, ctx.id.toString())
```

ดังนั้น ciphertext ใน `inventory.secret` (และอนาคต `login_id_enc` / `password_enc`) ของ DO เดิม **ถอดด้วย key ของ DO `shop` ไม่ได้** ถ้า `ctx.id` คนละค่า

### 2.2 ทางเลือกที่ต้องให้ Mark ล็อก (เลือกอย่างใดอย่างหนึ่ง)

| ทางเลือก | ความหมาย | ข้อดี | ข้อเสีย |
|----------|----------|--------|---------|
| **S1 — shop เริ่มฐานว่าง** | DO `shop` migrate 001–00x แล้ว seed ใหม่ / import สต็อกใหม่ | เรียบ ไม่มี decrypt พัง | สูญเสียข้อมูลเดโม/tenant เก่า |
| **S2 — export → re-encrypt → import** | บน DO เดิม: decrypt ด้วย key เดิม → ได้ plaintext → เข้ารหัสใหม่ด้วย key ของ `shop` → ใส่ฐาน shop | เก็บของจริงได้ | ต้องสคริปต์ one-shot + ห้ามล็อกคู่ขนานตอนย้าย |

**ค่าแนะนำในเอกสารนี้ระหว่างรอ Mark:** เดโม/sandbox ใช้ **S1**; ถ้าย้ายของจริงต้อง **S2** และทำเป็น Task คนละ PR หลัง shop DO พร้อม

น็อต**ไม่ implement** การเปลี่ยน routing shop ใน Worker ตามคำสั่งรอบนี้

## 3. Schema ที่จะเพิ่ม/ปรับ (หลังเอกสาร 1–6 ผ่านและ Mark ล็อก)

ลำดับเสนอ (forward-only) — ชื่อไฟล์สมมติ:

| ขั้น | ชื่อสมมติ | เนื้อหา |
|------|-----------|---------|
| A0 | (มาร์ค) | routing → DO `shop` ตาม Architecture ที่ล็อก |
| A1 | `005_*.sql` | ตามชุดที่ล็อกจาก DOC-01…03 (credential คู่ / reservation deliver / ranking indexes ฯลฯ) — **ยังไม่เขียนในรอบเอกสารนี้** |
| A2+ | 006… | payment_events / cart / … เมื่อล็อก |

### 3.1 ข้อบังคับเมื่อมีไฟล์ `005_*.sql`

รายการ migration ใน Worker **เขียนตายตัว** ที่ `cloud/worker.mjs` (~บรรทัด 16–19 import และ ~59–63 อาเรย์ชื่อไฟล์):

1. เพิ่ม `import … from "../server/migrations/005_….sql"`  
2. เพิ่มคู่ `["005_….sql", content]` ในลูป apply  
3. **เพิ่มเทสต์** ว่า list ชื่อใน Worker ตรงกับไฟล์ `*.sql` ใน `server/migrations/` (กันลืม import)  
4. เทสต์ upgrade บน fixture ที่มีข้อมูล (แบบ `migration-upgrade.test.mjs`)

> งานแตะ Worker เพื่อเพิ่ม 005 เป็นคนละเรื่องกับ “shop DO routing” ที่มาร์คทำ — แต่ต้องไม่ชน PR; ประสานลำดับกับมาร์คตอน implement

### 3.2 ข้อเสนอ `variants.price >= 0` — **ตัดทิ้งในรอบนี้**

Owner ล็อก (2026-11-11): **ไม่ทำ** rebuild ตาราง `variants` เพื่อเปลี่ยน CHECK `price > 0` → `>= 0` ในรอบนี้

เหตุผลปฏิบัติ: ต้อง rebuild + FK deferral + เทสต์บนฐานมีข้อมูล — ความเสี่ยงสูงโดยพรีออเดอร์ราคา 0 บน DO ปัจจุบันจัดการที่ชั้นแอปอยู่แล้ว (`cinema-max-30`)

ถ้าอนาคตจะทำใหม่ ต้องมี: migration rebuild variants พร้อม `executeSqliteMigration` / deferral + เทสต์ populated — ไม่เริ่มจนกว่า Mark/Owner สั่งใหม่

## 4. ลำดับงานหลังเอกสารผ่านรีวิว

```text
1) Mark merge/ล็อกเอกสาร DB-DOC-01…06
2) มาร์คจบ shop DO routing (น็อตไม่แตะ)
3) ล็อก S1 vs S2 สำหรับข้อมูลคลัง
4) น็อตเขียน 005 + เทสต์ upgrade + เทสต์ list worker↔โฟลเดอร์
5) เพิ่ม import 005 ใน worker (ประสานมาร์ค) — ยังไม่ deploy production จนกว่า Owner สั่ง
```

## 5. Backup และ Recovery

| สภาพแวดล้อม | วิธี |
|--------------|------|
| Local `.data/commerce.sqlite` | ก๊อปปี้ไฟล์ก่อน migrate / เทส |
| DO เดิมก่อนย้าย shop | snapshot/export ตามแผน S2 ถ้าเลือกเก็บของ |
| DO `shop` ใหม่ | ถ้าระบุ S1: ไม่พึ่งของเก่า |
| D1 local | ลบ state แล้ว apply ใหม่ได้ตอน dev เท่านั้น; 0002 ห้ามทับฐาน populate |
| Rollback | forward-fix หรือ restore ไฟล์ backup — ไม่มี down migration อัตโนมัติ |

## 6. ทดสอบ Migration บนฐานที่มีข้อมูล

มีอยู่แล้ว (แทร็ก A):

- `tests/migration-upgrade.test.mjs` + `tests/fixtures/legacy-commerce.mjs`

ต้องมีเมื่อมี 005+:

| ID | เคส | ผ่านเมื่อ |
|----|------|-----------|
| MU1 | fixture หลัง 004 → apply 005 | แถวเดิมครบ + คอลัมน์/ตารางใหม่มี |
| MU2 | apply 005 สองครั้ง | idempotent ผ่าน schema_migrations |
| MU3 | Worker migration list | ชื่อในโค้ด = ไฟล์ใน `server/migrations/*.sql` ครบ |
| MU4 | (ถ้า S2) re-encrypt sample | decrypt ด้วย key shop ได้หลัง import |

## 7. นอกแผนรอบนี้

- Deploy migration ขึ้น Cloudflare production  
- แก้เนื้อหาไฟล์ `004_commerce_ops.sql`  
- เปิด SlipOK/Gateway  
- น็อตแก้ shop DO routing ใน `cloud/worker.mjs`  
- Rebuild `variants` เพื่อ `price >= 0`
