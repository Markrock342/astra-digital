# Task Spec — Phase 4 Payment + Fulfillment

```text
[TASK]
ระบบ: ASTRA DIGITAL — NOTT Backend
แผนงาน: Phase 4 → Milestone 4.1 + 4.2
Current Task: 4.1.1–4.2.3 — PaymentAdapter (sandbox only) + idempotent allocation บน schema D1 + เอกสาร

**เป้าหมาย:** มี adapter interface + SandboxPaymentAdapter; fulfillment ใช้ payments/allocations; เทส race/retry; ห้าม activate SlipOK/Gateway
**ข้อห้าม:** ห้ามใส่ credentials provider จริง; ห้ามส่ง key ก่อน payment SUCCEEDED
**เกณฑ์ผ่าน:** โค้ด adapter + fulfill; npm test ผ่านเคสใหม่; docs อัปเดต DONE/NOT DONE/BLOCKERS
**Git:** แยก commit โค้ด vs docs; ห้าม push docs
```
