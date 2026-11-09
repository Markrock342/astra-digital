# Task Spec — P1-M11-T111

```text
[TASK]
ระบบ: ASTRA DIGITAL — NOTT Backend
แผนงาน: Phase 1 → Milestone 1.1
Current Task: 1.1.1 - ตัดสินโครงสร้างโฟลเดอร์ migration เป้าหมาย (D1) โดยไม่ทำลายของเดิม

**เป้าหมาย:** มี ADR + โครง `db/` สำหรับ D1 ตาม brief โดยคง `server/migrations/` ของ DO/Node ไว้ครบ
**ข้อห้าม:** ห้ามลบ/ย้ายทับ server/migrations; ห้ามตัด Durable Object จาก wrangler หลักใน Task นี้; ห้ามใส่ secrets
**เกณฑ์ผ่าน:**
1. มี docs/architecture/adr-d1-migration-path.md
2. มี db/migrations/ (+ README) สอดคล้อง brief ชื่อ 0001_*
3. มีวิธี apply local แยกจาก Worker deploy ปัจจุบัน (config แยก)
4. อัปเดต CURRENT / backend-nott / index
**หลักฐาน:** รายการไฟล์ + commit; ถ้ามีคำสั่ง wrangler ตรวจ config ให้บันทึกผล
**Git:** แยกได้ทั้ง docs และโค้ดโครง db; ห้าม push docs; push โค้ดเมื่อ Owner สั่ง
```
