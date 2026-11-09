# Checklist ตรวจรับทีม ASTRA จนจบ Phase 2

วันที่ 9 พฤศจิกายน 2026 | มาร์คคุมผลตรวจ น็อตรับ backend แบงค์รับหน้าร้าน ลูกค้ายืนยัน UAT

ใช้ตรวจร่วมกัน ไม่ติ๊กจากคำอธิบายว่าเขียนโค้ดแล้ว ทุกผลต้องผูกกับ commit SHA และ environment ข้อมูลทดสอบเป็น TEST เท่านั้น การผ่าน G2A ยังไม่อนุญาตรับเงินจริง

## G0 พร้อมเริ่มโครงร่วมกัน

- [ ] M0.1 มี scope และ decision log D01–D10 ระบุผู้ตัดสินใจและงานที่รอ
- [ ] M0.2 ทุกคนเข้าถึง private repo และเปิด PR ได้ checks ทำงาน ไม่เผย secrets
- [ ] M0.3 N0.2 เลือก data architecture รอบนี้ชัดเจน DO/D1 ไม่ปะปน มีแผนร้านถาวรและข้อมูลเก่า
- [ ] N0.1 มี inventory ของจริงแยก implemented/deployed/scaffold/gap
- [ ] N0.3 M0.4 B0.2 เห็น API/role/state/error contracts ตรงกัน
- [ ] B0.1 ตัวอย่างแบรนด์และ motion ผ่าน review พร้อมขอบสื่อและ copy ที่ใช้ได้
- [ ] B0.3 และมาร์คตกลง responsive accessibility loading/empty/error
- [ ] มี staging plan ที่แยกฐานและ secrets; รู้ว่างานใหม่ใดต้องรอ environment ก่อนปล่อย
- [ ] งาน schema/deploy มีทางส่ง artifact ให้ CI ที่สอดคล้องกติกา local-only ปัจจุบัน

ผู้ตรวจ G0: ______ วันที่: ______ Evidence/commit: ______ ผล PASS / FAIL / BLOCKED: ______

## G1 ร้านเดียวทำงานข้ามเครื่องและเก็บข้อมูลเดิม

### ชุดข้อมูลและบัญชี

- [ ] ใช้บัญชี CUSTOMER A CUSTOMER B STAFF และ ADMIN คนละ browser/context ไม่ copy cookie workspace เพื่อให้ผ่าน
- [ ] มีสินค้าทั่วไป variant สต็อกมากกว่า 1 สต็อก 1 สต็อก 0 และสินค้าปิดขาย พร้อม codes TEST ที่รู้ค่าคาดหวัง
- [ ] มี users sessions delivered/pending order sold/unsold ciphertext ledger reviews settings queue สำหรับทดสอบ upgrade

### ร้านและการซื้อ

- [ ] ADMIN เครื่อง A เพิ่มสินค้า/variant/import codes แล้ว CUSTOMER เครื่อง B เห็นร้าน/สินค้าเดียวกัน
- [ ] ราคาถูกแก้/สินค้าปิด/ร้านปิดหลังใส่ตะกร้าถูก server ปฏิเสธหรือให้ยืนยันราคาตามนโยบาย
- [ ] Cart ตรง D04 หากหลายรายการรวมยอด/จำนวน/ข้อผิดพลาดรายรายการถูกต้อง ไม่แสดงรองรับทั้งที่ซื้อได้ทีละ variant
- [ ] ซื้อ TEST สำเร็จได้ code ที่ import จริง ออเดอร์สัมพันธ์กับผู้ซื้อและ stock ลดถูกต้อง
- [ ] Refresh/logout/login อีกเครื่องด้วยบัญชีเดิมยังเห็น order/code เดิม
- [ ] กดซ้ำ retry/request เดิมไม่สร้างรายการหรือหัก credit/จ่าย code ซ้ำ
- [ ] ลูกค้าสองคนแย่ง stock สุดท้ายมีผู้ได้ code เพียงคนเดียว อีกคนได้สถานะที่อธิบายได้และไม่ถูกหักยอดผิด

### สิทธิ์และข้อมูลเดิม

- [ ] CUSTOMER B เปิด order ของ A ไม่ได้; STAFF ไม่เห็น unused keys/owner-only delivery ตาม matrix
- [ ] ปลอม role/shopID/paymentstatus ใน input ไม่ยกระดับสิทธิ์หรือเงิน
- [ ] Session หมดอายุ revoked password/role เปลี่ยน logout มีผลจริง
- [ ] Upgrade ฐานมีข้อมูลผ่านทั้ง native และ workerd แล้วค่าเดิม/keys/sessions/markers ถูกต้อง
- [ ] Negative migration ทำให้ rollback ทั้ง schema/rows/markers ไม่มี FK ค้างและ restart ยังอ่านข้อมูลได้
- [ ] Restore บน staging รวม key สำเร็จ ไม่ใช่แค่มีไฟล์ backup
- [ ] CI build domain/API tests E2E และ health บน mergedSHA ผ่านทั้งหมด

ผู้ตรวจ G1: ______ วันที่: ______ release SHA: ______ URL: ______ ข้อค้าง: ______

## G2A ฟังก์ชันครบและพร้อม UAT ด้วยเครดิตทดลอง

### ช่องทางชำระและการส่งโค้ด

- [ ] UI ระบุ sandbox และเครดิตทดลองทุกจุดที่เสี่ยงเข้าใจผิด ไม่ขอเงินจริงหรือใช้ realcode
- [ ] สำเร็จ/ล้มเหลว/ยกเลิก/pending/timeout/stock หมด/closedshop ผ่านตาม state machine
- [ ] จงใจส่ง confirmation หรือ event ซ้ำ/สลับลำดับผลยังถูกต้องและยอดไม่ซ้ำ
- [ ] paid-but-delivery-pending และ latepayment มี exception/action ตามแบบ ไม่แสดง DELIVERED หลอก
- [ ] owner อ่าน code เดิมได้ และ code ไม่อยู่ใน catalog/logs/notifications/unauthorizedCSV
- [ ] ขั้นตอนคืนเงิน/ยกเลิกถูกออกแบบและทดสอบ sandbox ตาม scope ไม่สร้าง realwallet และไม่เอา code ที่เห็นแล้วคืน stock

### Operations และรายงาน

- [ ] Preorder free/paid ตามนโยบาย เลขคิว atomic cancellation/fulfillment ถูกต้อง ไม่มี code จนส่งจริง
- [ ] Chat customer↔staff persist สองฝั่ง มี pagination/retry/unread/close และ privacy ไม่เป็นข้อความตัวอย่าง
- [ ] Notifications เกิดจาก event จริง อ่านแล้วจำได้หลัง reload ไม่มี duplicate หรือ secret ใน preview
- [ ] Ranking/Reports วันสัปดาห์เดือนรวมตรงสูตร timezone และ refundpolicy ที่อนุมัติ
- [ ] Dashboard API CSV เทียบ fixture ยอดเดียวกัน และแยก DEMO_CREDIT ออกจากเงินจริง
- [ ] Admin จัดการ catalog stock orders users staff settings ได้จริงตาม role

### คุณภาพและส่งมอบทดลอง

- [ ] หน้าหลักและ flow ซื้อ/รับ code ไม่มี overflow ที่ 360 390 768 1440px; zoom200%และ keyboard ทำงาน
- [ ] Motion เคลื่อนจริงครบตามตัวอย่าง และ prefers-reduced-motion ปิด/ลดการเคลื่อนไหวที่รบกวนได้
- [ ] ไม่มี dummy รีวิว/ชื่อ/ยอด/ข้อความไร้ความหมายหรือภาพติดต่อผิดที่ทำให้เข้าใจว่าเป็นข้อมูลจริง
- [ ] ไม่มี JSruntimeerrors และ criticalAPIerrors ค้าง; ทดสอบ connection หลุด/reload/deeplink
- [ ] ทดสอบ browser ตาม matrix ที่ตกลงและมือถือจริงพร้อมหลักฐาน
- [ ] ลูกค้าลองตามคู่มือแล้วพบ order/code ของตนได้ จดผล testcase และ bug ไม่ใช่บอกว่าโอเคเฉยๆ
- [ ] มาร์คปิด bug ที่ซื้อ/ข้อมูล/สิทธิ์พัง และแยก change request ออกจาก bug ตามสัญญา

ผู้ตรวจ G2A: ______ วันที่: ______ SHA/URL: ______ สถานะ sandbox-ready: ______

## G2B อนุญาตเปิดรับเงินจริงและส่งมอบใช้งานจริง

ถ้า provider ลูกค้าหรือบัญชี production ยังไม่พร้อม ให้ BLOCKED ตามจริงและเก็บเดโม G2A ไว้ ไม่ติ๊กแทนด้วย sandbox

- [ ] D03 มีข้อความยืนยัน provider หนึ่งรายและลูกค้าเป็นเจ้าของบัญชีรับเงิน/credentials ที่จำเป็น
- [ ] Secrets แยก test/live ไม่มี token ใน repo/chat/logs และไม่มี productionkey ใน preview
- [ ] Provider verification พิสูจน์ amount currency ผู้รับ reference และ status server-side; signature/webhook หรือ slipverification ตามวิธีที่เลือกผ่าน negativecases
- [ ] Reconciliation ชี้ทุก payment ไป order/delivery/exception ได้และจัดการ duplicate/replay/timeout/latepayment ตามนโยบาย
- [ ] นโยบายจัดการเงินเข้าแต่ส่งไม่ได้/คืนเงินมีเจ้าของรับผิดชอบและลูกค้ารับทราบ
- [ ] เปิดร้านถาวรข้ามเครื่องแล้ว production ไม่อนุญาต demo-merchant/topup/ทดลองสร้าง ADMIN
- [ ] Recovery บัญชี admin/staff สิทธิ์สำคัญและ session/abuselimits ตรวจครบ มีมาตรการ MFA/step-up ตามแบบ
- [ ] Restore ล่าสุดอ่านออเดอร์/โค้ดเข้ารหัสเก่าได้ มี keyversion และแผน rotation ไม่ทำข้อมูลสูญ
- [ ] Monitoring/alert/health ทำงาน มีผู้รับ incident และ safe rollback/maintenance path
- [ ] วัด load/concurrency ตามปริมาณที่ลูกค้ายืนยัน มีเป้า latency/error ที่ตกลงและผลจริงแนบ ไม่ตั้ง PASS จากค่าที่ไม่เคยวัด
- [ ] Terms/privacy/retention/support/contact และสื่อที่ใช้ได้รับการยืนยัน; ไม่เอาข้อมูลอ่อนไหวขึ้น demo
- [ ] ไม่มี P0/P1 ด้านเงินข้อมูลสิทธิ์ที่ยังไม่แก้ก่อน go-live
- [ ] Client UAT ระบุ releaseSHA URL ผลตรวจข้อค้างและลายลักษณ์อักษรอนุมัติเปิดจริง
- [ ] ส่ง source/build/deploy/envnames/คู่มือ/accountownership/backupsteps และช่องทาง support ครบ
- [ ] กำหนดวันเริ่มดูแล/รับประกันตามสัญญาจริงและ scopechange แยกจาก bug

ผู้อนุมัติเปิดจริง: ______ วันที่: ______ SHA: ______ provider: ______ หลักฐาน: ______

## แบบบันทึก UAT รายกรณี

| Case ID | Task/ฟังก์ชัน | บัญชีและ role | ขั้นตอน | ผลที่คาด | ผลจริง | PASS/FAIL | SHA และหลักฐาน | ผู้แก้ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-001 | ร้านข้ามเครื่อง | ADMIN / CUSTOMER A | เพิ่มสินค้าเครื่อง A เปิดเครื่อง B | เห็นสินค้าเดียวกัน | เติมเมื่อทดสอบ | รอตรวจ | แนบโดยไม่ติดข้อมูลลับ | น็อต/แบงค์/มาร์ค |
| UAT-002 | ซื้อและรับโค้ด | CUSTOMER A | ซื้อ TEST แล้ว reload | code เดิมและยอดเดิม | เติมเมื่อทดสอบ | รอตรวจ | แนบผล | น็อต/แบงค์ |
| UAT-003 | กันซื้อซ้ำ | A / B | แย่ง stock1 พร้อมกัน | ส่ง code ได้คนเดียว | เติมเมื่อทดสอบ | รอตรวจ | แนบผล | น็อต |
| UAT-004 | สิทธิ์ออเดอร์ | CUSTOMER B | เปิด order ของ A | ไม่เห็นข้อมูล/โค้ด | เติมเมื่อทดสอบ | รอตรวจ | แนบผล | น็อต |
| UAT-005 | แชท | CUSTOMER / STAFF | ส่งตอบแล้ว reload | เห็นข้อความจริงสองฝั่ง | เติมเมื่อทดสอบ | รอตรวจ | แนบผล | ทั้งทีม |
| UAT-006 | รายงาน | ADMIN | เทียบ fixture ข้ามเที่ยงคืน | ตรงสูตรและ timezone | เติมเมื่อทดสอบ | รอตรวจ | แนบผล | น็อต/มาร์ค |
| UAT-007 | Upgrade/Restore | ผู้ดูแล | อัปเกรดฐานมีข้อมูลแล้วกู้ staging | ข้อมูลและ code เก่าอ่านได้ | เติมเมื่อทดสอบ | รอตรวจ | redactedlog | น็อต/มาร์ค |

## ระดับบั๊กและจังหวะตอบสนองในทีม

- P0: ข้อมูล/โค้ดรั่ว เงินผิด ขาย code ซ้ำ ข้อมูลสูญ ให้หยุด flow ที่เสี่ยงและมาร์คกับน็อตดูทันที เก็บหลักฐานโดยไม่เผย secret
- P1: ซื้อ รับ code login หลังบ้านหรือฟังก์ชันสำคัญใช้งานไม่ได้ ต้องแก้ก่อน G2B
- P2: มีทางเลี่ยงและไม่กระทบเงินข้อมูล เช่น filter บางเงื่อนไข/UX ให้ตกลงกำหนดแก้ใน UAT
- P3: รายละเอียดตกแต่งเล็กน้อย ทำตามลำดับหลัง flow หลักผ่าน

ตัวเลข severity นี้เป็นวิธีจัดคิวภายใน ไม่ใช่ SLA ตามสัญญาที่รับปากลูกค้าโดยอัตโนมัติ
