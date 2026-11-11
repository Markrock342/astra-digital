# Changelog (กระบวนการทีม)

บันทึกการเปลี่ยนแปลงระดับโฟลว์/กฎ — ไม่แทนที่ประวัติผลิตภัณฑ์ในเอกสารอื่น

## 2026-11-11
- อันดับผู้ซื้อกรองได้ วัน/สัปดาห์/เดือน/ทั้งหมด ตามเวลาไทย นับพรีออเดอร์ที่จ่ายแล้ว ไม่ส่ง user id และ limit ผิดตอบ 400 แทน 500 — [api-contract-shop.md](architecture/api-contract-shop.md)
- หลังบ้านเรียงคำสั่งซื้อตามเวลาสร้างล่าสุด (เดิมเรียงตาม customer_id)
- Merge PR ของน็อต #12 (แชท rate limit/throttle/ปิดห้อง) #13 (URI ผิดตอบ 400) #14 (staff orders แบ่งหน้า) และ #3 (origin ตอน dev) · อันดับผู้ซื้อนับพรีออเดอร์ DELIVERED ด้วย · `npm test` 45 ผ่าน · ยังไม่ deploy
- ตัดสิน: ออกเลขคิวหลังจ่ายเงิน และหน้าร้านแสดงสต็อกแค่ มี/เหลือน้อย/หมด (API ส่ง stock ไม่เกิน 10 + stockStatus) — [api-contract-shop.md](architecture/api-contract-shop.md)
- เพิ่ม `tests/use-cases.test.mjs` 7 use case ผ่าน HTTP (ซื้อ, พรีออเดอร์+คิว, สต็อก, ของหมด, แชท/แจ้งเตือน, ranking, โหมด live) · Playwright 3/6 ไม่ผ่านเพราะ e2e ยังหาปุ่มบัญชีทดลองที่ถูกเอาออกใน `141ffad` ต้องเขียน e2e ใหม่สำหรับโหมด live
- PR #4–#11 และ #15 ส่งกลับให้น็อตแก้ก่อน (fingerprint ต้องใช้ HMAC, แผน rebuild ตาราง, ตัดคำว่า Approved ที่ยังไม่ได้อนุมัติ, openChatThread ยังยิงได้ไม่จำกัด)

## 2026-11-10
- ล็อก SOW จากสายลูกค้าเทียบใบเสนอราคา REV.06 — [SOW](prompts/SOW-FIFACORP-FINAL-20261110.md) และ [งานมาร์ค/น็อต](prompts/TASKS-MARK-NOTT-20261110.md)
- ล็อกสัญญา API ร้านฐานเดียว และปิดอันดับผู้ซื้อให้เฉพาะผู้ดูแล — [api-contract-shop.md](architecture/api-contract-shop.md)

## 2026-11-09
- ตรวจงานเพื่อน: GitHub ยังไม่มีงานใหม่หลังแผน; build/tests 40 ผ่าน ตรวจซ้ำพบ 3 P2 ใน NOTT API — [ผล review](modules/peer-review-20261109.md); เก็บหลักฐาน memory DB แยก ไม่แก้ production
- Owner ขอชุดแจกงานแยกคนจนจบ Phase 2: [TEAM แผนกลาง](team-phase2/00-START.md) + MARK/NOTT/BANK รวม 34 Tasks + gate ตรวจรับ พร้อม HTML/Markdown/CSV และ ZIP ส่งเพื่อน; ไม่เปลี่ยน production หรือเปิด provider
- Hotfix `9eebc6f`: migration 004 อัปเกรด SQLite ที่มีข้อมูลได้โดยไม่ reset; native/workerd regression + rollback; tests 40 + browser 6 + cloud QA 37 ผ่าน; GitHub run 42615156072 deploy สำเร็จ — [recovery](modules/migration-004-recovery.md)
- Owner Approve Roadmap DB · ส่ง Review Pack DB-01…05 ที่ [database/README.md](database/README.md) บน `feat/nott-database-audit` (ยังไม่ deploy migration)
- ร่าง Roadmap Database Ownership (DB-01…05) — [roadmaps/NOTT-DB-ARCHITECTURE.md](roadmaps/NOTT-DB-ARCHITECTURE.md); sync main `9eebc6f`
- NOTT Phase A–C: product detail / staff orders / payment_channel sandbox / code delivery / queue / chat / notifications / buyer ranking; `npm test` 37 passed
- NOTT W1: migrate `.data/commerce.sqlite` ถึง 003+004 (Staff/payments/queue/chat/notifications/DEMO_CREDIT); `npm test` 29 passed; Cloudflare/D1 dual-track ตามแผนรายสัปดาห์
- Phase 5 ปิด Sprint 1 NOTT: [status/NOTT-SPRINT1-DELIVERY.md](status/NOTT-SPRINT1-DELIVERY.md) · Self-QC `npm test` 27 passed
- Phase 4 เสร็จ: Sandbox PaymentAdapter + D1 fulfillment/allocations; SlipOK/Gateway ยังบล็อก; `npm test` 27 passed
- Phase 3 เสร็จ: D1 catalog API (`/api/d1/products`) + `@astra/contracts` + [api-contract-catalog.md](modules/api-contract-catalog.md); `npm test` 22 passed; Phase 4 ยังล็อก
- Phase 2 M2.1 เสร็จ: `server/auth-policy.mjs` + domain guards; `npm test` 20 passed; Phase 3–4 ยังล็อก
- Phase 1 M1.1 เสร็จ: dual-track D1 (`db/migrations/0001_init.sql`) + `npm run db:migrate:local` ผ่าน; ดู [architecture/erd-sprint1.md](architecture/erd-sprint1.md)
- Owner ปลดล็อก Phase 1 (หลังเคยเลือก B); Phase 2–4 ยังล็อก
- Owner เลือก **B**: ล็อกโค้ด DB/API/Payment ไว้ก่อนหลัง Approve design Phase 0 — รอคำสั่งปลดล็อก Phase 1 ในภายหลัง
- Owner Approve ชุด design Phase 0 (0.3.3 ข้อ 1: ERD + Payment/Fulfillment)
- Owner Approve Auth/RBAC (0.2.2); ร่าง ERD (0.3.1) + Payment/Fulfillment (0.3.2)
- Task **0.2.1** ร่าง Auth/RBAC design — [architecture/auth-rbac.md](architecture/auth-rbac.md)
- Task **0.1.2** เสร็จ / Milestone 0.1 ปิด: Gap Map — [modules/nott-gap-map.md](modules/nott-gap-map.md)
- Task **0.1.1** เสร็จ: inventory backend ของจริง — [modules/nott-backend-inventory.md](modules/nott-backend-inventory.md); Roadmap Approved โดย Owner
- ร่าง Roadmap NOTT Sprint 1 ตามลำดับความสำคัญ Phase 0–5 — [roadmaps/NOTT-SPRINT1.md](roadmaps/NOTT-SPRINT1.md)
- Owner ยืนยัน: รีโปเดียว ASTRA (FIFA = ผู้ว่าจ้าง); เอกสารหาในรีโปนี้; ยึด brief D1; ลำดับเดินเริ่มจาก design ก่อนลง DB/API/Payment
- Intake LCS×FIFA prompt pack: ย้ายไป [requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md](requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md); ขอบเขตทีมนี้คือ **NOTT** เท่านั้น — ดู [modules/backend-nott.md](modules/backend-nott.md)
- เพิ่มโครงทำงานแบบ Owner + **Agent (PM+Coder รวมแชทเดียว)**: `.cursor/rules/` + `docs/process/*` + สารบัญ [index.md](index.md) — **ไม่ลบ**เอกสารเดิมใน `docs/`
- กติกาเดิมคงไว้: commit หลังงานพร้อมหลักฐาน; **ห้าม push docs/schema**; push โค้ดเมื่อ Owner สั่ง; security-first; วัดผลด้วยหลักฐานเทสจริง; sub-agent สำหรับวิจัย
