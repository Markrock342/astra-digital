# Module: Backend / NOTT (Ownership)

Design: [../architecture/auth-rbac.md](../architecture/auth-rbac.md) · [../architecture/erd-target.md](../architecture/erd-target.md) · [../architecture/payment-fulfillment.md](../architecture/payment-fulfillment.md)  
D1 path: [../architecture/adr-d1-migration-path.md](../architecture/adr-d1-migration-path.md) · ERD applied: [../architecture/erd-sprint1.md](../architecture/erd-sprint1.md)  
Schema เป้า: `db/migrations/0001_init.sql` · ของเดิม: `server/migrations/` (ห้ามลบ)

## สถานะปัจจุบันของฟีเจอร์นี้ (Current Status)

- **Phase 1 / M1.1 เสร็จ** — มี D1 migration local แล้ว
- Phase 2–4 ยังล็อก
- Worker เดโม่ยังใช้ DO SQLite ตาม dual-track ADR

## งานที่เพิ่งทำเสร็จ (Recently Completed)

- ปลดล็อก Phase 1
- 1.1.1–1.1.3: ADR, `db/`, `0001_init.sql`, apply local, เอกสาร ERD sprint

## บันทึกการแก้บัค (Bug & Troubleshooting Log)

- `wrangler` ไม่ใน PATH → ใช้ `npx wrangler` ใน script `db:migrate:local`

## สิ่งที่ยังค้างอยู่และปัญหาที่ทราบ (Pending & Known Issues)

- Remote D1 ยังไม่สร้าง
- Cutover Worker → D1 ยังไม่ทำ
- Phase 2 Auth implement รอปลดล็อก

## Checklist งานต่อไป (Next Steps)

1. Owner ปลดล็อก Phase 2 เมื่อพร้อม
2. หรือสร้าง remote D1 + ใส่ database_id เมื่อจะใช้รีโมต
