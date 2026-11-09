# Task Spec — P0-M03-T032

```text
[TASK]
ระบบ: ASTRA DIGITAL — NOTT Backend
แผนงาน: Phase 0 → Milestone 0.3
Current Task: 0.3.2 - ร่าง PaymentAdapter + Fulfillment flow (proposed) โดยไม่ผูก provider จริง

**เป้าหมาย:** เอกสาร interface เดียว + flow การจ่าย/จัดส่งโค้ด แบบ idempotent โดยไม่ใส่ credentials และไม่ activate SlipOK/Gateway
**ข้อห้าม:** ห้าม implement adapter จริง; ห้ามใส่ API key/secret; ห้ามแก้โค้ด domain
**เกณฑ์ผ่าน:** มี docs/architecture/payment-fulfillment.md ครบ interface, states, idempotency, one-key-per-item, blockers รอ Client
**Git:** commit docs ท้องถิ่น; ห้าม push docs
```
