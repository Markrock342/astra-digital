# รายงานส่งมาร์ค — Admin FR งาน 5 · UP-2 รูปโปรไฟล์ + โลโก้ร้าน (ตรวจครบ + เทสซ้ำ)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-13  
**PR:** https://github.com/Markrock342/astra-digital/pull/50  
**Branch:** `feat/admin-fr-w5-up2-avatar-logo`  
**ฐาน:** `main` (หลัง #40 UP-1 + money/auth)  
**Deploy:** **ห้าม** จนกว่ามาร์คสั่ง

---

## 0) คำตัดสินหลังตรวจทีละขั้น + เทสซ้ำ

| ขอบเขต | สถานะ |
|--------|--------|
| **UP-1** แกนกลาง + รูปสินค้า | merge แล้ว (#40) — regression ผ่านในรอบนี้ |
| **UP-2** avatar + logo | **ครบเกณฑ์ผ่านข้อ 2–4** · `/api/me` + `/api/overview` ได้ url |
| **รายชื่อทีม / รายละเอียดลูกค้า → avatarUrl** | **ค้าง (ช่องว่างที่ตั้งใจ)** — สเปกบอกให้ได้ผ่าน `publicUser` แต่ข้อห้ามระบุห้ามแก้ `admin-team.mjs` / `admin-customers.mjs` ซึ่ง map คนละชุด ไม่เรียก `publicUser` |
| **UP-3** แชท/สลิป | **ห้ามทำ** — ไม่มีโค้ด |
| PR #21 race | rebase แล้ว · เหลือแค่เทสต์ · ทิ้ง payment_events |

**สรุป:** พร้อมให้มาร์ครีวิว/merge UP-2 ได้ · ทีม/ลูกค้าหลังบ้านยังไม่มี `avatarUrl` จนกว่ามาร์คอนุญาตแตะไฟล์นั้นหรือต่อเอง

---

## 1) ตรวจทีละขั้นเทียบโจทย์ (UP-2)

### ขั้น A — ลำดับ / ข้อห้าม
| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| UP-1 ก่อน · คนละ PR | ผ่าน | PR #50 = UP-2 only |
| ห้าม UP-3 | ผ่าน | ไม่มี path แชท/สลิป |
| ห้ามแตะ `src/` | ผ่าน | diff ไม่มี |
| ห้ามแตะ team/reports/customers | ผ่าน | diff ไม่มี |
| ห้ามสร้าง bucket / deploy / qa:cloud | ผ่าน | |

### ขั้น B — API avatar + logo
| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| POST/DELETE `/api/profile/avatar` (ล็อกอินทุก role) | ผ่าน | `profile-uploads` + api-handler |
| POST/DELETE `/api/admin/settings/logo` (ADMIN) | ผ่าน | buyer 403 |
| แทนรูปเดิมแล้วลบ file เก่า | ผ่าน | unit + 404 หลังแทน |
| ลบ file ล้มเหลว → log ไม่ตอบ error | ผ่าน | `deleteFileBestEffort` |
| key = UUID เซิร์ฟเวอร์ | ผ่าน | `randomUUID()` |

### ขั้น C — Payload เดิม
| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| `publicUser` → `avatarUrl` · `/api/me` | ผ่าน | unit + smoke |
| `settings()` / `/api/overview` → `logoUrl` | ผ่าน | |
| `logoKey` ไม่โผล่ API สาธารณะ | ผ่าน (แก้ตอน QC) | settings ลบ `logoKey` · เก็บใน store อย่างเดียว |
| `saveSettings` ไม่ล้างโลโก้ | ผ่าน | เทสต์ assert หลังแก้ชื่อร้าน |
| ทีม / ลูกค้าหลังบ้าน → `avatarUrl` | **ค้าง** | ดูข้อ 0 |
| live avatar → `customers` · logo → `catalog` | ผ่าน | LIVE_METHODS + เทสต์ bump |

### ขั้น D — Security
| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| jpeg/png/webp + magic · ห้าม SVG/GIF/HTML | ผ่าน | 415 |
| ≤2MB · Content-Length + นับไบต์ | ผ่าน | 413 |
| rate 30/10 นาที (path อัปโหลดเดิม) | ผ่าน | UP-1 ครอบ path avatar/logo ด้วย |
| X-Astra-Request + Origin | ผ่าน | ใช้ middleware เดิม |
| audit `AVATAR_*` / `LOGO_*` | ผ่าน | เทสต์ assert ตอน QC |

### ขั้น E — GET ไฟล์
| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| headers nosniff · inline · immutable | ผ่าน | unit UP-2 + UP-1 |

### ขั้น F — ช่องโหว่ที่พบตอน QC รอบนี้ (แก้แล้ว)
| ช่องโหว่ | แก้ |
|----------|-----|
| `logoKey` โผล่ใน `settings()`/`overview` | ลบจาก response สาธารณะ · อ่าน raw ตอน setLogo/saveSettings |
| เทสต์ไม่ assert audit / live bump / file headers | ขยาย `tests/uploads-up2.test.mjs` |

### ขั้น G — ข้อจำกัดที่ยังอยู่ (ไม่แก้ใน PR นี้)
| รายการ | เหตุผล |
|--------|--------|
| ทีม/ลูกค้าไม่มี `avatarUrl` | ข้อห้ามแตะ `admin-team` / `admin-customers` |
| `withLive` bump ก่อน Promise ของ async เสร็จ | พฤติกรรมเดิมของ UP-1 ด้วย · สเปกห้ามแก้ส่วนอื่นของ `live.mjs` |
| R2 local miniflare | เทสต์ SQLite store (ไม่มี binding) ตามโจทย์หลัก · R2 ยังคอมเมนต์รอมาร์ค |

---

## 2) Prove Matrix (รันจริงบนเครื่อง — รอบ QC)

| ชั้น | ผล |
|-----|-----|
| `tests/uploads-up2.test.mjs` | **5/5** |
| `npm test` | **172/172** |
| `npm run build` + `npm run test:e2e` | **61/61** |
| `wrangler dev --local --port 4342` smoke รอบ 1 | **19/19** |
| smoke รอบ 2 (ซ้ำ) | **19/19** |

Smoke ครอบ: รูปสินค้า + avatar → `/api/me` + GET ไบต์ตรง + logo → `/api/overview` + DELETE เคลียร์ (SQLite store · ไม่มี R2)

---

## 3) ไฟล์หลักใน PR #50

- `server/profile-uploads.mjs` (ใหม่)
- `server/domain.mjs` · `api-handler.mjs` · `live.mjs`
- `tests/uploads-up2.test.mjs` · `package.json`
- `scripts/wrangler-local-uploads-smoke.mjs`
- `tests/auth-hardening.test.mjs` (cleanup EPERM บน Windows)
- สัญญา API + roadmap backlog + รายงานนี้

---

## 4) PR #21 (คู่ขนาน)

- https://github.com/Markrock342/astra-digital/pull/21  
- rebase บน main · **เก็บ** C1 race + A4/A5 · **ทิ้ง** payment_events  
- ไฟล์เหลือแค่ `tests/commerce.test.mjs` + `tests/nott-ops.test.mjs`

---

## 5) ขอมาร์ค

1. รีวิว/merge **PR #50** (UP-2)
2. ถ้าต้องการ `avatarUrl` ในทีม/ลูกค้าหลังบ้าน — อนุญาตแตะ `admin-team`/`admin-customers` หรือมาร์คต่อเอง
3. แบงค์ต่อ UI รูปโปรไฟล์ · โลโก้ร้านตามหน้าตั้งค่า
4. **ห้าม deploy** จาก PR นี้จนกว่าสั่ง
5. คิวถัดไป (ต้นทุน/หมดอายุ/PDPA/10k/health) แยก PR — ยังไม่ทำ
