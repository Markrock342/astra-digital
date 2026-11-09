# Module: Backend / NOTT (Ownership)

แผนรายสัปดาห์: [../requirements/NOTT_BANK_MARK_WEEKLY_TH.md](../requirements/NOTT_BANK_MARK_WEEKLY_TH.md) · [../roadmaps/NOTT-WEEKLY.md](../roadmaps/NOTT-WEEKLY.md)

## สถานะปัจจุบันของฟีเจอร์นี้ (Current Status)

- **W1 เสร็จ:** `.data/commerce.sqlite` มีไมเกรชันถึง `003` + `004_commerce_ops.sql`
- STAFF / payments / payment_channel / queue / chat / notifications / DEMO_CREDIT
- Cloudflare: Worker apply 004 · D1 local apply `0002_commerce_ops.sql`

## งานที่เพิ่งทำเสร็จ (Recently Completed)

- แก้ path `.data` บน Windows (`fileURLToPath`)
- migration 004 + เทส local-migrate
- ledger ระบุ `DEMO_CREDIT` ชัดเจน

## บันทึกการแก้บัค (Bug & Troubleshooting Log)

- INSERT ledger แบบ VALUES พังหลังเพิ่มคอลัมน์ `kind` → แก้เป็น named columns + DEMO_CREDIT
- PRAGMA foreign_keys ใน transaction ไม่มีผล → ปิด FK นอก transaction ก่อน apply 004

## สิ่งที่ยังค้างอยู่และปัญหาที่ทราบ (Pending & Known Issues)

- W2–3 ยังไม่เปิด API ชุดใหม่ตามลิสต์
- payment_channel ยัง unset / active=0
- งาน Bank/Mark นอกรีโปนี้

## Checklist งานต่อไป (Next Steps)

1. W2–3 API สินค้า ออเดอร์ สิทธิ์
2. W4–5 เปิดช่องทางจ่ายหลังลูกค้าเลือก
3. W6–7 คิว แชท แจ้งเตือน อันดับผู้ซื้อ
