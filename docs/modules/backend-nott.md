# Module: Backend / NOTT (Ownership)

แผนรายสัปดาห์: [../requirements/NOTT_BANK_MARK_WEEKLY_TH.md](../requirements/NOTT_BANK_MARK_WEEKLY_TH.md) · [../roadmaps/NOTT-WEEKLY.md](../roadmaps/NOTT-WEEKLY.md)

## สถานะปัจจุบันของฟีเจอร์นี้ (Current Status)

- Ownership ล่าสุด: **NOTT = Database** · Mark = Architecture / API Contract
- Review Pack DB-01…05: [../database/README.md](../database/README.md) (ยังไม่ deploy migration)
- API Phase 0–C ก่อนหน้ายังอยู่; schema DO ถึง `004_commerce_ops.sql`
- ข้อเสนอค้างล็อก: ฐานร้านเดียวบน DO · ไม่ย้าย D1

## งานที่เพิ่งทำเสร็จ (Recently Completed)

- `GET /api/products/:id` — ไม่มี secret/โค้ด
- `GET /api/staff/orders` · STAFF/ADMIN ดูออเดอร์ได้โดยไม่ได้รับโค้ด
- `GET /api/payment-channel` · `POST /api/admin/payment-channel` (sandbox only; บล็อก slipok/gateway)
- จ่ายสำเร็จ → ส่งโค้ดเจ้าของ + บันทึก `payments` + แจ้งเตือน
- คิวพรีออเดอร์ · แชทในเว็บ · แจ้งเตือน · `GET /api/rankings/buyers`

## บันทึกการแก้บัค (Bug & Troubleshooting Log)

- INSERT ledger แบบ VALUES พังหลังเพิ่มคอลัมน์ `kind` → named columns + DEMO_CREDIT
- PRAGMA foreign_keys ใน transaction ไม่มีผล → ปิด FK นอก transaction ก่อน apply 004
- pay รับเฉพาะ `unset`/`sandbox` แม้ admin ตั้ง slipok หลังมี env ยืนยันแล้ว (ยังไม่มี connector จริง)

## สิ่งที่ยังค้างอยู่และปัญหาที่ทราบ (Pending & Known Issues)

- งาน Bank/Mark UI นอกรีโป / นอก ownership
- SlipOK/Gateway connector จริงยังไม่ทำ — รอลูกค้าเลือก
- payment_channel เริ่มต้นยัง `unset` จนกว่า admin เปิด sandbox

## Checklist งานต่อไป (Next Steps)

1. รอ Client เลือกช่องทางจ่าย → ออกแบบ connector จริง
2. ประสาน Bank/Mark ผูก UI กับ API ชุดนี้
3. (ถ้าสั่ง) push โค้ดขึ้น remote — ไม่ push docs/schema
