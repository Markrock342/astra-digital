# รายงานส่งมาร์ค — Admin FR งาน 3 (ledger 006 + bugfixes)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12  
**Branch:** `feat/admin-fr-work3-ledger-006`  
**ฐาน:** tip หลัง FR-P3 (`0712535` · บน `7fb79f9`)  
**Deploy:** **ยังไม่ทำ**

## คำตัดสิน

| มุม | ผล |
|-----|-----|
| MIG-006 ledger money idempotent | **ผ่าน** |
| `GET /api/admin/transactions` + summary/CSV | **ผ่าน** · ADMIN only |
| Bugfixes B.0 (Bangkok / sold / spent / LIKE) | **ผ่าน** |
| เทสต์ | **ผ่าน** — ดูด้านล่าง |
| ห้าม deploy / ยังไม่ปนงาน 4–5 | **ผ่าน** |

## Checklist

| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| `006_ledger_money.sql` + `applyMigration006` รันซ้ำไม่พัง | **ผ่าน** | เทสต์ W3 upgrade |
| แถวเก่า `DEMO_CREDIT` คงอยู่ ไม่แปลงเป็นเงินจริง | **ผ่าน** | summary เริ่มต้นไม่รวม DEMO |
| `PAYMENT_IN` ตอน pay สำเร็จ (sandbox) | **ผ่าน** | domain pay path |
| STAFF → 403 บน transactions | **ผ่าน** | เทสต์ |
| `from`/`to` orders+customers = Bangkok day | **ผ่าน** | `bangkokDayRange` + เทสต์ 02:00 ไทย |
| `sold` นับ orders DELIVERED + reservations PREORDER\|DELIVERED | **ผ่าน** | เทสต์ |
| `spentSatang` ซ่อนจาก STAFF | **ผ่าน** | เทสต์ |
| LIKE escape `%` `_` | **ผ่าน** | เทสต์ชื่อมี `%` |
| feature `adminFinance` | **ผ่าน** | `/api/me` + health |
| สัญญา API | **ผ่าน** | `api-contract-shop.md` |

## เทสต์

```
npm test          → 70/70 ผ่าน
npm run test:e2e  → 14/14 ผ่าน
```

เทสต์ใหม่:

- `ADMIN-FR-W3: bangkok day bounds, sold includes preorder, LIKE escape`
- `ADMIN-FR-W3: ledger 006 + transactions exclude DEMO; STAFF 403`

## นอกขอบเขต (ยืนยัน)

- ห้าม deploy / ห้าม `qa:cloud` ร้านจริง
- งาน 4 variant CRUD / สต็อก P7
- งาน 5 คืนเงิน/ถอน/แบน/R2 UI
- ตัด blob `GET /api/admin`
- แชทผูก `order_id`

## ขอมาร์ค

- รีวิว/merge PR นี้ก่อนงาน 4  
- **ห้าม deploy** จนกว่ามาร์คสั่ง  
- แจ้งเมื่อพร้อมให้เริ่มงาน 4  
