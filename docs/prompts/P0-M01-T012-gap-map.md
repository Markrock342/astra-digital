# Task Spec — P0-M01-T012

```text
[TASK]
ระบบ: ASTRA DIGITAL — NOTT Backend
แผนงาน: Phase 0 → Milestone 0.1
Current Task: 0.1.2 - เขียน Gap Map NOTT Sprint 1 (มี / ขาด / ความเสี่ยง / dependency Mark-Bank)

**รายละเอียดเทคนิค:**
- **เป้าหมาย:** มี Gap Map ที่เทียบ brief NOTT Sprint 1 กับ inventory ของจริง จัดมี/ขาด/ความเสี่ยง/dependency โดยไม่เดาและไม่แก้โค้ดระบบหลัก
- **ศัพท์ที่ถูกต้อง:** มีแล้ว / บางส่วน / ขาด / BLOCKED / dependency Mark|Bank|Owner|Client
- **Flow:** อ่าน inventory + brief §2 + roadmap Phase 1–4 → เขียน docs/modules/nott-gap-map.md → ลิงก์ index → อัปเดต CURRENT/backend-nott → commit docs
- **ไฟล์/โมดูลที่เกี่ยวข้อง:** docs/modules/nott-backend-inventory.md, docs/requirements/...§2, docs/roadmaps/NOTT-SPRINT1.md, docs/feature-matrix.md, docs/production-gap.md
- **Input / Output:** Input = เอกสารที่มี; Output = gap map markdown
- **Security:** ระบุช่องว่างสิทธิ์/การรั่ว key ถ้ามีจากของจริง; ห้ามแปะ secret
- **Constraints / Error Handling:** สถานะต้องอ้าง inventory; ของที่ไม่มีให้ระบุ "ขาด" ไม่สร้างของปลอม
- **Config:** ไม่เปลี่ยน
- **ข้อห้าม:** ห้ามเริ่ม Task 0.2.x หรือโค้ด DB/API/Payment ใน Task นี้
- **เกณฑ์ผ่าน:**
  1. มีตารางเทียบ deliverables brief ทีละข้อ
  2. มีส่วนความเสี่ยง + dependency Mark/Bank/Owner/Client
  3. ระบุชัดงานที่ทำได้ใน Phase 0 vs รอเกต 0.3.3
  4. อัปเดต index + CURRENT + backend-nott
- **หลักฐานที่ต้องมี:** ไฟล์ที่เปลี่ยน + commit hash
- **ชั้นเทสที่บังคับ:** ไม่บังคับ unit — งานเอกสาร; ตรวจว่าทุกข้อ brief §2 ถูกจัดสถานะ
- **Git:** commit docs ท้องถิ่น; ห้าม push docs
```
