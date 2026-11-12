# สถานะปัจจุบัน (CURRENT)

อัปเดตล่าสุด: 2026-11-12

## Admin FR W5 UP-1 — อัปโหลดรูปสินค้า (กำลังทำ / PR)
- branch `feat/admin-fr-w5-up1-product-images` จาก main หลัง #37/#38
- file-store + MIG-008 + product images APIs + `uploads` flag · ห้ามแตะ src/ · ห้าม UP-2/3 ใน PR นี้
- รายงาน [MARK_REPORT_ADMIN_FR_W5_UPLOADS](../database/MARK_REPORT_ADMIN_FR_W5_UPLOADS.md)
- **ห้าม deploy**

## Hotfix DO `run().changes` — merge แล้ว
- PR #37 ใน main · รายงาน [MARK_REPORT_DO_SQL_RUN_CHANGES](../database/MARK_REPORT_DO_SQL_RUN_CHANGES.md)

## Admin FR — งาน 5 FR-O5 (อยู่ใน hotfix ด้านบน)
- รายงาน [MARK_REPORT_ADMIN_FR_WORK5_O5](../database/MARK_REPORT_ADMIN_FR_WORK5_O5.md)

## Admin FR — งาน 4 + polish + round2 + bank merge แล้ว
- #31 / #32 / #34 / #36 · `main` @ `3549674` · รายงาน [MARK_REPORT_ADMIN_FR_WORK4](../database/MARK_REPORT_ADMIN_FR_WORK4.md)


## Admin FR — งาน 3 + FR-P3 + หน้าจอ Mark merge แล้ว
- #27 / #28 / #29 ใน `56f4603` · รายงาน [MARK_REPORT_ADMIN_FR_WORK3](../database/MARK_REPORT_ADMIN_FR_WORK3.md) · [MARK_REPORT_ADMIN_FR_P3](../database/MARK_REPORT_ADMIN_FR_P3.md)

## Admin FR Backend — งาน 2 merge แล้ว (PR #26 · ยังไม่ deploy)
- merge ใน `7fb79f9` · รายงาน [MARK_REPORT_ADMIN_FR_WORK2](../database/MARK_REPORT_ADMIN_FR_WORK2.md)

## Deploy 12 พ.ย. — งวด 2 (ล่าสุด)
- Worker `2aa1ce33` + Pages `302a34d2` จาก main `65e8cfe`
  - รวม PR #22, #24 (#23 เข้าผ่าน #24) และ PR #25
  - หน้าจอแชท / กระดิ่งแจ้งเตือน / อันดับผู้ซื้อ / ตั้งค่ารับเงิน (มาร์คทำแทนกลุ่ม B ของแบงค์)
- **โหมดทดสอบเปิดอยู่:** `ASTRA_TEST_PAYMENTS: "on"` ใน `wrangler.jsonc` ทำให้ health ขึ้น `mode: sandbox` ให้ลูกค้าเติมเครดิตทดลองและจ่ายเงินทดลองได้
  - ก่อนเปิดขายจริง: ลบค่านี้ แล้วล้างข้อมูลทดสอบ
- สถานะเทียบ SOW: [INSTALLMENT-2-READINESS](INSTALLMENT-2-READINESS.md)

## Admin FR Backend — งาน 1 merge แล้ว
- PR #25 merge · รวมใน deploy งวด 2 · รายงาน [MARK_REPORT_ADMIN_FR_WORK1](../database/MARK_REPORT_ADMIN_FR_WORK1.md)

## Deploy Worker 11 พ.ย. (ล่าสุด)
- Worker `15392db2` จาก main (`009ef0a` + worker fix) + Pages `40ae3b40` — **migration 005 รันบนร้านจริงแล้ว** · `features` ทั้งคู่ `true` (ปุ่มส่งของพรีออเดอร์ + นำเข้าไอดี/รหัสผ่านเปิดใช้)
- แอดมินล็อกอินด้วย `admin` (หรือ `admin@astra.local`) · รหัสตั้งชั่วคราวตามที่มาร์คสั่ง **ต้องเปลี่ยนก่อนเปิดขายจริง** (`npx wrangler secret put ASTRA_ADMIN_PASSWORD`, อย่างน้อย 8 ตัว)
- ตรวจหลังขึ้น: health/หน้าร้าน/หลังบ้าน 200, ไม่ล็อกอินเรียก ranking/admin 401, ล็อกอินแอดมินผ่านแล้ว logout

## ISSUE-18 DB-005 APIs — PR #20 merge แล้ว (ยังไม่ deploy)
- น็อตเปิด PR: import `items[{loginId,password}]`, `POST /api/admin/reservations/:id/deliver`, owner อ่าน credentials หลัง DELIVERED, คิวซ่อน DELIVERED, `features` ทั้งคู่ `true`, ขยาย `inventory_available` ให้มี `reservation_id`, MU3 เข้ม
- **ห้าม deploy** — มาร์ครีวิว/merge แล้วค่อยขึ้นพร้อมกันกับ schema 005
- คงการแยก codes/credentials ของ `035349d` และประวัติ deploy ด้านล่าง

## หน้าร้าน ASIA EXTRA ขึ้นแล้ว (11 พ.ย.)
- Pages `2ac9bcde` จาก commit ล่าสุดบน main: โลโก้ ASIA EXTRA, สองภาษา TH/EN (มี animation ตอนสลับ), แผงเลือกสีธีม (โหมดสว่าง/มืดตามเครื่อง), animation หน้าร้าน
- deploy เฉพาะ Pages — Worker ยังเป็น `184cd5a1` จึงยังไม่รัน migration 005 · โดเมนของ Worker ยังเสิร์ฟหน้าเก่าจนกว่าจะ deploy Worker
- โดเมน asiaextra.xyz ยังไม่ต่อ · PR #2 ของแบงค์จะชนกับงานนี้

## MIG-005 merge แล้ว (ยังไม่ deploy)
- PR #19 ของน็อต merge เข้า main แล้ว: rebuild `inventory` (ไอดี/รหัสผ่านเข้ารหัส, ธง legacy, `reservation_id`) และ `reservations` (DELIVERED, `delivered_at`/`delivered_by`), index `orders/reservations(status, created_at)`
- มาร์คแก้หลัง merge: โค้ดแบบเก่ายังอยู่ใน `codes` เท่านั้น คู่ไอดี/รหัสผ่านอยู่ใน `credentials` (เดิมของชิ้นเดียวโผล่ทั้งสองที่)
- ตรวจแล้ว: unit 57/57, Playwright 10/10, อัปเกรดฐาน 004 ที่มีพรีออเดอร์จ่ายแล้ว + ออเดอร์ส่งแล้ว + payments อ้าง reservation ผ่าน ไม่มี FK พัง
- **ยังไม่ deploy** — ขึ้นพร้อม deliver API + import คู่ + flip `features` ในงานถัดไปของน็อต
- ค่าที่ล็อก: คิว `after_payment` รวมทั้งร้าน · ส่งของ `POST /api/admin/reservations/:id/deliver` (ADMIN) · legacy = login=โค้ดเดิม, password=""

## Deploy 11 พ.ย. 2026

- **ล่าสุด:** Worker `184cd5a1-7f75-4781-89bb-31c7f9ee7fac` + Pages `0fc02803` จาก `0b97c90` — รวม PR น็อตรอบ 2 (#11 #16) และหน้าหลังบ้าน DB-005 (กระดานคิวใช้ได้, ปุ่มส่งของ/นำเข้าคู่ปิดรอ flag) · live smoke 26/26 · `features` ทั้งคู่ `false`
- ก่อนหน้า: Worker `ff238c13` (merge รอบ 2), `2be5f51d` (ranking/สต็อก)

- Worker `astra` เวอร์ชัน `2be5f51d-0881-47d7-8f27-c5127afd741c` และ Pages `https://astra-demo-133.pages.dev` (deployment `b4b0cd27`) จาก commit `346a1b1`
- ขึ้นแล้ว: ranking แบบมีช่วงเวลา, แชท rate limit/throttle/ปิดห้อง, URI ผิดตอบ 400, staff orders แบ่งหน้า, หน้าร้านแสดงสต็อกแค่ มี/เหลือน้อย/หมด
- ตรวจร้านจริงแบบอ่านอย่างเดียว 26/26 ผ่านทั้งสองโดเมน (mode live, สิทธิ์ 401/403, URI 400, cross-site 403, ไม่มีรหัสในแคตตาล็อก) ไม่ได้สร้างบัญชีหรือข้อมูลบนร้าน
- ร้านยังมีสินค้า 0 รายการ จึงยังไม่ได้เห็นการซ่อนสต็อกบนเครื่องจริง แต่ use case test ในเครื่องครอบคลุมแล้ว
- `scripts/cloud-qa.mjs` ยังเป็นชุดสำหรับโหมด demo ห้ามรันกับร้านจริง

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

