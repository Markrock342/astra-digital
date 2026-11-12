# รายงานส่งมาร์ค — Admin FR งาน 5 เริ่มด้วย FR-O5

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12  
**Branch:** `feat/admin-fr-work5-o5-replace-credential`  
**ฐาน:** `main` @ `4a8c33f` (#31+#32+#34 merge แล้ว)  
**Deploy:** **ยังไม่ทำ**

## คำตัดสิน

| มุม | ผล |
|-----|-----|
| FR-O5 เปลี่ยนบัญชีเสีย | **ผ่าน** |
| กันชน live/team/reports/STAFF deliver | **ผ่าน** — ไม่ทับ |
| เทสต์ | **ผ่าน** — ดูด้านล่าง |
| ห้าม deploy | **ผ่าน** |

## QC gates

| ชั้น | ผล | หลักฐาน |
|------|-----|---------|
| A Automated | **ผ่าน** | `npm test` · `test:e2e` |
| B Contract | **ผ่าน** | `api-contract-shop.md` · `adminReplaceCredential` |
| C Security | **ผ่าน** | STAFF/CUSTOMER 403 · ไม่มี plaintext ใน replace |
| D Regression | **ผ่าน** | deliver STAFF · defect available · W4 |
| E Schema | **ผ่าน** | ใช้คอลัมน์ defective ที่มีอยู่ (007) |
| F Manual | รอ Mark | ปุ่ม UI ต่อจาก flag |

## สิ่งที่ส่ง

- `POST /api/admin/orders/:id/replace` `{ inventoryId, reason }` — ADMIN
- ready + preorder DELIVERED · บัญชีเก่า defective + เคลียร์ bind · บัญชีใหม่ผูกแทน
- แจ้งเตือนลูกค้าในเว็บ · audit `REPLACE_ORDER_CREDENTIAL` · live bump `orders/catalog/notify`
- `readDeliveredItems` ข้าม defective

## เทสต์

```
npm test          → 85/85 ผ่าน
npm run test:e2e  → 30/30 ผ่าน
```

เทสต์ใหม่: `ADMIN-FR-W5-O5: replace delivered ready…` · `ADMIN-FR-W5-O5: replace after preorder deliver…`

## กันชนที่ยืนยันไม่แตะ

- `admin-team.mjs` / `admin-reports.mjs` / `live.mjs` (เพิ่มเฉพาะ LIVE_METHODS)
- `deliverReservation` ยัง `requireStaff`
- UI ตัวเลือก+สต็อกของมาร์ค

## ขอมาร์ค

- รีวิว/merge PR นี้  
- **ห้าม deploy** จนกว่ามาร์คสั่ง  
- แจ้งเมื่อพร้อมงาน 5 ข้อถัดไป  
