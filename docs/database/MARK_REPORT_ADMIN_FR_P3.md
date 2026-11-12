# รายงานส่งมาร์ค — FR-P3 saveProduct preorder

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12  
**PR:** https://github.com/Markrock342/astra-digital/pull/27  
**Branch:** `feat/admin-fr-p3-saveproduct-preorder`  
**ฐาน:** `main` @ `7fb79f9`  
**Deploy:** **ยังไม่ทำ**

## คำตัดสิน

| มุม | ผล |
|-----|-----|
| FR-P3 `saveProduct` รับ preorder | **ผ่าน** |
| เทสต์ | **ผ่าน** — ดูด้านล่าง |
| ห้าม deploy / ยังไม่ปนงาน 3 | **ผ่าน** |

## Checklist

| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| สร้างสินค้า `preorder:true` | **ผ่าน** | `products.preorder=1` · สั่งเข้า `reservations` |
| ปิด preorder ด้วย `false` | **ผ่าน** | `preorder=0` |
| UPDATE ไม่ส่ง preorder → คงค่าเดิม | **ผ่าน** | cinema-max คง 1 |
| STAFF/CUSTOMER → 403 | **ผ่าน** | เทสต์ |
| feature `productPreorderForm` | **ผ่าน** | `/api/me` + health |
| สัญญา API | **ผ่าน** | `api-contract-shop.md` |

## เทสต์

```
npm test          → 68/68 ผ่าน
npm run test:e2e  → 14/14 ผ่าน
```

เทสต์ใหม่: `ADMIN-FR-P3: saveProduct accepts preorder create/update; staff forbidden`

## ขอมาร์ค

- รีวิว/merge PR นี้เพื่อต่อหน้าจอฟอร์มสินค้า  
- **ห้าม deploy** จาก PR นี้จนกว่ามาร์คสั่ง  
- น็อตจะเริ่มงาน 3 (ledger 006) คนละ PR หลังส่งมอบนี้  
