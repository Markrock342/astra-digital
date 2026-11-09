# NOTT Sprint 1 — Delivery Package

วันที่ปิด: **2026-11-09**  
Ownership: **NOTT** (Backend / DB / API / Payment·Delivery)  
รีโป: `Markrock342/astra-digital` (ASTRA; FIFA = ชื่อย่อผู้ว่าจ้าง)  
Roadmap: [../roadmaps/NOTT-SPRINT1.md](../roadmaps/NOTT-SPRINT1.md)

## สรุปสั้น

Sprint 1 ของ NOTT **ปิดตามขอบเขตที่ Approve** — มี migration D1 เป้า, Auth/RBAC, Product API บน schema D1, contracts draft, PaymentAdapter แบบ sandbox + fulfillment idempotent  
**ยังไม่** เปิด gateway จริง, **ยังไม่** cutover Worker เดโมไป D1 ทั้งหมด, **ยังไม่** claim production-ready

## หลักฐานรันจริง (Self-QC)

| คำสั่ง | ผล (2026-11-09) |
|--------|------------------|
| `npm test` | **27 passed** / 0 failed |
| `npm run db:migrate:local` | `No migrations to apply` (0001 ถูก apply แล้ว) |

## Deliverables ตาม brief NOTT

| Brief deliverable | สถานะ | ที่อยู่ / หลักฐาน |
|-------------------|--------|-------------------|
| Migration | **DONE** (local D1 track) | `db/migrations/0001_init.sql` · ADR [../architecture/adr-d1-migration-path.md](../architecture/adr-d1-migration-path.md) |
| ERD | **DONE** | [../architecture/erd-target.md](../architecture/erd-target.md) · [../architecture/erd-sprint1.md](../architecture/erd-sprint1.md) |
| Tested Product APIs | **DONE** (D1 schema local) | `GET /api/d1/products` · `GET /api/d1/products/:id` · `tests/d1-catalog.test.mjs` |
| API Contract | **DONE (draft)** | `packages/contracts` · [../modules/api-contract-catalog.md](../modules/api-contract-catalog.md) — **รอ Mark/Bank agree** |
| Proposed Payment + Fulfillment | **DONE (sandbox)** | [../architecture/payment-fulfillment.md](../architecture/payment-fulfillment.md) · `server/payment/adapters.mjs` · `server/d1/fulfillment.mjs` |
| Auth/RBAC design + implement | **DONE** | [../architecture/auth-rbac.md](../architecture/auth-rbac.md) · `server/auth-policy.mjs` |
| Blockers | **DOCUMENTED** | ดูด้านล่าง |

## Phase checklist

| Phase | ผล |
|-------|-----|
| 0 Foundation & Design | Approved + docs |
| 1 D1 Schema | M1.1 เสร็จ |
| 2 Auth | M2.1 เสร็จ |
| 3 Catalog + Contracts | เสร็จ (contracts draft) |
| 4 PaymentAdapter + Fulfillment | เสร็จ (sandbox only) |
| 5 Closeout | เอกสารนี้ |

## DONE

- Dual-track: คง `server/migrations` (DO/Node) + เพิ่ม `db/migrations` (D1 เป้า)
- ไม่รับ role จาก client; เทสเชิงลบ auth
- Catalog ไม่รั่ว inventory secret
- Sandbox pay + one-key allocation + race/idempotent tests
- SlipOK/Gateway ถูกบล็อกชัดเจน (501)

## NOT DONE (ตั้งใจ / นอกขอบเขต Sprint นี้)

- Activate SlipOK หรือ payment gateway จริง
- Remote D1 `database_id` production + Worker cutover จาก Durable Object
- Mark/Bank formal agree บน `@astra/contracts`
- Email recovery / MFA / permanent multi-tenant org
- Chat/notifications API ลึก (มีแค่ schema placeholder)
- Push โค้ด/docs ขึ้น GitHub (รอ Owner สั่ง; docs ห้าม push ตามกติกาทีม)

## BLOCKERS

| ID | Blocker | รอใคร |
|----|---------|-------|
| B1 | เลือก payment provider + credentials | **Client** |
| B2 | Agree API contracts | **Mark / Bank** |
| B3 | สร้าง remote D1 + ตัดสินใจ cutover เดโม | **Owner** (+ infra) |

## ไฟล์โค้ดหลักที่เพิ่มใน Sprint

- `db/migrations/0001_init.sql`, `db/wrangler.jsonc`
- `server/auth-policy.mjs`
- `server/d1/db.mjs`, `catalog.mjs`, `fulfillment.mjs`
- `server/payment/adapters.mjs`
- `packages/contracts/**`
- เทส: `tests/d1-catalog.test.mjs`, `tests/d1-fulfillment.test.mjs` (+ ขยาย commerce auth)

## คำแนะนำหลัง Sprint

1. ส่ง contracts ให้ Mark/Bank รีวิว  
2. ถาม Client เรื่อง provider  
3. เมื่อพร้อม: สร้าง remote D1 แล้วค่อยวางแผน cutover Worker (งานใหม่ — คนละ Roadmap)  
4. Owner สั่ง **push โค้ด** เมื่อต้องการแชร์ (ห้าม push `docs/` ตามกติกา)
