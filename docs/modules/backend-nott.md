# Module: Backend / NOTT (Ownership)

แหล่ง requirement: [../requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md](../requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md) — ส่วน **§2 NOTT** เท่านั้น  
นอกขอบเขตทีมนี้: MARK (PM/Admin/CI) · BANK (Storefront UI)

## สถานะปัจจุบันของฟีเจอร์นี้ (Current Status)

- รีโปเดียว: [Markrock342/astra-digital](https://github.com/Markrock342/astra-digital) — ชื่องาน **ASTRA**; “FIFA” = ชื่อย่อผู้ว่าจ้าง ไม่ใช่รีโปแยก
- Owner ยืนยัน: หาเอกสารจากรีโปนี้เท่านั้น · ทิศทาง DB ระยะ brief ยึด **D1** · **ยังไม่ทำ DB / API / Payment ตอนนี้** — ทำส่วนอื่นก่อน
- เอกสารที่ prompt อ้างชื่อ (`README_TH.md`, `SOW_CHECKLIST`, `MODULES_AND_API`, `SECURITY`, `SPRINT_01`, `0001_init.sql`) **ไม่มีในรีโป** — ใช้เอกสารผลิตภัณฑ์ + schema/โค้ดจริงแทน

### เอกสาร/หลักฐานที่มีในรีโป (ใช้แทน SOW)

| ของจริงในรีโป | ใช้แทนอะไรใน brief |
|---------------|---------------------|
| `README.md` | ภาพรวมรัน/deploy |
| `docs/architecture.md` | สถาปัตยกรรมผลิตภัณฑ์ |
| `docs/feature-matrix.md` | ขอบเขตฟีเจอร์ที่ทำแล้ว |
| `docs/production-gap.md` | ช่องว่างก่อน production |
| `docs/demo-guide.md` | เส้นทางลูกค้า/แอดมิน |
| `docs/security` กระบวนการ + กฎใน architecture | หลัก security |
| `server/migrations/001_initial.sql` (+002, 003) | schema ปัจจุบัน (SQLite / Durable Object) |
| `server/domain.mjs`, `api-handler.mjs`, `cloud/worker.mjs` | backend จริง |
| `wrangler.jsonc` | Cloudflare Worker + DO (ยังไม่ใช่ D1) |

## งานที่เพิ่งทำเสร็จ (Recently Completed)

- ยืนยันทิศทางรีโป/เอกสาร/DB จาก Owner
- ไล่รายการเอกสารในรีโปแล้ว ไม่พบ SOW ชุดชื่อใน prompt
- กำหนดว่าช่วงนี้ **พัก** implement DB / API / Payment

## บันทึกการแก้บัค (Bug & Troubleshooting Log)

- ไม่มี (ยังไม่เริ่ม implement รอบนี้)

## สิ่งที่ยังค้างอยู่และปัญหาที่ทราบ (Pending & Known Issues)

- Brief ชี้ D1 แต่ระบบปัจจุบันใช้ Durable Object SQLite — ยังไม่ migrate (พักตามคำสั่ง Owner)
- `packages/contracts` ยังไม่มี
- Auth มี role ใน DB/`demo-merchant` แล้ว แต่ยังไม่มีเอกสาร Auth/RBAC design ตาม brief

## Checklist งานต่อไป (Next Steps)

งานที่**ไม่แตะ** DB migration / Product API / Payment adapter เปิดใช้ — รอ Owner เลือกก่อนทำ Roadmap:

1. **Auth/RBAC design doc** (brief สั่ง design ก่อน แล้วค่อย PR implement แยก)
2. **Gap map** backend ปัจจุบัน ↔ deliverables NOTT Sprint 1 (เอกสารอย่างเดียว)
3. **Payment/Fulfillment flow แบบเอกสาร** (interface/proposal — ไม่ activate gateway) — Owner บอกว่าพัก Payment; ทำทีหลังได้ถ้าต้องการ
4. หลัง Owner ปลดล็อก: D1 migration · Product APIs · contracts · PaymentAdapter + เทส allocation
