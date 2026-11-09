# สถานะปัจจุบัน (CURRENT)

อัปเดตล่าสุด: 2026-11-09

## Hotfix ที่ Owner อนุมัติ: migration 004 / 503

- โค้ด `9eebc6f` push แล้ว; build ผ่าน, business/runtime tests 40 ผ่าน, browser workflows 6 ผ่าน
- ตรวจอัปเกรดฐานเดิมพร้อม session/ออเดอร์/ยอด/โค้ดเข้ารหัส และ rollback เมื่อ FK ผิด
- GitHub run 42615156072 ผ่านทั้ง build/deploy; live stamp ตรง `9eebc6f`; API และหน้าร้าน/หลังบ้านกลับมาตอบปกติ
- เว็บจริงผ่าน cloud QA 37/37: ซื้อ TEST/รับโค้ด/reload, stock concurrency, idempotency, workspace isolation และ motion/mobile
- รายละเอียด: [migration-004-recovery.md](../modules/migration-004-recovery.md)

## ตำแหน่งงานปัจจุบัน
| ระดับ | ค่า |
|-------|-----|
| โปรเจกต์ | ASTRA DIGITAL — ownership **NOTT** |
| Roadmap | [NOTT-WEEKLY.md](../roadmaps/NOTT-WEEKLY.md) |
| Phase / Milestone / Task | **Phase A–C เสร็จ** — คิวถัดไปรอ Owner (Bank/Mark นอก scope / เปิด gateway จริง) |

## สรุปรอบนี้ (น็อต — ทำต่อเนื่อง)
- Phase 0 (W1 schema) คงเดิม: 001–004 + DEMO_CREDIT
- Phase A: `productDetail`, `staffOrders`, STAFF อ่านออเดอร์ได้แต่ไม่เห็นโค้ด
- Phase B: ช่องทางจ่ายเดียว (sandbox) · บล็อก SlipOK/Gateway · ส่งโค้ดหลังชำระ + แถว `payments`
- Phase C: คิวพรีออเดอร์ · แชท · แจ้งเตือน · อันดับผู้ซื้อ
- โฮสต์เป้า: Cloudflare (dual-track กับ local `.data`)

หลักฐาน: `npm test` **37 passed**

## ที่เสร็จแล้ว
- [x] NOTT Sprint 1 เดิม
- [x] W1 local migrate + schema ops
- [x] Phase A–C APIs ตามโจทย์น็อต

## กำลังทำ / รอ
- [ ] Mark ถามช่องทางจ่ายจริง / Bank โครงหน้าร้าน (นอก ownership โค้ด NOTT)
- [ ] เชื่อม SlipOK/Gateway หลังลูกค้าเลือก

## Blockers
- เปิด gateway จริง รอ Client เลือกช่องทาง
