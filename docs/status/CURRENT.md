# สถานะปัจจุบัน (CURRENT)

อัปเดตล่าสุด: 2026-11-09

## ผลตรวจงานเพื่อนล่าสุด

- ตรวจ GitHub แล้ว remote main ยังเป็น 9eebc6f มี branch เดียวและไม่มี PR ไม่พบงานใหม่หลังแจกแผน
- งาน NOTT ล่าสุดที่รวมแล้วคือ 7705b29 และเอกสาร 710a818 เวลา 16:02 น. วันที่ 9 พฤศจิกายน 2026
- build และ tests 40/40 ผ่าน แต่ reproduction เพิ่มพบ 3 P2: payment active flag ไม่บังคับ, แชทแรกไม่ notify staff, fractional ranking limit ทำ 500
- รายละเอียดและสิ่งที่ส่งกลับให้แก้: [peer review](../modules/peer-review-20261109.md) ยังไม่ได้แก้/merge/deploy findings เหล่านี้

## แผนแจกงานทีมที่ Owner ขอ

- จัดชุด TEAM-P0 ถึง TEAM-P2 รวม 34 Tasks: มาร์ค 12 น็อต 12 แบงค์ 10 พร้อม dependency checklist เกณฑ์ผ่าน และหลักฐาน
- เป้าหมายร้านถาวรหนึ่งร้านข้ามเครื่อง → ฟังก์ชันตาม scope → UAT; แยก G2A sandbox-ready และ G2B production go-live
- แผนรวมทีมนี้เพิ่มจาก roadmap NOTT เดิม ไม่ใช่การรัน implementation ใหม่หรือย้ายฐานแล้ว
- อ่าน [แผนกลาง](../team-phase2/00-START.md) และ [ตรวจรับ](../team-phase2/04-ACCEPTANCE.md)
- Deliverable ในเครื่อง: `/Users/code/Projects/nursejob/output/astra-team-phase2-20261109` และ ZIP ข้างโฟลเดอร์นี้; Markdown ต้นฉบับอยู่ `docs/team-phase2/`

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
