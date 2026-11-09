# แผนงาน แบงค์ ตั้งแต่เตรียมงานจนจบ Phase 2

วันที่ 9 พฤศจิกายน 2026 | บทบาท หน้าร้าน ลูกค้า Responsive UI Accessibility และ Animation

เป้าหมายของคุณคือทำส่วนที่รับผิดชอบให้ต่อกับร้านจริงหนึ่งร้านและตรวจรับได้ อ่าน 00-START ควบคู่ไฟล์นี้ เริ่มที่ B0.1 ก่อน งานที่ของเดิมผ่านเกณฑ์แล้วให้แนบหลักฐานและนำกลับมาใช้ ไม่สร้างใหม่ซ้ำทั้งหมด

## ขอบเขตไฟล์และการร่วมงาน

พื้นที่หลักใน repo ปัจจุบัน: src/ReferenceStore.tsx และ customer-facing components ใน src/App.tsx; src/motion.tsx, src/styles.css และ public assets แก้ผ่านขอบที่ตกลงกับมาร์ค

Repo: https://github.com/Markrock342/astra-digital | Local: /Users/code/Projects/nursejob/demos/astra-digital

ไฟล์ src/App.tsx src/styles.css src/api.ts src/types.ts packages/contracts และ config deploy เป็นจุดร่วม ต้องตกลงผู้แก้ใน PR ก่อน งานข้าม ownership ให้เจ้าของโมดูลร่วม review

## วิธีเริ่มและส่งงาน

- [ ] อ่าน scope decision log และ baseline ใน 00-START พร้อมกติกา repo ก่อนแก้
- [ ] ใช้ Node >=24.14 และ npm ci; npm run build; npm test เพื่อตรวจ baseline ไม่ใช้ข้อมูลลูกค้าหรือโค้ดจริงใน tests
- [ ] สร้าง branch codex/bank-task-id จาก origin/main ที่ตรวจแล้ว ไม่ merge local docs-only commits เข้า release โดยไม่ได้ตั้งใจ
- [ ] รับ Task แรกเพียงหนึ่งงาน ระบุ effort และสิ่งที่รอในบอร์ด
- [ ] ผ่านเกณฑ์แล้ว commit แยกโมดูล แนบผลตรวจและส่งให้มาร์ค review; main ที่ merge จะ deploy demo อัตโนมัติ
- [ ] เอกสารและ schema อยู่ภายใต้กติกา local-only ของ repo ปัจจุบัน ถ้างาน runtime ต้องใช้ schema ใหม่ให้ประสาน M0.3 ก่อน ห้ามปล่อย code อ้าง artifact ที่ CI ไม่มี

## ความหมายของสถานะ

ช่องว่างหมายถึงยังไม่ตรวจรับ ไม่ใช่ยืนยันว่าไม่มีโค้ด; DONE ต้องมีหลักฐานกับ commit ล่าสุด, BLOCKED ต้องระบุคน/คำตอบที่รอ ไม่ใช้เปอร์เซ็นต์แทนผลจริง

## TEAM-P0 วางหน้าตาและขอบ frontend

### B0.1 กำหนดแบรนด์และตัวอย่าง UI พร้อม motion

มีหน้าตาเป็นของเราและลูกค้าเห็นทิศทางก่อนทำทุกหน้า

เริ่มเมื่อ: D01 และ scope จาก M0.1

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ทำตัวอย่างหน้าแรก รายการสินค้า รายละเอียดสินค้า และสถานะปุ่มหลักให้มาร์ค/ลูกค้าดู

- [ ] กำหนด tokens สี ฟอนต์ไทย ขนาด ระยะห่าง border focus states และภาพสินค้า โดยไม่เปลี่ยน stack

- [ ] กำหนด motion สำหรับ hero grid pulse page transition hover dialog และ loading พร้อม reduced-motion ที่อ่านได้ทันที

- [ ] นำ composition ที่ใช้งานดีจาก reference มาปรับให้ตรงแบรนด์ เปลี่ยนโลโก้ copy ภาพที่ไม่มีสิทธิ์ และข้อมูลติดต่อจริง

- [ ] ตรวจข้อความตัวอย่างใน ReferenceStore เช่นข้อความถามตอบ/ชื่อที่ไม่มีความหมาย รวมรีวิว/ยอดแต่งขึ้น ให้ลบหรือแทนเนื้อหาที่ได้รับอนุมัติ


เกณฑ์ผ่าน: มีตัวอย่าง visual/motion ที่มาร์คยืนยันและรายการ assets พร้อมสิทธิ์ใช้

หลักฐานที่ส่ง: ภาพ desktop/mobile + motion clip สั้น + token/asset inventory

### B0.2 ตกลง route component และ API consumer

ต่อ backend ได้โดยไม่ชน Admin หรือเดา endpoint

เริ่มเมื่อ: N0.3; ทำ workshop ร่วมกับ M0.4 ไม่ต้องรอ M0.4 ปิดงาน

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ทำ route map Home Products Detail Cart Checkout Login Profile Orders Delivery Preorder Chat Notifications Ranking ตาม scope

- [ ] แยก component หน้าร้านจาก Admin โดยตรวจโครง App/context เดิมก่อน ไม่ refactor router ทั้งแอพกลางงาน

- [ ] ตกลง shared types/response/error contracts และการ refresh user/order state กับน็อต

- [ ] ระบุเจ้าของ CSS class ใน shared file ใช้ scope หน้าร้านและขอ review ก่อนแก้ token กลาง

- [ ] ทำ mock เฉพาะ development/fixtures ที่มี label ไม่มีการจำลอง paid/delivery success ใน production


เกณฑ์ผ่าน: เปิดหน้าที่ตกลงได้และทีมเห็น API dependency ที่ยังรอทั้งหมด

หลักฐานที่ส่ง: route/component map + contract revision + dependency list

### B0.3 วาง loading error empty และ accessibility

ทุกหน้ารับกรณีผิดพลาดและใช้งานด้วย keyboard ได้

เริ่มเมื่อ: B0.1 B0.2

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ทำ skeleton/loading ที่ไม่เลื่อน layout, empty states ที่มีทางไปต่อ และ retry เมื่อ API ล้มเหลว

- [ ] กำหนด inline validation toast/status และ disabled submitting ให้แยกข้อมูลผิด session หมดอายุ forbidden และ server ล่ม

- [ ] ทำ keyboard tab order visible focus dialog focus trap/return และชื่อปุ่ม/icon ที่ screen reader อ่านได้

- [ ] วาง responsive ที่ 360 390 768 1440px และ zoom200%; touch targets/contrast อ่านข้อความไทยได้

- [ ] กำหนด motion ลดลงตาม prefers-reduced-motion และไม่ทำ animation บังการซื้อ/รับโค้ด


เกณฑ์ผ่าน: มี states ใช้งานจริงกับตัวอย่าง API error ไม่ใช่ภาพสวยเฉพาะ happy path

หลักฐานที่ส่ง: states screenshots + keyboard/reduced-motion checklist


- [ ] ตรวจงานทั้งหมดของ TEAM-P0 กับมาร์ค และใช้ gate ที่ตรงกันใน 04-ACCEPTANCE ก่อนเลื่อนไป Phase ถัดไป

## TEAM-P1 หน้าร้านซื้อและดูโค้ดข้ามเครื่อง

### B1.1 หน้าแรก สินค้า และรายละเอียดที่ใช้ข้อมูลจริง

แสดงสินค้าที่แอดมินจัดการจากร้านถาวรเดียวกัน

เริ่มเมื่อ: G0 B0.1–B0.3 N1.1 N1.3

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ต่อ catalog/detail API จริง แสดง category/search/filter/variant/price/stock ตาม contract ไม่ hardcode ข้อมูลร้าน

- [ ] มี direct link loading missing product ปิดขาย/หมด stock error และรูป fallback ไม่ล้น

- [ ] ราคาและตัวเลือกจาก server ส่วน client คำนวณเป็นเพียง preview ห้ามส่ง total เป็นความจริง

- [ ] ทำ home hero และ motion ตามตัวอย่าง approved ตรวจว่ามีการเคลื่อนจริงหลัง load และไม่ทำ mobile กระตุก

- [ ] แสดงเฉพาะข้อมูล catalog ไม่มี unused/delivered codes ใน HTML หรือ cache ของหน้ารายการ


เกณฑ์ผ่าน: สินค้าใหม่จาก Admin เครื่อง A ปรากฏใน customer เครื่อง B และเปลี่ยน variant/stock ได้ถูกต้อง

หลักฐานที่ส่ง: cross-browser evidence + route/reload/mobile screenshots + motion proof

### B1.2 สมาชิก ตะกร้า และ checkout

ลูกค้าทำรายการต่อได้เมื่อ refresh หรือ payment ยังไม่พร้อม

เริ่มเมื่อ: N1.2 N1.3 D04 และ B1.1

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ต่อ login/register/profile/logout และ session หมดอายุโดยไม่ให้ client กำหนด role; เชื่อ/server user state

- [ ] ทำ cart ตาม D04 หากตกลงหลายสินค้าให้รองรับหลายรายการและข้อจำกัด preorder อย่างชัดเจน ไม่สัญญาว่าของเดิมรองรับแล้ว

- [ ] รักษาตะกร้าขณะ refresh ตามแบบที่ตกลงและ revalidate ราคาสินค้า/จำนวนก่อนสร้าง order

- [ ] สร้าง order ด้วย idempotency ที่ contract กำหนด ป้องกัน double click และคืนสถานะเมื่อ network หาย

- [ ] แยก checkout ทดลองกับจ่ายจริง ไม่ใช้เติมเครดิต DEMO เป็นการจ่ายเงินจริง; แสดงร้านปิด stock หมด ราคามีการเปลี่ยนแปลง และต้อง login


เกณฑ์ผ่าน: flow catalog→cart→checkout→pending ใช้ API จริงและไม่สร้าง order ซ้ำจากการคลิก/refresh

หลักฐานที่ส่ง: E2E happy/error/retry tests + cart persistence proof

### B1.3 ประวัติออเดอร์และหน้ารับโค้ด

ผู้ซื้ออ่านโค้ดของตนซ้ำได้จากอีกเครื่อง

เริ่มเมื่อ: N1.1–N1.3 B1.2

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ต่อ orders/detail ตาม server สถานะ แสดง pending failed out-of-stock cancelled delivered โดยไม่ตีความ redirect ว่า paid

- [ ] ทำ delivery viewer copy/reveal และข้อความเก็บรักษาเฉพาะโค้ดที่ server อนุญาต; ไม่ log/analytics โค้ด

- [ ] login อีกเครื่องด้วยบัญชีเดิมเห็นออเดอร์และโค้ดเดิม; session หมดอายุต้องกลับ login แล้วกลับรายการเดิมได้

- [ ] รอผล network ชัดเจนพร้อม refresh สถานะ ไม่กดจ่ายใหม่อัตโนมัติเมื่อ timeout

- [ ] ทดสอบเปลี่ยน orderID คนอื่นไม่เห็นโค้ดแม้ส่ง URL ตรง และ layout บน mobile ไม่ตัดโค้ด


เกณฑ์ผ่าน: รับและคัดลอกโค้ด TEST จริงหลังซื้อ อ่านซ้ำข้ามเครื่องได้และไม่เห็นของคนอื่น

หลักฐานที่ส่ง: cross-device delivery E2E + negative IDOR result + mobile screenshot


- [ ] ตรวจงานทั้งหมดของ TEAM-P1 กับมาร์ค และใช้ gate ที่ตรงกันใน 04-ACCEPTANCE ก่อนเลื่อนไป Phase ถัดไป

## TEAM-P2 customer flows ครบและพร้อมตรวจรับ

### B2.1 หน้าเลือกจ่ายและติดตามการชำระหนึ่งวิธี

ลูกค้าเข้าใจว่าจ่ายสำเร็จจริงหรือกำลังตรวจสอบ

เริ่มเมื่อ: D03 N2.1 N2.2 และ B1.2

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ต่อ paymentadapter ที่เลือกผ่าน API แสดงยอด reference expiry และขั้นตอนตาม provider ไม่สร้างช่องทางสองวิธีเอง

- [ ] ถ้าเป็น slipupload แสดงอัปโหลดแล้ว/กำลังตรวจ/ยืนยันแล้วแยกกัน; ถ้า gateway กลับมาให้ queryserver ก่อนแสดง Paid

- [ ] รองรับ pending timeout expired cancelled duplicate และ paid-but-delivery-pending พร้อมทางติดต่อร้าน

- [ ] ป้องกัน request ซ้ำ ไม่ชวนโอน/จ่ายใหม่เมื่อสถานะยังไม่แน่นอน และอ่าน status หลัง reload

- [ ] เอาหน้าเติม DEMO credit ออกจากทางซื้อ production และคง labelsandbox ใน UAT ทดลอง; ไม่แสดง fakepayment สำเร็จ


เกณฑ์ผ่าน: ผลทุกหน้ามาจาก server verification และลูกค้ารู้ทางทำต่อเมื่อมีปัญหา

หลักฐานที่ส่ง: provider test UI proof success/fail/pending/reload + error screenshots

### B2.2 พรีออเดอร์และคิวของลูกค้า

ลูกค้าเข้าใจว่าจองอะไรและยังไม่ได้รับโค้ดเมื่อยังไม่พร้อม

เริ่มเมื่อ: D06 N2.3

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] แสดงวันเปิดจอง/ส่ง เงื่อนไข free หรือ paidpreorder และการคิดเงินตามข้อมูลจริง

- [ ] ต่อเลขคิวสถานะและประวัติของลูกค้า ไม่เผยชื่อ/อีเมลคนอื่นใน board

- [ ] รองรับ retry cancel จองไม่ได้คิวและ stock ไม่พร้อมโดยไม่แสดง delivered ปลอม

- [ ] เมื่อ fulfillment พร้อมพาไป order/codeviewer เดิมและอ่านซ้ำได้

- [ ] มี empty/loading/error และ mobilelayout ที่อ่านวันที่/คิวได้


เกณฑ์ผ่าน: จองสอง browser พร้อมกันได้คิวตามนโยบายและรับโค้ดเมื่อ server ส่งจริง

หลักฐานที่ส่ง: preorder E2E + queue states screenshots + ownership checks

### B2.3 แชท แจ้งเตือน และอันดับในหน้าร้าน

ลูกค้าใช้งาน operations ผ่าน UI จริง

เริ่มเมื่อ: N2.4 N2.5 และ D07 D10

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ทำ chatwidget เปิดห้องส่งข้อความดูประวัติโหลดเพิ่มและสถานะรอส่ง/ส่งไม่สำเร็จ retry โดยไม่เพิ่มข้อความซ้ำ

- [ ] ข้อความที่ดูเป็น HTML/script ต้องไม่ทำงาน; เคารพข้อจำกัดขนาด/อัตราและข้อความชี้เวลาบริการ

- [ ] ต่อ notification unread/read และ link ไป order/queue ตามสิทธิ์ โดยไม่ใส่ secretcode ใน preview

- [ ] ทำ rankings ใช้ชื่อปิดบังและช่วงเวลาตามสูตรที่ตกลง มี empty/error ไม่แต่งยอดผู้ซื้อ

- [ ] ทดสอบ staff ตอบจาก Admin แล้วลูกค้าเห็นจริง unread/read ตรงกันหลัง reload ไม่ใช้ placeholder สนทนาแทนการเชื่อมต่อ


เกณฑ์ผ่าน: แชทสองฝั่ง notification และ ranking มี API จริงและผ่าน privacy/securitystates

หลักฐานที่ส่ง: customer↔staff browser video + unread/retry tests + masked ranking screenshot

### B2.4 เก็บคุณภาพหน้าร้านและร่วม UAT

ให้ลูกค้าลองบนมือถือได้ครบทุกเส้นทางก่อนส่งมอบ

เริ่มเมื่อ: B2.1–B2.3 และประสาน M2.5

สถานะ: ยังไม่ตรวจรับ | Effort: ผู้รับงานเติมหลังสำรวจ | PR และ commit: เติมเมื่อส่งงาน

- [ ] ตรวจทุกหน้า 360/390/768/1440px ไม่มี horizontaloverflow อ่านโค้ด/วันที่/ยอดได้ และ keyboard เข้าออก dialog ได้

- [ ] ตรวจ motion จริง hover/focus loading route และ reduced-motion ไม่ทำ animation ตอนจ่ายจนคลิกผิด

- [ ] ปรับรูป/font/lazyloading/ขนาด bundle ตามผลวัด ไม่เพิ่ม library เพื่อเอฟเฟกต์โดยไม่จำเป็น; ตกลงเกณฑ์ performance กับมาร์ค

- [ ] ลบ dummytext/testreviews/contact ผิดและลิงก์เมนูที่ยังใช้งานไม่ได้จากเส้นทางส่งลูกค้า; sandbox ต้องติด label ต่อ

- [ ] ทำ browsermatrix ตามลูกค้าที่ตกลงอย่างน้อย Chromium และ mobile จริงหนึ่งเครื่อง; ตรวจ Safari/iOS หากเป็นกลุ่มลูกค้า

- [ ] ส่งภาพก่อนหลังคลิป motion รายการ route/API และ knownissues ร่วม G2A/G2B แล้วแก้บั๊ก UI ตาม severity


เกณฑ์ผ่าน: customerUAT ครบไม่มีบั๊กซื้อ/จ่าย/รับโค้ดร้ายแรงและไม่รายงานเชื่อม API แล้วทั้งที่เป็น mock

หลักฐานที่ส่ง: releaseSHA + screenshots3 ขนาด + motion/reduced-motion proof + UAT fixes


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
