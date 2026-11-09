# Task Spec — P1-M11-T112

```text
[TASK]
ระบบ: ASTRA DIGITAL — NOTT Backend
แผนงาน: Phase 1 → Milestone 1.1
Current Task: 1.1.2 - เขียน migration เริ่มต้นจาก ERD ที่ Approve แล้ว + ตรวจ constraints/indexes บน local D1

**เป้าหมาย:** มี `db/migrations/0001_init.sql` ตาม erd-target + หลักฐาน apply สำเร็จด้วย `npm run db:migrate:local`
**ข้อห้าม:** ห้าม seed plaintext digital keys; ห้ามลบ server/migrations; ห้าม activate payment provider; ห้ามตัด DO จาก wrangler หลัก
**เกณฑ์ผ่าน:** ไฟล์ migration มีตารางตาม brief/ERD; apply local ผ่าน; บันทึกคำสั่ง+ผลใน docs
**Git:** commit โค้ด schema แยกจาก docs ได้; ห้าม push docs; push โค้ดเมื่อ Owner สั่ง
```
