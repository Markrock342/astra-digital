[TASK]
ระบบ: ASIA EXTRA (FIFACORP) — Durable Object `shop` + Pages
แผนงาน: Admin FR งาน 5 → อัปโหลดไฟล์
Current Task: W5-UP — ระบบอัปโหลดรูป (สินค้า โปรไฟล์ โลโก้ร้าน)

**ลำดับ:** ทำหลังแก้บั๊ก `run()` คืน `.changes` บน Cloudflare (ข้อความแยก) · แตก PR ทีละก้อน: UP-1 แกนกลาง+รูปสินค้า → UP-2 โปรไฟล์+โลโก้ → UP-3 (รอมาร์คยืนยัน)

**รายละเอียดเทคนิค:**

- **เป้าหมาย:**
  - แอดมินอัปโหลดรูปสินค้าได้หลายรูป เรียงลำดับได้ ลบได้ และรูปแรกเป็นรูปปก
  - ลูกค้าและแอดมินอัปโหลดรูปโปรไฟล์ตัวเองได้
  - แอดมินอัปโหลดโลโก้ร้านได้
  - หน้าร้านแสดงรูปจริงแทนรูปที่ผูกกับ Disney+ และ Monomax

- **ศัพท์ที่ถูกต้อง:**
  - **file** คือไฟล์หนึ่งชิ้นในที่เก็บ เรียกผ่าน `key` (UUID)
  - **product image** คือแถวที่ผูก file กับสินค้า มีลำดับ `sort_order`
  - **avatar** คือรูปโปรไฟล์ เก็บเป็น `users.avatar_key`
  - **logo** คือโลโก้ร้าน เก็บเป็น `logoKey` ใน shop settings

- **Flow:**
  1. เบราว์เซอร์ย่อและแปลงรูปเป็น webp ก่อนส่ง (มาร์คหรือแบงค์ทำฝั่ง UI) ขนาด: สินค้ากว้างสูงสุด 1200px, โปรไฟล์ 256px, โลโก้ 512px การแปลงด้วย canvas ตัด EXIF/GPS ออกให้ในตัว
  2. ส่ง body เป็นไบต์ของรูปตรงๆ ไม่ใช่ multipart โดยใช้ `Content-Type: image/webp|image/jpeg|image/png` และ `X-Astra-Request: 1`
  3. เซิร์ฟเวอร์ตรวจไฟล์ แล้วเก็บลงที่เก็บ บันทึกแถวในฐานข้อมูล บันทึก audit แล้วส่ง `{ id, url }` กลับ
  4. ทุกคนเปิดรูปได้ที่ `GET /api/files/:key`

- **ที่เก็บไฟล์ (adapter เดียว 2 แบบ):** ใช้ไฟล์ `server/file-store.mjs` ที่มี `put(key, bytes, mime)`, `get(key)` และ `delete(key)`
  - **Cloudflare:** ถ้ามี binding `UPLOADS` (R2) ให้ใช้ R2 ถ้าไม่มีให้ใช้ตาราง `files(key TEXT PRIMARY KEY, mime TEXT, size INTEGER, bytes BLOB, created_at)` ใน DO SQLite ร้านจะได้ deploy ได้ก่อนสร้าง bucket
  - **Node (dev และเทสต์):** ใช้ตาราง `files` ใน SQLite เดียวกัน
  - **ห้ามสร้าง bucket เอง:** มาร์คจะสั่ง `npx wrangler r2 bucket create asiax-uploads` เอง น็อตเพิ่มแค่ binding ใน `wrangler.jsonc` แบบคอมเมนต์ไว้ พร้อมวิธีเปิดใช้

- **ตาราง (ensure แบบ idempotent หรือ migration 008 ตามแบบ MIG-005/007):**
  - `product_images(id TEXT PK, product_id TEXT NOT NULL, file_key TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at)` พร้อม index `(product_id, sort_order)`
  - `users.avatar_key TEXT`
  - `files` (ถ้าใช้ SQLite store)

- **API:**

  | Method | Path | สิทธิ์ | หมายเหตุ |
  |---|---|---|---|
  | GET | `/api/files/:key` | ทุกคน | `Content-Type` ตามที่เก็บ · `X-Content-Type-Options: nosniff` · `Content-Disposition: inline` · `Cache-Control: public, max-age=31536000, immutable` (key ไม่ซ้ำ จึงแคชถาวรได้) · ไม่พบตอบ 404 |
  | POST | `/api/admin/products/:id/images` | ADMIN | body เป็นรูป · สูงสุด 8 รูปต่อสินค้า · ตอบ `{ image: { id, url, sort_order } }` |
  | PATCH | `/api/admin/products/:id/images` | ADMIN | `{ order: [imageId...] }` ต้องครบชุด ห้ามขาดหรือเกิน |
  | DELETE | `/api/admin/product-images/:id` | ADMIN | ลบแถวและลบ file |
  | POST | `/api/profile/avatar` | ผู้ใช้ที่ล็อกอิน (ทุก role) | แทนรูปเดิม (ลบ file เก่า) |
  | DELETE | `/api/profile/avatar` | ผู้ใช้ที่ล็อกอิน | |
  | POST | `/api/admin/settings/logo` | ADMIN | |
  | DELETE | `/api/admin/settings/logo` | ADMIN | |

- **ข้อมูลที่ API เดิมต้องส่งเพิ่ม:**
  - `products()`, `productDetail()`, `/api/admin/products` และ admin overview ส่ง `images: [{ id, url }]` เรียงตาม `sort_order` และ `imageUrl` (รูปแรก หรือ null)
  - `publicUser()` ส่ง `avatarUrl` ทำให้ `/api/me`, รายชื่อทีม และรายละเอียดลูกค้าในหลังบ้านได้ไปด้วย
  - `settings()` และ `/api/overview` ส่ง `logoUrl`
  - live: ทุก mutation รูปสินค้าและโลโก้ bump `catalog` · avatar bump `customers` โดยเพิ่มชื่อเมธอดใน `LIVE_METHODS` ของ `server/live.mjs` (ห้ามแก้ส่วนอื่นของไฟล์)

- **Security (บังคับ):**
  - **ชนิดไฟล์:** whitelist แค่ jpeg, png, webp โดยตรวจทั้ง `Content-Type` และ magic bytes (`FFD8FF`, `89504E47`, `RIFF....WEBP`) ไม่ตรงตอบ 415 · **ห้ามรับ SVG, GIF หรือ HTML** (ป้องกัน XSS)
  - **ขนาด:** ไม่เกิน 2MB หลังย่อ ถ้าเกินตอบ 413 · ต้องเช็ก `Content-Length` ก่อนอ่าน body และนับไบต์ซ้ำระหว่างอ่าน
  - **ชื่อไฟล์:** key เป็น UUID ที่เซิร์ฟเวอร์สร้าง ห้ามใช้ชื่อไฟล์จากผู้ใช้
  - **จำกัดความถี่:** ใช้ `consumeLimit` เดิม โดยอัปโหลดได้ไม่เกิน 30 ครั้งต่อผู้ใช้ใน 10 นาที
  - **audit:** `PRODUCT_IMAGE_ADD/REMOVE/REORDER`, `AVATAR_SET/REMOVE`, `LOGO_SET/REMOVE`
  - **ตัวตรวจ request ใน `api-handler.mjs`:** ตอนนี้บังคับ `Content-Type: application/json` สำหรับทุก POST ให้ยกเว้นเฉพาะ path อัปโหลดข้างบน เส้นอื่นต้องบังคับเหมือนเดิม และต้องเช็ก `X-Astra-Request` กับ Origin เหมือนเดิมทุกเส้น
  - **`server/http.mjs` (Node):** ส่ง body ไบต์ของรูปผ่านได้ (ตอนนี้ส่ง POST, PATCH, DELETE แล้ว)

- **Constraints / Error Handling:**
  - ถ้าเก็บ file ไม่สำเร็จ ห้ามมีแถวค้างในตาราง
  - ถ้าลบแถวสำเร็จแต่ลบ file ไม่สำเร็จ ให้ log ไว้ แล้วไม่ต้องตอบ error
  - ลบสินค้าหรือตัวเลือกไม่เกี่ยวกับงานนี้ (ร้านใช้วิธีปิดสินค้า)
  - ข้อความ error เป็นภาษาไทยตามแบบเดิม

- **ข้อห้าม:**
  - ห้ามแตะ `src/` ทั้งหมด (มาร์คต่อ UI ในหน้าเพิ่มสินค้าที่มีตัวอย่างอยู่แล้ว แบงค์ต่อรูปโปรไฟล์ในหน้าบัญชี)
  - ห้ามแก้ `admin-team.mjs`, `admin-reports.mjs`, `admin-customers.mjs` และหน้าจอตัวเลือกและสต็อก
  - ห้ามสร้าง bucket หรือ resource บน Cloudflare · ห้าม deploy · ห้ามรัน `qa:cloud` กับร้านจริง

- **UP-3 (รอมาร์คยืนยันกับลูกค้าก่อน ห้ามทำ):**
  - **รูปในแชท:** ลูกค้าส่งภาพหน้าจอปัญหาได้ ต้องเป็นไฟล์ส่วนตัว เปิดดูได้เฉพาะเจ้าของห้องแชทและทีมงาน ใช้ path แยก ไม่ใช้ `/api/files` สาธารณะ
  - **สลิปโอนเงิน:** ต่อจากหน้าตาที่แบงค์ทำไว้ ทำเมื่อลูกค้าเลือกผู้ให้บริการแล้ว เป็นไฟล์ส่วนตัวเช่นกัน

- **เกณฑ์ผ่าน:**
  1. อัปโหลด เรียง และลบรูปสินค้าได้ หน้าร้าน (`/api/products`) เห็นรูปตามลำดับ
  2. avatar กับ logo ตั้งและลบได้ `/api/me` และ `/api/overview` ส่ง url กลับมา
  3. ไฟล์ SVG, ไฟล์ที่ magic bytes ไม่ตรง, ไฟล์เกิน 2MB และผู้ไม่มีสิทธิ์ ถูกปฏิเสธด้วย code ที่ถูกต้อง
  4. `GET /api/files/:key` ส่ง header ครบตามตาราง

- **ชั้นเทสที่บังคับ:**
  - `npm test` มีเทสต์ใหม่ครบทุกข้อในเกณฑ์ผ่าน และเทสต์เดิมต้องเขียวทั้งหมด
  - `npm run build` แล้วรัน `npm run test:e2e` ต้องเขียว
  - **ต้องทดสอบบน `wrangler dev --local` จริง** (บทเรียนจากบั๊ก `.changes`):
    - อัปโหลด webp แล้วเปิด `/api/files/:key` ได้ภาพกลับมาไบต์ตรงกัน
    - เรียงลำดับและลบได้
    - ทดสอบทั้งแบบไม่มี R2 binding (ใช้ SQLite store) และถ้าทำได้ แบบ R2 local ของ miniflare ด้วย

- **หลักฐานที่ต้องมี:**
  - รายงาน `docs/database/MARK_REPORT_ADMIN_FR_W5_UPLOADS.md` (รูปแบบเดิม)
  - อัปเดตสัญญา API ใน `docs/architecture/api-contract-shop.md`
  - เพิ่ม feature flag `uploads: true`
  - รายการไฟล์ที่เปลี่ยน

- **Git:**
  - เปิด PR เทียบ `main` แยก UP-1 กับ UP-2
  - commit หลังผ่านเกณฑ์
  - ห้าม deploy จนกว่ามาร์คสั่ง
