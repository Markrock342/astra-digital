# รายงานส่งมาร์ค — Admin FR งาน 4 (variant + stock)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12  
**PR:** https://github.com/Markrock342/astra-digital/pull/31  
**Branch:** `feat/admin-fr-work4-variant-stock`  
**ฐาน:** `main` @ `56f4603`  
**Deploy:** **ยังไม่ทำ**

## คำตัดสิน

| มุม | ผล |
|-----|-----|
| FR-P2 variant CRUD | **ผ่าน** |
| FR-P7 inventory list/defect/delete/CSV/lowStockAt | **ผ่าน** |
| MIG-007 idempotent | **ผ่าน** |
| เทสต์ | **ผ่าน** — ดูด้านล่าง |
| ห้าม deploy | **ผ่าน** |

## QC gates

| ชั้น | ผล | หลักฐาน |
|------|-----|---------|
| A Automated | **ผ่าน** | `npm test` · `test:e2e` |
| B Contract | **ผ่าน** | `api-contract-shop.md` · features |
| C Security | **ผ่าน** | STAFF/CUSTOMER 403 บน mutation · list ปิดบังรหัส |
| D Regression | **ผ่าน** | Mark wallet/PAYMENT_IN · summary+cursor · P3 |
| E Schema | **ผ่าน** | 007 รันซ้ำ `skipped:true` · upgrade คอลัมน์ |
| F Manual | รอ Mark | UI หน้าสต็อกเต็มต่อจาก flag |

## Checklist

| ข้อ | สถานะ |
|-----|--------|
| สร้าง/เรียง/ปิด variant · ปิดแล้วซื้อไม่ได้ | **ผ่าน** |
| DELETE มีสต็อก/ออเดอร์ → 409 | **ผ่าน** |
| list inventory ปิดบัง · defect/delete | **ผ่าน** |
| CSV import คู่ | **ผ่าน** |
| `lowStockAt` ใน settings | **ผ่าน** |
| STAFF อ่านได้ · mutation ADMIN | **ผ่าน** |

## เทสต์

```
npm test          → 77/77 ผ่าน
npm run test:e2e  → 19/19 ผ่าน
```

เทสต์ใหม่: `ADMIN-FR-W4: variant CRUD…` · `ADMIN-FR-W4: inventory list…`

## นอกขอบเขต

- polish ledger daily Bangkok + CSV ทุกหน้า → PR แยก (Phase 4)
- FR-P4/P5/P6/P8/P9 · FR-O5 · งาน 5 · deploy

## ขอมาร์ค

- รีวิว/merge PR นี้ก่อนงาน 5  
- **ห้าม deploy** จนกว่ามาร์คสั่ง  
