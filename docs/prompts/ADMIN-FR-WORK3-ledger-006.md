# [TASK] ADMIN-FR-WORK3 — Ledger 006 + finance API + bugfixes

ระบบ: ASTRA / NOTT  
Current Task: **ADMIN-FR-WORK3**  
ฐาน: tip หลัง FR-P3 (`0712535`)  
Branch: `feat/admin-fr-work3-ledger-006`

**เป้าหมาย:** migration ledger เงินจริง + `GET /api/admin/transactions` + bugfixes จาก Mark  
**FR:** F2–F4, F9, F10 · NFR-3 (ซ่อน spent จาก STAFF)  
**ข้อห้าม:** ห้าม deploy · ห้าม qa:cloud ร้านจริง · ห้าม UI คืนเงิน/ถอน (งาน 5) · ห้ามตัด blob `/api/admin`  
**เกณฑ์ผ่าน:** migrate ซ้ำไม่พัง · summary ไม่ปน DEMO · STAFF 403 · bugfixes มีเทสต์ · `npm test` + `test:e2e` · รายงาน Mark · PR  
**Features:** `adminFinance: true` ใน `/api/me` + health  
