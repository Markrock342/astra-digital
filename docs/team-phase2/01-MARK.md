# แผนงาน มาร์ค ตั้งแต่เตรียมงานจนจบ Phase 2

วันที่ 9 พฤศจิกายน 2026 | บทบาท PM สถาปัตยกรรม Admin UI Integration และ Release

เป้าหมายของคุณคือทำส่วนที่รับผิดชอบให้ต่อกับร้านจริงหนึ่งร้านและตรวจรับได้ อ่าน 00-START ควบคู่ไฟล์นี้ เริ่มที่ M0.1 ก่อน งานที่ของเดิมผ่านเกณฑ์แล้วให้แนบหลักฐานและนำกลับมาใช้ ไม่สร้างใหม่ซ้ำทั้งหมด

## ขอบเขตไฟล์และการร่วมงาน

พื้นที่หลักใน repo ปัจจุบัน: src/Admin.tsx, src/Stores.tsx, .github/workflows/demo.yml, scripts/verify-deployment.mjs, scripts/cloud-qa.mjs, wrangler.jsonc และ Cloudflare Pages/Worker configuration

Repo: https://github.com/Markrock342/astra-digital | Local: /Users/code/Projects/nursejob/demos/astra-digital

ไฟล์ src/App.tsx src/styles.css src/api.ts src/types.ts packages/contracts และ config deploy เป็นจุดร่วม ต้องตกลงผู้แก้ใน PR ก่อน งานข้าม ownership ให้เจ้าของโมดูลร่วม review

## วิธีเริ่มและส่งงาน

- [ ] อ่าน scope decision log และ baseline ใน 00-START พร้อมกติกา repo ก่อนแก้
- [ ] ใช้ Node >=24.14 และ npm ci; npm run build; npm test เพื่อตรวจ baseline ไม่ใช้ข้อมูลลูกค้าหรือโค้ดจริงใน tests
- [ ] สร้าง branch codex/mark-task-id จาก origin/main ที่ตรวจแล้ว ไม่ merge local docs-only commits เข้า release โดยไม่ได้ตั้งใจ
- [ ] รับ Task แรกเพียงหนึ่งงาน ระบุ effort และสิ่งที่รอในบอร์ด
- [ ] ผ่านเกณฑ์แล้ว commit แยกโมดูล แนบผลตรวจและส่งให้มาร์ค review; main ที่ merge จะ deploy demo อัตโนมัติ
- [ ] เอกสารและ schema อยู่ภายใต้กติกา local-only ของ repo ปัจจุบัน ถ้างาน runtime ต้องใช้ schema ใหม่ให้ประสาน M0.3 ก่อน ห้ามปล่อย code อ้าง artifact ที่ CI ไม่มี

## ความหมายของสถานะ

ช่องว่างหมายถึงยังไม่ตรวจรับ ไม่ใช่ยืนยันว่าไม่มีโค้ด; DONE ต้องมีหลักฐานกับ commit ล่าสุด, BLOCKED ต้องระบุคน/คำตอบที่รอ ไม่ใช้เปอร์เซ็นต์แทนผลจริง

## TEAM-P0 ล็อก scope และโครงทีม

### M0.1 สรุปขอบเขตและคำตอบจากลูกค้า

เป้าหมายคือทุกคนทำงานตรงสัญญาและรู้ว่ารอคำตอบอะไร

เริ่มเมื่อ: อ่าน 00-START และ kickoff

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ทำบอร์ด Backlog Ready In progress Review Blocked Done; ใส่ Task ID ผู้รับผิดชอบ dependency และเกณฑ์ผ่านจากชุดนี้

- [ ] บันทึก D01–D10 จากแผนกลาง แยกคำตอบลูกค้าออกจากข้อเสนอทีม; provider และ auth recovery ที่ไม่มีคำตอบต้องมีผู้ตามเรื่อง

- [ ] ตรวจว่าหน้าร้านเดียว คิว แชทในเว็บ แจ้งเตือน รายงาน และส่ง source อยู่ในขอบเขต; ตัดเมนู multi-vendor wallet เงินจริง OTP และ LINE bot ออกจากงานรับปาก

- [ ] นิยามสินค้า/แพ็กเกจ ราคา หน่วยเงิน เงื่อนไขส่งโค้ดคืนเงินและ SLA support ด้วยภาษาที่ลูกค้าเข้าใจ

- [ ] จัดลำดับ P0/P1/P2 และตกลงวิธีอนุมัติ change request ก่อนเพิ่มเวลา/ค่าใช้จ่าย


เกณฑ์ผ่าน: มี scope checklist และ decision log ที่ระบุผู้ตัดสินใจ ทุกคนชี้งานแรกและสิ่งที่รอได้

หลักฐานที่ส่ง: ลิงก์บอร์ดหรือไฟล์รายการงาน + decision log + รายการคำถามที่ยังไม่ตอบ

### M0.2 จัด repo สิทธิ์ CI และสภาพแวดล้อม

ลดโอกาสเพื่อน merge แล้วเดโมล่ม

เริ่มเมื่อ: M0.1

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ตรวจสมาชิก GitHub private repo ให้เฉพาะคนที่ทำงานและกำหนดผู้ review/merge; ตั้ง protection/required checks ตามสิทธิ์แผนที่ใช้อยู่

- [ ] ยืนยัน branch แยก PR และ main deploy อัตโนมัติจาก .github/workflows/demo.yml; ห้ามให้ทุกคน deploy จากเครื่องด้วย token ส่วนตัว

- [ ] แยก local staging production ให้ staging ใช้ฐาน/namespace และ secrets ของตัวเอง; ระบุ URLs และชื่อเจ้าของบัญชี

- [ ] ตรวจค่า secret ที่ต้องมีจากชื่อเท่านั้น ไม่พิมพ์ค่า token; บันทึกวันหมดอายุ การหมุน token และเจ้าของบริการ

- [ ] ตรวจ CI npm ci build test test:e2e และ deployment smoke ตรง runtime Node ที่ repo ต้องการ; ทดลอง PR หนึ่งรายการโดยไม่ปล่อยทับ demo


เกณฑ์ผ่าน: PR branch ไม่ deploy ทับ main, main ผ่าน checks จึง deploy และ staging ไม่มีสิทธิ์เขียนฐานจริง

หลักฐานที่ส่ง: ภาพ settings ที่ไม่ติด secrets + CI run + ตาราง env/URL + ตัวอย่าง PR

### M0.3 ตัดสินสถาปัตยกรรมและทางย้ายข้อมูล

ให้ UI และ backend ต่อร้านเดียวกันโดยเก็บข้อมูลเดิม

เริ่มเมื่อ: M0.1 และ N0.1–N0.2

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ร่วมกับน็อตบันทึกว่าจะใช้ DO live ต่อหรือย้าย D1 พร้อมเหตุผล ผลต่อ auth/key routing และกำหนด rollback; ไม่เปลี่ยนเพราะ starter ใช้ D1 อย่างเดียว

- [ ] ยืนยันรูปแบบ permanent single shop URL และขอบ demo workspace; ไม่เพิ่มระบบหลายร้านนอก scope

- [ ] ตรวจนโยบาย repo ที่ห้าม push docs/schema กับ migration ที่ CI ต้องใช้ จัดวิธีส่ง versioned artifact หรือขอแก้นโยบายอย่างชัดเจนก่อน release ที่พึ่ง schema ใหม่

- [ ] ตรวจแผนสำรองทั้งข้อมูลและ encryption key ระบุผู้กู้คืนและเวลาหยุดเขียนระหว่าง cutover ถ้าต้องย้าย

- [ ] ให้มาร์คและน็อตตรวจ API/infra change ก่อนแบงค์ผูก flow สำคัญ


เกณฑ์ผ่าน: มี ADR ทางเลือกเดียวสำหรับ release รอบนี้ พร้อม rollback และไม่มี D1 placeholder ถูกอ้างว่า live

หลักฐานที่ส่ง: ADR สรุป environment/data-flow + rehearsal plan + decision D02

### M0.4 ตกลง contracts และขอบ UI ร่วม

ลดการแก้ไฟล์ชนและการสร้าง API ตามเดา

เริ่มเมื่อ: N0.3 และ B0.2

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] รีวิว request/response/error role matrix และสถานะ orders/payments กับน็อตและแบงค์

- [ ] กำหนดเจ้าของ src/App.tsx src/styles.css src/api.ts src/types.ts และ packages/contracts ทีละ PR; ตกลง route integration ก่อนแยก component

- [ ] แยก Admin navigation ให้ตรง scope ระบุหน้าที่มี API จริง กับหน้าที่รอ backend

- [ ] ตกลง theme typography motion focus และตารางข้อมูลให้หน้าร้าน/หลังบ้านเป็นแบรนด์เดียวกัน

- [ ] ลงรายการ API dependency ที่ยังไม่มีและผู้ทำ ห้ามแจ้ง save สำเร็จด้วย local state แทน persistence


เกณฑ์ผ่าน: UI ทั้งสองฝั่งใช้ contract revision เดียวกันและผ่าน checklist G0

หลักฐานที่ส่ง: contract review + route/component map + ภาพ shell


- [ ] ตรวจงานทั้งหมดของ TEAM-P0 กับมาร์ค และใช้ gate ที่ตรงกันใน 04-ACCEPTANCE ก่อนเลื่อนไป Phase ถัดไป

## TEAM-P1 หลังบ้านเชื่อมร้านถาวร

### M1.1 สินค้าและสต็อกในหลังบ้าน

ให้เจ้าของร้านดูแลสินค้าที่ลูกค้าเห็นจากอีกเครื่องได้

เริ่มเมื่อ: G0 และ N1.1–N1.3; reuse Admin เดิม

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ต่อรายการ/เพิ่ม/แก้ไข/เปิดปิดสินค้า หมวดหมู่และ variant ตาม API ที่ตกลง; แสดง error จาก server และรักษาค่าที่กรอกเมื่อ save พลาด

- [ ] ทำการนำเข้า TEST codes ให้แจ้งจำนวนสำเร็จ ซ้ำ และผิด; ขนาดไฟล์/จำนวนรายการต้องตรงข้อจำกัด backend

- [ ] แสดงยอด available/sold แยก ไม่ส่ง unused plaintext keys ลงรายการหรือ CSV

- [ ] เตือนก่อนแก้สถานะที่มีผลกับคำสั่งซื้อและไม่ให้คลิกส่งซ้ำระหว่าง request

- [ ] ตรวจแอดมินเครื่อง A เพิ่มสินค้า/โค้ดแล้วลูกค้าเครื่อง B เห็นและซื้อได้; refresh กลับมายังเห็นการแก้ไข


เกณฑ์ผ่าน: CRUD และนำเข้าโค้ด persist จริงในร้านเดียวกัน ปฏิเสธข้อมูลผิดและไม่มี key รั่ว

หลักฐานที่ส่ง: browser evidence ต่างเครื่อง + ผล negative API/import tests

### M1.2 ออเดอร์ ผู้ใช้ และสิทธิ์พนักงาน

ให้ทีมงานเห็นเฉพาะข้อมูลที่ได้รับอนุญาต

เริ่มเมื่อ: N1.2–N1.3 และ D05

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ต่อรายการ/รายละเอียดออเดอร์ค้นหา pagination และสถานะตาม server; ไม่คำนวณ Paid จาก query URL

- [ ] จัดหน้าผู้ใช้/Staff และการเปลี่ยนสิทธิ์ตาม contract; ใช้ invite/ตั้ง role โดย ADMIN ที่ยืนยันแล้ว ห้ามฟอร์มเลือก ADMIN สมัครเอง

- [ ] ซ่อนปุ่มและตรวจ route สำหรับ role ที่ไม่มีสิทธิ์ พร้อมแสดง forbidden; ยืนยัน backend ปฏิเสธได้จริง

- [ ] ป้องกัน export ข้อมูลเกินจำเป็น ปิดบังข้อมูลส่วนตัวและโค้ดตาม matrix; CSV ต้องกัน formula injection

- [ ] ทดสอบ CUSTOMER STAFF ADMIN และผู้ไม่ login ว่าไม่หลุดดูออเดอร์/โค้ดคนอื่น


เกณฑ์ผ่าน: หลังบ้านทำงานตาม role matrix พร้อมทดสอบ API/CSV โดยไม่พึ่งแค่ซ่อนเมนู

หลักฐานที่ส่ง: role screenshots + security negative results + API dependency ที่เหลือ

### M1.3 รวมงานและซ้อมอัปเกรด TEAM-P1

ให้ทีมมี shared-shop baseline ที่ deploy ซ้ำได้

เริ่มเมื่อ: N1.4 และ M1.1–M1.2 B1.1–B1.3

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] รวม PR ทีละชุดตาม dependency และรัน build/tests บน merged revision ไม่ดูแต่ผล branch เดิม

- [ ] รัน populated migration tests บน runtime จริงและ staging ที่มีข้อมูลสังเคราะห์; ห้าม reset ฐานเพื่อให้ tests ผ่าน

- [ ] ตรวจ health deployment stamp direct links และ cookies ผ่าน Pages proxy พร้อมเทสซื้อข้ามเบราว์เซอร์

- [ ] บันทึก rollback code ที่ไม่ทำ schema ใหม่เสียและวิธีกู้ข้อมูลเมื่อ rollback โค้ดอย่างเดียวไม่ได้

- [ ] ตรวจ checklist G1 กับทั้งทีม เก็บ commit/version env ผลทดสอบ และรายการบั๊กก่อนขึ้น P2


เกณฑ์ผ่าน: G1 ผ่านรวมออเดอร์ข้ามเครื่อง ข้อมูลเดิมยังอ่านได้ และ CI ไม่ข้าม migration regression

หลักฐานที่ส่ง: CI URL + staging/live smoke + G1 result ที่ผูก commit


- [ ] ตรวจงานทั้งหมดของ TEAM-P1 กับมาร์ค และใช้ gate ที่ตรงกันใน 04-ACCEPTANCE ก่อนเลื่อนไป Phase ถัดไป

## TEAM-P2 รวมฟังก์ชัน ตรวจรับ และส่งมอบ

### M2.1 หน้าหลังบ้านการชำระและกรณีผิดปกติ

ให้ร้านตามเงินและช่วยลูกค้าที่จ่ายแล้วติดปัญหาได้

เริ่มเมื่อ: D03 D06 และ N2.1–N2.2

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ทำหน้าดู payment status provider reference การยืนยัน server และเหตุขัดข้องโดยไม่แสดง secrets

- [ ] แสดงช่องทางเดียวตาม config พร้อมโหมด sandbox/real ชัดเจน; ห้ามเปิด endpoint topup/demo admin สาธารณะใน production

- [ ] ทำรายการเงินเข้าแต่โค้ดยังไม่ส่ง หมดสต็อก จ่ายช้า และรายการต้องคืนเงิน พร้อม actor/time audit

- [ ] การคืนเงิน/กลับยอดใช้ flow ที่ตกลงกับ provider; ไม่สร้างเครดิตเงินจริงใน wallet เดโมและไม่ restore โค้ดที่ลูกค้าเคยเห็นกลับมาขาย

- [ ] เทส retry และกดซ้ำแล้วไม่จ่ายโค้ด/ตัดเงินซ้ำ


เกณฑ์ผ่าน: ทีมงานตามรายการผิดปกติจาก order ไป payment/delivery ได้ และไม่กดยืนยันเงินเข้าแทน provider โดยไร้หลักฐาน

หลักฐานที่ส่ง: ภาพ flow สำเร็จ/exception + integration tests ของ provider test mode

### M2.2 หลังบ้านคิว แชท และแจ้งเตือน

ให้เจ้าหน้าที่ทำงานกับลูกค้าในระบบเดียวกัน

เริ่มเมื่อ: N2.3–N2.4 และ D05 D06 D10

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ต่อหน้าคิวจัดเรียง/ค้นหา สถานะ และ fulfillment ที่ audit ได้; จำกัดการเปลี่ยนลำดับตามกติกา

- [ ] ทำกล่องแชททีมงาน รายการห้อง ตอบ ปิด/เปิดห้อง และ unread ตาม API; ไม่มีห้องลูกค้าอื่นหลุดผ่าน URL

- [ ] ต่อศูนย์แจ้งเตือนในเว็บและการอ่านแล้วตามสิทธิ์ ไม่เพิ่ม LINE/SMS/email/push

- [ ] แสดง loading/empty/error/polling/offline และเวลาตอบบริการ; ไม่อ้างว่ามีพนักงาน online ตลอด

- [ ] ตรวจการตอบจากหลังบ้านไปถึงหน้าร้านและ refresh แล้วยังมีข้อความจริง


เกณฑ์ผ่าน: คิว/แชท/แจ้งเตือนใช้งานสองฝั่งและเชื่อมข้อมูลจริง ไม่มี dummy success

หลักฐานที่ส่ง: E2E customer↔staff + negative room/notification access

### M2.3 รายงานและอันดับที่ตรวจยอดได้

ให้ลูกค้าตรวจรายงานรายวัน สัปดาห์ เดือนและรวมได้

เริ่มเมื่อ: D07 และ N2.5

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ต่อรายงานช่วงเวลา Asia/Bangkok พร้อมตัวกรองและนิยาม gross/paid/refunded/net ที่ API รองรับ

- [ ] ทำ ranking ตามสูตรที่อนุมัติ ปิดบังชื่อ/ข้อมูลส่วนตัว และเลือกช่วงเวลาตาม scope

- [ ] ตรวจตัวเลขกับชุด fixture ที่มียอดสำเร็จ ล้มเหลว ยกเลิก คืนยอด และรายการข้ามเที่ยงคืน

- [ ] แยกยอดเครดิตทดลองออกจากเงินจริง ห้ามนำ ledger DEMO_CREDIT ไปรายงานรายรับจริง

- [ ] ตรวจ CSV encoding ภาษาไทย วันที่ สตางค์ permission และสูตรอันตรายใน cell


เกณฑ์ผ่าน: ตัวเลขหน้า dashboard/CSV/API ตรงกันตาม fixture และไม่มีการนับ payment ซ้ำ

หลักฐานที่ส่ง: expected totals + screenshots + tests + CSV ตัวอย่างสังเคราะห์

### M2.4 ความปลอดภัย การเฝ้าระวัง และกู้คืน

ป้องกันเหตุ 503 และเหตุข้อมูลสูญหายซ้ำ

เริ่มเมื่อ: N1.4 N2.5 และรวม P2 functions

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] กำหนด health/log/alert และ request ID เพื่อไล่ order ที่ล้มเหลว พร้อม redact passwords cookies slips และ code

- [ ] ซ้อม restore ฐานและ key บน staging แล้วอ่านออเดอร์/โค้ดเก่าได้ บันทึก RPO/RTO ที่ทีมยอมรับและผลเวลาจริง

- [ ] ตรวจ session lifecycle admin MFA หรือมาตรการเทียบเท่าที่ตกลง rate limits input XSS CSRF IDOR และ endpoint ทดลองใน production

- [ ] ตรวจ quota/cost alerts token expiration การหยุดขายเมื่อ provider/stock มีปัญหา และผู้รับ incident

- [ ] ปิด P0/P1 ที่กระทบเงิน ข้อมูล และการส่งโค้ดก่อน G2B; dependency/security scan ต้องมีผู้ตรวจและแผนแก้


เกณฑ์ผ่าน: มี restore drill และ incident runbook ที่คนอื่นทำตามได้ ไม่มีความเสี่ยงเงิน/ข้อมูลสำคัญเปิดค้างก่อนเงินจริง

หลักฐานที่ส่ง: restore log + alert proof + security results + risk register

### M2.5 ตรวจรับและส่งมอบลูกค้า

ส่งระบบ คู่มือ บัญชี และ source ที่ลูกค้าดูแลต่อได้

เริ่มเมื่อ: M2.1–M2.4 B2.4 และ 04-ACCEPTANCE

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ทำ G2A sandbox กับบัญชี CUSTOMER STAFF ADMIN คนละเบราว์เซอร์และข้อมูล TEST; รวบรวม bug แยกจาก change request

- [ ] หาก provider/บัญชีจริงพร้อม ทำ G2B ตรวจ verification/reconciliation และอนุมัติ go-live แยกจาก demo; ไม่รับเงินจริงเพื่อทดสอบโดยไร้แผน

- [ ] จัดคู่มือสินค้า นำเข้าโค้ด ออเดอร์ จ่าย/คืนเงิน คิว แชท รายงาน สำรอง และกู้บัญชี พร้อมข้อจำกัด

- [ ] ส่ง source revision ที่สร้าง artifact จริง env variable names deploy/restore steps dependency licenses และรายชื่อผู้ถือสิทธิ์บัญชี; ส่ง secrets ผ่านช่องทางปลอดภัยแยก

- [ ] ลงบันทึก UAT ผู้ตรวจ วันที่ สิ่งที่ยอมรับ/คงค้าง และวันเริ่มดูแลตามสัญญาจริง; หากสัญญารับประกัน bug ตาม scope 30 วันให้ยึดวันตรวจรับ ไม่รวมฟังก์ชันใหม่

- [ ] ถอนสิทธิ์ที่ไม่ใช้ ทำ asset/account ownership handoff และกำหนด contact support หลังส่งมอบ


เกณฑ์ผ่าน: ลูกค้าทำคู่มือสำคัญได้และมี UAT signoff; ระบุ sandbox-ready หรือ production-ready อย่างถูกต้อง

หลักฐานที่ส่ง: UAT result + release SHA + guide/source inventory + account handoff checklist


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
