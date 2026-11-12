# รายงานส่งมาร์ค — Admin FR งาน 5 · UP-1 อัปโหลดรูปสินค้า

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12  
**PR:** (ใส่หลังเปิด)  
**Branch:** `feat/admin-fr-w5-up1-product-images`  
**ฐาน:** `main` หลัง #37 (DO `.changes`) + #38  
**Deploy:** **ห้าม** จนกว่ามาร์คสั่ง

---

## ขอบเขตรอบนี้ (UP-1 เท่านั้น)

| รวม | ไม่รวม |
|------|--------|
| `file-store` (R2 หรือ SQLite `files`) | UP-2 avatar/logo API |
| MIG-008: `product_images` + `files` + `users.avatar_key` (คอลัมน์เตรียมไว้) | UP-3 แชท/สลิป |
| GET `/api/files/:key` | สร้าง R2 bucket |
| POST/PATCH product images + DELETE product-images | แตะ `src/` |
| `images[]` + `imageUrl` บน products/detail/admin | deploy |

---

## สิ่งที่ส่ง

- `server/file-store.mjs` — put/get/delete · magic bytes · max 2MB  
- `server/migrate-008.mjs` + `008_uploads.sql`  
- `server/admin-product-images.mjs`  
- api-handler: ยกเว้น JSON CT **เฉพาะ** path อัปโหลด · อ่านไบต์ · rate 30/10 นาที  
- live: `addProductImage` / `reorderProductImages` / `deleteProductImage` → `catalog`  
- `wrangler.jsonc`: คอมเมนต์ `r2_buckets` UPLOADS + วิธีเปิดใช้  
- feature `uploads: true`

---

## หลักฐาน Prove Matrix

| ชั้น | ผล |
|------|-----|
| A `npm test` | **91/91** (รวม uploads-up1) |
| B contract | api-contract-shop อัปเดต |
| C security | SVG/mismatch→415 · เกิน 2MB→413 · buyer→403 · JSON เส้นอื่นยัง 415 |
| E2E | **`npm run test:e2e` 31/31** |
| F/G wrangler local | `wrangler dev --local --port 4350` + smoke **10/10** — อัป webp→GET ไบต์ตรง · เรียง · ลบ · storefront cover |

---

## ขอมาร์ค

1. รีวิว/merge PR UP-1  
2. สร้าง bucket `asiax-uploads` แล้วค่อย uncomment R2 ใน wrangler เมื่อพร้อม  
3. ต่อ UI อัปโหลดในหน้าสินค้าจาก flag `uploads`  
4. หลัง merge แล้วน็อตเริ่ม **UP-2** (avatar + logo) คนละ PR  
5. **ห้าม deploy** จาก PR นี้จนกว่าสั่ง  
