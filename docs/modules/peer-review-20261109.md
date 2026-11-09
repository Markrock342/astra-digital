# ตรวจงานล่าสุดของทีม วันที่ 9 พฤศจิกายน 2026

## สถานะปัจจุบันของฟีเจอร์นี้ (Current Status)

Owner ขอให้ตรวจงานเพื่อนและถามว่าเพื่อน commit มาแล้วหรือยัง ตรวจด้วย git fetch origin --prune, GitHub CLI branches/commits/PRs และโค้ดปัจจุบัน พบ origin/main ที่ 9eebc6f, มี remote branch main เดียว และ PR list ทุกสถานะว่าง ไม่พบโค้ดใหม่หลังแจกแผน TEAM-P0 ถึง TEAM-P2

งานเพื่อนที่ยืนยันได้คือ sonthaya20322 (NOTT): commit โค้ดล่าสุด 7705b29 วันที่ 2026-11-09 เวลา 16:02:38 Asia/Bangkok และ commit เอกสาร 710a818 เวลา 16:02:44 ทั้งคู่มีใน main แล้ว ข้อมูลนี้ไม่ยืนยันสถานะงานที่ยังอยู่ในเครื่องเพื่อนหรือ repo อื่น

GitHub connector ค้นหา private repo ไม่ได้ (422 permission/search) จึงใช้ gh ที่มีสิทธิ์อ่าน repo ตรวจยืนยันแทน ไม่มีการโพสต์ comment ส่งข้อความ merge push หรือแก้โค้ดระบบในรอบ review

## งานที่เพิ่งทำเสร็จ (Recently Completed)

- npm run build ผ่าน และ npm test ผ่าน 40/40 กับ working tree ปัจจุบัน โค้ดระบบตรง baseline 9eebc6f; commits หลังจากนั้นเป็นเอกสาร local เท่านั้น
- ตรวจงานใหม่ใน main/remote branches/PRs ไม่พบเพิ่มหลังแผนแจกงาน
- ทดสอบเพิ่มเติมใน SQLite :memory: แยก ใช้บัญชี example.invalid และ TEST stock ไม่แตะฐานลูกค้า
- หลักฐาน [peer-review-20261109-result.json](../peer-review-20261109-result.json) เก็บผลจริง ไม่เก็บ password/token/code

## บันทึกการแก้บัค (Bug & Troubleshooting Log)

รอบนี้เป็น review ยังไม่แก้บั๊ก ทั้ง 3 ข้อเกิดซ้ำได้จากโค้ดที่น็อตเพิ่มใน 7705b29 ไม่ใช่ migration 004 ที่แก้แล้ว

### P2 การปิดช่องทางจ่ายไม่หยุดการชำระ

ตำแหน่ง server/domain.mjs:114–121 และ pay เรียก guard ที่ 762

ตั้ง provider=sandbox, active=false ด้วย setPaymentChannel แล้วสร้างออเดอร์และ pay outcome=success ได้สถานะ DELIVERED ส่ง code 1 รายการ และหัก DEMO_CREDIT 10000 สตางค์ guard ตรวจเฉพาะ provider ไม่ตรวจ active จึงทำให้คำสั่งปิดช่องทางไม่มีผล

ส่งกลับน็อต: ให้ explicit inactive ปฏิเสธการชำระใหม่โดยไม่หักยอด/จัดสรร code กำหนดค่า default sandbox ให้ตรงพฤติกรรม demo ที่ต้องรักษา และยอมให้เรียกอ่านผลของรายการสำเร็จเดิมได้ตามนโยบาย เพิ่ม tests ทั้ง orders และ reservations

### P2 ข้อความเปิดแชทแรกไม่แจ้งทีมงาน

ตำแหน่ง server/domain.mjs:1204–1209 เทียบ postChatMessage ที่ 1249–1256

ลูกค้าเปิดห้องพร้อมข้อความแรก ทำให้ STAFF notifications มี 0 รายการ เมื่อส่งข้อความที่สองจึงมี 1 รายการ openChatThread แจ้งเฉพาะลูกค้าผู้เปิดห้อง staff ยังเปิดดู thread list ได้ แต่หากอาศัย notification จะพลาดข้อความแรก

ส่งกลับน็อต: สร้าง staff/admin notification สำหรับข้อความแรกอย่างมีขอบสิทธิ์ และทดสอบ USER→STAFF ทั้งเปิดห้องและส่งต่อ

### P2 ค่า limit ทศนิยมทำ public rankings API ตอบ 500

ตำแหน่ง server/domain.mjs:1284–1296

GET /api/rankings/buyers?limit=5 ตอบ 200 แต่ limit=1.5 ตอบ 500 เนื่องจาก clamp ไม่แปลง/ตรวจ integer แล้วส่งทศนิยมเข้า SQLite LIMIT ทำให้ datatype mismatch

ส่งกลับน็อต: validate safe integer แล้วตอบ 400 หรือ normalize ตาม contract ที่ตกลง เพิ่มเคสทศนิยม ค่าว่าง ค่ามาก และ nonnumeric

## สิ่งที่ยังค้างอยู่และปัญหาที่ทราบ (Pending & Known Issues)

- พบ backend ของคิว/แชท/notifications/rankings แต่ยังไม่มี consumer routes เหล่านี้ใน src/*.tsx จึงไม่ควรตรวจรับว่าฟีเจอร์ใช้ครบสองฝั่งแล้ว
- การรับเงินจริงและร้านถาวรข้ามเครื่องยังเป็นงานในแผน ไม่ใช่สิ่งที่ผ่านเพราะ build/tests เดิมผ่าน
- ไม่พบงานใหม่ของแบงค์ใน remote ที่ตรวจ ไม่สรุปว่าแบงค์ยังไม่ได้ทำงาน เพราะอาจยังไม่ push
- รายงานนี้ยังไม่ใช่ security audit ครบทุก API หรือผล UAT ใหม่บน production

## Checklist งานต่อไป (Next Steps)

- [ ] น็อตแก้ 3 findings เป็น PR ขนาดเล็ก พร้อม regression tests และผูก Task ID ตามแผน
- [ ] เพื่อนแต่ละคนส่ง branch/PR/commit SHA พร้อม Task ID ก่อนให้มาร์คตรวจรับ; commit เฉพาะเครื่องเพื่อนต้อง push branch ที่ได้รับอนุญาตจึงเห็นจาก GitHub
- [ ] มาร์คให้ merge ผ่าน review/checks และตรวจ deployment หลังรวมแต่ละ PR
- [ ] แบงค์และมาร์คต่อ UI operations กับ backend ที่มีแล้วตาม dependency ไม่ใช้ placeholder แทนผล API
