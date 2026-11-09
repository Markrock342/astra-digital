# Task Spec — Phase 2 Auth (2.1.1–2.1.3)

```text
[TASK]
ระบบ: ASTRA DIGITAL — NOTT Backend
แผนงาน: Phase 2 → Milestone 2.1
Current Task: 2.1.1–2.1.3 (รวมในรอบเดียวหลังปลดล็อก Phase 2) — session verification, RBAC, เทสเชิงลบตาม auth-rbac.md

**เป้าหมาย:** มีชั้น auth-policy ชัดเจน ใช้ใน domain; ไม่รับ role จาก client; เคสเชิงลบตาม design ผ่านเทสจริง
**ข้อห้าม:** ห้ามทำ Phase 3 Product API / Phase 4 PaymentAdapter; ห้ามลบ DO path; ห้ามใส่ secrets
**เกณฑ์ผ่าน:**
1. มี server/auth-policy.mjs และ domain ใช้ guards จากนั้น
2. register/profile ไม่ตั้ง role จาก client (มีเทส register+role)
3. เทส expired session + unauthorized orders/ledger/admin ผ่าน
4. npm test ผ่าน; อัปเดต docs CURRENT/auth-rbac/backend-nott
**Git:** แยก commit โค้ด vs docs; ห้าม push docs; push โค้ดเมื่อ Owner สั่ง
```
