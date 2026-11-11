# รายงานส่งมาร์ค — MIG-005 (credential + preorder schema)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-11  
**PR:** https://github.com/Markrock342/astra-digital/pull/19 (**OPEN** · รอรีวิว)  
**Commits:** `5030815` (โค้ด) · `8cf3c42` (docs)  
**ฐาน:** `main` @ `4b520a3`  
**Deploy:** **ยังไม่ทำ** (ตามคำสั่ง)

---

## 1. คำตัดสิน Self-QC

| มุม | ผล |
|-----|-----|
| ทำครบตามโจทย์ migration 005 หรือไม่ | **ผ่าน** |
| เกณฑ์เทสต์อัตโนมัติ | **ผ่าน** — `npm test` **57 passed / 0 failed** (รันซ้ำตอนทำรายงานนี้) |
| ห้าม deploy เอง | **ผ่าน** — 005 ยังไม่อยู่บน `main`; PR เปิดรอรีวิวเท่านั้น |
| Flip features / deliver API | **ยังไม่ทำ** (อยู่นอกขอบเขตโจทย์รอบนี้ · flags ยัง `false`) |

---

## 2. ตรวจทีละข้อโจทย์

### 2.1 บริบทที่มาร์คแจ้ง (ยืนยัน)

| ข้อ | สถานะ |
|-----|--------|
| Merge ครบ #4 #6 #7 #9 #8 #10 #5 #11 #16 บน main | ใช้เป็นฐาน `4b520a3` |
| คิว = `after_payment` + รวมทั้งร้าน (ไม่ทำ `on_create`) | **ไม่แตะ** logic คิวใน PR นี้ |
| ส่งของ = `POST /api/admin/reservations/:id/deliver` (ADMIN) | **ล็อก path แล้ว** · ยังไม่ implement route (รอหลัง merge 005 ตามแผน) |
| Legacy = login=โค้ดเดิม, password="", ธง · นับแถวก่อน ถ้า 0 ข้าม | **ทำใน** `applyMigration005` |

### 2.2 รายการบังคับของ migration 005

| ข้อโจทย์ | สถานะ | หลักฐาน |
|----------|--------|---------|
| ไฟล์เดียวตาม MIGRATION_PLAN §3 | **ผ่าน** | `server/migrations/005_credential_preorder_indexes.sql` |
| rebuild inventory + reservations ด้วย `executeSqliteMigration` + FK deferral | **ผ่าน** | SQL เรียกผ่าน `executeSqliteMigration` ใน `server/migrate-005.mjs` (helper ตั้ง `PRAGMA defer_foreign_keys`) |
| rebuild inventory: dual credential + `reservation_id` XOR + เลิก `secret` | **ผ่าน** | `inventory_new` มี `login_id_enc`/`password_enc`/`legacy_single_secret`/`reservation_id` + CHECK XOR · JS สลับ DROP/RENAME |
| rebuild reservations: `DELIVERED` + `delivered_at`/`delivered_by` | **ผ่าน** | `reservations_new` status CHECK รวม `DELIVERED` |
| index `orders(status, created_at)` | **ผ่าน** | `orders_status_created` |
| index `reservations(status, created_at)` | **ผ่าน** | `reservations_status_created` |
| import ใน `cloud/worker.mjs` | **ผ่าน** | import `credentialPreorder` + คู่ในอาร์เรย์ + `applyMigration005(db, key, content)` |
| เทสต์ list worker ตรงโฟลเดอร์ | **ผ่าน** | `tests/worker-migrations.test.mjs` (MU3) เทียบ `TRACK_A_MIGRATION_FILES` ↔ `server/migrations/*.sql` |
| เทสต์อัปเกรดบนฐานที่มีข้อมูล | **ผ่าน** | MU1/MU5 + MU2 ใน `tests/migration-upgrade.test.mjs` · รวมเคส workerd เดิมยังผ่าน |
| เปิด PR ให้มาร์ครีวิวก่อน · ห้าม deploy | **ผ่าน** | PR #19 OPEN · ไม่มี 005 บน `origin/main` |

### 2.3 Legacy backfill (คำตอบมาร์คข้อ 2)

| ขั้น | พฤติกรรมในโค้ด |
|------|----------------|
| นับแถว | `SELECT COUNT(*) FROM inventory` ก่อน map |
| COUNT > 0 | decrypt `secret` → `login_id=plaintext`, `password=""`, `legacy_single_secret=1` → HMAC fingerprint → encrypt คู่ |
| COUNT = 0 | สร้างตารางว่างแล้วสลับ ไม่ต้อง map เนื้อหา |
| Idempotent | มี marker ใน `schema_migrations` แล้ว → skip |

หมายเหตุเทคนิค: การ map ciphertext → คู่ credential **ทำใน JS** (`migrate-005.mjs`) เพราะ SQL อย่างเดียวถอด AES-GCM / คำนวณ HMAC ไม่ได้ — DDL ยังคงผ่าน `executeSqliteMigration` ตามโจทย์

---

## 3. ไฟล์ที่เปลี่ยน (สรุป)

| ไฟล์ | บทบาท |
|------|--------|
| `server/migrations/005_credential_preorder_indexes.sql` | DDL rebuild + indexes |
| `server/migrate-005.mjs` | orchestrator + crypto backfill + `TRACK_A_MIGRATION_FILES` |
| `server/commerce.mjs` | apply 005 ด้วย key เดียวกับ runtime |
| `cloud/worker.mjs` | import 005 + เรียก `applyMigration005` (derive key ก่อน migrate) |
| `server/domain.mjs` | adapter อ่าน/เขียนคอลัมน์ใหม่ · allocate ใช้ `order_id IS NULL AND reservation_id IS NULL` · `features` ยัง `false` |
| `tests/migration-upgrade.test.mjs` | MU1/MU5, MU2 + ปรับ assert inventory หลัง remap |
| `tests/worker-migrations.test.mjs` | MU3 |
| `tests/local-migrate.test.mjs` / `commerce.test.mjs` | ให้ตรง schema ใหม่ |
| `docs/prompts/MIG-005-credential-preorder.md` | Task Spec |
| `docs/status/CURRENT.md` | สถานะรอรีวิว |

---

## 4. หลักฐานเทสต์ (รันจริงตอนรายงาน)

```text
npm test
ℹ tests 57
ℹ pass 57
ℹ fail 0
```

ครอบคลุมอย่างน้อย:
- MU1/MU5 ฐานมีข้อมูล → ไม่มี `secret` · มี dual columns · legacy flag · DELIVERED/XOR/indexes
- MU2 idempotent reopen
- MU3 worker list = โฟลเดอร์
- workerd upgrade regression (ของเดิม)
- commerce / nott-ops / use-cases หลัง schema ใหม่

Playwright e2e บนเครื่องน็อตเคยติด browser/login fixture บางเคส — **เกณฑ์หลักของโจทย์รอบนี้คือ unit/upgrade tests** ซึ่งผ่านครบ; แนะนำมาร์ครัน `npm run test:e2e` บนเครื่อง/CI ของมาร์คหลังรีวิว

---

## 5. สิ่งที่ตั้งใจยังไม่ทำ (ถูกขอบเขต)

1. Deploy / อัปโหลด Worker-Pages production  
2. `features.credentialPair` / `preorderDelivery` ยัง `false`  
3. ยังไม่มี `POST /api/admin/reservations/:id/deliver` (path ล็อกแล้ว · implement หลัง merge 005)  
4. ยังไม่บังคับ body `items[{loginId,password}]` เต็มรูปแบบ — `importCodes` รับ `codes[]` เดิมแล้วเก็บเป็น legacy pair  

---

## 6. ขอมาร์ค

1. รีวิว/merge PR #19 เมื่อเห็นว่า schema + เทสต์พอ  
2. หลัง merge — น็อตจะเปิด Task ถัดไป: deliver API + ขยาย import คู่ + flip flags ตาม `api-contract-shop.md`  
3. **อย่าให้ deploy อัตโนมัติทับร้าน** จนกว่ามาร์ค/Owner สั่ง (ตามกติกาเดิม)

---

## 7. สรุปหนึ่งบรรทัด

Migration 005 **ทำครบตามโจทย์** (ไฟล์เดียว · rebuild · indexes · worker import · เทสต์อัปเกรด/list · PR เปิด · ไม่ deploy) และ **`npm test` 57/57 ผ่าน** — พร้อมให้มาร์ครีวิวที่ PR #19
