# Roadmap: NOTT Database Architecture (Review Pack)

สถานะ: **Approved** โดย Owner (2026-11-09) — กำลังทำบน `feat/nott-database-audit`  
ฐานโค้ดเริ่มต้น: `9eebc6f` (`main`)  
โจทย์: LCS TASK DB-01…05 + checklist 7 ข้อ + ข้อเสนอฐานร้านเดียว (DO SQLite)  
**รอบนี้ยังไม่ Deploy Migration / ไม่เปลี่ยน Production DB**  
ค่าเริ่มต้นที่อิงโจทย์: ฐานร้านเดียวบน DO · ไม่ย้าย D1 · แช่แข็ง D1 เป็นแทร็กเงา · ERD ครอบคลุมโมดูลครบแม้ตารางยังไม่มี

## สรุปวิเคราะห์สั้นๆ (จากรีโปจริง)

| จุด | ของจริงในรีโป |
|-----|----------------|
| Runtime หลัก (Cloud) | Durable Object SQLite ผ่าน `cloud/worker.mjs` + `server/migrations/001–004` |
| แทร็กคู่ | D1 ที่ `db/migrations/0001–0002` (ยังไม่ cutover) — ADR เดิมยังชี้ dual-track |
| Isolation ปัจจุบัน | คุกกี้ `astra_space` → คนละ DO instance → **สต็อกไม่ร่วมกัน** |
| Schema DO หลัง 004 | users(+STAFF), sessions, products, variants, orders, inventory, reservations(+queue), payments, payment_channel, ledger(+DEMO_CREDIT), reviews, audit, runtime_flags, chat_*, notifications |
| Schema D1 เป้า | ใช้ชื่อ `inventory_units` + `allocations` (คนละรูปกับ DO `inventory.order_id`) |
| เอกสารเดิมที่ต้อง reconcile | `docs/architecture/erd-target.md`, `erd-sprint1.md`, `adr-d1-migration-path.md` |
| อัปเดตล่าสุดจากทีม | `sqlite-migrations.mjs` + `tests/migration-upgrade.test.mjs` แก้ 004 บนฐานที่มีข้อมูลแล้ว |

## ข้อเสนอที่ต้องให้มาร์ค/Owner ล็อก (Blockers — ไม่ตัดสินใจเอง)

1. **ฐานร้านเดียวบน DO SQLite** — ไม่ย้าย D1 ในรอบนี้; แก้ทางเข้าที่ `cloud/worker.mjs` ให้ชี้ `idFromName` คงที่; แยกลูกค้าด้วย session เท่านั้น (ตามข้อความน็อต)  
2. **คงไฟล์ `004_commerce_ops.sql` ไม่แก้** — การปรับ schema ใหม่ทำเป็น migration ถัดไปหลัง Review เท่านั้น  
3. **Cart / Order Items / Categories / Payment Events** — checklist ขอครบ แต่ schema ปัจจุบันเป็น order ต่อ variant เดียว + `category` เป็น TEXT — เสนอเป็นตารางใหม่หรือคงแบบเดิม?  
4. **dual-track D1** — คงเป็นเอกสารเงา / แช่แข็ง / หรือ sync ภายหลัง?

---

```
Module/Project: ASTRA — NOTT Database Ownership (Review First)

Phase 0: Sync & Branch — เตรียมพื้นที่ทำงาน
  Milestone 0.1: ยืนยันฐานโค้ดล่าสุด + สร้าง branch
    Task 0.1.1: สร้าง `feat/nott-database-audit` จาก main ล่าสุด
      Tech Note: ตอนนี้ local = 9eebc6f; หลัง Approve ค่อย branch
    Task 0.1.2: อัปเดต docs/status + ลิงก์สารบัญไปชุด docs/database/
      Tech Note: ห้ามแตะ production DB / ห้าม deploy migration

Phase 1: Database Audit (DB-01) — ตรวจของเดิมก่อนออกแบบใหม่
  Milestone 1.1: Audit dual-track + อ้างอิงไฟล์/บรรทัด
    Task 1.1.1: ตรวจ DO path (`cloud/worker.mjs`, `server/migrations/*`, `server/sqlite-migrations.mjs`)
      Tech Note: โฟกัส astra_space → idFromName / presentation vs tenant space
    Task 1.1.2: ตรวจ D1 path (`db/migrations/*`, `db/wrangler.jsonc`)
      Tech Note: เทียบชื่อตาราง inventory vs inventory_units/allocations
    Task 1.1.3: สรุปตาราง / FK / UNIQUE / INDEX + จุดซ้ำซ้อน/เสี่ยงสูญหาย
      Tech Note: Deliverable → docs/database/DB_AUDIT.md
    Task 1.1.4: ระบุจุดต้องปรับปรุง + Blocker ส่งมาร์ค
      Tech Note: รวมข้อเสนอฐานร้านเดียว; ยังไม่แก้ worker ใน Phase นี้

Phase 2: ERD & Schema Proposal (DB-02) — ออกแบบครบโมดูล Digital Goods
  Milestone 2.1: ERD ครอบคลุม 9 กลุ่มที่โจทย์กำหนด
    Task 2.1.1: ร่าง ERD จากของจริง + ช่องว่าง (Users/Sessions/Roles … Audit)
      Tech Note: Deliverable → docs/database/ERD.md (อ้างอิง erd-target เดิม ไม่ทับไฟล์เก่า)
    Task 2.1.2: SCHEMA_PROPOSAL — PK/FK/UNIQUE/INDEX + ตารางที่เสนอเพิ่ม/คง/เลิกใช้
      Tech Note: Deliverable → docs/database/SCHEMA_PROPOSAL.md; ระบุชัดว่า 004 ไม่แก้ไฟล์เดิม
    Task 2.1.3: Map checklist รูปภาพ 7 ข้อ ↔ deliverables
      Tech Note: ข้อ 1–3 ≈ Phase1–2; ข้อ 4–6 ≈ Phase3–5; ข้อ 7 = ส่งมาร์คผ่าน PR

Phase 3: Data Integrity (DB-03) — กติกา Transaction / Idempotency
  Milestone 3.1: ป้องกัน race / callback ซ้ำ / สถานะผิดลำดับ / ข้ามบัญชี
    Task 3.1.1: เขียน DATA_INTEGRITY สำหรับ 7 ความเสี่ยงในโจทย์
      Tech Note: อิงเทสที่มีแล้ว (commerce / nott-ops / migration-upgrade) + ช่องว่าง
    Task 3.1.2: กำหนดขอบเขตสิทธิ์คิว แชท ข้อความ อันดับผู้ซื้อ + ห้ามโค้ดใน API สินค้า
      Tech Note: สอดคล้องข้อตกลงน็อต; ยังไม่เปิด SlipOK/Gateway
      Deliverable → docs/database/DATA_INTEGRITY.md

Phase 4: Migration Plan (DB-04) — แผนอย่างเดียว ยังไม่รันบน production
  Milestone 4.1: ลำดับ migration + backup/recovery + test บนฐานมีข้อมูล
    Task 4.1.1: ระบุ 001–004 / D1 0001–0002 ที่ต้องเก็บ
    Task 4.1.2: ร่างลำดับไฟล์ถัดไป (เช่น 005_*) โดยยังไม่ commit SQL deploy
    Task 4.1.3: Backup / Recovery / upgrade test strategy
      Tech Note: Deliverable → docs/database/MIGRATION_PLAN.md; ห้าม apply จริงนอก local fixture ในรอบ Review

Phase 5: Database Test Plan (DB-05) + ส่งมาร์ค
  Milestone 5.1: Test cases + PR
    Task 5.1.1: DB_TEST_PLAN — FK, UNIQUE, concurrent, key allocation, duplicate payment, migration, isolation
      Tech Note: Deliverable → docs/database/DB_TEST_PLAN.md
    Task 5.1.2: เปิด Pull Request → มาร์ค Review (รายงาน Task ID, Commit SHA, ผลตรวจ, Blocker)
      Tech Note: push เฉพาะเมื่อ Owner สั่ง; แยก commit โค้ด vs docs ตามกติกาทีม
```

## ลำดับส่งงานที่แนะนำ (ตรงเป้า 2 วันทำการ)

| วัน | ส่ง | ตรงโจทย์ |
|-----|------|----------|
| วัน 1 | Phase 0–1 เสร็จ + ร่าง Phase 2 เริ่ม | **DB Audit + ERD ฉบับร่าง** |
| วัน 2 | Phase 2 ปิด + ร่าง Phase 3 | Schema Proposal + Integrity ต้นฉบับ |
| ถัดไปหลังมาร์คล็อก | Phase 3–5 ปิด + PR | Integrity / Migration Plan / Test Plan ครบ Acceptance |

## นอกขอบเขตรอบนี้ (ตามโจทย์)

- Frontend / Bank UI  
- เชื่อม SlipOK หรือ Gateway จริง  
- เปลี่ยน Architecture หลักโดยไม่ได้รับอนุมัติ  
- Deploy Database หรือ Migration จริง  
- แก้ `004_commerce_ops.sql` หรือย้าย D1 ก่อนมาร์คล็อก
