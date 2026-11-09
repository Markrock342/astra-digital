# ERD Sprint 1 — หลัง apply migration D1 local (Task 1.1.3)

สถานะ: สะท้อนไฟล์ `db/migrations/0001_init.sql` ที่ apply local สำเร็จ (2026-11-09)  
Design ต้นทาง: [erd-target.md](erd-target.md) (Approved)  
Runtime เป้า: Cloudflare D1 (แทร็ก B) · ของเดิม DO ยังอยู่ที่ `server/migrations/`

## หลักฐาน apply

```text
npm run db:migrate:local
→ 0001_init.sql ✅
→ 30 commands executed successfully
→ local DB: astra-commerce (db/.wrangler/state/…)
```

Node engine บนเครื่องนี้ตอนรัน: v24.10.0 (package ขอ >=24.14 — เตือน EBADENGINE แต่ wrangler ทำงานได้)

## ตารางที่สร้างแล้ว

users, sessions, products, variants, orders, reservations, payments, inventory_units, allocations, ledger, reviews, audit, runtime_flags, chat_threads, chat_messages, notifications

## Constraints สำคัญที่อยู่ใน migration

- `users.role` CHECK CUSTOMER|ADMIN · email UNIQUE · username partial unique  
- `orders` / `reservations` UNIQUE(user_id, request_key)  
- `payments.idempotency_key` UNIQUE · partial unique (provider, provider_ref) · CHECK ผูก order หรือ reservation อย่างเดียว  
- `inventory_units.fingerprint` UNIQUE · `allocations.inventory_unit_id` UNIQUE (one-key-per-unit)  
- `ledger.reference` UNIQUE · `reviews.order_id` UNIQUE  
- เงิน/ราคาเป็น INTEGER (satang)

## Deploy / rollback

| เรื่อง | สถานะ |
|--------|--------|
| Local D1 migrate | ทำได้ผ่าน `npm run db:migrate:local` |
| Remote D1 | ต้อง `wrangler d1 create` แล้วใส่ `database_id` จริงใน `db/wrangler.jsonc` — **ยังไม่ทำ** |
| Worker หลัก (`wrangler.jsonc`) | ยังเป็น DO SQLite — **ไม่ตัด** ใน Phase 1.1 |
| Rollback D1 | Wrangler D1 ไม่มี down migration อัตโนมัติ — แก้ด้วย migration ใหม่แบบ forward-only หรือลบ local state แล้ว apply ใหม่ตอน dev |
| ข้อมูลเดโมออนไลน์ | ไม่ถูกแตะโดยแทร็ก B |

## Blockers ที่เหลือ

- ยังไม่มี cutover DO → D1 ใน Worker  
- `database_id` ใน `db/wrangler.jsonc` เป็น placeholder สำหรับ local  
- Phase 2–4 ยังไม่ปลดล็อกในรอบนี้ (ปลดเฉพาะ Phase 1)
