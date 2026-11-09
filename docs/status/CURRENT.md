# สถานะปัจจุบัน (CURRENT)

อัปเดตล่าสุด: 2026-11-09

## ตำแหน่งงานปัจจุบัน
| ระดับ | ค่า |
|-------|-----|
| โปรเจกต์ | ASTRA DIGITAL — ownership **NOTT** |
| Roadmap | [NOTT-WEEKLY.md](../roadmaps/NOTT-WEEKLY.md) |
| Phase / Milestone / Task | **W1 เสร็จ** — ถัดไป W2–3 API สินค้า/ออเดอร์/สิทธิ์ |

## สรุปรอบนี้ (สัปดาห์นี้ — น็อต)
- เปิด `.data/commerce.sqlite` ผ่าน `npm run migrate` ได้ถึง **003 + 004**
- สคีมาใหม่: payments, payment_channel (unset), STAFF, queue_number, chat, notifications, ledger.kind=DEMO_CREDIT
- คงกันซื้อซ้ำ / ราคา satang / โค้ดไม่โผล่ใน products API
- จุดเชื่อมชำระช่องทางเดียวยัง **unset/ไม่ active** — ห้าม SlipOK/Gateway
- โฮสต์เป้า: Cloudflare (dual-track กับ local `.data`)

หลักฐาน: `npm test` **29 passed** · `npm run migrate` แสดง 001–004 · `db:migrate:local` apply 0002 ✅

## ที่เสร็จแล้ว
- [x] NOTT Sprint 1 เดิม (ปิดแล้ว)
- [x] W1 local migrate + schema ops

## กำลังทำ / รอ
- [ ] W2–3: API สินค้า ออเดอร์ สิทธิ์ (รอสั่งหรือเดินต่อ)
- [ ] Mark ถามช่องทางจ่าย / Bank โครงหน้าร้าน (นอก ownership)

## Blockers
- เปิด gateway จริง รอ Client เลือกช่องทาง
