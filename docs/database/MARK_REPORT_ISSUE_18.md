# รายงานส่งมาร์ค — ISSUE-18 (DB-005 APIs)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-11  
**PR:** https://github.com/Markrock342/astra-digital/pull/20 (**OPEN** · รอรีวิว)  
**Commits:** `077e6e7` (โค้ด) · `0539f09` (docs) · (+ docs รายงานนี้ถ้ามี commit ตามหลัง)  
**ฐาน:** `origin/main` @ `b1dc115` (รวม `035349d` + rebrand)  
**Deploy:** **ยังไม่ทำ** — ตามคำสั่ง ขึ้นพร้อมกันทีเดียวหลังรีวิว

---

## 1. คำตัดสิน Self-QC

| มุม | ผล |
|-----|-----|
| ทำครบตามโจทย์งานถัดไป (issue #18 APIs) หรือไม่ | **ผ่าน** |
| pull main ก่อนทำ (มี `035349d`) | **ผ่าน** — branch จาก `b1dc115` มี ancestor `035349d` |
| ไม่ regress แยก codes / credentials | **ผ่าน** — ใช้ logic เดิมของมาร์ค ขยายแค่ bind `reservation_id` |
| ประวัติ deploy ใน CURRENT.md | **ผ่าน** — เพิ่มบล็อก ISSUE-18 ด้านบน · คง Deploy 11 พ.ย. ไว้ |
| เกณฑ์เทสต์อัตโนมัติ (รันซ้ำตอนทำรายงาน) | **ผ่าน** — `npm test` **59/59** · MU3 **1/1** · Playwright admin-preorder **4/4** |
| ห้าม deploy เอง | **ผ่าน** — PR เปิดอย่างเดียว ไม่ขึ้น Worker/Pages |

---

## 2. ตรวจทีละข้อจากข้อความมาร์ค

### 2.1 บริบทก่อนเริ่ม

| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| PR #19 (migration 005) merge แล้ว · ยังไม่ deploy | **ยืนยัน** | main มี `f0d0053` / schema 005 · CURRENT บอกยังไม่ deploy |
| มาร์คแก้ `035349d` — orderDetail แยก codes vs credentials | **ยืนยันบนฐาน** | `readDeliveredItems`: legacy → `codes` เท่านั้น · pair → `credentials` เท่านั้น |
| กู้ประวัติ deploy ใน CURRENT · ครั้งหน้าเพิ่มด้านบน | **ทำตาม** | บล็อก ISSUE-18 อยู่บนสุด · ส่วน Deploy 11 พ.ย. ยังอยู่ |

### 2.2 งาน ISSUE-18 (PR เดียว)

| ข้อโจทย์ | สถานะ | ที่ทำ / หลักฐาน |
|----------|--------|-----------------|
| นำเข้า `items: [{loginId,password}]` | **ผ่าน** | `importCodes` ใน `server/domain.mjs` · trim `loginId` · **ไม่ trim** `password` · 1–100 · fingerprint ซ้ำ → 409 ทั้งชุด · `legacy_single_secret=0` · ห้ามส่ง `codes`+`items` พร้อมกัน → 400 · path `codes` เดิมยังใช้ได้ |
| `POST /api/admin/reservations/:id/deliver` | **ผ่าน** | route ใน `server/api-handler.mjs` · `deliverReservation` ADMIN only · PREORDER → จองสต็อก + `reservation_id` + `DELIVERED` · idempotent คืน metadata · สต็อกไม่พอ / สถานะผิด → 409 · **ไม่มีรหัสใน response** |
| ลูกค้าเห็นไอดี/รหัสผ่านหลังส่งของพรีออเดอร์ | **ผ่าน** | `orderDetail` สาขา reservation เมื่อ owner + `DELIVERED` → `readDeliveredItems("reservation_id", …)` · staff ได้ `codes: []`, `credentials: []` · คนอื่น 404 |
| คิวไม่แสดงรายการที่ส่งแล้ว | **ผ่าน** | `queueBoard`: `queue_number IS NOT NULL AND status='PREORDER'` |
| เปิด `features` ทั้งสองเป็น `true` | **ผ่าน** | `features: { credentialPair: true, preorderDelivery: true }` · UC7 อัปเดตตาม |
| index `inventory_available` | **ผ่าน** | `ensureInventoryAvailableIndex`: `(variant_id, order_id, reservation_id)` เรียกหลัง migrate ใน `commerce.mjs` + `worker.mjs` และตอน apply 005 |
| แก้ MU3 | **ผ่าน** | `tests/worker-migrations.test.mjs` assert `worker.includes(name)` **ทีละไฟล์** ไม่ใช้ `\|\| MIGRATION_005_NAME` |
| เทสต์ตามรายการใน issue / K·P | **ผ่าน** (ดู §3) | `tests/nott-ops.test.mjs` + e2e `admin-preorder.spec.mjs` |
| **ห้าม deploy** | **ผ่าน** | ไม่รัน wrangler/pages deploy |

---

## 3. แมปเคส K / P (DB_TEST_PLAN)

| ID | ความหมาย | ใน PR #20 | หลักฐานเทสต์ |
|----|----------|-----------|--------------|
| K1 | product API ไม่มี secret/login/password/`*_enc` | **ผ่าน** | ISSUE-18 unit + เทสเดิม `product detail API omits…` |
| K2 | staff orderDetail ไม่มี codes/credentials | **ผ่าน** | staff view หลัง deliver → arrays ว่าง · เทส staff list เดิม |
| K3 | deliver ซ้ำ = metadata ไม่มีรหัส | **ผ่าน** | เรียก deliver ซ้ำ · ไม่มี login/password/codes/credentials ใน response |
| K4 | owner อ่านหลัง DELIVERED ได้ credentials · คนอื่น 404 | **ผ่าน** | owner ได้คู่ · stranger 404 |
| P1 | deliver PREORDER สำเร็จ · bind `reservation_id` | **ผ่าน** | unit + e2e deliver จริง |
| P2 | deliver ซ้ำไม่ allocate เพิ่ม | **ผ่าน** | นับ inventory `reservation_id` ยัง = 1 |
| P3 | CUSTOMER/STAFF deliver → 403 | **ผ่าน** | unit assert 403 ทั้งคู่ |
| P4 | สต็อกไม่พอ → 409 · สถานะยัง PREORDER | **ผ่าน** | เทสแยก `deliver refuses when stock is short` |
| P5 | owner credentials พรีออเดอร์ | **ผ่าน** | รวมใน K4 + e2e ลูกค้าเปิดรหัส |
| P6 | rebuild ฐานมีข้อมูล (XOR / DELIVERED) | **อยู่นอก PR นี้ · ผ่านแล้วใน #19** | `tests/migration-upgrade.test.mjs` (MU1/MU2/MU5) บน main หลัง merge 005 |

**Import / Queue / Features / Index / MU3** (นอกตาราง K/P แต่ในโจทย์ Mark)

| หัวข้อ | ผล |
|--------|-----|
| import `items` + password มีช่องว่างไม่ถูก trim | **ผ่าน** |
| import ซ้ำ 409 | **ผ่าน** |
| หลัง deliver หายจาก `queueBoard` | **ผ่าน** (unit + e2e) |
| `features` ทั้งคู่ `true` | **ผ่าน** (health/UC7 + e2e) |
| `PRAGMA index_info(inventory_available)` มี `reservation_id` | **ผ่าน** |
| MU3 ชื่อไฟล์ครบใน worker | **ผ่าน** |

---

## 4. หลักฐานรันจริง (รอบรายงานนี้)

```
npm test                         → 59 passed / 0 failed
node --test tests/worker-migrations.test.mjs → MU3 passed
npx playwright test tests/admin-preorder.spec.mjs → 4 passed
```

e2e ครอบ: คิว+ปุ่มส่งของเปิด · deliver จริงแล้วคิวว่าง · นำเข้าคู่จาก UI · ลูกค้าเห็น credentials หลังส่งของ

---

## 5. ไฟล์หลักที่เปลี่ยน (PR #20)

| ไฟล์ | บทบาท |
|------|--------|
| `server/domain.mjs` | import items · deliver · orderDetail reservation · queue · features |
| `server/api-handler.mjs` | route deliver |
| `server/migrate-005.mjs` | `ensureInventoryAvailableIndex` |
| `server/commerce.mjs` / `cloud/worker.mjs` | เรียก ensure หลัง migrate |
| `server/http.mjs` | path root แบบ Windows-safe (e2e production static) |
| `tests/nott-ops.test.mjs` | K/P + import/queue/index |
| `tests/worker-migrations.test.mjs` | MU3 เข้ม |
| `tests/use-cases.test.mjs` | UC7 features true |
| `tests/admin-preorder.spec.mjs` | ถอด mock ยิง API จริง |
| `docs/status/CURRENT.md` | บล็อกด้านบน · ไม่ลบประวัติ deploy |

---

## 6. หมายเหตุให้มาร์ค (ไม่บล็อก DoD)

1. **รูปแบบ `delivered` ใน response:** สัญญาตัวอย่างเขียน `"delivered": n` (ตัวเลข) — implement คืน `delivered: true` (boolean) พร้อม metadata · หน้าหลังบ้าน e2e ผ่านแล้ว ถ้าต้องการให้เป็นจำนวนหน่วยที่ allocate บอกได้ จะปรับใน PR เล็กตามหลังได้  
2. **P6** เป็นเคส migration rebuild — ปิดไปแล้วกับ PR #19 ไม่ได้ทำซ้ำใน #20  
3. **ยังไม่ deploy** — รอมาร์ครีวิว/merge แล้วขึ้น schema 005 + API + flags พร้อมกัน  
4. **ไม่รัน** `npm run qa:cloud` กับร้านจริง

---

## 7. สิ่งที่ขอนมาร์ค

- รีวิว/merge [PR #20](https://github.com/Markrock342/astra-digital/pull/20)  
- เมื่อพร้อม: **มาร์คเป็นคน deploy** (ไม่ให้น็อตขึ้นเอง)  
- หลังขึ้นร้าน: เปิดปุ่มส่งของ/นำเข้าคู่บนหลังบ้านควรติด เพราะ `features` เป็น `true` แล้ว
