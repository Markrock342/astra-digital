# Roadmap: NOTT Sprint 1 — Backend / DB / API / Payment·Delivery

สถานะ: **Approved** โดย Owner (2026-11-09) — Approve โครงสร้าง Phase 0–5  
หมายเหตุปลดล็อกโค้ด DB/API/Payment: ยังผ่านเกต **Task 0.3.3** หลังจบ Phase 0 design  
ระบบ: ASTRA DIGITAL (`Markrock342/astra-digital`)  
Ownership: **NOTT เท่านั้น** (ไม่รวม Admin UI ของ Mark / Storefront ของ Bank)  
แหล่ง brief: [../requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md](../requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md) §2  
อัปเดต: 2026-11-09

## หลักการจัดความสำคัญ

| ลำดับ | เหตุผล |
|------|--------|
| 1 | รู้ของจริงในรีโปก่อน (ห้ามเดา schema/API) |
| 2 | Security design ก่อน implement (Auth/RBAC ตาม brief) |
| 3 | ออกแบบข้อมูล/สัญญาที่ทีมอื่นพึ่งพา ก่อนลงโค้ดหนัก |
| 4 | Schema D1 → Auth จริง → Product API → Contracts |
| 5 | Payment เป็น interface + เทส idempotency — **ห้ามเปิด gateway** จนกว่าลูกค้ายืนยัน provider |

**ขอบเขตที่พักไว้ก่อนตาม Owner:** ยังไม่ลงมือโค้ด DB migration / Product API / Payment จนกว่า Phase 0 ผ่านและ Owner ปลดล็อก Phase ถัดไป (หรือ Approve ให้เดินต่อทั้งแผนก็ได้)

**นอกขอบเขต Sprint นี้:** Admin shell, Storefront UI, CI ของ Mark, เปิด SlipOK/Gateway จริง, chat/notifications ลึกเกิน schema/placeholder ตาม brief

---

```
Module/Project: ASTRA — NOTT Backend Sprint 1

Phase 0: Foundation & Design - วางฐานเอกสารและความปลอดภัยก่อนแตะโค้ดระบบหลัก
  Milestone 0.1: Inventory & Gap Map - มีแผนที่ของจริง ↔ brief ที่ตรวจแล้ว
    Task 0.1.1: สำรวจ backend/schema/API ที่มีในรีโปและสรุป inventory
      Tech Note: อ่าน server/migrations/*.sql, domain.mjs, api-handler.mjs, cloud/worker.mjs, docs/architecture.md, feature-matrix, production-gap; ห้ามเดา endpoint ที่ไม่มีในโค้ด
    Task 0.1.2: เขียน Gap Map NOTT Sprint 1 (มี / ขาด / ความเสี่ยง / dependency Mark-Bank)
      Tech Note: เก็บ docs/modules/backend-nott.md หรือ docs/modules/nott-gap-map.md; ลิงก์จาก docs/index.md; ระบุชัดส่วนที่พัก DB/API/Payment

  Milestone 0.2: Auth/RBAC Design - มีเอกสารออกแบบก่อน PR implement
    Task 0.2.1: ร่าง Auth/RBAC design (actors, roles, guards, session, demo-merchant boundary)
      Tech Note: อิงพฤติกรรมจริง (CUSTOMER/ADMIN, session hash, /api/demo-merchant, never trust client role); ไฟล์แนะนำ docs/architecture/auth-rbac.md; เคสเชิงลบที่ต้องมีตอน implement
    Task 0.2.2: Owner รีวิว/Approve เอกสาร Auth/RBAC
      Tech Note: ยังไม่เขียนโค้ด auth ใหม่ใน Phase นี้; แก้ตามฟีดแบ็กให้ปิด Milestone

  Milestone 0.3: Target Data & Flow Designs - ออกแบบเป้าหมาย D1 + Payment/Fulfillment แบบเอกสาร
    Task 0.3.1: ร่าง ERD เป้าหมาย (users, catalog, orders, payments, inventory, allocations, preorder, chat, notifications, audit)
      Tech Note: เทียบของเดิม 001–003; ระบุ constraints/indexes/unique ที่ต้องมีเพื่อกันซ้ำโค้ดและ replay; ยังไม่เขียน migration รันได้
    Task 0.3.2: ร่าง PaymentAdapter + Fulfillment flow (proposed) โดยไม่ผูก provider จริง
      Tech Note: interface เดียว; money เป็น integer satang; ไม่ส่ง key ก่อน verified payment; ระบุ idempotency keys และ one-key-per-order-item; ห้ามใส่ credentials
    Task 0.3.3: Owner Approve ชุด design Phase 0 และตัดสินใจปลดล็อก Phase 1+
      Tech Note: จุดโก-โนโก้ของ DB/API/Payment implementation

Phase 1: D1 Schema Foundation - มี migration/schema เป้าหมายตาม brief (หลังปลดล็อก)
  Milestone 1.1: Migration skeleton & local D1 path
    Task 1.1.1: ตัดสินโครงสร้างโฟลเดอร์ migration เป้าหมาย (เช่น db/migrations) ให้สอดคล้อง brief โดยไม่ทำลายของเดิมก่อนมีแผนย้าย
      Tech Note: ของปัจจุบันอยู่ server/migrations + Durable Object; บันทึก ADR สั้นใน docs/architecture/ หรือ modules; ยึด D1 ตาม brief
    Task 1.1.2: เขียน migration เริ่มต้นจาก ERD ที่ Approve แล้ว + ตรวจ constraints/indexes
      Tech Note: append-only; มีหลักฐาน apply กับ local D1 (คำสั่งจริง); ห้ามใส่ seed key จริง/plaintext ใน repo
    Task 1.1.3: เอกสาร ERD สุดท้ายของ Sprint 1 + ผลกระทบ deploy/rollback
      Tech Note: อัปเดต docs ให้ตรงความจริง; ระบุ blockers ถ้า DO→D1 ยังไม่ครบ

Phase 2: Verified Auth Implementation - Auth จริงตาม design (PR แยกตาม brief)
  Milestone 2.1: Server-side auth guards
    Task 2.1.1: Implement authenticated session verification ตาม Auth design
      Tech Note: เก็บแค่ token hash; ไม่รับ role จาก client; เทส unauthorized
    Task 2.1.2: Implement RBAC checks (CUSTOMER vs ADMIN) + เคสข้ามผู้ใช้
      Tech Note: security negative tests บังคับ; demo-merchant ต้องไม่ promote คนละ workspace/ขอบเขตที่ design กำหนด
    Task 2.1.3: เทส + อัปเดต docs Auth ให้ตรงโค้ด
      Tech Note: หลักฐานคำสั่งเทส; อัปเดต CURRENT.md

Phase 3: Catalog Product APIs & Contracts - API สินค้าปลอดภัย + สัญญาแชร์ทีม
  Milestone 3.1: Product read APIs
    Task 3.1.1: Implement catalog list API ต่อ local D1
      Tech Note: ไม่คืน encrypted/plaintext unused keys; ราคา/สต็อกเป็นค่า server-owned
    Task 3.1.2: Implement product detail API + เทสไม่รั่ว key
      Tech Note: เคสเชิงลบ: unauthenticated key read ต้องล้มเหลวถ้ามี endpoint ที่เกี่ยวข้อง
    Task 3.1.3: เทส integration/contract ของ Product APIs
      Tech Note: รันเทสจริง; บันทึกคำสั่ง+ผล

  Milestone 3.2: Shared contracts package
    Task 3.2.1: สร้าง/เผยแพร่ input-output types ใน packages/contracts (หรือโครงเทียบเท่าที่ตกลงในรีโป)
      Tech Note: รีโปยังไม่มี packages/; ต้องออกแบบโครงให้ Mark/Bank ใช้ได้โดยไม่เดาสคีมา
    Task 3.2.2: เอกสาร API Contract + จุดที่รอ agree จาก Mark/Bank
      Tech Note: ระบุ BLOCKED ถ้าฝั่งอื่นยังไม่รีวิว; ห้าม invent completed integration

Phase 4: Payment Adapter & Idempotent Fulfillment - ออกแบบ+ทดสอบโดยไม่เปิด gateway จริง
  Milestone 4.1: PaymentAdapter interface
    Task 4.1.1: Implement PaymentAdapter interface (ไม่ activate SlipOK/Gateway)
      Tech Note: ไม่ใส่ credentials; sandbox/test double ได้ถ้าจำเป็นต่อเทส
    Task 4.1.2: เอกสาร proposed Payment flow + blockers รอลูกค้าเลือก provider
      Tech Note: deliverable ตาม brief; อัปเดต production-gap/module

  Milestone 4.2: Idempotent allocation
    Task 4.2.1: Implement/ปรับ one-key-per-order-item + unique constraints ตาม design
      Tech Note: DB atomicity; ห้ามส่ง key ก่อน verified payment
    Task 4.2.2: เทส race/retry/duplicate callback และ last-code contention
      Tech Note: หลักฐานเทสบังคับ; อิงพฤติกรรม domain เดิมถ้ายังใช้ชั้นร่วม
    Task 4.2.3: เอกสาร Fulfillment flow สุดท้ายของ Sprint 1
      Tech Note: DONE/NOT DONE/BLOCKERS

Phase 5: Sprint 1 Closeout - สรุปส่งมอบ NOTT
  Milestone 5.1: Delivery package
    Task 5.1.1: รวบรวม deliverables: migration, ERD, tested Product APIs, API Contract, Payment+Fulfillment proposal, blockers
      Tech Note: อัปเดต docs/status/CURRENT.md + modules/backend-nott.md; ไม่ overclaim
    Task 5.1.2: Self-QC ตาม DoD + commit ตามกติกา (ห้าม push docs/schema; push โค้ดเมื่อ Owner สั่ง)
      Tech Note: แยก commit โค้ด vs docs/schema
```

---

## ลำดับเดินงานที่แนะนำหลัง Approve

1. ทำ **Phase 0** ให้จบและให้ Owner เซ็น design  
2. Owner ปลดล็อก → **Phase 1 → 2 → 3 → 4 → 5** ตาม dependency  
3. ถ้าต้องตัดขอบเขต Sprint: คง Phase 0 + Auth design ไว้ก่อนเสมอ; ตัด Phase 4 activation (ไม่มีอยู่แล้ว) หรือเลื่อน D1 เฉพาะเมื่อ Owner สั่งเป็นลายลักษณ์

## ความเสี่ยงหลัก

| ความเสี่ยง | ผล | แนวกัน |
|-----------|-----|--------|
| DO SQLite → D1 ไม่ตรง 1:1 | migration/API ช้า | ERD + ADR ใน Phase 0/1 ก่อนย้ายหนัก |
| ไม่มี `packages/contracts` | Mark/Bank รอ | โครง contracts ใน Phase 3.2 ชัดเจน เป็น BLOCKED จนมี agree |
| เปิด payment ก่อนลูกค้าเลือก provider | นอก brief / ความเสี่ยง credential | Phase 4 interface-only |
| ทำ API ก่อน Auth design | สิทธิ์รั่ว | บังคับ Phase 0.2 ก่อน Phase 2/3 ที่ต้องป้องกันข้อมูล |

## เกณฑ์ Approve Roadmap นี้

Owner ตอบอย่างน้อย:
- [x] ยอมรับลำดับ Phase 0 → 5 (Approved 2026-11-09)
- [ ] ยืนยันว่าหลัง Phase 0 แล้วให้เดิน Phase 1+ ได้ หรือยังล็อกเฉพาะข้อใด → **กำลังรอที่ Task 0.3.3** (Auth/ERD/Payment docs พร้อมรีวิว)
- [x] ไม่ขอแก้ชื่อ Milestone/Task ก่อนเริ่ม Task 0.1.1
