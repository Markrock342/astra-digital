# สถานะปัจจุบัน (CURRENT)

อัปเดตล่าสุด: 2026-11-09

## ตำแหน่งงานปัจจุบัน
| ระดับ | ค่า |
|-------|-----|
| โปรเจกต์ | ASTRA DIGITAL — **NOTT = Database** |
| Roadmap | [NOTT-DB-ARCHITECTURE.md](../roadmaps/NOTT-DB-ARCHITECTURE.md) (**Approved**) |
| Phase | 0–5 Review Pack บน branch `feat/nott-database-audit` |
| ฐานโค้ดต้นทาง | `main` @ `9eebc6f` |

## ส่งมอบรอบนี้ (docs only)
- [x] `docs/database/DB_AUDIT.md`
- [x] `docs/database/ERD.md`
- [x] `docs/database/SCHEMA_PROPOSAL.md`
- [x] `docs/database/DATA_INTEGRITY.md`
- [x] `docs/database/MIGRATION_PLAN.md`
- [x] `docs/database/DB_TEST_PLAN.md`
- [x] PR → Mark Review: https://github.com/Markrock342/astra-digital/pull/1

## ยังไม่ทำ (ตามโจทย์)
- Deploy migration / เปลี่ยน production DB
- แก้ `004_commerce_ops.sql`
- แก้ Worker ฐานร้านเดียว (รอ Mark ล็อก)
- SlipOK / Gateway / Frontend

## Blockers ส่ง Mark
1. ยืนยันฐานร้านเดียวบน DO  
2. ล็อกตารางถัดไป (payment_events / order_items / categories / cart)  
3. แช่แข็ง D1 จนกว่ามี cutover plan
