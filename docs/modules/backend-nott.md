# Module: Backend / NOTT (Ownership)

แหล่ง requirement: [../requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md](../requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md) — ส่วน **§2 NOTT**  
Roadmap: [../roadmaps/NOTT-SPRINT1.md](../roadmaps/NOTT-SPRINT1.md) (**Approved**)  
Inventory: [nott-backend-inventory.md](nott-backend-inventory.md) (Task 0.1.1 เสร็จ)

## สถานะปัจจุบันของฟีเจอร์นี้ (Current Status)

- Roadmap Phase 0–5 ถูก Approve แล้ว
- Task 0.1.1 เสร็จ: มี inventory ของ runtime/schema/API/domain/tests จากของจริงในรีโป
- ยังไม่มี D1 / Hono / `packages/contracts` / ตาราง payments·chat·notifications แยก
- ปลดล็อกโค้ด DB/API/Payment ยังผ่านเกต Task 0.3.3

## งานที่เพิ่งทำเสร็จ (Recently Completed)

- Approve Roadmap + Task Spec 0.1.1
- เขียน `docs/modules/nott-backend-inventory.md`

## บันทึกการแก้บัค (Bug & Troubleshooting Log)

- ไม่มี

## สิ่งที่ยังค้างอยู่และปัญหาที่ทราบ (Pending & Known Issues)

- Brief ชี้ D1 แต่ของปัจจุบันเป็น Durable Object SQLite
- Payment = sandbox บน order/reservation ยังไม่มี PaymentAdapter
- Chat/notifications ยังไม่มีใน schema/API

## Checklist งานต่อไป (Next Steps)

1. Task 0.1.2 Gap Map (มี/ขาด/ความเสี่ยง/dependency Mark–Bank)
2. Milestone 0.2 Auth/RBAC design
3. Milestone 0.3 ERD + Payment/Fulfillment design → เกต 0.3.3
