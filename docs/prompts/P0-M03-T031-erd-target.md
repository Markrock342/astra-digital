# Task Spec — P0-M03-T031

```text
[TASK]
ระบบ: ASTRA DIGITAL — NOTT Backend
แผนงาน: Phase 0 → Milestone 0.3
Current Task: 0.3.1 - ร่าง ERD เป้าหมาย (users…audit) สำหรับ D1 โดยยังไม่เขียน migration รันได้

**เป้าหมาย:** เอกสาร ERD เป้าหมายที่เทียบของเดิม 001–003 กับ brief พร้อม constraints/indexes สำหรับ idempotency และกันซ้ำโค้ด
**ข้อห้าม:** ห้ามสร้าง/รัน migration ใหม่; ห้ามแก้ schema จริงในรีโป
**เกณฑ์ผ่าน:** มี docs/architecture/erd-target.md ครบ entity ใน brief + ตารางเทียบของเดิม + unique/index ที่จำเป็น + ขอบเขต Sprint 1 สำหรับ chat/notifications
**Git:** commit docs ท้องถิ่น; ห้าม push docs
```
