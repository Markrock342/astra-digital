# Task Spec — Phase 3 Catalog + Contracts

```text
[TASK]
ระบบ: ASTRA DIGITAL — NOTT Backend
แผนงาน: Phase 3 → Milestone 3.1 + 3.2
Current Task: 3.1.1–3.2.2 — Product list/detail บน schema D1 + packages/contracts + เอกสาร API

**เป้าหมาย:** API อ่านแคตตาล็อกจาก schema D1 local ไม่รั่ว key; มี shared types; เอกสาร contract ระบุจุดรอ Mark/Bank
**ข้อห้าม:** ห้าม activate payment gateway; ห้ามตัด DO path; ห้ามคืน secret/fingerprint ของหน่วยที่ยังไม่ขาย
**เกณฑ์ผ่าน:**
1. GET list + detail ทำงานบน DB ที่ apply db/migrations
2. เทสพิสูจน์ JSON ไม่มี DEMO key / secret
3. มี packages/contracts
4. มี docs contract + npm test รวมเคสใหม่ผ่าน
**Git:** แยก commit โค้ด vs docs; ห้าม push docs
```
