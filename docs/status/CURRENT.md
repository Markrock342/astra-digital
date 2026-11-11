# สถานะปัจจุบัน (CURRENT)

อัปเดตล่าสุด: 2026-11-11

## ลิงก์ลูกค้า 10 พ.ย. 2026

- ปิด GitHub workflow `Test and deploy demo` แล้ว สถานะ `disabled_manually` เพื่อไม่ให้ `main` ทับร้านบนเซิร์ฟเวอร์
- อัปโหลดจากเครื่องนี้แล้ว: Worker `astra` เวอร์ชัน `55439134-5d32-404c-9a1f-9f267935306a` และ Pages `https://astra-demo-133.pages.dev`
- ตรวจแล้ว: `mode` เป็น `live`, สินค้า 0 รายการ, ชื่อร้าน “ร้านค้า”, คนไม่ล็อกอินเรียกอันดับผู้ซื้อได้ 401
- หน้าแรกยังมีฮีโร่ แผงสถิติ และ “สร้างด้วย ASTRA” งานนี้ยังเป็นของแบงค์

## สัญญา API ร้านกลาง

- เขียนที่ [api-contract-shop.md](../architecture/api-contract-shop.md)
- SOW ที่ล็อกแล้ว: [SOW-FIFACORP-FINAL-20261110.md](../prompts/SOW-FIFACORP-FINAL-20261110.md)
- งานมาร์คกับน็อต: [TASKS-MARK-NOTT-20261110.md](../prompts/TASKS-MARK-NOTT-20261110.md)
- `GET /api/rankings/buyers` ต้องเป็นผู้ดูแล คนไม่ล็อกอินได้ 401 ลูกค้าได้ 403
- 11 พ.ย. (local ยังไม่ deploy): อันดับผู้ซื้อรับ `period=day|week|month|all` และ `limit` 1–50 ค่าไม่ถูกต้องตอบ 400
- กฎอันดับนี้ขึ้นกับ Worker ชุด `55439134-5d32-404c-9a1f-9f267935306a` แล้ว ยังไม่ได้ตรวจกรณีลูกค้าล็อกอินได้ 403 บนเซิร์ฟเวอร์

## ร้านโครงสำเร็จรูป

- ทุกคำขอ API ใช้ Durable Object ชุดเดียวชื่อ `shop`
- โหมด live ไม่เปิดเครดิตทดลอง และไม่ส่งโค้ดก่อนมีการชำระเงิน
- เปิดครั้งแรกไม่มีสินค้าตัวอย่าง ชื่อร้านเริ่มที่ “ร้านค้า” ไลน์และอีเมลว่าง ให้กรอกจากหลังบ้าน
- ช่องทางจ่ายและโดเมนยังไม่เชื่อม

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
| โปรเจกต์ | ASTRA DIGITAL — **NOTT = Database** |
| Roadmap | [NOTT-DB-ARCHITECTURE.md](../roadmaps/NOTT-DB-ARCHITECTURE.md) (**Approved**) |
| Phase | 0–5 Review Pack บน branch `feat/nott-database-audit` |
| ฐานโค้ดต้นทาง | `main` @ `9eebc6f` |

## ส่งมอบรอบนี้ (docs only)
- [x] `docs/database/DB_AUDIT.md`
- [x] `docs/database/ERD.md`
- [x] `docs/database/SCHEMA_PROPOSAL.md`
- [x] `docs/database/DATA_INTEGRITY.md`
- [x] `docs/database/MIGRATION_PLAN.md`
- [x] `docs/database/DB_TEST_PLAN.md`
- [x] PR → Mark Review: https://github.com/Markrock342/astra-digital/pull/1
- [x] รายงานส่งมาร์ค: [../database/MARK_HANDOFF_REPORT.md](../database/MARK_HANDOFF_REPORT.md)

## ยังไม่ทำ (ตามโจทย์)
- Deploy migration / เปลี่ยน production DB
- แก้ `004_commerce_ops.sql`
- แก้ Worker ฐานร้านเดียว (รอ Mark ล็อก)
- SlipOK / Gateway / Frontend

## Blockers ส่ง Mark
1. ~~ยืนยันฐานร้านเดียวบน DO~~ ทำแล้วใน `141ffad` (DO ชื่อ `shop`) — ร้านเริ่มจากฐานว่าง ไม่ย้ายข้อมูลจาก `client:*`  
2. ล็อกตารางถัดไป (payment_events / order_items / categories / cart)  
3. แช่แข็ง D1 จนกว่ามี cutover plan
