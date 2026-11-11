# DB-04 — Migration Plan

สถานะ: Draft for Mark Review · อัปเดตตามผลตรวจ 11 พ.ย. (**DB-DOC-04**) + รีวิวรอบ 2  
**ช่วงนี้ยังไม่อนุญาต Deploy Migration จริงหรือเปลี่ยน Production DB**  
**น็อตห้ามแตะ** `cloud/worker.mjs` เรื่อง shop DO — มาร์คทำ `141ffad` แล้ว; เอกสารนี้ส่งแบบ rebuild/005 ให้ล็อกก่อนลงมือ

## 1. ของเดิมที่ต้องเก็บไว้

### แทร็ก A (หลัก — DO / local SQLite)

| ลำดับ | ไฟล์ | เหตุผลเก็บ |
|-------|------|------------|
| 1 | `server/migrations/001_initial.sql` | ฐานต้นทาง |
| 2 | `server/migrations/002_reviews.sql` | reviews |
| 3 | `server/migrations/003_reference_layout.sql` | preorder / username / flags |
| 4 | `server/migrations/004_commerce_ops.sql` | STAFF / payments / queue / chat / notifications — **ห้ามแก้ไฟล์นี้** |

ตัวช่วย apply: `executeSqliteMigration` ใน `server/sqlite-migrations.mjs`  
(`PRAGMA defer_foreign_keys` บนฐานที่มีข้อมูล — แทร็ก A)

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

ดังนั้น ciphertext ของ DO เดิม **ถอดด้วย key ของ DO `shop` ไม่ได้** ถ้า `ctx.id` คนละค่า

### 2.2 ทางเลือกที่ล็อกแล้ว: **S1 เท่านั้น**

| ทางเลือก | สถานะ |
|----------|--------|
| **S1 — shop เริ่มฐานว่าง** | **เลือกแล้ว** — ทำใน `141ffad` (DO ชื่อ `shop`, เปิดครั้งแรกไม่มีสินค้าตัวอย่าง) |
| **S2 — export → re-encrypt → import** | **ตัดทิ้งรอบนี้** — ไม่ทำ / ไม่เขียนแผนปฏิบัติการ S2 ใน 005 |

น็อต**ไม่ implement** การเปลี่ยน routing shop ใน Worker (มาร์คทำแล้ว)

## 3. Schema ที่จะเพิ่ม/ปรับ — ไฟล์ `005_*.sql` เดียว

**ยังไม่เริ่มเขียน SQL** จนกว่า PR **#6 + #7 + #9** แก้และ **merge** แล้ว (ตามมาร์ค)

เมื่ออนุญาตแล้ว ใช้ **ไฟล์เดียว** ประกอบด้วย:

1. **Rebuild `inventory`** ผ่าน `executeSqliteMigration`  
   - credential คู่: `login_id_enc`, `password_enc`, `legacy_single_secret`  
   - fingerprint = HMAC-SHA256(serverKey, JSON canonical)  
   - `reservation_id` + XOR CHECK กับ `order_id` (จาก DOC-02)  
   - DROP `secret` หลัง map (ถ้ามีแถว)  
2. **Rebuild `reservations`**  
   - เพิ่ม `DELIVERED` ใน status CHECK  
   - คอลัมน์ `delivered_at` / `delivered_by`  
3. **Index**  
   - `orders(status, created_at)`  
   - `reservations(status, created_at)` (แนะนำคู่)  
4. **ก่อน apply:** `COUNT` แถว inventory เก่า — ถ้า 0 ข้าม legacy backfill; ถ้า >0 ใช้กฎมาร์ค: `login_id=โค้ดเดิม`, `password=""`, `legacy_single_secret=1`

ชื่อไฟล์สมมติ: `005_credential_preorder_indexes.sql` (ล็อกชื่อตอน implement)

### 3.1 ข้อบังคับเมื่อมีไฟล์ `005_*.sql` (อ้างชื่อ symbol — ไม่ใส่เลขบรรทัด)

รายการ migration ใน Worker เป็น **import ตายตัว** + อาร์เรย์คู่ชื่อไฟล์ใน `cloud/worker.mjs`:

| สิ่งที่มีอยู่ | สัญลักษณ์ / รูปแบบ |
|--------------|---------------------|
| helper | `executeSqliteMigration` |
| imports ปัจจุบัน | `initial`, `reviews`, `referenceLayout`, `commerceOps` จาก `server/migrations/001…004_*.sql` |
| รายการ apply | อาร์เรย์คู่ `["00x_….sql", content]` ใน worker (ต่อจากคู่ `001_initial.sql` … `004_commerce_ops.sql`) |

เมื่อมี 005 ต้อง:

1. เพิ่ม import binding ใหม่สำหรับไฟล์ 005  
2. เพิ่มคู่ชื่อไฟล์ในอาร์เรย์ apply ของ worker  
3. **เทสต์** ว่า list ชื่อใน Worker ตรงกับไฟล์ `*.sql` ใน `server/migrations/`  
4. เทสต์ upgrade บน fixture ที่มีข้อมูล (ต่อจาก `tests/migration-upgrade.test.mjs` + `tests/fixtures/legacy-commerce.mjs`)

> งานแตะ Worker เพื่อเพิ่ม 005 เป็นคนละเรื่องกับ shop DO routing ที่มาร์คทำแล้ว — ประสานตอน implement

### 3.2 ข้อเสนอ `variants.price >= 0` — **ตัดทิ้งในรอบนี้**

**ไม่ทำ** rebuild ตาราง `variants` เพื่อเปลี่ยน CHECK `price > 0` → `>= 0` ในรอบนี้

## 4. ลำดับงานหลังเอกสารผ่านรีวิว

```text
1) Mark merge เอกสารตามลำดับ: #4 → #6 → #7 → #9 → …
2) น็อตเขียน 005 ไฟล์เดียว (rebuild inventory+reservations + indexes) + เทสต์
3) เพิ่ม import 005 ใน worker + เทสต์ list ↔ โฟลเดอร์
4) ยังไม่ deploy production จนกว่า Owner/Mark สั่ง
```

## 5. Backup และ Recovery

| สภาพแวดล้อม | วิธี |
|--------------|------|
| Local `.data/commerce.sqlite` | ก๊อปปี้ไฟล์ก่อน migrate / เทส |
| DO `shop` (S1) | ฐานว่างตอนเริ่ม — ไม่พึ่ง ciphertext จาก DO เก่า |
| D1 local | ลบ state แล้ว apply ใหม่ได้ตอน dev เท่านั้น; 0002 ห้ามทับฐาน populate |
| Rollback | forward-fix หรือ restore ไฟล์ backup — ไม่มี down migration อัตโนมัติ |

## 6. ทดสอบ Migration บนฐานที่มีข้อมูล

มีอยู่แล้ว (แทร็ก A):

- `tests/migration-upgrade.test.mjs` + `tests/fixtures/legacy-commerce.mjs`

ต้องมีเมื่อมี 005:

| ID | เคส | ผ่านเมื่อ |
|----|------|-----------|
| MU1 | fixture หลัง 004 → apply 005 | แถวเดิมครบ + schema ใหม่ (credential / DELIVERED / XOR / indexes) |
| MU2 | apply 005 สองครั้ง | idempotent ผ่าน schema_migrations |
| MU3 | Worker migration list | ชื่อในโค้ด = ไฟล์ใน `server/migrations/*.sql` ครบ |
| MU5 | นับแถว secret เก่าก่อน backfill | COUNT=0 → ข้าม legacy; COUNT>0 → map ตามกฎมาร์ค |

## 7. นอกแผนรอบนี้

- Deploy migration ขึ้น Cloudflare production  
- แก้เนื้อหาไฟล์ `004_commerce_ops.sql`  
- เปิด SlipOK/Gateway  
- S2 re-encrypt / ย้าย ciphertext ข้าม DO  
