# Roadmap: NOTT ตามแผนรายสัปดาห์ (Owner 2026-11-09)

สถานะ: **กำลังทำ — สัปดาห์นี้ (W1)**  
โฮสต์: Cloudflare · แทร็ก local Node: `.data/commerce.sqlite` · แทร็ก cloud: Worker/D1 ตาม dual-track  
แหล่ง: [../requirements/NOTT_BANK_MARK_WEEKLY_TH.md](../requirements/NOTT_BANK_MARK_WEEKLY_TH.md)

หมายเหตุ: ไฟล์ `003_reference_layout.sql` **มีอยู่แล้ว** ในรีโป — งาน W1 = เปิด `.data` ให้ apply ถึง 003 แล้วเพิ่ม **`004_commerce_ops.sql`** สำหรับสคีมาที่ลิสต์ใหม่ (ไม่เขียนทับ 003)

```
Module/Project: ASTRA — NOTT Weekly

Phase W1: Local DB + schema ใหม่ - .data มี 001–004 และกฎเงิน/โค้ดคงไว้
  Milestone W1.1: เปิดฐานท้องถิ่น
    Task W1.1.1: แก้ path .data ให้ migrate ลง .data/commerce.sqlite ได้บน Windows
    Task W1.1.2: พิสูจน์ schema_migrations มี 001–003 (และ 004 หลังเพิ่ม)
  Milestone W1.2: สคีมา ops
    Task W1.2.1: migration 004 — payments, STAFF, queue_number, chat, notifications, ledger DEMO_CREDIT
    Task W1.2.2: อัปเดต auth-policy ROLES.STAFF + คงกันซื้อซ้ำ/สตางค์/ไม่รั่วโค้ดใน products API
    Task W1.2.3: จุดเชื่อมชำระช่องทางเดียว (sandbox/none) ยังไม่เปิด SlipOK/Gateway

Phase W2-3: API สินค้า ออเดอร์ สิทธิ์ - เปิด endpoint ตามสัญญา (รอ Mark ตรวจ)
  Milestone W2.1: Product/Order/RBAC APIs บนฐานที่ migrate แล้ว

Phase W4-5: Payment channel ที่ลูกค้าเลือก - เปิดหลัง Client ยืนยันเท่านั้น
  Milestone W4.1: Activate adapter ที่เลือก + ส่งโค้ดหลังเงินผ่าน

Phase W6-7: คิว แชท แจ้งเตือน อันดับผู้ซื้อ - API/โดเมนส่วนนี้
  Milestone W6.1: Queue/Chat/Notifications/Buyer ranking APIs
```
