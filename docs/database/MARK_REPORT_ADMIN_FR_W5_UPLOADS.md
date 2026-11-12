# รายงานส่งมาร์ค — Admin FR งาน 5 · UP-2 รูปโปรไฟล์ + โลโก้ร้าน

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-13  
**Branch:** `feat/admin-fr-w5-up2-avatar-logo`  
**ฐาน:** `main` @ `9dcbc8f` (หลัง #40 UP-1 + money/auth-hardening)  
**Deploy:** **ห้าม** จนกว่ามาร์คสั่ง merge + deploy

---

## 0) คำตัดสิน

| ขอบเขต | สถานะ |
|--------|--------|
| **UP-1** แกนกลาง + รูปสินค้า | merge แล้ว (#40) |
| **UP-2** avatar + logo | **ครบตามโจทย์รอบนี้** |
| **UP-3** แชท/สลิป | **ห้ามทำ** |
| งานมาร์ค (อีเมล/Turnstile/backup/notify/คูปอง/นโยบาย/คลังรูป) | ไม่แตะซ้ำ |

---

## 1) ตรวจทีละขั้นเทียบโจทย์ (UP-2)

### API + payload
| ข้อ | สถานะ | หลักฐาน |
|-----|--------|---------|
| POST/DELETE `/api/profile/avatar` (ทุก role ที่ล็อกอิน) | ผ่าน | `profile-uploads.mjs` + api-handler |
| POST/DELETE `/api/admin/settings/logo` (ADMIN) | ผ่าน | |
| `publicUser` → `avatarUrl` (`/api/me` …) | ผ่าน | domain.mjs |
| `settings()` / `/api/overview` → `logoUrl` | ผ่าน | เก็บ `logoKey` ใน shop-settings · ไม่ persist `logoUrl` |
| แทนรูปเดิมแล้วลบ file เก่า | ผ่าน | unit + smoke |
| magic/CT · ≤2MB · UUID · rate เดิม · audit AVATAR_*/LOGO_* | ผ่าน | |
| live: avatar → `customers` · logo → `catalog` | ผ่าน | เพิ่ม 4 ชื่อใน LIVE_METHODS เท่านั้น |
| ห้ามแตะ `src/` / team/reports/customers | ผ่าน | |
| ห้าม UP-3 / deploy | ผ่าน | |

### ไฟล์หลักที่เปลี่ยน
- `server/profile-uploads.mjs` (ใหม่)
- `server/domain.mjs` · `api-handler.mjs` · `live.mjs`
- `tests/uploads-up2.test.mjs` · `package.json` (ใส่เทสต์ใน npm test)
- `scripts/wrangler-local-uploads-smoke.mjs` (ขยาย avatar/logo)
- `docs/architecture/api-contract-shop.md`
- `tests/auth-hardening.test.mjs` — แก้ cleanup `rmSync` หลัง `db.close()` กัน EPERM บน Windows (assertion เดิมผ่านอยู่แล้ว)

---

## 2) Prove Matrix (รันจริงบนเครื่อง)

| ชั้น | ผล |
|-----|-----|
| `tests/uploads-up2.test.mjs` | **4/4** |
| `npm test` | **171/171** |
| `npm run build` + `npm run test:e2e` | **61/61** |
| `wrangler dev --local --port 4341` + smoke | **19/19** (UP-1 10 + UP-2 avatar/logo 9) |

Smoke UP-2 ที่พิสูจน์บน workerd: อัปโหลด avatar → `/api/me` มี `avatarUrl` → GET ไบต์ตรง · logo → `/api/overview` มี `logoUrl` · DELETE เคลียร์ทั้งคู่ (SQLite store · ไม่มี R2)

---

## 3) ขอมาร์ค

1. รีวิว/merge PR UP-2 นี้
2. แบงค์ต่อ UI รูปโปรไฟล์ในหน้าบัญชี · มาร์คต่อโลโก้ถ้ายังไม่ครบ
3. **ห้าม deploy** จาก PR นี้จนกว่าสั่ง
4. ถัดไป (แยก PR): คิวต้นทุน/หมดอายุ/PDPA/10k/health ตาม roadmap — ยังไม่ทำใน PR นี้
5. PR #21: น็อตจะ rebase เหลือเทสต์ race · ทิ้ง `payment_events`

---

## ภาคผนวก — สรุป UP-1 (อ้างอิง)

PR #40 · file-store + MIG-008 + รูปสินค้า · ดูประวัติแชท/commit บน main
