# Recovery: migration 004 / Cloudflare 503

## สถานะปัจจุบันของฟีเจอร์นี้ (Current Status)

Owner อนุมัติให้แก้ 503, เก็บข้อมูลเดิม, เพิ่มเทสอัปเกรดฐานที่มีข้อมูล และ push โค้ดเพื่อ deploy เมื่อ 2026-11-09 โค้ด hotfix: `9eebc6f` — GitHub build/deploy ผ่าน และตรวจเว็บออนไลน์สำเร็จแล้ว

## งานที่เพิ่งทำเสร็จ (Recently Completed)

- ใช้ `server/sqlite-migrations.mjs` ร่วมกันระหว่าง Node และ Durable Objects
- รัน SQL ใน transaction โดย defer foreign-key checks แล้วตรวจ `PRAGMA foreign_key_check` ก่อน commit
- เมื่อ integrity check ผ่านจึงคืนค่า deferral; foreign-key enforcement ยังคงเปิดอยู่
- คงไฟล์ migration 004 เดิม เพื่อไม่เปลี่ยน SQL ที่บางฐาน apply สำเร็จแล้ว
- ไม่ reset database, ไม่สร้าง namespace ใหม่, ไม่เปลี่ยน secrets หรือกุญแจเข้ารหัส
- `npm run build`: ผ่าน; `npm test`: 40 ผ่าน; `npm run test:e2e`: 6 ผ่าน

## บันทึกการแก้บัค (Bug & Troubleshooting Log)

ก่อนแก้: schema ใหม่ผ่าน แต่ฐานเดิมที่มี users และแถวลูกใน orders/sessions/reviews ไม่สามารถ DROP/recreate users ได้ภายใต้ transaction ของ Durable Object จึงเกิด FOREIGN KEY constraint failed และ API 503

SQLite ไม่เปลี่ยน foreign_keys enforcement กลาง transaction และ DROP/recreate parent อาจเหลือ deferred counter แม้ parent keys ถูกคืนแล้ว Hotfix จึงตรวจทุกความสัมพันธ์จริงก่อนคืนค่า deferral การตรวจพบ orphan จะ throw และ rollback ทั้ง schema/data/migration marker

หลักฐาน regression: สร้าง schema 001–003 พร้อมผู้ใช้ 3 ราย, session, สินค้า/ราคา, ออเดอร์ที่ส่งแล้ว, ciphertext โค้ดที่ขายแล้วและพร้อมขาย, ledger, audit, review, reservation และ shop settings แล้วอัปเกรดด้วย production Commerce class บน workerd เปรียบเทียบทุกค่าเดิม อ่านโค้ดเก่าด้วย session เดิม และเปิด runtime ใหม่จาก storage เดิมสำเร็จ มี negative test ที่จงใจสร้าง orphan และยืนยัน rollback ไม่เหลือข้อมูล/ตารางครึ่งทาง

## สิ่งที่ยังค้างอยู่และปัญหาที่ทราบ (Pending & Known Issues)

- เว็บออนไลน์ https://astra-demo-133.pages.dev ผ่าน cloud QA 37/37 เมื่อ 2026-11-09T12:17:37.671Z
- GitHub Actions run 42615156072 ผ่านทั้ง Build and test / Deploy Cloudflare demo
- ยืนยัน deployment stamp ตรง `9eebc6f881ff14703f08889943834a64d7b64d87`, API SQLite และเส้นทางหน้าร้าน/ร้านค้า/หลังบ้านตอบปกติ
- D1 cutover และการเปิด payment provider จริงอยู่นอก hotfix นี้
- เทสใช้ข้อมูลสังเคราะห์ ไม่ได้ดึงบัญชีหรือโค้ดลูกค้าจริงลงเครื่อง

## Checklist งานต่อไป (Next Steps)

- [x] GitHub Build and test / Deploy Cloudflare demo ผ่าน
- [x] Pages deployment stamp ตรง hotfix และ API health ตอบ 200
- [x] ตรวจซื้อ TEST และดูโค้ดเดิมหลัง reload บนเว็บออนไลน์
- [x] เก็บ regression อัปเกรด populated workerd database ใน CI ทุกครั้ง
- [ ] เพิ่ม staging migration gate และซ้อม backup/recovery ก่อนเปลี่ยน schema รอบถัดไป

### เปิดดูฐานข้อมูล

ฐานจริงใช้ SQLite ใน Cloudflare Durable Objects (`Commerce`, binding `COMMERCE` ของ Worker `astra`) ไม่ใช่ D1 หรือ Supabase ขณะนี้ D1 ใน `db/wrangler.jsonc` ยังเป็น placeholder

เปิด Cloudflare Dashboard → Durable Objects → namespace ของ `astra`/`Commerce` → Data Studio → ชื่อ object `presentation` สำหรับข้อมูลหน้าสาธารณะ พื้นที่ทดลองส่วนตัวใช้ชื่อ `client:<space id>` แยกต่อ cookie เบราว์เซอร์ จึงไม่มีตารางรวมทุกพื้นที่ใน object เดียว

ตารางหลัก: `users`, `products`, `variants`, `inventory`, `orders`, `payments`, `ledger`, `schema_migrations` ดู marker ด้วย `SELECT name, applied_at FROM schema_migrations ORDER BY name;` ดูออเดอร์โดยไม่อ่าน secrets ด้วย `SELECT id, status, total, created_at FROM orders ORDER BY created_at DESC LIMIT 20;`

คู่มือ: https://developers.cloudflare.com/durable-objects/observability/data-studio/
