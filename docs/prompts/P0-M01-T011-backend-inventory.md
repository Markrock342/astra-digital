# Task Spec — P0-M01-T011

```text
[TASK]
ระบบ: ASTRA DIGITAL — NOTT Backend
แผนงาน: Phase 0 → Milestone 0.1
Current Task: 0.1.1 - สำรวจ backend/schema/API ที่มีในรีโปและสรุป inventory

**รายละเอียดเทคนิค:**
- **เป้าหมาย:** มีเอกสาร inventory ของของจริงในรีโป (schema, API routes, domain capabilities, runtime) โดยไม่เดาและไม่แก้โค้ดระบบหลัก
- **ศัพท์ที่ถูกต้อง:** Durable Object SQLite (ของปัจจุบัน), D1 (เป้าหมาย brief), domain core, api-handler, workspace/astra_space
- **Flow:** อ่านไฟล์จริง → ลิสต์ตาราง/endpoint/ความสามารถ → เขียน docs/modules/nott-backend-inventory.md → ลิงก์จาก index + อัปเดต CURRENT
- **ไฟล์/โมดูลที่เกี่ยวข้อง:** server/migrations/*.sql, server/domain.mjs, server/api-handler.mjs, server/http.mjs, cloud/worker.mjs, wrangler.jsonc, pages/wrangler.jsonc, docs/architecture.md, docs/feature-matrix.md, src/api.ts (client calls เป็นหลักฐานฝั่งเรียก)
- **Input / Output:** Input = ซอร์สในรีโป; Output = inventory markdown ที่อ้างพาธจริง
- **Security:** ห้ามแปะ secret/ค่า .dev.vars; บันทึกว่า key/inventory ถูกเข้ารหัสหรือซ่อนอย่างไรจากของที่มี
- **Constraints / Error Handling:** ถ้าไม่พบของที่ brief ชื่อไว้ ให้เขียนว่า "ไม่มีในรีโป" ไม่สร้างของปลอม
- **Config:** ไม่เปลี่ยน env/secrets
- **ข้อห้าม:** ห้ามทำ Task 0.1.2 หรือโค้ด DB/API/Payment; ห้ามแก้ business logic
- **เกณฑ์ผ่าน:**
  1. มีไฟล์ inventory ครบหมวด: runtime, schema tables, API routes, domain ops, tests ที่เกี่ยวข้อง
  2. ทุก endpoint/ตารางอ้างจากไฟล์จริง
  3. อัปเดต docs/index.md + docs/status/CURRENT.md + modules/backend-nott.md
- **หลักฐานที่ต้องมี:** รายการไฟล์ที่เปลี่ยน; คำสั่งสำรวจที่ใช้ (rg/read); commit hash ท้องถิ่น
- **ชั้นเทสที่บังคับ:** ไม่บังคับ unit — งานเอกสาร; ตรวจความครบด้วยการเทียบรายการ route จาก api-handler กับ inventory
- **Git:** commit docs หลังผ่านเกณฑ์; ห้าม push docs; ห้าม push จนกว่า Owner สั่ง
```
