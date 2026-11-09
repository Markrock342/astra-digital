# รายงานส่งมาร์ค — NOTT Database Review Pack (DB-01…05)

**ถึง:** มาร์ค (System Architecture / API Contract)  
**จาก:** น็อต (Database)  
**โครงการ:** FIFACORP Digital Goods — `astra-digital`  
**วันที่:** 2026-11-09  
**PR:** https://github.com/Markrock342/astra-digital/pull/1  
**Branch:** `feat/nott-database-audit`  
**Base:** `main` @ `9eebc6f`  
**หัว Commit:** `d48e3b3` (รายงานนี้จะตามด้วย commit ล่าสุดบน branch เดียวกัน)

---

## 1. สรุปผลตรวจ Acceptance Criteria

| เกณฑ์ | สถานะ | หลักฐาน |
|-------|--------|---------|
| Database Audit อ้างอิง Source Code จริง | **ผ่าน** | [DB_AUDIT.md](DB_AUDIT.md) อ้าง `cloud/worker.mjs`, `server/migrations/001–004`, `db/migrations/0001–0002`, `server/sqlite-migrations.mjs` |
| ERD + Schema Proposal ครอบคลุมทุกโมดูล | **ผ่าน** | [ERD.md](ERD.md) · [SCHEMA_PROPOSAL.md](SCHEMA_PROPOSAL.md) ครบ 9 กลุ่มในโจทย์ |
| Data Integrity Design | **ผ่าน** | [DATA_INTEGRITY.md](DATA_INTEGRITY.md) ครบ 7 ความเสี่ยง |
| Migration Plan | **ผ่าน** | [MIGRATION_PLAN.md](MIGRATION_PLAN.md) — ระบุของเดิมที่เก็บ, ลำดับถัดไป, backup, ห้าม deploy |
| Database Test Plan | **ผ่าน** | [DB_TEST_PLAN.md](DB_TEST_PLAN.md) ครบหัวข้อโจทย์ + map เทสที่มี |
| Pull Request ให้มาร์คตรวจ | **ผ่าน** | PR #1 OPEN |
| ยังไม่ Deploy Migration / ไม่เปลี่ยน Production | **ปฏิบัติตาม** | ไม่มีไฟล์ SQL ใหม่ · ไม่แก้ `004` · ไม่แก้ Worker ใน PR นี้ |
| ไม่ทำ Frontend / SlipOK / Gateway / เปลี่ยน Architecture เอง | **ปฏิบัติตาม** | ระบุเป็น Blocker แทน |

**คำตัดสินรอบนี้:** งาน Review ตาม LCS TASK DB-01…05 **ส่งตรวจได้ครบ**

หมายเหตุขอบเขต: ข้อความต้นทางที่ว่า “ทำ SQL Migration + Test กันขายโค้ดซ้ำ” ถูกจำกัดชัดใน TASK ว่า **ช่วงนี้ยังไม่อนุญาต Deploy / เปลี่ยน DB จริง** และให้ส่ง ERD + แผนก่อนให้มาร์คล็อก — ดังนั้นไฟล์ migration 005+ และการเขียนเทสชุดใหม่ **ยังไม่ทำใน PR นี้โดยตั้งใจ** รอหลัง Review

---

## 2. รายงานราย Task

### TASK DB-01 — Database Audit
- **ไฟล์:** `docs/database/DB_AUDIT.md`
- **ผลตรวจหลัก:**
  - Runtime จริงบน Cloudflare = **Durable Object SQLite** (`server/migrations`)
  - มีแทร็กคู่ **D1** (`db/migrations`) ยังไม่ cutover
  - คุกกี้ `astra_space` → `getByName("client:"+space)` ทำให้ **คนละเบราว์เซอร์ = คนละสต็อก** (`cloud/worker.mjs` ~170–172)
  - หลัง 004 มี payments, payment_channel, STAFF, queue, chat, notifications, DEMO_CREDIT
  - ชื่อ inventory คนละรูประหว่าง DO (`inventory`) กับ D1 (`inventory_units` + `allocations`) = จุดเสี่ยงสับสน/สูญหายตอน cutover
- **Commit ที่รวมงาน:** `74a34c2`

### TASK DB-02 — ERD & Schema
- **ไฟล์:** `docs/database/ERD.md`, `SCHEMA_PROPOSAL.md`
- **ครอบคลุม:** Users/Sessions/Roles, Products/Categories/Variants, Digital Keys, Orders/Order Items, Payments/Payment Events, Preorders/Queue, Chat, Notifications, Audit
- **ของที่มีแล้ว vs ที่เสนอ:** Categories ตอนนี้เป็น TEXT; Order Items / Payment Events / Cart ยังไม่มีตาราง — เสนอใน Proposal โดยยังไม่สร้าง SQL
- **กติกา:** ไม่แก้ `004_commerce_ops.sql`; ของใหม่เป็น migration ถัดไปหลังล็อก

### TASK DB-03 — Data Integrity
- **ไฟล์:** `docs/database/DATA_INTEGRITY.md`
- **สรุปการกันขายโค้ดซ้ำ (ของที่มีในโค้ดแล้ว):**
  - `fingerprint` UNIQUE
  - allocate ด้วย `UPDATE … WHERE order_id IS NULL` ใน transaction
  - pay idempotent เมื่อ DELIVERED แล้ว
  - เทส: `tests/commerce.test.mjs`, `tests/d1-fulfillment.test.mjs`
- **ช่องว่างสำคัญ:** หลาย DO ทำให้ race ข้ามเบราว์เซอร์ “ไม่เกิดบนสต็อกร่วม” จนกว่าจะรวมร้านเดียว; ยังไม่มี `payment_events` สำหรับ webhook จริง

### TASK DB-04 — Migration Plan
- **ไฟล์:** `docs/database/MIGRATION_PLAN.md`
- **เก็บ:** 001–004 (A) และ 0001–0002 (B แช่แข็ง)
- **ลำดับเสนอหลังล็อก:** Worker ร้านเดียว → `005_payment_events` → cart/order_items → categories (optional)
- **Backup/Recovery + เทส upgrade บนฐานมีข้อมูล:** อ้าง `tests/migration-upgrade.test.mjs` เป็นแบบอย่าง

### TASK DB-05 — Database Test Plan
- **ไฟล์:** `docs/database/DB_TEST_PLAN.md`
- **แมป** FK / UNIQUE / concurrent / allocation / duplicate payment / migration / preservation / auth isolation → เทสที่มีและช่องว่างหลังล็อก schema

---

## 3. ข้อเสนอฐานข้อมูลหลัก (จากน็อต — รอ Confirm)

| ข้อ | ข้อเสนอ |
|-----|---------|
| Runtime | คง **Durable Object SQLite** · **ยังไม่ย้าย D1** |
| Isolation | **ฐานร้านเดียว**; แยกลูกค้าด้วย session cookie ไม่ใช้ `astra_space` แยกสต็อก |
| Schema 004 | **ใช้ต่อได้ · ไม่แก้ไฟล์ไมเกรชัน 004** |
| งานถัดไปหลัง Confirm | แก้เฉพาะทางเข้าฐานใน `cloud/worker.mjs` (คนละ PR จากเอกสารนี้) |
| นโยบายคงเดิม | ตรวจสิทธิ์คิว/แชท/ข้อความ/อันดับ · รหัสสินค้าห้ามโผล่ API สินค้า · ยังไม่เปิด SlipOK/Gateway |

---

## 4. Blockers — ขอมาร์คล็อกก่อน (น็อตไม่ตัดสินใจ Architecture เอง)

1. **ยืนยันฐานร้านเดียวบน DO + ไม่ย้าย D1 ในรอบนี้หรือไม่**  
   ถ้าใช่ → น็อตจะเปิด PR ถัดไปแก้เฉพาะ `cloud/worker.mjs`
2. **ล็อกชุดตารางถัดไป**  
   - `payment_events` จำเป็นก่อน webhook หรือยังไม่ต้อง?  
   - `order_items` / `cart_items` / `categories` ล็อกรอบไหน?
3. **dual-track D1**  
   ยืนยันแช่แข็งเป็นเอกสารเงาจนกว่ามี cutover plan หรือไม่?

จนกว่าจะได้คำตอบ 3 ข้อนี้ **จะยังไม่ Deploy migration และยังไม่เปลี่ยน routing ร้านเดียว**

---

## 5. สิ่งที่อยู่นอกขอบเขต PR นี้ (ทำถูกต้องตามโจทย์)

- ไม่พัฒนา Frontend  
- ไม่เชื่อม SlipOK / Payment Gateway จริง  
- ไม่เปลี่ยน Architecture หลักโดยไม่ได้รับอนุมัติ  
- ไม่ Deploy Database / Migration จริง  
- ไม่แก้ไฟล์ `004_commerce_ops.sql`

---

## 6. ลิงก์เอกสารครบชุด

| Task | ไฟล์ |
|------|------|
| Index | [README.md](README.md) |
| DB-01 | [DB_AUDIT.md](DB_AUDIT.md) |
| DB-02 | [ERD.md](ERD.md) · [SCHEMA_PROPOSAL.md](SCHEMA_PROPOSAL.md) |
| DB-03 | [DATA_INTEGRITY.md](DATA_INTEGRITY.md) |
| DB-04 | [MIGRATION_PLAN.md](MIGRATION_PLAN.md) |
| DB-05 | [DB_TEST_PLAN.md](DB_TEST_PLAN.md) |
| Roadmap | [../roadmaps/NOTT-DB-ARCHITECTURE.md](../roadmaps/NOTT-DB-ARCHITECTURE.md) |

---

## 7. Commit SHA สำหรับรายงาน

| SHA | ข้อความ |
|-----|---------|
| `74a34c2` | เอกสาร: Review Pack ฐานข้อมูล NOTT (DB-01 ถึง DB-05) |
| `d48e3b3` | เอกสาร: ใส่ลิงก์ PR Review Pack ฐานข้อมูล |
| *(commit ตามหลังรายงานนี้)* | เอกสาร: รายงานส่งมาร์ค DB Review Pack |

---

## 8. คำขอจากมาร์ค

กรุณา Review PR #1 แล้วตอบ Blocker ข้อ 1–3  
เมื่อล็อกแล้ว น็อตจะเริ่มงานถัดไปตามลำดับ: (ก) Worker ร้านเดียว ถ้า Approve → (ข) migration/test ตาม SCHEMA ที่ล็อก — ยังไม่ทำจนกว่าจะได้รับคำสั่งชัดเจน
