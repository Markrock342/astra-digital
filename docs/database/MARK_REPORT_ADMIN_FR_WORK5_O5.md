# รายงานส่งมาร์ค — Admin FR งาน 5 · FR-O5 เปลี่ยนบัญชีเสีย (ละเอียด)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12  
**PR:** https://github.com/Markrock342/astra-digital/pull/35  
**Branch:** `feat/admin-fr-work5-o5-replace-credential`  
**ฐาน:** `main` @ `4a8c33f` (Merge #34 = #31 งาน 4 + #32 polish + `feat/admin-round2`)  
**Deploy:** **ยังไม่ทำ** · ห้าม `qa:cloud` ร้านจริง

---

## 1) คำตัดสินเทียบโจทย์มาร์ค

| ข้อจากโจทย์ | สถานะ | หลักฐาน |
|-------------|--------|---------|
| #31 + #32 รีวิวผ่าน · รวมในเครื่องมาร์ค · รอ merge กับ branch มาร์ค | **ผ่านแล้วก่อนเริ่ม** | `main` @ `4a8c33f` รวม #31/#32/#34 |
| มาร์คต่อ UI ตัวเลือก+สต็อก / แก้ `http.mjs` PATCH·DELETE body | **รับทราบ · ไม่ทับ** | PR #35 **ไม่แตะ** `src/AdminLists.tsx` / `Admin.tsx` · `http.mjs` คงส่ง body POST+PATCH+DELETE |
| กันชน: `live.mjs`, `admin-team.mjs`, `admin-reports.mjs`, `admin-customers.mjs` | **ผ่าน** | แตะ `live.mjs` แค่เพิ่ม 1 แถว `LIVE_METHODS` · ไฟล์อื่นของมาร์คไม่แก้ |
| STAFF ส่งพรีออเดอร์ได้ (`deliverReservation = requireStaff`) | **คงไว้** | `domain.mjs` ยัง `requireStaff` · เทสต์ preorder deliver ด้วย staff ยังเขียว |
| งาน 5 เริ่มหลัง merge · **FR-O5 เป็นอันดับแรก** | **ผ่าน** | PR #35 มีเฉพาะ FR-O5 · ไม่ปนงาน 5 ข้ออื่น |

**คำตัดสินรวม:** ทำครบตามโจทย์รอบนี้ · **ห้าม deploy** จนกว่ามาร์คสั่ง

---

## 2) FR-O5 — สิ่งที่ส่งมอบ

### 2.1 Endpoint

`POST /api/admin/orders/:id/replace` — **ADMIN only**

```json
{ "inventoryId": "<id แถวที่ผูกออเดอร์อยู่>", "reason": "…" }
```

ตอบ metadata เท่านั้น (ไม่มี plaintext):

```json
{
  "id": "<order|reservation id>",
  "replacedInventoryId": "…",
  "newInventoryId": "…",
  "status": "DELIVERED",
  "replaced_at": "YYYY-MM-DD HH:MM:SS"
}
```

### 2.2 พฤติกรรมใน transaction เดียว

1. โหลด `orders` หรือ `reservations` ตาม id (แบบเดียวกับ detail/reveal)  
2. ต้อง `status === DELIVERED`  
3. ยืนยัน `inventoryId` ผูก `order_id` หรือ `reservation_id` นั้น + `variant_id` ตรง + ยังไม่ defective  
4. หยิบ 1 แถว available ตัวเลือกเดียวกัน (`order_id/reservation_id` ว่าง และ `defective=0`)  
5. บัญชีเก่า: `defective=1` + `defective_at/by/reason` · **เคลียร์ bind** (`order_id`/`reservation_id`/`sold_at` = NULL)  
6. บัญชีใหม่: ผูก bind เดิม + `sold_at`  
7. `notify` ลูกค้าในเว็บ (kind `order`) · `audit REPLACE_ORDER_CREDENTIAL` · `maybeNotifyStockLow`  
8. Live bump: `orders` + `catalog` + `notify`

### 2.3 ชั้นกันพลาดเพิ่ม

- `readDeliveredItems` อ่านเฉพาะ `COALESCE(defective,0)=0` — ลูกค้า/reveal ไม่เห็นบัญชีเก่าที่เสียแม้ bind ค้างโดยพลาด

### 2.4 Feature / สัญญา

- `features.adminReplaceCredential: true` ใน `/api/me` + health  
- สัญญา: `docs/architecture/api-contract-shop.md`  
- แก้ข้อความ deliver ในสัญญาให้ตรงโค้ด: **STAFF+** (ไม่ใช่ ADMIN อย่างเดียว)

### 2.5 ไฟล์หลักใน PR

| ไฟล์ | การเปลี่ยน |
|------|------------|
| `server/admin-order-replace.mjs` | **ใหม่** — logic FR-O5 |
| `server/domain.mjs` | wire API · filter delivered · feature flag |
| `server/api-handler.mjs` | route `.../replace` |
| `server/live.mjs` | ลงทะเบียน `replaceOrderCredential` |
| `src/types.ts` | `adminReplaceCredential?` |
| `tests/nott-ops.test.mjs` | เทสต์ O5 สองเคส |
| `tests/use-cases.test.mjs` | assert feature |
| docs สัญญา / CURRENT / รายงานนี้ | อัปเดต |

---

## 3) ไทม์ไลน์งานที่น็อตทำ

### ขั้น A — ฐานหลัง merge

1. `git fetch` + ff `main` → `4a8c33f`  
2. Baseline ก่อนแตะโค้ด: **`npm test` 83/83** · **`test:e2e` 30/30** (ตรงที่มาร์คแจ้ง)

### ขั้น B — Implement FR-O5

1. สร้าง branch `feat/admin-fr-work5-o5-replace-credential`  
2. เขียน `replaceOrderCredential` + route + live + contract + tests  
3. **ไม่แก้** team / reports / customers / Admin UI ตัวเลือก-สต็อก

### ขั้น C — Prove

| คำสั่ง | ผล |
|--------|-----|
| `npm test` | **85/85** ผ่าน (เพิ่ม 2 เทสต์ O5) |
| `npm run test:e2e` | **30/30** ผ่าน |

เทสต์ใหม่:

- `ADMIN-FR-W5-O5: replace delivered ready credential; staff forbidden`  
  — ready path · STAFF/CUSTOMER 403 · ลูกค้าเห็นบัญชีใหม่ · เก่า defective · มีแจ้งเตือน · ซ้ำ 409  
- `ADMIN-FR-W5-O5: replace after preorder deliver; empty stock 409`  
  — STAFF deliver ก่อน · replace สำเร็จ · reveal เห็นบัญชีใหม่ · ของหมด 409  

Commits บน PR:

- `af6f85f` feat(admin-fr): FR-O5 replace delivered credential from stock  
- `95325fa` docs(admin-fr): FR-O5 contract, CURRENT, and Mark report  
- `b405224` docs(admin-fr): link Work 5 O5 Mark report to PR #35  

---

## 4) QC gates (A–F)

| ชั้น | ผล | รายละเอียด |
|------|-----|------------|
| A Automated | **ผ่าน** | 85 unit + 30 e2e |
| B Contract | **ผ่าน** | endpoint + feature ใน api-contract |
| C Security | **ผ่าน** | ADMIN only · response ไม่มีรหัส · STAFF/CUSTOMER 403 |
| D Regression | **ผ่าน** | deliver STAFF · W4 stock · journey e2e (รวม staff deliver + live chat) เขียว |
| E Schema | **ผ่าน** | ใช้คอลัมน์ defective จาก MIG-007 ที่มีอยู่แล้ว ไม่เพิ่ม migration |
| F Manual (Mark) | **รอ** | ต่อปุ่ม UI จาก `adminReplaceCredential` + ยิง replace จากหลังบ้าน |

---

## 5) เคสขอบ / ข้อจำกัดที่รู้

| เคส | พฤติกรรม |
|-----|----------|
| ยังไม่ DELIVERED | 409 |
| `inventoryId` ไม่ผูกออเดอร์นี้ | 409 |
| สต็อก available หมด | 409 |
| ออเดอร์ qty>1 | ต้องระบุ `inventoryId` ของแถวที่เสียทีละใบ (ออกแบบแล้ว) |
| UI ปุ่มเปลี่ยนบัญชี | **นอก PR นี้** — มาร์ค/แบงค์ต่อจาก flag |

---

## 6) นอกขอบเขต (ยืนยันตามโจทย์)

- งาน 5 ข้ออื่น (คืนเงิน / ถอน / R2 / P4 / …) — **ยังไม่ทำ**  
- ตัด blob `GET /api/admin`  
- Deploy / qa:cloud ร้านจริง  

---

## 7) ขอมาร์ค

1. รีวิว/merge **PR #35**  
2. ต่อ UI: จากหน้ารายละเอียดออเดอร์ที่ส่งแล้ว → เลือกบัญชีที่เสีย → เรียก `POST .../replace` พร้อมเหตุผล  
3. **ห้าม deploy** จาก PR นี้จนกว่ามาร์คสั่ง  
4. แจ้งเมื่อพร้อมงาน 5 ข้อถัดไป  

---

## 8) Quick links

- PR: https://github.com/Markrock342/astra-digital/pull/35  
- สัญญา: `docs/architecture/api-contract-shop.md` (หัวข้อเปลี่ยนบัญชีที่เสีย)  
- สถานะ: `docs/status/CURRENT.md`  
