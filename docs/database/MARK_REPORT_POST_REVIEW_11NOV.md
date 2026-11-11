# รายงานส่งมาร์ค — งานต่อจากผลตรวจ 11 พ.ย. (NOTT)

**ถึง:** มาร์ค (Architecture / API Contract / Review)  
**จาก:** น็อต (Database + API fixes ตามโจทย์)  
**วันที่รายงาน:** 2026-11-11  
**ฐาน `main` ตอนเริ่มงาน:** `f43587f`  
**กติกาที่ทำตาม:** 1 Task ID = 1 branch = 1 PR · **ไม่แตะ** `cloud/worker.mjs` เรื่อง shop DO · **ยังไม่เขียน migration 005**

---

## 1. คำตัดสินรวม (Self-QC)

| มุม | ผล |
|-----|-----|
| ครบตามโจทย์ข้อ 1–10 ในขอบเขตที่กำหนด | **ผ่าน** |
| ข้อห้าม (อย่าแตะ shop DO / 1 PR ต่อ Task) | **ผ่าน** — ตรวจ diff แล้วไม่มี PR ใดแก้ `cloud/worker.mjs` |
| เอกสารก่อน migration 005 | **ผ่าน** — มีแค่แบบใน docs ไม่มีไฟล์ `005_*.sql` |
| API fixes มี regression test | **ผ่าน** — รัน `npm test` บน `fix/api-fix-01`…`04` ทั้งสี่ branch **41 passed** ตอนทำรายงานนี้ |
| พร้อมให้มาร์ครีวิว/merge | **พร้อม** — แนะนำลำดับ merge ด้านล่าง |

### สิ่งที่ตั้งใจยังไม่ทำ (ถูกตามโจทย์)

- ยังไม่ implement migration 005 / ไม่ apply production  
- เทสต์ K1–K4 / R1–R5 / P1–P4 เป็น**แผนเทสต์ในเอกสาร** (สถานะ「ยังขาด implement」) — จะลงมือหลังมาร์คล็อกแบบและหลังมี schema  
- โค้ด ranking ยังไม่บังคับ ADMIN-only / period filter ใน runtime — อยู่ที่เอกสาร DB-DOC-03 (เลน「แก้เอกสารก่อน」)

---

## 2. ตารางตรวจทีละข้อโจทย์

### เลนเอกสาร (ก่อน migration 005)

| # | โจทย์ | สถานะ | PR | Commit | หลักฐานสั้น |
|---|--------|--------|-----|--------|-------------|
| 1 | ID+Password สองช่อง · fingerprint ทั้งคู่ · แผนย้าย secret · เทสต์ไม่รั่ว | **ครบ (ออกแบบ)** | [#6](https://github.com/Markrock342/astra-digital/pull/6) | `ea84413` | `SCHEMA_PROPOSAL` §4.0 · `login_id_enc`/`password_enc` · fingerprint `SHA-256(v1\\nlogin\\npassword)` · แผนย้าย M0–M6 · แผนเทสต์ K1–K4 |
| 2 | Admin fulfill พรีออเดอร์ · DELIVERED · delivered_* · ผูกของ · idempotent tx | **ครบ (ออกแบบ)** | [#7](https://github.com/Markrock342/astra-digital/pull/7) | `f20b129` | §4.5 · สถานะ PREORDER→DELIVERED · `delivered_at`/`delivered_by` · `reservation_id` XOR · tx deliver ซ้ำไม่ allocate เพิ่ม · แผนเทสต์ P1–P4 |
| 3 | อันดับผู้ซื้อ admin · วัน/สัปดาห์/เดือน/ทั้งหมด · Bangkok · พรีออเดอร์จ่ายแล้ว · ไม่ส่ง user id · index · A5 | **ครบ (ออกแบบ)** | [#8](https://github.com/Markrock342/astra-digital/pull/8) | `9d1c61b` | §4.6 · period + Asia/Bangkok · คอลัมน์ `orders.created_at` / `reservations.created_at` · นับ PREORDER+DELIVERED · response ไม่มี user id · index `orders(status, created_at)` · A5→R1–R5 |
| 4 | MIGRATION_PLAN: shop key / 005 ใน worker list / price>=0 | **ครบ** | [#9](https://github.com/Markrock342/astra-digital/pull/9) | `afc87f6` | HMAC(INVENTORY_KEY, ctx.id) · เลือก S1 ว่าง หรือ S2 re-encrypt · 005 ต้อง import ใน worker + เทสต์ list=โฟลเดอร์ · **ตัดทิ้ง** `price >= 0` ตาม Owner |
| 5 | คิวก่อน/หลังจ่าย · รวมร้าน vs ต่อสินค้า | **ครบ (ออกแบบ)** | [#10](https://github.com/Markrock342/astra-digital/pull/10) | `255582b` | โหมด `after_payment` / `on_create` · **ล็อกคิวรวมทั้งร้าน** · default after_payment |
| 6 | แก้ข้อความเท็จ Audit / TestPlan / Handoff | **ครบ** | [#4](https://github.com/Markrock342/astra-digital/pull/4) | `4ba7c33` | D1 0002 = ใช้ฐานใหม่เท่านั้น · C3/A4/A5 = ยังขาด · PR #1 = merged `f43587f` |

Roadmap รวม Task ID (Owner Approved): [#5](https://github.com/Markrock342/astra-digital/pull/5) · `fb70c57`

### เลนโค้ด API (PR เล็ก + regression)

| # | โจทย์ | สถานะ | PR | Commit | หลักฐานสั้น |
|---|--------|--------|-----|--------|-------------|
| 7a | `active=false` ยังจ่ายได้ | **แก้แล้ว** | [#11](https://github.com/Markrock342/astra-digital/pull/11) | `cfc1d46` | sandbox + inactive → pay **403**; unset ยังจ่ายได้ |
| 7b | เปิดแชทไม่แจ้ง staff | **แก้แล้ว** | [#11](https://github.com/Markrock342/astra-digital/pull/11) | `cfc1d46` | `openChatThread` notify STAFF/ADMIN |
| 7c | ranking limit ทศนิยม → 500 | **แก้แล้ว** | [#11](https://github.com/Markrock342/astra-digital/pull/11) | `cfc1d46` | ไม่ใช่จำนวนเต็ม → **400** |
| 8 | rate limit · ลด fan-out staff · ปิดห้อง · tx | **แก้แล้ว** | [#12](https://github.com/Markrock342/astra-digital/pull/12) | `fa45112` | 30 msg/min · throttle 60s/thread · `POST .../close` · เขียนใน `tx` |
| 9 | `%E0%A4` → 500 | **แก้แล้ว** | [#13](https://github.com/Markrock342/astra-digital/pull/13) | `782e73f` | จับ decode พัง → **400** |
| 10 | staff orders limit/cursor | **แก้แล้ว** | [#14](https://github.com/Markrock342/astra-digital/pull/14) | `d12c6c5` | `{ orders, nextCursor }` |

### ข้อห้าม

| ข้อห้าม | ผลตรวจ |
|---------|--------|
| อย่าแตะ `cloud/worker.mjs` เรื่อง shop DO | **ผ่าน** — ไม่มี diff worker ใน PR เอกสาร/API ชุดนี้; DOC-04 ส่งแบบให้มาร์คล็อก |
| 1 PR = 1 Task ID | **ผ่าน** — PR #4–#14 (ยกเว้น #5 = roadmap) |

---

## 3. รายละเอียดงานเอกสาร (สำหรับมาร์คล็อกแบบ)

### 3.1 Credential คู่ (DB-DOC-01)
- คอลัมน์เป้า: `login_id_enc`, `password_enc`  
- Fingerprint จากทั้งสองช่อง (canonical `v1`)  
- แผนย้าย `secret` ช่องเดียว: M0–M6 + เตือน decrypt ข้าม DO ไม่ได้  
- เกณฑ์ไม่รั่ว: products / staff / admin · owner เท่านั้นที่เห็น plaintext หลังส่ง  
- **ขอ Mark ล็อก:** กฎ legacy backfill (`login_id=legacy_code`, `password=""` หรือแบบอื่น)

### 3.2 พรีออเดอร์ส่งโดยแอดมิน (DB-DOC-02)
- สถานะ `PREORDER → DELIVERED` + `delivered_at` / `delivered_by`  
- ผูกของ: `inventory.reservation_id` + XOR กับ `order_id` (แนะนำ)  
- Deliver idempotent ใน transaction  
- **ขอ Mark ล็อก:** path API และสิทธิ์ ADMIN-only vs STAFF ได้ deliver

### 3.3 อันดับผู้ซื้อ (DB-DOC-03)
- ADMIN เท่านั้น · `period=day|week|month|all` · Asia/Bangkok  
- เวลากรอง: `orders.created_at` (DELIVERED) + `reservations.created_at` (PREORDER|DELIVERED)  
- ไม่ส่ง user id · เพิ่ม index `orders(status, created_at)` (+ แนะนำ reservations คู่)  
- แผนเทสต์ R1–R5 แทน A5 เดิมที่อ้างเกินจริง

### 3.4 Migration plan (DB-DOC-04)
- Shop DO: S1 ฐานว่าง **หรือ** S2 export→re-encrypt→import  
- เมื่อมี 005: ต้องเพิ่ม import ใน worker list + เทสต์ list ตรงโฟลเดอร์  
- `price >= 0`: **ตัดทิ้งรอบนี้**

### 3.5 คิว (DB-DOC-05)
- รองรับ `after_payment` และ `on_create`  
- **คิวรวมทั้งร้าน** (Owner lock)  
- Default โหมด: `after_payment`

### 3.6 แก้ข้อความเท็จ (DB-DOC-06)
- D1 0002 / populated FK  
- C3 / A4 / สิทธิ์ ranking = ยังขาด  
- PR #1 merged

---

## 4. รายละเอียดงานโค้ด API + หลักฐานเทส

| PR | Regression ที่เพิ่ม | ผลรัน |
|----|---------------------|--------|
| #11 API-FIX-01 | inactive sandbox บล็อก pay · ranking reject decimal · staff ถูกแจ้งตอนเปิดแชท | 41 passed |
| #12 API-FIX-02 | rate limit · throttle notify · close thread | 41 passed |
| #13 API-FIX-03 | `%E0%A4` → 400 | 41 passed |
| #14 API-FIX-04 | limit/cursor pagination | 41 passed |

คำสั่ง: `npm test` (รวม commerce / d1 / local-migrate / migration-upgrade / nott-ops)

---

## 5. ความเสี่ยงตอน merge (สำคัญ)

1. **เอกสาร PR #4,#6–#10 แตะไฟล์ซ้อน** (`SCHEMA_PROPOSAL`, `DB_TEST_PLAN`, `DATA_INTEGRITY`, `ERD`)  
   → แนะนำ merge ลำดับ: **#4 → #6 → #7 → #8 → #9 → #10** (หรือ rebase ก่อน merge)  
2. **API PR #11–#14** แตะ `domain.mjs` / `api-handler.mjs` / `nott-ops.test.mjs` คนละส่วน แต่มีโอกาส conflict ที่ `nott-ops`  
   → แนะนำ: **#11 → #12 → #13 → #14**  
3. หลัง merge เอกสาร ยัง**ห้าม**เริ่ม 005 จนกว่ามาร์คยืนยันแบบ (โดยเฉพาะ S1/S2, legacy credential, deliver path)

---

## 6. สิ่งที่ขอมาร์คตอบกลับ (Blockers / ล็อก)

1. ยืนยันลำดับ merge เอกสารตามข้อ 5 หรือจะ squash รวมเอง  
2. ล็อกกฎ legacy ย้าย `secret` → คู่ ID/Password  
3. ล็อก S1 vs S2 เมื่อ shop DO พร้อม  
4. ล็อกว่า STAFF deliver พรีออเดอร์ได้หรือเฉพาะ ADMIN  
5. หลัง merge เอกสาร — อนุญาตให้น็อตเปิด Task เขียน `005_*.sql` + เทสต์หรือยัง

---

## 7. สรุปหนึ่งบรรทัด

งานตามผลตรวจ 11 พ.ย. **ทำครบในขอบเขตที่สั่ง** (เอกสารออกแบบ 1–6 + API fix 7–10 เป็น PR แยก, ไม่แตะ shop DO, ยังไม่ migration 005) — พร้อมให้มาร์ครีวิวตามลิงก์ PR ด้านบน
