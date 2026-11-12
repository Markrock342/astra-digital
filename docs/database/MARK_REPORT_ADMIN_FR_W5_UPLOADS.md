# รายงานส่งมาร์ค — Admin FR งาน 5 · UP-1 อัปโหลดรูปสินค้า (ตรวจครบ + เทส 2 รอบ)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12  
**PR:** https://github.com/Markrock342/astra-digital/pull/40  
**Branch:** `feat/admin-fr-w5-up1-product-images`  
**ฐาน:** `main` หลัง #37 (DO `.changes`) + #38  
**Deploy:** **ห้าม** จนกว่ามาร์คสั่ง

---

## 0) คำตัดสินหลังตรวจทีละขั้น + เทส 2 รอบ

| ขอบเขต | สถานะ |
|--------|--------|
| Prerequisite `run().changes` (#37) | ผ่าน (อยู่บน main แล้ว) |
| **UP-1** แกนกลาง + รูปสินค้า | **ครบตามโจทย์รอบนี้** |
| **UP-2** avatar + logo | **ยังไม่ทำ** (PR แยกตามลำดับ) |
| **UP-3** แชท/สลิป | **ห้ามทำ** (รอมาร์คยืนยัน) |

---

## 1) ตรวจทีละขั้นเทียบโจทย์ (UP-1)

### ขั้น A — Prerequisite / ลำดับงาน
| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| แก้บั๊ก `run().changes` ก่อน | ผ่าน | #37 merged |
| UP-1 ก่อน UP-2 คนละ PR | ผ่าน | PR #40 = UP-1 เท่านั้น |
| ห้าม UP-3 | ผ่าน | ไม่มีโค้ดแชท/สลิป |

### ขั้น B — ที่เก็บไฟล์ (adapter)
| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| `server/file-store.mjs` put/get/delete | ผ่าน | ไฟล์ใหม่ |
| R2 `UPLOADS` ถ้ามี / ไม่มีใช้ `files` BLOB | ผ่าน | `createFileStore({ uploads: env.UPLOADS })` |
| Node ใช้ตาราง `files` | ผ่าน | commerce local |
| ห้ามสร้าง bucket · คอมเมนต์ binding ใน wrangler | ผ่าน | `wrangler.jsonc` คอมเมนต์ + วิธีเปิดใช้ |

### ขั้น C — Schema MIG-008
| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| `product_images` + index | ผ่าน | migrate-008 + เทสต์ local-migrate |
| `files` table | ผ่าน | |
| `users.avatar_key` (เตรียมไว้ · API ใน UP-2) | ผ่าน | คอลัมน์มีแล้ว ไม่เปิด API avatar |

### ขั้น D — API รูปสินค้า + GET ไฟล์
| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| GET `/api/files/:key` headers ครบ | ผ่าน | nosniff · inline · immutable · CT ตามไฟล์ |
| POST `/api/admin/products/:id/images` | ผ่าน | body ไบต์ · สูงสุด 8 · `{ image }` |
| PATCH reorder ครบชุด | ผ่าน | |
| DELETE `/api/admin/product-images/:id` | ผ่าน | ลบแถว + ลบ file · fail ลบ file แค่ log |
| body ไม่ใช่ multipart · jpeg/png/webp + magic | ผ่าน | |
| ≤2MB · 415/413 | ผ่าน | |
| key = UUID เซิร์ฟเวอร์ | ผ่าน | `randomUUID()` |
| rate 30/10 นาที | ผ่าน | เทสต์ 429 ที่ครั้งที่ 31 |
| audit ADD/REMOVE/REORDER | ผ่าน | เทสต์ assert audit |
| api-handler ยกเว้น JSON เฉพาะ path อัปโหลด | ผ่าน | เส้น settings ยัง 415 ถ้าส่งรูป |

### ขั้น E — Payload เดิม + live
| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| products / productDetail / admin products / overview → `images[]` + `imageUrl` | ผ่าน | |
| live bump `catalog` บน mutation รูปสินค้า | ผ่าน | LIVE_METHODS เพิ่ม 3 ชื่อเท่านั้น |
| `uploads: true` | ผ่าน | health/me |
| `avatarUrl` / `logoUrl` | **UP-2** | นอก PR นี้ตามลำดับมาร์ค |

### ขั้น F — ข้อห้าม
| ข้อ | สถานะ |
|-----|--------|
| ไม่แตะ `src/` | ผ่าน (diff ไม่มี) |
| ไม่แตะ team/reports/customers | ผ่าน |
| ห้าม deploy / qa:cloud ร้านจริง | ผ่าน |

### ขั้น G — ช่องโหว่ที่พบตอนตรวจซ้ำ (แก้แล้ว)
| ช่องโหว่ | แก้ |
|----------|-----|
| นับจำนวนรูปก่อนเข้า tx → อัปพร้อมกันอาจเกิน 8 | ย้าย count+insert เข้า tx · ถ้า fail ลบ file ที่ put ไว้ |
| เทสต์ไม่ครอบ GIF/HTML/max8/audit/rate/404 หลังลบ | ขยาย `tests/uploads-up1.test.mjs` |

---

## 2) หลักฐานเทส 2 รอบ (เต็มรูปแบบ)

### รอบที่ 1
| ชุด | ผล |
|-----|-----|
| `tests/uploads-up1.test.mjs` | **5/5** (magic/SVG/GIF/HTML · CRUD+audit · max8 · HTTP security · rate 429) |
| `npm test` ทั้งชุด | **93/93** |

### รอบที่ 2
| ชุด | ผล |
|-----|-----|
| `npm test` ซ้ำ | **93/93** |
| `npm run test:e2e` | **31/31** |
| `wrangler dev --local` smoke #1 | **10/10** (อัป→GET ไบต์ตรง→เรียง→ลบ→storefront) |
| `wrangler dev --local` smoke #2 | **10/10** ซ้ำ |

---

## 3) สิ่งที่ส่งใน PR #40 (ไฟล์หลัก)

- `server/file-store.mjs`, `migrate-008.mjs`, `migrations/008_uploads.sql`
- `server/admin-product-images.mjs`
- `domain.mjs` / `api-handler.mjs` / `live.mjs` / `commerce.mjs` / `cloud/worker.mjs`
- `wrangler.jsonc` (คอมเมนต์ R2)
- เทสต์ + `scripts/wrangler-local-uploads-smoke.mjs`
- สัญญา API + รายงานนี้

---

## 4) ขอมาร์ค

1. รีวิว/merge **PR #40**
2. ต่อ UI จาก `uploads`
3. สร้าง bucket แล้ว uncomment R2 เมื่อพร้อม
4. หลัง merge → น็อตเริ่ม **UP-2** (avatar + logoUrl) คนละ PR
5. **ห้าม deploy** จาก PR นี้จนกว่าสั่ง
