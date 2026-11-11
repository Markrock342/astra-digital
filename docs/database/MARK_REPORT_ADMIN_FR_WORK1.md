# รายงานส่งมาร์ค — Admin FR งาน 1

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12  
**PR:** (ใส่ลิงก์หลังเปิด)  
**ฐาน:** `main` @ `30d1f00`  
**Deploy:** **ยังไม่ทำ**

---

## 1. คำตัดสิน

| มุม | ผล |
|-----|-----|
| งาน 1 ตามโจทย์ (สัญญา + แชท/แจ้งเตือน/อันดับ + FR-F10) | **ผ่าน** |
| เก็บ ADMIN-FR เข้า docs | **ผ่าน** |
| เทสต์ | **ผ่าน** — ดู §3 |
| ห้าม deploy / ยังไม่เริ่มงาน 2–4 | **ผ่าน** |

---

## 2. Checklist โจทย์งาน 1

| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| 1.1 สัญญาแชทแอดมิน (เรียงข้อความล่าสุด, unread, ตอบ, ปิด) | **ผ่าน** | `api-contract-shop.md` + `chatThreads`/`chatMessages` |
| 1.1 แจ้งเตือนแอดมิน: ออเดอร์ / แชท / คิวพรีออเดอร์ / สต็อกใกล้หมด | **ผ่าน** | kinds `order_new`, `chat`, `preorder_queue_admin`, `stock_low` |
| 1.1 อันดับผู้ซื้อ Bangkok ในสัญญา | **ผ่าน** | ขยายหมวดอันดับ + RBAC ในสัญญา (API มีอยู่แล้ว) |
| features ใน `/api/me` | **ผ่าน** | mirror health + `adminChatInbox`, `adminOpsNotifications`, `salesRevenueFromPayments` |
| 1.2 FR-F10 ยอดขาย = payments SUCCEEDED − คืนเงิน | **ผ่าน** | `salesRevenueSatang()` → `adminOverview.revenue` · REFUND=0 จนกว่างาน 3 |
| unread โดยไม่กินเลข migration 006 | **ผ่าน** | `ensureChatThreadReads` (CREATE IF NOT EXISTS) |

---

## 3. หลักฐานเทสต์

รันบนเครื่องน็อต 2026-11-12 (branch `feat/admin-fr-work1-api-contract-revenue`):

```
npm test          → 63/63 ผ่าน (รวม ADMIN-FR-W1 ×3)
npm run test:e2e  → 11/11 ผ่าน (หลัง rebuild dist ให้ UI มี radio โค้ดเดี่ยว)
```

เทสต์ใหม่ใน `tests/nott-ops.test.mjs`:
- chat inbox sort + unread
- admin notifications + `/api/me` features
- revenue FR-F10

หมายเหตุ e2e: production harness เสิร์ฟ `dist/` — ต้อง `npm run build` ก่อนรันถ้า Admin UI เปลี่ยน

---

## 4. ไฟล์หลัก

- `server/domain.mjs`, `server/api-handler.mjs`, `server/ensure-admin-fr.mjs`
- `server/commerce.mjs`, `cloud/worker.mjs`
- `docs/architecture/api-contract-shop.md`
- `docs/requirements/ADMIN-FR-20261111.md`, `docs/roadmaps/NOTT-ADMIN-FR-20261111.md`

---

## 5. ขอมาร์ค

- รีวิว/merge PR งาน 1
- **ห้าม deploy จาก PR นี้** (หรือขึ้นเมื่อมาร์คพร้อม)
- รอ approve ก่อนน็อตเริ่มงาน 2 (list APIs)
