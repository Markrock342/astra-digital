# รายงานส่งมาร์ค — Admin FR งาน 2

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12  
**PR:** (ใส่ลิงก์หลังเปิด)  
**Branch:** `feat/admin-fr-work2-list-apis`  
**ฐาน:** `main` @ `6b37c4a`  
**Deploy:** **ยังไม่ทำ** · ไม่รัน `qa:cloud` ร้านจริง

---

## 1. คำตัดสิน

| มุม | ผล |
|-----|-----|
| งาน 2 ตามโจทย์ (orders/customers/products + detail/reveal) | **ผ่าน** |
| 2.5 ตัด blob `/api/admin` | **เลื่อน** ตามที่มาร์คสั่ง รอแบงค์ |
| เทสต์ | **ผ่าน** — ดู §3 |
| ห้าม deploy / ยังไม่เริ่มงาน 3–5 | **ผ่าน** |

---

## 2. Checklist เทียบโจทย์

| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| 2.1 `GET /api/admin/orders` + status/from/to/product/customer/type/q/cursor | **ผ่าน** | `adminOrders` · STAFF+ADMIN |
| 2.2 `GET /api/admin/orders/:id` สินค้า ลูกค้า payment ไทม์ไลน์ บัญชีปิดบัง | **ผ่าน** | `adminOrderDetail` · `credentialsMasked: true` |
| 2.2 `POST .../reveal` + audit ทุกครั้งใน transaction | **ผ่าน** | `REVEAL_ORDER_CREDENTIALS` |
| 2.3 `GET /api/admin/customers` + ตัวกรอง | **ผ่าน** | status≠ACTIVE → ว่าง (ยังไม่มีแบน) |
| 2.4 `GET /api/admin/products` + ตัวกรอง | **ผ่าน** | ไม่ชนกับ `POST` บันทึกสินค้า |
| 2.5 ตัด blob `/api/admin` | **เลื่อน** | รายงานนี้ระบุค้างรอ Bank |
| features ใน `/api/me` | **ผ่าน** | `adminOrdersApi`, `adminCustomersApi`, `adminProductsApi` |
| สัญญา API ให้แบงค์ | **ผ่าน** | `api-contract-shop.md` |

---

## 3. หลักฐานเทสต์

```
npm test          → 66/66 ผ่าน (ADMIN-FR-W2 ×3)
npm run test:e2e  → 14/14 ผ่าน
```

เทสต์ใหม่ใน `tests/nott-ops.test.mjs`:
- orders filters + cursor + RBAC + features
- detail mask + reveal audit
- customers/products filters + RBAC

---

## 4. ไฟล์หลัก

- `server/admin-list-apis.mjs` (ใหม่)
- `server/domain.mjs` · `server/api-handler.mjs` · `src/types.ts`
- `docs/architecture/api-contract-shop.md`
- `docs/prompts/ADMIN-FR-WORK2-list-apis.md`

---

## 5. ขอมาร์ค

- รีวิว/merge PR งาน 2
- **ห้าม deploy จาก PR นี้** จนกว่ามาร์คสั่ง
- รอ approve ก่อนน็อตเริ่มงาน 3 (ledger 006)
