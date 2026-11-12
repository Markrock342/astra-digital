# รายงานส่งมาร์ค — Admin FR งาน 2 (ตรวจครบ + ข้อเพิ่ม)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12 (อัปเดตหลังเติมข้อเพิ่มจากมาร์ค)  
**PR:** https://github.com/Markrock342/astra-digital/pull/26  
**Branch:** `feat/admin-fr-work2-list-apis`  
**ฐาน:** `main` @ `6b37c4a` (หลัง PR #25 merge)  
**Deploy:** **ยังไม่ทำ** · ไม่รัน `qa:cloud` ร้านจริง  
**แชทผูก `order_id`:** **ยังไม่ทำ** ตามที่มาร์คสั่งไว้รอบหลัง

---

## 0. คำตัดสินรวม

| มุม | ผล |
|-----|-----|
| งาน 2 เดิม (2.1–2.4 list/detail/reveal) | **ผ่าน** |
| ข้อเพิ่ม 1 — `GET /api/admin/summary` Bangkok + FR-F10 | **ผ่าน** (เติมในรอบนี้) |
| ข้อเพิ่ม 2 — คืน `Sharp\|Animations` ใน storefront e2e | **ผ่าน** (เทสต์เขียว ไม่พัง) |
| ข้อเพิ่ม 3 — แชทผูกออเดอร์ | **เลื่อน** ตามสั่ง |
| งาน 2.5 ตัด blob `/api/admin` | **เลื่อน** รอแบงค์ย้ายหน้า |
| เทสต์ | **ผ่านซ้ำ** — `npm test` **67/67** · `test:e2e` **14/14** |
| ห้าม deploy / ยังไม่เริ่มงาน 3–5 | **ผ่าน** |

---

## 1. Checklist เทียบโจทย์เดิม (งาน 2)

| ข้อมาร์ค | สถานะ | ทำอย่างไร / หลักฐาน |
|----------|--------|---------------------|
| 2.1 `GET /api/admin/orders?status&from&to&product&customer&type&q&cursor` | **ผ่าน** | `adminOrders` · cursor base64url · STAFF+ADMIN · CUSTOMER 403 |
| 2.2 `GET /api/admin/orders/:id` สินค้า ลูกค้า payment ไทม์ไลน์ บัญชีปิดบัง | **ผ่าน** | `credentialsMasked: true` · รหัสไม่โผล่ใน JSON |
| 2.2 `POST .../reveal` + audit ทุกครั้งใน transaction | **ผ่าน** | action `REVEAL_ORDER_CREDENTIALS` · ยังไม่ DELIVERED → 409 |
| 2.3 `GET /api/admin/customers?...` | **ผ่าน** | `status≠ACTIVE` → ว่าง (ยังไม่มีแบนจนกว่างาน 5) · sort/cursor |
| 2.4 `GET /api/admin/products?...` | **ผ่าน** | ไม่ชน `POST /api/admin/products` บันทึกสินค้า |
| 2.5 เลิกส่ง blob `/api/admin` ทั้งก้อน | **เลื่อน** | คง blob ไว้ · ระบุในสัญญาว่าเลื่อนรอ Bank |
| features ใน `/api/me` + health | **ผ่าน** | `adminOrdersApi`, `adminCustomersApi`, `adminProductsApi`, `adminSummaryApi` |
| สัญญาให้แบงค์ | **ผ่าน** | `docs/architecture/api-contract-shop.md` |
| 1 branch / 1 PR / ห้าม deploy | **ผ่าน** | PR #26 |

เทสต์: `ADMIN-FR-W2` ×3 (orders / reveal / customers+products) ใน `tests/nott-ops.test.mjs`

---

## 2. Checklist ข้อเพิ่มจากมาร์ค (หลัง PR #25 merge)

### 2.A ยอดขายตามช่วงวัน — `GET /api/admin/summary?from&to`

| ข้อ | สถานะ | รายละเอียด |
|-----|--------|------------|
| Endpoint ใหม่ (หรือใน overview) | **ผ่าน** | เลือก endpoint แยก `GET /api/admin/summary` ไม่ยัดเข้า blob |
| `revenue` = FR-F10 ในช่วง | **ผ่าน** | `payments SUCCEEDED` ตาม `COALESCE(finalized_at,created_at)` − `ledger REFUND` |
| `orderCount` ตามช่วง | **ผ่าน** | นับ `orders` + `reservations` ที่ `created_at` ในช่วง |
| `newCustomers` ตามช่วง | **ผ่าน** | `users.role=CUSTOMER` ที่สมัครในช่วง |
| เวลา Asia/Bangkok | **ผ่าน** | `from`/`to` เป็น `YYYY-MM-DD` ตีเป็นวันปฏิทิน Bangkok → UTC |
| ไม่ส่ง from/to = ทั้งช่วง | **ผ่าน** | คืน `from: null, to: null` |
| ส่งแค่อันเดียว → 400 | **ผ่าน** | ต้องส่งคู่กัน |
| RBAC ADMIN only | **ผ่าน** | STAFF/CUSTOMER → 403 (ตัวเลขการเงิน) |
| features flag | **ผ่าน** | `adminSummaryApi: true` |
| เทสต์ | **ผ่าน** | `ADMIN-FR-W2: admin summary uses Bangkok range and FR-F10 revenue` |

ตัวอย่าง response:

```json
{
  "from": "2026-11-12",
  "to": "2026-11-12",
  "timezone": "Asia/Bangkok",
  "revenue": 12500,
  "orderCount": 3,
  "newCustomers": 1
}
```

จุดประสงค์: แบงค์เลิกคำนวณยอดใน `Admin.tsx` แล้วอ่านเลขจากเซิร์ฟเวอร์อย่างเดียว

### 2.B คืนสเปกแผงธีมใน `tests/storefront.spec.mjs`

| ข้อ | สถานะ | รายละเอียด |
|-----|--------|------------|
| ใส่ `not.toContainText(/Sharp\|Animations/)` กลับ | **ผ่าน** | ในเทสต์ «language switch, theme panel and brand assets» |
| รันบนเครื่องน็อต | **ผ่าน** | `npx playwright test tests/storefront.spec.mjs:140` → **1 passed** · ไม่มี error |
| เหตุผลที่ไม่พัง | แผง `ThemePanel` เหลือแค่โหมดสี + สีธีม · ไม่มีตัวเลือก Sharp/Animations ใน UI แล้ว (แม้ i18n-en ยังมีคำแปลค้าง — ไม่โผล่ใน dialog) |

### 2.C แชทผูก `order_id`

| ข้อ | สถานะ |
|-----|--------|
| ยังไม่ต้องทำ ไว้รอบหลัง | **เลื่อน** — ไม่มี migration/คอลัมน์ใน PR นี้ |

---

## 3. หลักฐานเทสต์ (รันซ้ำหลังเติมข้อเพิ่ม)

เครื่องน็อต · branch `feat/admin-fr-work2-list-apis`:

```
npm test                                         → 67/67 ผ่าน
npx playwright test tests/storefront.spec.mjs:140 → 1 passed (Sharp|Animations)
npm run test:e2e                                 → 14/14 ผ่าน
```

เทสต์ใหม่/เกี่ยวงาน 2:

1. `ADMIN-FR-W2: admin orders list filters, cursor, RBAC`
2. `ADMIN-FR-W2: order detail masks credentials; reveal audits`
3. `ADMIN-FR-W2: customers and products list filters + RBAC`
4. `ADMIN-FR-W2: admin summary uses Bangkok range and FR-F10 revenue`
5. storefront theme: ไม่มี Sharp/Animations ใน dialog

---

## 4. ไฟล์หลัก

**โค้ด**

- `server/admin-list-apis.mjs` — orders/customers/products/detail/reveal
- `server/domain.mjs` — `adminSummary`, `bangkokDayRange`, ขยาย `salesRevenueSatang(range)`, features
- `server/api-handler.mjs` — route `GET /api/admin/summary` + list/reveal routes
- `src/types.ts` — Features
- `tests/nott-ops.test.mjs` · `tests/use-cases.test.mjs` · `tests/storefront.spec.mjs`

**เอกสาร**

- `docs/architecture/api-contract-shop.md`
- `docs/prompts/ADMIN-FR-WORK2-list-apis.md`
- `docs/status/CURRENT.md`
- รายงานนี้

---

## 5. สิ่งที่ยังไม่ทำ / เลื่อน (ชัดเจน)

1. **ตัด blob `GET /api/admin`** (งาน 2.5) — รอแบงค์ย้ายหน้าไปใช้ API ใหม่
2. **แชทผูก `order_id`** — มาร์คสั่งไว้รอบหลัง
3. **งาน 3–5** — ยังไม่เริ่ม จนกว่ามาร์คผ่าน PR งาน 2
4. UI แบงค์ยังคำนวณยอดเองอยู่จนกว่าแบงค์จะเรียก `/api/admin/summary` — ฝั่ง API พร้อมแล้ว

---

## 6. ขอมาร์ค

1. รีวิว / merge **PR #26** (รวมข้อเพิ่ม summary + theme spec)
2. **ห้าม deploy** จาก PR นี้จนกว่ามาร์คสั่ง
3. ยืนยันว่างาน 2 ผ่าน → น็อตเริ่ม **งาน 3** (migration ledger 006) คนละ branch/PR
