# Module: Backend / NOTT (Ownership)

แหล่ง requirement: [../requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md](../requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md) — ส่วน **§2 NOTT** เท่านั้น  
นอกขอบเขตทีมนี้: MARK (PM/Admin/CI) · BANK (Storefront UI) · Weekly QA ของ Mark

## สถานะปัจจุบันของฟีเจอร์นี้ (Current Status)

- Owner มอบหมายขอบเขต **NOTT = database + backend API + Payment/Delivery design**
- รีโปปัจจุบันคือ **ASTRA DIGITAL demo** (React SPA + `server/domain.mjs` + Cloudflare Worker/Durable Object SQLite) — **ยังไม่ใช่** monorepo Hono + D1 + `packages/contracts` ตาม shared prompt
- เอกสารที่ prompt อ้าง (`README_TH.md`, `docs/SOW_CHECKLIST.md`, `docs/MODULES_AND_API.md`, `docs/SECURITY.md`, `docs/SPRINT_01.md`, `db/migrations/0001_init.sql`) **ยังไม่มีในรีโปนี้**
- ยังไม่เปิด Roadmap / ยังไม่ลงมือโค้ดระบบหลัก — รอ Owner ตอบคำถามทิศทาง

## งานที่เพิ่งทำเสร็จ (Recently Completed)

- อ่าน prompt pack ทั้งไฟล์ แยกขอบเขต NOTT จาก MARK/BANK
- ตรวจของจริงในรีโป: ไม่พบ monorepo / D1 migration / contracts package
- ย้ายไฟล์ต้นทางเข้า `docs/requirements/`

## บันทึกการแก้บัค (Bug & Troubleshooting Log)

- ไม่มี (ยังไม่เริ่ม implement)

## สิ่งที่ยังค้างอยู่และปัญหาที่ทราบ (Pending & Known Issues)

- **Gap ใหญ่:** สเปกเป้าหมายใน prompt ≠ สแต็ก/โครง ASTRA ปัจจุบัน
- Payment provider ยังไม่ยืนยันจากลูกค้า → ทำได้แค่ `PaymentAdapter` interface ตาม NOTT brief
- Auth/RBAC ใน brief แยก design ก่อน แล้ว implement คนละ PR
- การประสาน `packages/contracts` กับ Mark/Bank ยังไม่มีแพ็กเกจจริงในรีโป

## Checklist งานต่อไป (Next Steps)

1. Owner ยืนยันทิศทางรีโป (evolve ASTRA vs รอ monorepo LCS ใหม่)
2. Agent ทำ Roadmap Sprint 1 เฉพาะ NOTT หลัง Approve
3. ตาม brief NOTT: ERD/migration → Product APIs → contracts → Auth design → PaymentAdapter (ไม่เปิด gateway) → idempotent allocation tests
