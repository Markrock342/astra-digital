# Module: Backend / NOTT (Ownership)

แหล่ง requirement: [../requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md](../requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md) — ส่วน **§2 NOTT**  
Roadmap: [../roadmaps/NOTT-SPRINT1.md](../roadmaps/NOTT-SPRINT1.md) (**Approved**)  
Inventory: [nott-backend-inventory.md](nott-backend-inventory.md) · Gap Map: [nott-gap-map.md](nott-gap-map.md)

## สถานะปัจจุบันของฟีเจอร์นี้ (Current Status)

- Milestone **0.1 เสร็จ** (inventory + gap map)
- ช่องว่างหลักเทียบ brief: D1, `packages/contracts`, PaymentAdapter, Auth/RBAC design doc, ตาราง payments/chat/notifications แยก, product detail API แยก
- ของที่มีแล้วและแข็ง: sandbox pay + encrypted inventory + idempotent allocation tests + RBAC พฤติกรรมในโค้ด
- ถัดไป: Task **0.2.1** Auth/RBAC design

## งานที่เพิ่งทำเสร็จ (Recently Completed)

- Task 0.1.1 inventory
- Task 0.1.2 gap map → ปิด M0.1

## บันทึกการแก้บัค (Bug & Troubleshooting Log)

- ไม่มี

## สิ่งที่ยังค้างอยู่และปัญหาที่ทราบ (Pending & Known Issues)

- ดูรายละเอียดใน [nott-gap-map.md](nott-gap-map.md) (R1–R5, dependency Mark/Bank/Client)
- โค้ด DB/API/Payment พักจนเกต 0.3.3

## Checklist งานต่อไป (Next Steps)

1. Task 0.2.1 Auth/RBAC design → 0.2.2 Owner Approve
2. Task 0.3.1–0.3.2 ERD + Payment/Fulfillment docs
3. Task 0.3.3 ปลดล็อก Phase 1+
