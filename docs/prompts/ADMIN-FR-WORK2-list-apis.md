# [TASK] ADMIN-FR-WORK2 — Admin list APIs (NFR-1)

ระบบ: ASTRA / NOTT  
Current Task: **ADMIN-FR-WORK2**  
ฐาน: `main` @ `6b37c4a`  
Branch: `feat/admin-fr-work2-list-apis`

**เป้าหมาย:** แบ่งหน้า+กรองที่เซิร์ฟเวอร์สำหรับออเดอร์ / รายละเอียด+reveal / ลูกค้า / สินค้า  
**FR:** O2, O3, O4, C1, C2, P1 · NFR-1, NFR-2 (reveal audit), NFR-3  
**ข้อห้าม:** ห้ามตัด blob `GET /api/admin` (2.5 เลื่อน) · ห้ามงาน 3–5 · ห้าม deploy · ห้าม qa:cloud ร้านจริง  
**เกณฑ์ผ่าน:** เทสต์ pagination/filter/RBAC/reveal-audit · `npm test` + `test:e2e` · รายงาน Mark · PR  
**Features:** `adminOrdersApi`, `adminCustomersApi`, `adminProductsApi` ใน `/api/me` + health  
