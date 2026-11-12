# รายงานส่งมาร์ค — Admin FR งาน 5 · UP-2 + QC รูปสินค้า (ตรวจครบ · เทส 2 รอบ)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-13  
**PR:** https://github.com/Markrock342/astra-digital/pull/50  
**Branch:** `feat/admin-fr-w5-up2-avatar-logo`  
**Deploy:** **ห้าม** จนกว่ามาร์คสั่ง

---

## 0) คำตัดสิน

| หัวข้อ | สถานะ |
|--------|--------|
| UP-1 รูปสินค้า (API + หลังบ้าน + หน้าร้าน) | **ทำงาน** — #40 merge แล้ว |
| UP-2 avatar + logo | **ครบ** ใน PR #50 |
| ทำไม screenshot มีไอคอนรูปแตก | **ไม่ใช่ API พัง** — เป็นสินค้าจาก smoke เก่าที่อัปโหลดไบต์ webp ปลอม (magic อย่างเดียว) เบราว์เซอร์ถอดรหัสไม่ได้ |
| รูปโปรไฟล์ในหลังบ้าน (ทีม / ลูกค้า) | **ปิดช่องว่างแล้ว** ใน PR นี้ (ห่อจาก domain · ไม่แก้ไฟล์ MUST_NOT) |
| UP-3 | **ห้ามทำ** |

---

## 1) ทำไมไม่มีรูปสินค้าใน screenshot (root cause)

สินค้าในภาพชื่อ `Wrangler Upload QA cdd1e9 / 441922 / 9430e8` + `Wrangler Preorder QA`  
= สินค้าที่สคริปต์ `wrangler-local-uploads-smoke.mjs` สร้างตอนเทส local

ตรวจบน `wrangler dev --local` จริง:

| ตรวจ | ผล |
|------|-----|
| `GET /api/products` มี `imageUrl=/api/files/…` | มี |
| `GET /api/files/:key` | **200** · `Content-Type: image/webp` |
| ไบต์ไฟล์เก่า | 64 bytes · header `RIFF….WEBP` แต่**ไม่ใช่ภาพ webp จริง** |
| ผลในเบราว์เซอร์ | `<img>` โหลดได้แต่ถอดรหัสไม่ได้ → ไอคอนรูปแตก + พื้นเทา |
| `Wrangler Preorder QA` | ไม่มี `imageUrl` → โชว์ placeholder ตัว **A** (ปกติ) |

**สรุป:** ระบบอัปโหลด/เสิร์ฟไฟล์ไม่พัง · smoke เก่าใช้ stub ทำให้ดูเหมือนไม่มีรูป  
**แก้แล้ว:** smoke ใช้ webp/png 1×1 จริง (base64) · สินค้าใหม่หลัง smoke รอบนี้ `len=44` ถอดรหัสได้

**รูปจากหลังบ้านจริง (UI มาร์ค · `toWebp`)** ไม่เกี่ยวกับ stub นี้ — อัปผ่านหน้าแก้ไขสินค้าแล้วจะเป็น webp จริง

รองรับหลังบ้านอยู่แล้ว:

- รูปสินค้า: `ProductImages` ใน Admin + API UP-1 · `adminProducts` ส่ง `images[]` + `imageUrl`
- รูปโปรไฟล์: API UP-2 · `/api/me.avatarUrl` · ทีม/ลูกค้าหลังบ้านได้ `avatarUrl` แล้วใน PR นี้

---

## 2) ช่องโหว่ที่พบและปิดในรอบ QC นี้

| ช่องโหว่ / ช่องว่าง | แก้ |
|---------------------|-----|
| Smoke อัปโหลด webp ปลอม → หน้าร้านโชว์รูปแตก | ใช้รูป 1×1 จริงใน smoke |
| `logoKey` โผล่ settings/overview | ซ่อนจาก API สาธารณะ (รอบก่อน) |
| ทีม/ลูกค้าไม่มี `avatarUrl` ทั้งที่สเปกบอก | ห่อใน `domain.mjs` + `admin-list-apis` · **ไม่แก้** `admin-team`/`admin-customers` |
| เทสต์ไม่ assert audit/live/headers/admin avatar | ขยาย `uploads-up2.test.mjs` |

ข้อจำกัดที่ยังอยู่ (นอกขอบเขต / โดนห้าม):

- ไม่แตะ `src/` — UI รูปโปรไฟล์ในหน้าบัญชีเป็นของแบงค์
- R2 ยังคอมเมนต์ — มาร์คสร้าง bucket เอง
- UP-3 ห้ามทำ
- สินค้า smoke เก่าใน local DB ยังมี stub — สร้างใหม่หรืออัปโหลดทับจะหาย

---

## 3) สิ่งที่ทำใน UP-2 (ย้ำ)

| API | สิทธิ์ |
|-----|--------|
| POST/DELETE `/api/profile/avatar` | ล็อกอินทุก role |
| POST/DELETE `/api/admin/settings/logo` | ADMIN |
| `publicUser.avatarUrl` · team · customer list/detail | มี |
| `settings`/`overview.logoUrl` | มี |
| live | avatar → `customers` · logo → `catalog` |

---

## 4) Prove Matrix — เทส 2 รอบ (รันจริงบนเครื่อง)

### รอบที่ 1
| ชุด | ผล |
|-----|-----|
| `npm test` | **173/173** |
| `npm run build` + `test:e2e` | **61/61** |
| `wrangler` smoke | **19/19** |

### รอบที่ 2
| ชุด | ผล |
|-----|-----|
| `wrangler` smoke ซ้ำ | **19/19** |
| ตรวจสินค้าใหม่หลัง smoke | `imageUrl` 200 · `len=44` · `image/webp` จริง |

---

## 5) ขอมาร์ค

1. รีวิว/merge **PR #50**
2. บนร้านจริง: อัปโหลดรูปสินค้าผ่านหลังบ้าน (ไม่ใช้ smoke stub) · เปิด R2 เมื่อพร้อม
3. แบงค์ต่อ UI รูปโปรไฟล์จาก `avatarUrl`
4. **ห้าม deploy** จาก PR นี้จนกว่าสั่ง
5. PR #21 (race tests) พร้อมแยก — ทิ้ง payment_events แล้ว
