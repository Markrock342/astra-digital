# Roadmap: NOTT เต็มชุด (ทำต่อเนื่อง)

สถานะ: **Done (A–C)** — Owner ให้ทำต่อเนื่องไม่รอรายสัปดาห์  
โฮสต์: Cloudflare · local: `.data/commerce.sqlite`  
แหล่งโจทย์: [../requirements/NOTT_BANK_MARK_WEEKLY_TH.md](../requirements/NOTT_BANK_MARK_WEEKLY_TH.md)  
หลักฐาน: `npm test` **37 passed** (รวม `tests/nott-ops.test.mjs`)

```
Module/Project: ASTRA — NOTT Full Delivery

Phase 0: Schema foundation (W1) — DONE
  Milestone 0.1: .data migrate 001–004 + DEMO_CREDIT + payment_channel unset

Phase A: Product / Order / Permissions APIs — DONE
  Milestone A.1: GET /api/products/:id ไม่มีโค้ดใน response
  Milestone A.2: Order APIs + STAFF/ADMIN (ไม่รับ role จาก client); GET /api/staff/orders

Phase B: Single payment channel + code delivery — DONE
  Milestone B.1: GET /api/payment-channel · POST /api/admin/payment-channel
                 เปิดได้ sandbox; บล็อก slipok/gateway จนกว่า env ยืนยัน; pay รับเฉพาะ unset/sandbox
  Milestone B.2: ชำระแล้วส่งโค้ดเจ้าของออเดอร์ + บันทึก payments + แจ้งเตือน

Phase C: Queue / Chat / Notifications / Buyer ranking — DONE
  Milestone C.1: เลขคิวพรีออเดอร์ · GET /api/queue · GET /api/queue/me
  Milestone C.2: แชทในเว็บ + แจ้งเตือนในเว็บ
  Milestone C.3: GET /api/rankings/buyers
```
