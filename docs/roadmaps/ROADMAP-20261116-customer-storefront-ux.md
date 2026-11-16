# Roadmap — Customer Storefront UX (2026-11-16)

Module/Project: Customer Storefront UX (โจทย์ลูกค้าตรง)
Baseline: `main` @ `dba9ce3`
ส่งมอบ: **PR ละ Phase (หรือ commit ชัดต่อ Phase)** → Mark merge · **ห้าม push main / deploy**

ลำดับตาม Owner ยืนยันรายการ 1–8 (+ พรีออเดอร์จากข้อความลูกค้า):

```
Module/Project: Customer Storefront UX
Phase 1: Header guest chrome - รายการ 1 / รูป 10
 Milestone 1.1: ไอคอนภาษา/ธีมแบบใหม่ + ลบปุ่มเข้าสู่ระบบ/สมัคร (มือถือ+คอม)
  Task 1.1.1: PrefsPanel Globe+Palette · Header guest links ออก
  Prove: guest desktop+mobile · เมนูลัดยังมี login
  PR: #124 feat/ux-header-guest-chrome

Phase 2: Auth typography - รายการ 2 / รูป 6
 Milestone 2.1: ตัวอักษรฟอร์มล็อกอิน/สมัครใหญ่ขึ้น
  Prove: /login /register

Phase 3: Auth error - รายการ 3 / รูป 8
 Milestone 3.1: Error banner ใหญ่ขึ้น + สีคอนทราสต์ดีขึ้น
  Prove: เคสรหัสผิดบน /login

Phase 4: Footer mobile menu - รายการ 4 / รูป 9
 Milestone 4.1: ซ่อนบล็อกเมนูท้ายหน้า (มือถือ; desktop ซ่อนอยู่แล้ว)
  Prove: หน้าแรกเลื่อนสุด · ไม่มีหัวข้อเมนู footer

Phase 5: Home + products strip - รายการ 5 / รูป 7
 Milestone 5.1: ลบค้นหา+ตัวกรอง · ปุ่ม「ดูเพิ่มเติม」
  Prove: หน้าแรก + /products ไม่มี search/sort tools

Phase 6: Product card polish - รายการ 6 / รูป 5
 Milestone 6.1: กรอบรูปชั้น · ชื่อ/ราคา/ปุ่มใหญ่ · ลบ「เริ่ม」· ปุ่มกรอบสีเดียว
  Prove: การ์ดพร้อมส่ง + พรีออเดอร์

Phase 7: OOS card - รายการ 7 / รูป 1,3
 Milestone 7.1: รูป grayscale · 「สินค้าหมด」กลางรูป · ปุ่มสินค้าหมด
  Prove: การ์ด OOS บน home/products · เทียบของมีสต็อก

Phase 8: Variant stack - รายการ 8 / รูป 2,4
 Milestone 8.1: ตัวเลือกเรียงลงแนวตั้งเสมอ (variants + option chips)
  Prove: PDP ≥3 ตัวเลือก · มือถือ+เดสก์ท็อป

Phase 9: Preorder Q&A - ข้อความลูกค้า
 Milestone 9.1: Admin แก้/เพิ่มคำถามได้ >1 บนสินค้าพรีออเดอร์
  Task 9.1.1: products.order_questions + PreorderQuestionsCard + API
 Milestone 9.2: ลูกค้ากรอกก่อนสั่ง · เก็บกับออเดอร์
  Tech Note: แยกจาก manual delivery_fields · checkoutInputs รวมทั้งสอง · เก็บใน order_fulfilment
  Prove: unit tests/preorder-questions.test.mjs
  Branch: feat/ux-preorder-questions

Phase 10: Ladder QC + Mark
 Milestone 10.1: เทสโค้ด + Local + มือถือ 320/390/430 · รายงาน Mark
```

## กติกา Commit / PR

- **Phase ละ 1 สาขา/PR** (หรืออย่างน้อย 1 commit ต่อ Milestone ที่ Mark ตรวจแยกได้)
- ไม่ squash ทับกันในเครื่อง Owner จน Mark มองไม่เห็นขอบเขต
- ห้าม push `main` / deploy
