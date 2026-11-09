# Task Spec — P0-M02-T021

```text
[TASK]
ระบบ: ASTRA DIGITAL — NOTT Backend
แผนงาน: Phase 0 → Milestone 0.2
Current Task: 0.2.1 - ร่าง Auth/RBAC design (actors, roles, guards, session, demo-merchant boundary)

**รายละเอียดเทคนิค:**
- **เป้าหมาย:** มีเอกสาร Auth/RBAC design ที่อิงพฤติกรรมจริงในรีโป และกำหนดเกณฑ์สำหรับ Phase 2 implement โดยยังไม่เขียนโค้ด auth ใหม่
- **ศัพท์ที่ถูกต้อง:** CUSTOMER, ADMIN, astra_session, astra_space, requireUser, requireAdmin, allowDemoAdmin, presentation workspace
- **Flow:** อ่าน domain/api-handler/worker + เทสสิทธิ์ → เขียน docs/architecture/auth-rbac.md → ลิงก์ docs → รอ Owner ที่ Task 0.2.2
- **ไฟล์ที่เกี่ยวข้อง:** server/domain.mjs, server/api-handler.mjs, cloud/worker.mjs, tests/commerce.test.mjs, docs/modules/nott-backend-inventory.md
- **Input / Output:** Output = auth-rbac.md ครบ actors/roles/flows/guards/negative cases/out of scope
- **Security:** Never trust client role/price; session hash only; demo-merchant จำกัดขอบเขต
- **ข้อห้าม:** ห้าม implement auth ใหม่ใน Task นี้; ห้ามแตะ DB/API/Payment code
- **เกณฑ์ผ่าน:** เอกสารมี (1) actors/roles (2) authn flows (3) authz matrix ต่อ API กลุ่มหลัก (4) demo-merchant/workspace boundary (5) เคสเชิงลบบังคับตอน Phase 2 (6) สิ่งที่ยังไม่ทำใน Sprint 1
- **หลักฐาน:** ไฟล์ docs + commit hash; อ้างพาธโค้ดจริง
- **ชั้นเทส:** ไม่รันโค้ดใหม่ — อ้างเทสที่มีเป็นหลักฐานพฤติกรรมปัจจุบัน
- **Git:** commit docs ท้องถิ่น; ห้าม push docs
```
