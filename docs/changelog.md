# Changelog (กระบวนการทีม)

บันทึกการเปลี่ยนแปลงระดับโฟลว์/กฎ — ไม่แทนที่ประวัติผลิตภัณฑ์ในเอกสารอื่น

## 2026-11-09
- Phase 2 M2.1 เสร็จ: `server/auth-policy.mjs` + domain guards; `npm test` 20 passed; Phase 3–4 ยังล็อก
- Phase 1 M1.1 เสร็จ: dual-track D1 (`db/migrations/0001_init.sql`) + `npm run db:migrate:local` ผ่าน; ดู [architecture/erd-sprint1.md](architecture/erd-sprint1.md)
- Owner ปลดล็อก Phase 1 (หลังเคยเลือก B); Phase 2–4 ยังล็อก
- Owner เลือก **B**: ล็อกโค้ด DB/API/Payment ไว้ก่อนหลัง Approve design Phase 0 — รอคำสั่งปลดล็อก Phase 1 ในภายหลัง
- Owner Approve ชุด design Phase 0 (0.3.3 ข้อ 1: ERD + Payment/Fulfillment)
- Owner Approve Auth/RBAC (0.2.2); ร่าง ERD (0.3.1) + Payment/Fulfillment (0.3.2)
- Task **0.2.1** ร่าง Auth/RBAC design — [architecture/auth-rbac.md](architecture/auth-rbac.md)
- Task **0.1.2** เสร็จ / Milestone 0.1 ปิด: Gap Map — [modules/nott-gap-map.md](modules/nott-gap-map.md)
- Task **0.1.1** เสร็จ: inventory backend ของจริง — [modules/nott-backend-inventory.md](modules/nott-backend-inventory.md); Roadmap Approved โดย Owner
- ร่าง Roadmap NOTT Sprint 1 ตามลำดับความสำคัญ Phase 0–5 — [roadmaps/NOTT-SPRINT1.md](roadmaps/NOTT-SPRINT1.md)
- Owner ยืนยัน: รีโปเดียว ASTRA (FIFA = ผู้ว่าจ้าง); เอกสารหาในรีโปนี้; ยึด brief D1; ลำดับเดินเริ่มจาก design ก่อนลง DB/API/Payment
- Intake LCS×FIFA prompt pack: ย้ายไป [requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md](requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md); ขอบเขตทีมนี้คือ **NOTT** เท่านั้น — ดู [modules/backend-nott.md](modules/backend-nott.md)
- เพิ่มโครงทำงานแบบ Owner + **Agent (PM+Coder รวมแชทเดียว)**: `.cursor/rules/` + `docs/process/*` + สารบัญ [index.md](index.md) — **ไม่ลบ**เอกสารเดิมใน `docs/`
- กติกาเดิมคงไว้: commit หลังงานพร้อมหลักฐาน; **ห้าม push docs/schema**; push โค้ดเมื่อ Owner สั่ง; security-first; วัดผลด้วยหลักฐานเทสจริง; sub-agent สำหรับวิจัย
