# Module: Backend / NOTT (Ownership)

Auth: [../architecture/auth-rbac.md](../architecture/auth-rbac.md) · โค้ด `server/auth-policy.mjs`  
D1: [../architecture/adr-d1-migration-path.md](../architecture/adr-d1-migration-path.md) · `db/migrations/0001_init.sql`

## สถานะปัจจุบันของฟีเจอร์นี้ (Current Status)

- **Phase 2 / M2.1 เสร็จ** — verified auth ตาม design
- Phase 3–4 ยังล็อก
- `npm test` 20 passed (รวมเคส role injection / expired session / anonymous 401)

## งานที่เพิ่งทำเสร็จ (Recently Completed)

- ปลดล็อก Phase 2
- `auth-policy.mjs` + เชื่อม domain + เทสใหม่

## บันทึกการแก้บัค (Bug & Troubleshooting Log)

- ไม่มีในรอบนี้

## สิ่งที่ยังค้างอยู่และปัญหาที่ทราบ (Pending & Known Issues)

- Product API บน D1 (Phase 3) ยังไม่ทำ
- PaymentAdapter code (Phase 4) ยังล็อก
- Worker ยังเป็น DO dual-track

## Checklist งานต่อไป (Next Steps)

1. รอ Owner ปลดล็อก Phase 3
2. หรือสั่งงานอื่น
