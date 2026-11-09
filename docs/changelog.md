# Changelog (กระบวนการทีม)

บันทึกการเปลี่ยนแปลงระดับโฟลว์/กฎ — ไม่แทนที่ประวัติผลิตภัณฑ์ในเอกสารอื่น

## 2026-11-09
- ร่าง Roadmap NOTT Sprint 1 ตามลำดับความสำคัญ Phase 0–5 — [roadmaps/NOTT-SPRINT1.md](roadmaps/NOTT-SPRINT1.md) รอ Owner Approve
- Owner ยืนยัน: รีโปเดียว ASTRA (FIFA = ผู้ว่าจ้าง); เอกสารหาในรีโปนี้; ยึด brief D1; ลำดับเดินเริ่มจาก design ก่อนลง DB/API/Payment
- Intake LCS×FIFA prompt pack: ย้ายไป [requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md](requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md); ขอบเขตทีมนี้คือ **NOTT** เท่านั้น — ดู [modules/backend-nott.md](modules/backend-nott.md)
- เพิ่มโครงทำงานแบบ Owner + **Agent (PM+Coder รวมแชทเดียว)**: `.cursor/rules/` + `docs/process/*` + สารบัญ [index.md](index.md) — **ไม่ลบ**เอกสารเดิมใน `docs/`
- กติกาเดิมคงไว้: commit หลังงานพร้อมหลักฐาน; **ห้าม push docs/schema**; push โค้ดเมื่อ Owner สั่ง; security-first; วัดผลด้วยหลักฐานเทสจริง; sub-agent สำหรับวิจัย
