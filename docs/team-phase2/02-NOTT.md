# แผนงาน น็อต ตั้งแต่เตรียมงานจนจบ Phase 2

วันที่ 9 พฤศจิกายน 2026 | บทบาท Backend ฐานข้อมูล Auth API Payment และ Digital Code Delivery

เป้าหมายของคุณคือทำส่วนที่รับผิดชอบให้ต่อกับร้านจริงหนึ่งร้านและตรวจรับได้ อ่าน 00-START ควบคู่ไฟล์นี้ เริ่มที่ N0.1 ก่อน งานที่ของเดิมผ่านเกณฑ์แล้วให้แนบหลักฐานและนำกลับมาใช้ ไม่สร้างใหม่ซ้ำทั้งหมด

## ขอบเขตไฟล์และการร่วมงาน

พื้นที่หลักใน repo ปัจจุบัน: server/domain.mjs, server/api-handler.mjs, server/auth-policy.mjs, server/commerce.mjs, server/sqlite-migrations.mjs, server/migrations, server/d1, db/migrations, cloud/worker.mjs, packages/contracts และ tests

Repo: https://github.com/Markrock342/astra-digital | Local: /Users/code/Projects/nursejob/demos/astra-digital

ไฟล์ src/App.tsx src/styles.css src/api.ts src/types.ts packages/contracts และ config deploy เป็นจุดร่วม ต้องตกลงผู้แก้ใน PR ก่อน งานข้าม ownership ให้เจ้าของโมดูลร่วม review

## วิธีเริ่มและส่งงาน

- [ ] อ่าน scope decision log และ baseline ใน 00-START พร้อมกติกา repo ก่อนแก้
- [ ] ใช้ Node >=24.14 และ npm ci; npm run build; npm test เพื่อตรวจ baseline ไม่ใช้ข้อมูลลูกค้าหรือโค้ดจริงใน tests
- [ ] สร้าง branch codex/nott-task-id จาก origin/main ที่ตรวจแล้ว ไม่ merge local docs-only commits เข้า release โดยไม่ได้ตั้งใจ
- [ ] รับ Task แรกเพียงหนึ่งงาน ระบุ effort และสิ่งที่รอในบอร์ด
- [ ] ผ่านเกณฑ์แล้ว commit แยกโมดูล แนบผลตรวจและส่งให้มาร์ค review; main ที่ merge จะ deploy demo อัตโนมัติ
- [ ] เอกสารและ schema อยู่ภายใต้กติกา local-only ของ repo ปัจจุบัน ถ้างาน runtime ต้องใช้ schema ใหม่ให้ประสาน M0.3 ก่อน ห้ามปล่อย code อ้าง artifact ที่ CI ไม่มี

## ความหมายของสถานะ

ช่องว่างหมายถึงยังไม่ตรวจรับ ไม่ใช่ยืนยันว่าไม่มีโค้ด; DONE ต้องมีหลักฐานกับ commit ล่าสุด, BLOCKED ต้องระบุคน/คำตอบที่รอ ไม่ใช้เปอร์เซ็นต์แทนผลจริง

## TEAM-P0 ตรวจของเดิมและออกแบบข้อมูล

### N0.1 สำรวจ runtime schema และ API ที่มีจริง

แยกสิ่งที่เสร็จแล้วออกจาก scaffold และช่องว่าง

เริ่มเมื่อ: อ่าน 00-START baseline 9eebc6f

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ดึง origin/main ที่ผ่าน CI ตรวจ Node version npm ci build และ npm test ก่อนเปลี่ยนโค้ด; ห้าม reset ข้อมูลเดิม

- [ ] ทำ inventory ว่า endpoint แต่ละตัวมี code tests UI consumer และ deploy evidence อะไรบ้าง โดยเฉพาะ queue/chat/notifications/rankings

- [ ] แยก live DO SQLite, local Node SQLite และ D1 dual-track ให้ชัด; database_id placeholder ไม่ใช่ remote DB

- [ ] ตรวจ schema_migrations 001–004 ข้อจำกัด FK/index และ key derivation จาก object ID; เก็บ migration-upgrade regression ไว้

- [ ] ทำ ERD และตารางสถานะ existing/proposed ของ users sessions products variants orders inventory payments ledger reservations chats notifications audit; ไม่มีข้อมูล/keys จริงในเอกสาร


เกณฑ์ผ่าน: ชี้ฐานที่ live อ่าน/เขียนได้ถูกต้องและระบุงานที่ต้องเพิ่มโดยไม่รายงาน scaffold ว่า production

หลักฐานที่ส่ง: ERD + API inventory + baseline commands/results + gap list

### N0.2 ออกแบบร้านถาวรและการรักษาข้อมูล

ให้ลูกค้าหลายเครื่องเข้าร้านเดียวกันโดยไม่ทำโค้ดเดิมอ่านไม่ได้

เริ่มเมื่อ: N0.1; ออกแบบร่วมกับ M0.3 แล้วจึงปิด decision ด้วยกัน

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ออกแบบ stable shop identity และการเลือกร้านฝั่ง server ที่ไม่พึ่ง client workspace cookie เป็นเจ้าของร้านจริง

- [ ] แยก demo-merchant/demo customer ออกจาก production และกำหนด admin bootstrap/invite ที่ไม่เปิดสาธารณะ

- [ ] เสนอ mapping บัญชี ออเดอร์ และ inventory เดิม โดยรักษา ID/hash/ciphertext/ownership; ไม่ merge ผู้ใช้ชื่อซ้ำเงียบ ๆ

- [ ] ถ้าต้องย้าย DO→D1 หรือ object เดิม→object ใหม่ ให้ระบุว่า ciphertext key ผูก object ID ต้องใช้ key version/ถอดแล้วเข้ารหัสใหม่อย่างปลอดภัย ห้ามย้าย bytes แล้วคิดว่าอ่านได้

- [ ] เสนอ dry-run export/import การ freeze writes จำนวน/checksum reconciliation restore และ rollback โดยมีมาร์ค review ก่อนทำจริง


เกณฑ์ผ่าน: มี data/identity/key migration design ที่มาร์คเลือกได้และมีวิธีเก็บข้อมูลเดิมครบ

หลักฐานที่ส่ง: ADR input + mapping + rehearsal/rollback plan + ข้อมูลสังเคราะห์สำหรับทดสอบ

### N0.3 ทำ API contracts และสถานะธุรกรรมร่วมทีม

ให้ frontend ต่อ endpoint ที่มีจริงและเข้าใจกรณีผิดพลาด

เริ่มเมื่อ: N0.1 N0.2 และ D04–D07

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ทำตาราง method/path/input/output/auth/errors ของ catalog auth cart/checkout orders payments inventory staff queue chat notifications reports

- [ ] กำหนด money integer satang currency THB เวลา UTC ใน storage และขอบเขตรายงาน Asia/Bangkok พร้อม pagination/limit

- [ ] ตกลง status machine ระหว่าง order/payment/fulfillment/preorder และ policy paid-but-no-stock/late payment โดยไม่ฝืน enum เดิม

- [ ] กำหนด idempotency key scope unique constraints correlation IDs และ error ที่ frontend retry ได้/ไม่ได้

- [ ] อัปเดต packages/contracts ตามรูปจริง ระบุ proposed endpoints ที่ยังไม่ implement และให้มาร์ค/แบงค์ review


เกณฑ์ผ่าน: มี contract version ที่ UI ใช้ร่วมได้และไม่มี endpoint ที่เดาว่าใช้ได้โดยไม่ทดสอบ

หลักฐานที่ส่ง: contract examples สังเคราะห์ + review + endpoint backlog


- [ ] ตรวจงานทั้งหมดของ TEAM-P0 กับมาร์ค และใช้ gate ที่ตรงกันใน 04-ACCEPTANCE ก่อนเลื่อนไป Phase ถัดไป

## TEAM-P1 ร้านถาวรและแกนซื้อขาย

### N1.1 ทำร้านถาวรและเส้นทางข้อมูลข้ามเครื่อง

แอดมินและลูกค้าคนละ browser ใช้ร้านเดียวกัน

เริ่มเมื่อ: G0 N0.2 และ M0.3

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] implement stable shop routing ตาม ADR โดยเลือกสิทธิ์และขอบเขตข้อมูลบน server; ไม่เชื่อ shop/role ที่ client เปลี่ยนเอง

- [ ] แยก demo sandbox กับร้านถาวร ไม่ทำให้ presentation object กลายเป็นช่องเขียนสาธารณะ

- [ ] รัน migration mapping แบบ dry-run และเทียบข้อมูลเดิมก่อน cutover; รักษาความสามารถอ่านโค้ดเข้ารหัสเก่าด้วย key เดิม

- [ ] ทดสอบ admin A สร้างสินค้า แล้ว customer B เห็นและสร้างออเดอร์ในร้านเดียวกันโดยไม่ copy cookie ของ A

- [ ] ทดสอบ login บัญชีเดิมจากอีกเครื่องแล้วยังเห็นประวัติของตน แต่ไม่เห็นข้อมูล private ของคนอื่น


เกณฑ์ผ่าน: ผ่าน shared-shop cross-device test พร้อมรักษาบัญชี ออเดอร์ และการถอดโค้ดเดิม

หลักฐานที่ส่ง: integration/E2E หลาย browser + before/after data reconciliation

### N1.2 ยืนยันตัวตนและสิทธิ์ใช้งานร้านจริง

ลูกค้า Staff Admin แยกสิทธิ์และกู้การเข้าถึงได้ตามนโยบาย

เริ่มเมื่อ: N1.1 D05 D08

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] คง password hash ที่ปลอดภัยและ token hash HttpOnly Secure SameSite cookies; revoke sessions ตาม password/role change และ logout

- [ ] ตรวจ authenticated→role→resource ownership ทุก endpoint รวม CSV/chat/queue/notifications/report และ admin configuration

- [ ] admin/staff provision ต้องเป็นช่องทางที่ได้รับอนุญาต; ปิด self-promotion และ demo admin shortcuts ใน production ด้วย feature gate ที่ทดสอบได้

- [ ] เพิ่ม session expiry persistent rate limits และ abuse protection สำหรับ auth; กำหนด admin MFA/step-up ตามที่ตกลงกับมาร์ค

- [ ] ทำวิธีกู้บัญชีที่ตกลงและพิสูจน์เจ้าของได้; ถ้า email service ยังไม่อนุมัติให้รายงาน blocker ไม่ทำ reset ที่ยึดแค่ email/username

- [ ] มี tests ปลอม role เปลี่ยน ID ข้ามคน session หมดอายุ revoke และข้าม browser ร้านเดียวกัน


เกณฑ์ผ่าน: CUSTOMER/STAFF/ADMIN ทำได้ตรง matrix และไม่มี public endpoint สร้างแอดมินจริง

หลักฐานที่ส่ง: auth/security negative tests + session lifecycle proof + recovery flow

### N1.3 เชื่อมสินค้า ตะกร้า ออเดอร์ และสต็อก

backend เป็นเจ้าของราคาและการจัดสรรโค้ด

เริ่มเมื่อ: N1.1 N1.2 N0.3 และ D04

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ยกระดับ catalog/variant/category/filter/pagination ตาม scope และ product CRUD API ที่ frontend ต้องใช้; ไม่คืน unused key หรือ ciphertext ใน catalog

- [ ] ใช้ราคาฝั่ง server และตรวจจำนวน/สถานะสินค้า ไม่รับ total จาก browser; ตกลง multi-line cart แล้วค่อยทำโครง order items ถ้าต้องรองรับ

- [ ] คง sandbox path แยกจาก real payment และ label ledger DEMO_CREDIT; ไม่ทำ wallet เงินจริง

- [ ] ทำ import validation/fingerprint duplicate handling และขีดจำกัดจำนวน/ขนาดที่ Admin เข้าใจ; ไม่ log โค้ด

- [ ] ทดสอบ stock 0 ปิดร้าน ปิดสินค้า ราคาถูกแก้หลังใส่ตะกร้า จำนวนไม่พอ request ซ้ำ และ last-unit race

- [ ] owner-only delivery viewer ต้องอ่าน order เดิมและ code เดิมได้หลัง reload/login ใหม่ และ Staff ไม่เห็น unused code


เกณฑ์ผ่าน: UI สองฝั่งใช้ API จริง ซื้อ TEST ได้ไม่ขายซ้ำและไม่ใช้ยอด client

หลักฐานที่ส่ง: contract tests + checkout/idempotency/race/ownership tests + Admin integration proof

### N1.4 ซ้อม migration และ restore ที่มีข้อมูล

ป้องกันการ deploy ที่ผ่านเฉพาะฐานเปล่า

เริ่มเมื่อ: N1.1–N1.3 และประสาน M1.3

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ใช้ append-only migration ใหม่เมื่อจำเป็น ไม่แก้ 004 เพื่อทับฐานที่เคย apply แล้ว; migration runner ตรวจ FK และ rollback บน failure

- [ ] ทดสอบ upgrade ฐานมี users sessions orders ledger stock ciphertext reviews queue settings ครบ และเทียบค่าเดิมหลัง upgrade

- [ ] รันบน Node และ Cloudflare workerd/DO path จริง; ทดสอบ restart และ migration marker ไม่ทำซ้ำ

- [ ] จงใจทำ orphan/constraint failure เพื่อยืนยัน rollback schema/rows/marker และไม่ปิด FK enforcement ค้าง

- [ ] ซ้อม backup+restore รวม key ที่แยกเก็บบน staging และตรวจอ่านออเดอร์/โค้ดเก่า ไม่ publish raw DB/keys เป็น CI artifact

- [ ] ส่ง migration preflight/check/rollback ให้มาร์คใช้ release และชี้ไฟล์ schema ที่ต้องมีใน checkout runtime


เกณฑ์ผ่าน: อัปเกรดและกู้ฐานมีข้อมูลได้จริง พร้อม negative rollback และไม่มี secret ใน artifacts

หลักฐานที่ส่ง: automated upgrade results + restore drill + reconciliation counts + release notes


- [ ] ตรวจงานทั้งหมดของ TEAM-P1 กับมาร์ค และใช้ gate ที่ตรงกันใน 04-ACCEPTANCE ก่อนเลื่อนไป Phase ถัดไป

## TEAM-P2 ชำระหนึ่งวิธีและ operations ครบ scope

### N2.1 เชื่อม provider หนึ่งวิธี

เปลี่ยน Paid ได้จากหลักฐานฝั่ง server เท่านั้น

เริ่มเมื่อ: G1 D03 credentials ฝั่ง secret store และ provider test mode

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] implement adapter เพียง provider ที่เลือก; แยก test/live configs ตรวจ amount currency merchant/order reference สถานะและความเป็นเอกลักษณ์ของธุรกรรม

- [ ] ถ้า gateway ให้ verify signature/server query และ webhook replay; ถ้า slip verification ให้ตรวจผล provider ผู้รับ ยอด เวลา/duplicate reference ไม่ใช้ภาพอัปโหลดเป็นหลักฐานสำเร็จ

- [ ] เก็บ event/reference และ idempotency ให้ callback ซ้ำ/สลับลำดับ/timeout/retry ไม่เปลี่ยนยอดหรือจ่าย key ซ้ำ

- [ ] กำหนด payment state machine และทางตามสถานะหลัง callback หาย โดย frontend ไม่มีสิทธิ์ส่ง paid=true

- [ ] ปิด real checkout fail-closed เมื่อ config/provider ยังไม่พร้อม; sandbox ใช้ได้แยกและไม่เลียนแบบ real proof

- [ ] ทำ reconciliation ของยอดที่ผู้ให้บริการยืนยันกับ payment/order ในระบบ และ redacted logs


เกณฑ์ผ่าน: provider test cases สำเร็จ/ล้มเหลว/ปลอม/ซ้ำ/timeout ผ่าน; ถ้ายังไม่มี D03 ให้สถานะ BLOCKED จริง

หลักฐานที่ส่ง: provider test evidence ที่ลบข้อมูลลับ + integration tests + env names + rollback switch

### N2.2 ส่งโค้ดและจัดการเงินเข้าแต่ส่งไม่ได้

ธุรกรรมเงิน/โค้ดติดตามและ retry ได้โดยไม่ขายซ้ำ

เริ่มเมื่อ: N2.1 และ D06; sandbox semantics ทดสอบล่วงหน้าได้

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ใช้ atomic allocation/unique constraints และ immutable unit price snapshot เพื่อหนึ่ง key ต่อรายการส่งมอบ

- [ ] แยก PAID/PROCESSING/DELIVERED เมื่อ asynchronous และบันทึก fulfillment attempts/correlation; retry ได้หลัง runtime restart

- [ ] ทดสอบเงินเข้าหลังออเดอร์หมดอายุ paid-but-no-stock callback ซ้ำลำดับสลับ provider timeout และ process ตายระหว่าง flow

- [ ] ไม่คืน used/exposed code กลับ stock อัตโนมัติ; refund/reversal เป็น audited flow ตาม provider และนโยบาย ไม่ปั้น demo wallet เงินจริง

- [ ] ทำ delivery retrieval owner-only และป้องกัน code ใน catalog/logs/notifications/list exports

- [ ] มี exception queue ให้มาร์คตามเคสโดยเห็นเหตุและ action ที่ทำได้ ไม่ซ่อนล้มเหลวเป็น success


เกณฑ์ผ่าน: ทุก verified payment มี delivery หรือ exception ที่ติดตามได้ ไม่มีการจ่ายโค้ด/เงินซ้ำจาก retry

หลักฐานที่ส่ง: fault/restart/concurrency tests + reconciliation + exception examples สังเคราะห์

### N2.3 คิวพรีออเดอร์และ fulfillment

คิวถูกต้องเมื่อจองพร้อมกันและไม่จ่ายโค้ดก่อนพร้อม

เริ่มเมื่อ: D06 N1.2 N1.3 และ N2.2 สำหรับ paid fulfillment

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] นิยาม queue scope ต่อสินค้า/ร้าน ลำดับเวลา tie-breaker และเงื่อนไขได้คิวตามคำตอบลูกค้า

- [ ] คิวและเลขลำดับออกฝั่ง server แบบ atomic; retry/cancel ไม่จองซ้ำและไม่เผยข้อมูลคนอื่นใน queue board

- [ ] ต่อ payment semantics ของ free/paid preorder ให้ชัด ไม่ fabricate delivered keys ก่อนมี stock

- [ ] implement staff/admin fulfillment เมื่อโค้ดพร้อมแบบไม่ซ้ำ; scheduler ใช้เฉพาะเมื่อ scope ต้องการ พร้อมกติกา retry

- [ ] ทดสอบยกเลิก คิวชน จ่ายล้มเหลว โค้ดไม่พอ ระบุวันส่ง และย้อนหลังหลัง restart


เกณฑ์ผ่าน: ทั้งสอง UI เห็นคิว/สถานะตรงกันและ fulfillment ได้จริงตามสิทธิ์

หลักฐานที่ส่ง: queue concurrency + preorder delivery E2E + policy examples

### N2.4 แชทและแจ้งเตือนในเว็บไซต์

ลูกค้าและพนักงานติดต่อกันได้โดยข้อมูลไม่ข้ามคน

เริ่มเมื่อ: N1.2 และ D10

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ตรวจ API ที่มีอยู่แล้วและเติม staff thread inbox/reply/close/unread ตาม contract ที่ขาด ไม่สร้าง endpoint ชื่อใหม่โดยไม่บอก UI

- [ ] ทำ authz ทุกห้อง/ข้อความ/แจ้งเตือน; sender role มาจาก session ไม่ใช่ input และป้องกัน IDOR

- [ ] ตกลง polling/realtime ที่เหมาะกับโควตา รองรับ pagination และ cursor ไม่ดึงแชททั้งหมดทุกครั้ง

- [ ] จำกัด message size/rate และเก็บ plain text หรือ sanitize ตามแบบที่ตกลง ไม่มี script/HTML ทำงานเมื่อแสดง

- [ ] แจ้งเตือนจาก domain event/order/queue แบบไม่ซ้ำ รองรับ read/unread ไม่ใส่ plaintext key ใน notification

- [ ] กำหนด retention และทดสอบ USER↔STAFF/ADMIN, unread count, close/reopen, reload และ isolation


เกณฑ์ผ่าน: chat/notifications persist จริงใช้ได้สองฝั่งและไม่มีช่องทาง notification นอก scope

หลักฐานที่ส่ง: API/negative tests + cross-browser thread E2E + unread/idempotency tests

### N2.5 รายงาน อันดับ และตรวจ backend ก่อนส่งมอบ

ตัวเลขตรงนิยามและระบบรับ load/ข้อผิดพลาดได้

เริ่มเมื่อ: D07 และ N2.1–N2.4

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] เพิ่ม period filters วัน/สัปดาห์/เดือน/รวมตาม timezone กับ ranking/report APIs ที่ยังขาด โดยนับ paid/refund ตามนิยามเดียว

- [ ] ใช้ fixture ที่คำนวณยอดเองได้ เทสขอบเที่ยงคืน วันเริ่มสัปดาห์ เปลี่ยนเดือนและ callback ซ้ำ; mask identity ตามสิทธิ์

- [ ] pagination/index/query plan และ import batching ให้รองรับปริมาณที่มาร์คตกลงกับลูกค้า; รายงานผล load p95/error rate ไม่สร้างตัวเลขผ่านเอง

- [ ] ทำ structured redacted logs health ข้อผิดพลาด และ metrics exception/payment/stock; ไม่มี secrets หรือ keys ใน response ผิดพลาด

- [ ] ทบทวน abuse limits quotas auth recovery และ production feature gates ร่วมมาร์ค

- [ ] ส่ง schema/API/state-machine/recovery/env names และข้อจำกัดให้คู่มือ; รัน build tests และ security/upgrade regression บน release SHA


เกณฑ์ผ่าน: รายงานตรง fixture มีผล nonfunctional/security tests และ backend ไม่เปิดช่องทาง demo เงินจริง

หลักฐานที่ส่ง: totals fixture + performance results ตามเป้าที่ตกลง + CI + backend handoff + known issues


- [ ] ตรวจงานทั้งหมดของ TEAM-P2 กับมาร์ค และใช้ gate ที่ตรงกันใน 04-ACCEPTANCE ก่อนเลื่อนไป Phase ถัดไป

## สิ่งที่ห้ามทำให้ดูเสร็จ

- [ ] ไม่เปลี่ยน status เป็น DONE จากภาพ UI หรือ happy path เพียงอย่างเดียว
- [ ] ไม่ใช้ demo credit และปุ่มยืนยันทดลองเป็นหลักฐานรับเงินจริง
- [ ] ไม่ reset ฐานหรือเปลี่ยน key เพื่อให้ migrate ผ่าน และไม่ใส่ code/password/token จริงใน logs/PR
- [ ] ไม่เปิดฟีเจอร์นอก scope โดยอาศัยเมนูจากเว็บต้นแบบ
- [ ] ไม่ deploy ทับ demo ก่อน checks และการ review ตามข้อตกลงทีม

## รูปแบบส่งงานรายวันและ PR

คัดลอกกรอกหนึ่งชุดต่อ Task

```text
ผู้รับผิดชอบ:
Phase และ Task ID:
ทำเสร็จอะไรและพฤติกรรมที่เปลี่ยน:
PR / commit SHA / environment URL:
ไฟล์หรือโมดูลที่เปลี่ยน:
คำสั่งทดสอบและผล:
หลักฐาน UI / API / migration / security:
ผลต่อข้อมูลเดิม secrets config และ deploy:
ยังไม่ทำอะไร:
ติดอะไร รอใคร และต้องตอบเมื่อไร:
งานถัดไปหนึ่งอย่าง:
```

การทดสอบเลือกตามงาน: build ทุกโค้ดที่เปลี่ยน, domain/API ใช้ npm test, flow สำคัญใช้ npm run test:e2e และ cloud QA บนพื้นที่ TEST แยก; งานเอกสารอย่างเดียวตรวจความถูกต้องของ path/ลิงก์แทนการรัน tests ไม่เกี่ยวข้อง

## สรุปก่อนจบ Phase 2

- [ ] ปิด Task ของตนพร้อมหลักฐานหรือระบุ BLOCKED ที่ตรวจสอบได้
- [ ] คู่มือและ contract ตรง release SHA และบอกข้อจำกัดที่ยังมี
- [ ] ผ่าน G2A sandbox; ถ้ายังไม่มีเงื่อนไข G2B ให้ระบุว่ายังไม่เปิดรับเงินจริง
- [ ] ส่งมอบงานต่อให้เพื่อนและมาร์ค โดยไม่มีข้อมูลลับในไฟล์แจกงาน
