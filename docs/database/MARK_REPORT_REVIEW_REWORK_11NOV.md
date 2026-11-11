# รายงานส่งมาร์ค — แก้ตามผลรีวิว PR #4–#15 (11 พ.ย. รอบ 2)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-11  
**ฐานตรวจ:** `origin/main` @ `372e7d4` (รวม shop DO `141ffad`, ranking `22657a2`, API-FIX-02/03/04)  
**วิธีตรวจ:** เทียบโจทย์รีวิวทีละข้อกับเนื้อหาบน remote branch ของแต่ละ PR + รันเทสจริงบน `#11`

---

## 1. คำตัดสินรวม (Self-QC รอบนี้)

| มุม | ผล |
|-----|-----|
| ทำตามโจทย์รีวิวรอบ 2 หรือยัง | **ครบในขอบเขตที่สั่ง** |
| พร้อมให้มาร์ค merge ตามลำดับที่ล็อก | **พร้อมรีวิวอีกครั้ง** — docs #4→#6→#7→#9→#8→#10→#5 แล้วโค้ด #11 แล้ว follow-up #16 |
| migration 005 | **ยังไม่เริ่ม** (ถูกต้องตามข้อ 5 ของมาร์ค) |
| รายงาน Self-QC เดิม (#15) | **ปิดแล้ว** — ใช้รายงานฉบับนี้แทน |

---

## 2. สิ่งที่มาร์คบอกว่า merge ได้แล้ว (ยืนยันบน main)

| รายการ | หลักฐานบน `main` |
|--------|------------------|
| #12 chat hardening | ancestor `fa45112` ✓ |
| #13 URI → 400 | ancestor `782e73f` ✓ |
| #14 staff orders pagination (JS) | ancestor `d12c6c5` ✓ |
| shop DO | ancestor `141ffad` ✓ |
| ranking period/limit | ancestor `22657a2` ✓ |

**Follow-up #14 → SQL pagination:** ทำแล้วเป็น **[PR #16](https://github.com/Markrock342/astra-digital/pull/16)** (`eccbde7`) — `staffOrders` ใช้ `WHERE` cursor + `LIMIT ?` ใน SQL ไม่ดึงทั้งก้อนมาตัดใน JS

---

## 3. ตารางตรวจทีละข้อโจทย์

### 3.1 PR #11 — ต้องแก้ (โค้ด)

| ข้อมาร์ค | สถานะ | หลักฐาน |
|----------|--------|---------|
| `openChatThread` ใส่ rate limit เหมือน `postChatMessage` | **ผ่าน** | เรียก `assertChatRateLimit(user.id)` ก่อน tx |
| แจ้ง staff แบบ throttle ไม่ทุกครั้ง | **ผ่าน** | `notifyStaffChatThrottled(thread.id, …)` แทนลูป staff ทุกคนทุกครั้ง |
| เปิด/ปิดวนข้าม throttle → ต้องมี rate limit กัน | **ผ่าน** | เทสต์ flood open+close → **429**; throttle กัน re-open ห้องเดิมใน 60s |
| ตัด hunk ranking (มีใน `22657a2`) | **ผ่าน** | diff กับ main **ไม่มี** แก้ `buyerRanking` |
| เทสต์ `buyerRanking(merchant, { limit: 1.5 })` | **ผ่าน** | ใน `API-FIX-01` test |
| คง inactive sandbox บล็อก pay | **ผ่าน** | `provider==='sandbox' && !active` → 403 |

- PR: [#11](https://github.com/Markrock342/astra-digital/pull/11) · commit `940c9d1`  
- หลักฐานเทส: `npm test` บน branch นี้ → **54 passed** (รวม UC5b)

### 3.2 PR #6 — credential

| ข้อมาร์ค | สถานะ | หลักฐาน |
|----------|--------|---------|
| fingerprint = HMAC-SHA256 + server key | **ผ่าน** | `HMAC-SHA256(serverKey, canonical)` — ห้าม SHA-256 เปล่า |
| ห้าม trim password | **ผ่าน** | ระบุชัดใน §4.0.2 |
| ใช้ JSON แทน `\n` | **ผ่าน** | `JSON({v,login,password})` |
| secret NOT NULL → rebuild ไม่ ALTER | **ผ่าน** | `executeSqliteMigration` + FK deferral |
| รวม `reservation_id` ของ #7 ใน rebuild เดียว | **ผ่าน** | §4.0.1 + XOR CHECK |
| Legacy: login=โค้ดเดิม, password="", ธงของเก่า | **ผ่าน** | `legacy_single_secret=1` · M3 |
| นับแถวก่อน 005 | **ผ่าน** | M0 `COUNT` — ถ้า 0 ข้าม backfill |

- PR: [#6](https://github.com/Markrock342/astra-digital/pull/6) · `6d707d4`

### 3.3 PR #7 — preorder

| ข้อมาร์ค | สถานะ | หลักฐาน |
|----------|--------|---------|
| DELIVERED ใน CHECK + XOR → rebuild ทั้งคู่ + เทสต์ฐานมีข้อมูล | **ผ่าน** | §4.5.1–4.5.2 · แผนเทสต์ P6 |
| deliver ซ้ำคืนแค่ metadata (ไม่ขัด K3) | **ผ่าน** | ข้อ 2 ใน tx · P1/P2 |
| เขียน path เจ้าของอ่านรหัส | **ผ่าน** | §4.5.5 — orderDetail + `inventory.reservation_id` |
| ลบคำ `政策` | **ผ่าน** | `git show` ไม่พบ |
| ADMIN เท่านั้น | **ผ่าน** | §4.5.4 (SOW) |

- PR: [#7](https://github.com/Markrock342/astra-digital/pull/7) · `b302ffc`

### 3.4 PR #8 — ranking docs ↔ `22657a2`

| ข้อมาร์ค | สถานะ | หลักฐาน |
|----------|--------|---------|
| name + email เต็ม ไม่ mask | **ผ่าน** | SCHEMA §4.6.1 · DATA_INTEGRITY แถวอันดับ · R5 |
| limit/period ผิด → 400 · default limit=10 | **ผ่าน** | §4.6.1 · R3b |
| นับ `reservations IN ('PREORDER','DELIVERED')` | **ผ่าน** | §4.6.2–4.6.3 |
| หมายเหตุกรอง `created_at` ไม่ใช่เวลาจ่าย | **ผ่าน** | §4.6.2 หมายเหตุสำคัญ |

- PR: [#8](https://github.com/Markrock342/astra-digital/pull/8) · `627c641`

### 3.5 PR #9 — migration plan

| ข้อมาร์ค | สถานะ | หลักฐาน |
|----------|--------|---------|
| เลือก S1 แล้ว (`141ffad`) | **ผ่าน** | §2.2 |
| ตัด S2 | **ผ่าน** | ตัดทิ้งรอบนี้ |
| แผน rebuild #6/#7 อ้าง symbol ไม่ใส่เลขบรรทัด | **ผ่าน** | `executeSqliteMigration`, import bindings `initial`/`commerceOps` ฯลฯ |
| 005 ไฟล์เดียวหลัง merge #6#7#9 | **ผ่าน** | §3 — ยังไม่เขียน SQL |

- PR: [#9](https://github.com/Markrock342/astra-digital/pull/9) · `1da511d`

### 3.6 PR #10 — queue

| ข้อมาร์ค | สถานะ | หลักฐาน |
|----------|--------|---------|
| reservations ไม่มี `product_id` | **ผ่าน** | อ้าง `variant_id` · ห้าม UNIQUE(product_id,…) |
| `on_create` มีกฎหมดอายุ | **ผ่าน** | เสนอ 30 นาที → เคลียร์ `queue_number` |
| `queueBoard` กรอง unpaid | **ผ่าน** | โชว์แค่ PREORDER/DELIVERED |
| ตัด Approved/Owner lock → เสนอ รอมาร์คล็อก | **ผ่าน** | SCHEMA §4.7 · DATA_INTEGRITY |

- PR: [#10](https://github.com/Markrock342/astra-digital/pull/10) · `18f2974`

### 3.7 PR #4 / #5 / #15 — wording + ปิดรายงานเก่า

| ข้อมาร์ค | สถานะ | หลักฐาน |
|----------|--------|---------|
| #4 ตัด Approved/Owner lock ของงานรอบนี้ | **ผ่าน** | CURRENT: Roadmap **เสนอ รอมาร์คล็อก** · หัวข้อ「ค่าที่เสนอ รอมาร์คล็อก」 |
| #5 ตัด Approved | **ผ่าน** | title + `NOTT-POST-REVIEW-11NOV.md` = เสนอ รอมาร์คล็อก |
| #15 ปิดได้ | **ผ่าน** | state **CLOSED** (2026-11-11) |
| #15 เอา `.gitignore *.webm` ออก | **ผ่านโดยการปิด PR** — ไม่ได้ merge เข้า main; `main` ไม่มีกฎ `*.webm` จาก #15 |

หมายเหตุ: คำว่า Approved ที่เหลือในรีโปเป็นของเอกสารเก่าที่ Owner อนุมัติจริงก่อนหน้า (Sprint1 / auth-rbac ฯลฯ) — **ไม่ได้** อ้างว่ามาร์คอนุมัติ Post-Review รอบนี้

- #4 `0117357` · #5 `a36d626` · #15 CLOSED

### 3.8 คำตอบ 5 ข้อของมาร์ค — สะท้อนในเอกสารแล้ว

| # | คำตอบมาร์ค | สะท้อนที่ |
|---|------------|----------|
| 1 | ลำดับ merge `#4→#6→#7→#9→#8→#10→#5→#11` (#15 ปิด) | Roadmap #5 · รายงานนี้ |
| 2 | legacy login=โค้ดเดิม, password="", ธง; นับก่อน 005 | #6 M0/M3 |
| 3 | S1 เพราะ `141ffad` | #9 §2.2 |
| 4 | deliver ADMIN เท่านั้น | #7 §4.5.4 |
| 5 | ยังไม่เริ่ม 005 จน #6#7#9 merge · ไฟล์เดียว | #9 §3 · **ยังไม่มี `005_*.sql` บน main** |

---

## 4. รายการ PR ที่รอมาร์ครีวิว/merge

ลำดับที่มาร์คล็อก:

1. [#4](https://github.com/Markrock342/astra-digital/pull/4) DB-DOC-06  
2. [#6](https://github.com/Markrock342/astra-digital/pull/6) DB-DOC-01  
3. [#7](https://github.com/Markrock342/astra-digital/pull/7) DB-DOC-02  
4. [#9](https://github.com/Markrock342/astra-digital/pull/9) DB-DOC-04  
5. [#8](https://github.com/Markrock342/astra-digital/pull/8) DB-DOC-03  
6. [#10](https://github.com/Markrock342/astra-digital/pull/10) DB-DOC-05  
7. [#5](https://github.com/Markrock342/astra-digital/pull/5) Roadmap  
8. [#11](https://github.com/Markrock342/astra-digital/pull/11) API-FIX-01  

จากนั้น (follow-up #14):

9. [#16](https://github.com/Markrock342/astra-digital/pull/16) API-FIX-05 SQL pagination  

**หลัง merge #6+#7+#9 เท่านั้น** — น็อตจะเปิด Task เขียน `005_*.sql` ไฟล์เดียวตามสเปกใน #9

---

## 5. ความเสี่ยงตอน merge (สั้น)

- เอกสาร #6/#7/#8/#10 แตะ `SCHEMA_PROPOSAL` / `DATA_INTEGRITY` / `DB_TEST_PLAN` คนละส่วน — **merge ตามลำดับด้านบน** จะลด conflict  
- #11 อิง helpers จาก #12 ที่มีบน main แล้ว — rebase แล้ว  
- ยัง**ห้าม**เริ่ม 005 ก่อนมาร์ค merge เอกสารแกน

---

## 6. สรุปหนึ่งบรรทัด

งานตามผลรีวิว 11 พ.ย. **แก้ครบทุกข้อที่สั่ง** (docs + #11 + SQL pagination #16; #15 ปิด; ยังไม่ 005) — พร้อมให้มาร์ครีวิวตามลำดับ merge ที่ล็อกไว้
