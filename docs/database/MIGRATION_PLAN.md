# DB-04 — Migration Plan

สถานะ: Draft for Mark Review  
**ช่วงนี้ยังไม่อนุญาต Deploy Migration จริงหรือเปลี่ยน Production DB**

## 1. ของเดิมที่ต้องเก็บไว้

### แทร็ก A (หลัก — DO / local SQLite)

| ลำดับ | ไฟล์ | เหตุผลเก็บ |
|-------|------|------------|
| 1 | `server/migrations/001_initial.sql` | ฐานต้นทาง |
| 2 | `server/migrations/002_reviews.sql` | reviews |
| 3 | `server/migrations/003_reference_layout.sql` | preorder / username / flags |
| 4 | `server/migrations/004_commerce_ops.sql` | STAFF / payments / queue / chat / notifications — **ห้ามแก้ไฟล์นี้** |

ตัวช่วย apply: `server/sqlite-migrations.mjs` (FK deferral บนฐานมีข้อมูล)

### แทร็ก B (D1 — แช่แข็ง)

| ลำดับ | ไฟล์ | หมายเหตุ |
|-------|------|----------|
| 1 | `db/migrations/0001_init.sql` | schema เป้าเดิม |
| 2 | `db/migrations/0002_commerce_ops.sql` | STAFF / channel / queue / ledger.kind |

ไม่ลบออกจากรีโป — แต่ **ไม่ cutover** ในแผนรอบนี้

## 2. Schema ที่จะเพิ่ม/ปรับ (หลัง Mark ล็อกเท่านั้น)

ลำดับเสนอ (forward-only):

| ขั้น | ชื่อสมมติ | เนื้อหา | เงื่อนไขเริ่ม |
|------|-----------|---------|----------------|
| A0 | (ไม่มีไฟล์) | แก้ทางเข้า Worker → DO ร้านเดียว | Mark Approve Architecture |
| A1 | `005_payment_events.sql` | ตาราง payment_events | ก่อนเปิด webhook |
| A2 | `006_cart_or_order_items.sql` | cart_items และ/หรือ order_items | เมื่อ Mark ล็อกโมเดลตะกร้า |
| A3 | `007_categories.sql` | แยก categories ถ้าเลือกตัวเลือก B | optional |
| — | D1 mirror | sync ชื่อตารางให้ใกล้ DO หรือกลับกัน | เฉพาะเมื่อมีแผน cutover |

**ราคา/สต็อก/กันซื้อซ้ำ** ต้องไม่ถูกลดความเข้มในทุกขั้น

## 3. ลำดับงานที่แนะนำหลัง Review

```text
1) Mark Review เอกสารชุด docs/database/*
2) ล็อก: ร้านเดียวบน DO · ชุดตารางถัดไป
3) (ถ้าล็อกแล้ว) เปลี่ยน cloud/worker.mjs ให้ชี้ DO คงที่ — คนละ PR กับ SQL ก็ได้
4) เขียน migration 005+ พร้อมเทส upgrade บน fixture มีข้อมูล
5) Apply เฉพาะ local / preview — ห้าม production จนกว่า Owner สั่ง
```

## 4. Backup และ Recovery

| สภาพแวดล้อม | วิธี |
|--------------|------|
| Local `.data/commerce.sqlite` | ก๊อปปี้ไฟล์ก่อน `npm run migrate` / เทส |
| DO SQLite | พึ่ง Cloudflare DO storage — ก่อนเปลี่ยน routing ร้านเดียวควรบันทึกว่า tenant `client:*` ไหนเป็น canonical |
| D1 local | state ใต้ `db/.wrangler/` — ลบแล้ว apply ใหม่ได้ตอน dev เท่านั้น |
| Rollback | SQLite/D1 **ไม่มี down migration อัตโนมัติ** → forward-fix หรือ restore จากไฟล์ backup |

## 5. ทดสอบ Migration บนฐานที่มีข้อมูล

มีอยู่แล้ว:

- `tests/migration-upgrade.test.mjs` + `tests/fixtures/legacy-commerce.mjs`  
  - 004 อัปเกรดโดยไม่เสีย users/sessions/orders/balances/keys  
  - FK พังต้องไม่ทิ้ง migration marker  

ต้องเพิ่มเมื่อมี 005+:

- fixture หลัง 004 → apply 005 แล้วตรวจแถวเดิมครบ  
- idempotent re-apply (schema_migrations กันซ้ำ)  
- product API ยังไม่มี secret หลัง migrate  

## 6. นอกแผนรอบนี้

- Remote D1 create / production database_id  
- Deploy migration ขึ้น Cloudflare production  
- แก้เนื้อหา 004  
- เปิด SlipOK/Gateway
