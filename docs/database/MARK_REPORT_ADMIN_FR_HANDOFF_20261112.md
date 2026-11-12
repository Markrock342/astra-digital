# รายงานส่งมาร์ค — ตรวจทานโจทย์หลัง #27/#28 + งาน 4 + polish

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12  
**ฐานตรวจ:** `origin/main` @ `56f4603` + PR เปิดอยู่  
**Deploy:** **ยังไม่ทำ** · ห้าม `qa:cloud` ร้านจริง

---

## 1) สรุปคำตัดสินเทียบโจทย์

| ข้อจากโจทย์มาร์ค | สถานะ | ที่อยู่ / หลักฐาน |
|------------------|--------|-------------------|
| #27 + #28 รีวิวผ่าน รอมาร์ค merge กับ `feat/admin-screens-mark` | **เสร็จแล้วบน main** | #27 / #28 / #29 **merged** → `56f4603` |
| บั๊ก #28 ข้อ 1: `/api/ledger` กรองเฉพาะ kind เครดิต (ไม่โชว์ PAYMENT_IN) | **มาร์คแก้บน main แล้ว** · น็อตไม่ทำซ้ำ | `domain.mjs` ledger filter + `admin-customers.mjs` `CREDIT_KINDS` · เทสต์ `wallet and customer credit exclude shop-side PAYMENT_IN rows` |
| บั๊ก #28 ข้อ 2: `adminTransactions` summary พังตอน from/to+cursor | **มาร์คแก้บน main แล้ว** · น็อตไม่ทำซ้ำ | สร้าง `sumSql`/`sumParams` **ก่อน**ใส่ cursor · เทสต์ `transactions summary works with a date range and a cursor` |
| ฝากแก้ทีหลัง: `summary.daily` เป็นวันไทย ไม่ใช่ UTC substr | **น็อตทำแล้ว** · PR แยก | **PR #32** · `BANGKOK_DAY_SQL = datetime(created_at,'+7 hours')` · เทสต์ `ADMIN-FR-W3 polish…` |
| ฝากแก้ทีหลัง: CSV ต้องครบทุกหน้าตามตัวกรอง | **น็อตทำแล้ว** · PR แยก | **PR #32** · export ทั้งชุดตาม filter สูงสุด 10 000 แถว · เทสต์เดียวกัน |
| FR-P3 กับบั๊ก #26 ทำซ้ำ — มาร์คใช้ฉบับน็อต | **รับทราบ / ไม่ทำซ้ำ** | P3 อยู่บน main จาก #27 · บั๊ก W2 ใช้โค้ดน็อตใน #28/#29 |
| เริ่มงาน 4 ได้ แต่ pull main หลังมาร์ค merge ก่อน | **ทำแล้ว** | pull `main` @ `56f4603` ก่อนลงมือ · **PR #31** งาน 4 |

**คำตัดสินรวม:** โจทย์รอบนี้**ครบ** — ของที่มาร์คแก้แล้วน็อตไม่แตะซ้ำ · ของไม่ด่วนทำใน #32 · งาน 4 ส่งใน #31 · **ห้าม deploy**

---

## 2) ไทม์ไลน์ / ขั้นตอนที่น็อตทำจริง

### ขั้น A — รับโจทย์ + ดึงฐาน

1. `git fetch` / fast-forward `main` → `56f4603` (Merge PR #29 admin screens; รวม #27+#28 แล้ว)
2. ยืนยันว่าเงื่อนไข “pull main หลังมาร์ค merge” ผ่านก่อนงาน 4

### ขั้น B — Baseline QC (Phase 0)

1. รัน `npm test` บน `56f4603` → **75/75** รวมเทสต์มาร์คสองตัวของบั๊ก #28
2. พบ e2e ล้มเพราะ `dist/` เก่า (เมนูเดโมโผล่ทั้งที่ซอร์สตัดแล้ว) → `npm run build` แล้วรันใหม่ → **19/19**
3. อัปเดต `docs/status/CURRENT.md` ให้ตรงความจริง (#27/#28/#29 merge แล้ว)

### ขั้น C — งาน 4 FR-P2 / FR-P7 (PR #31)

Branch: `feat/admin-fr-work4-variant-stock`

1. **MIG-007** `007_variant_stock.sql` + `migrate-007.mjs`  
   - `variants.active`, `variants.sort_order`  
   - `inventory.defective` (+ `defective_at` / `by` / `reason`)  
   - idempotent · ผูก `commerce.mjs` + `cloud/worker.mjs` + `TRACK_A_MIGRATION_FILES`
2. **FR-P2 APIs** ใน `server/admin-variant-stock-apis.mjs`  
   - `GET /api/admin/products/:id/variants` (STAFF+)  
   - `POST /api/admin/products/:id/variants` (ADMIN)  
   - `PATCH /api/admin/variants/:id` (ADMIN)  
   - `DELETE /api/admin/variants/:id` (ADMIN; มีประวัติ → 409 ให้ปิดแทน)  
   - หน้าร้าน/checkout เห็นเฉพาะ `active=1`
3. **FR-P7 APIs**  
   - `GET /api/admin/variants/:id/inventory` (mask รหัส)  
   - `POST /api/admin/inventory/:id/defect`  
   - `DELETE /api/admin/inventory/:id` (available เท่านั้น)  
   - `POST /api/admin/inventory` รับ `csv`  
   - `saveSettings.lowStockAt` (1–100, default 3)
4. Features: `adminVariantCrud`, `adminStockApi`  
5. สัญญา: `docs/architecture/api-contract-shop.md`  
6. เทสต์: `ADMIN-FR-W4: variant CRUD…` · `ADMIN-FR-W4: inventory list…`  
7. Prove: **`npm test` 77/77** · **`test:e2e` 19/19**  
8. รายงานสั้น: `MARK_REPORT_ADMIN_FR_WORK4.md` · เปิด **PR #31** · ห้าม deploy

### ขั้น D — ของไม่ด่วนจากโจทย์ (PR #32)

Branch: `feat/admin-fr-w3-finance-polish` (จาก `main` คนละ PR งาน 4)

1. `summary.daily` → วัน Bangkok ผ่าน `datetime(created_at, '+7 hours')`
2. `format=csv` → ดึงทั้งชุดตามตัวกรอง (ไม่ตัดหน้า 100) · เพดาน 10 000  
3. เทสต์: `ADMIN-FR-W3 polish: daily buckets use Bangkok day and CSV exports all pages`  
4. Prove: **`npm test` 76/76** บน branch นี้  
5. รายงาน: `MARK_REPORT_ADMIN_FR_W3_POLISH.md` · เปิด **PR #32** · ห้าม deploy

---

## 3) แผนที่ PR ที่เกี่ยวข้อง

| PR | หัวข้อ | สถานะ | หมายเหตุ |
|----|--------|--------|----------|
| [#27](https://github.com/Markrock342/astra-digital/pull/27) | FR-P3 saveProduct preorder | **merged** | ฉบับน็อต |
| [#28](https://github.com/Markrock342/astra-digital/pull/28) | งาน 3 ledger 006 + transactions + bugfixes B.0 | **merged** | ฉบับน็อต |
| [#29](https://github.com/Markrock342/astra-digital/pull/29) | Admin screens Mark + แก้บั๊ก #28 สองข้อ | **merged** | รวมเข้า main เป็น `56f4603` |
| [#31](https://github.com/Markrock342/astra-digital/pull/31) | งาน 4 variant + stock (P2/P7) | **OPEN** | น็อต · ห้าม deploy |
| [#32](https://github.com/Markrock342/astra-digital/pull/32) | W3 polish daily Bangkok + CSV เต็ม | **OPEN** | น็อต · ไม่ด่วน · ห้าม deploy |

---

## 4) หลักฐานเทสต์ (QC)

### บน main หลัง merge (บั๊ก #28 ของมาร์ค)

- `wallet and customer credit exclude shop-side PAYMENT_IN rows` — **มีและเขียว**
- `transactions summary works with a date range and a cursor` — **มีและเขียว**

### PR #31 งาน 4

```
npm test          → 77/77
npm run test:e2e  → 19/19
```

### PR #32 polish

```
npm test → 76/76 (รวม ADMIN-FR-W3 polish)
```

### สิ่งที่จงใจไม่ทำซ้ำ

- ไม่แตะ logic กรอง wallet / summary+cursor ที่มาร์คใส่ใน #29 อีก  
- ไม่ทำ FR-P3 ซ้ำ (อยู่บน main แล้ว)  
- ไม่ deploy · ไม่ `qa:cloud` ร้านจริง

---

## 5) นอกขอบเขตรอบนี้ (ยืนยัน)

- งาน 5 (คืนเงิน/ถอน/แบน/R2 UI ฯลฯ ตาม roadmap)  
- FR-P4/P5/P6/P8/P9 · FR-O5 เปลี่ยนบัญชีเสีย  
- ตัด blob `GET /api/admin`  
- UI หน้าสต็อกเต็ม (แบงค์/มาร์คต่อจาก feature flag)

---

## 6) ขอมาร์ค

1. รีวิว/merge **PR #31** (งาน 4)  
2. รีวิว/merge **PR #32** (polish ไม่ด่วน) ได้คู่กันหรือหลัง #31 ก็ได้  
3. **ห้าม deploy** จากสอง PR นี้จนกว่ามาร์คสั่ง  
4. แจ้งเมื่อพร้อมให้เริ่ม **งาน 5** (docs/schema ตาม roadmap)

รายงานสั้นรายงาน:  
- งาน 4 → [MARK_REPORT_ADMIN_FR_WORK4.md](MARK_REPORT_ADMIN_FR_WORK4.md) (บน branch PR #31)  
- polish → [MARK_REPORT_ADMIN_FR_W3_POLISH.md](MARK_REPORT_ADMIN_FR_W3_POLISH.md)  
