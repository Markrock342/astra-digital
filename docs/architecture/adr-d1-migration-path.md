# ADR: D1 migration path (ควบคู่ DO SQLite)

สถานะ: **Accepted** — Owner ปลดล็อก Phase 1 (2026-11-09)  
บริบท: brief NOTT ยึด D1 · ของ production เดโม่ปัจจุบันใช้ Worker + Durable Object SQLite

## Decision

ใช้ **dual-track schema** ในช่วง Sprint 1:

| แทร็ก | ที่อยู่ | ใช้กับ |
|-------|--------|--------|
| **A — ของเดิม (คงไว้)** | `server/migrations/*.sql` | Node local + Cloudflare Durable Object `Commerce` (`wrangler.jsonc` หลัก) |
| **B — เป้าหมาย brief** | `db/migrations/*.sql` | Cloudflare **D1** ผ่าน config แยก `db/wrangler.jsonc` |

ไม่ลบแทร็ก A จนกว่า Product API/Auth บน D1 ผ่านเทสและ Owner สั่ง cutover

## Consequences

- มีสองชุด schema ชั่วคราว — เอกสาร ERD เป้าหมายเป็นสัญญาของแทร็ก B
- Deploy เดโม่ลูกค้าบน DO **ไม่พัง** เพราะไม่บังคับ binding D1 ใน `wrangler.jsonc` หลักใน Task 1.1.1
- งาน apply migration D1 ใช้คำสั่งที่ชี้ `-c db/wrangler.jsonc` เท่านั้น
- การย้ายข้อมูล live DO → D1 เป็นงานคนละชุด (นอก Task 1.1.x ถ้ายังไม่สั่ง)

## Local D1 apply (เป้าหมาย)

```sh
npx wrangler d1 migrations apply astra-commerce --local -c db/wrangler.jsonc
```

สร้าง DB รีโมตเมื่อพร้อม (ไม่ทำใน 1.1.1 ถ้ายังไม่จำเป็น):

```sh
npx wrangler d1 create astra-commerce
# แล้วนำ database_id ใส่ db/wrangler.jsonc
```

## สถานะดำเนินการ

- [x] Task 1.1.1 โครง `db/` + config แยก  
- [x] Task 1.1.2 `db/migrations/0001_init.sql` + local apply  
- [x] Task 1.1.3 [erd-sprint1.md](erd-sprint1.md)

## Out of scope เอกสารนี้

- เปลี่ยน Worker ให้อ่าน D1 แทน DO → Phase 2–3+  
- Remote D1 create / production database_id  
- เปิด Payment gateway → ยังล็อก (Phase 4 / Client)
