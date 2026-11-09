# NOTT Sprint 1 — Gap Map

Task: **0.1.2** · วันที่: 2026-11-09  
เทียบ: brief §2 NOTT ↔ [nott-backend-inventory.md](nott-backend-inventory.md)  
Roadmap: [../roadmaps/NOTT-SPRINT1.md](../roadmaps/NOTT-SPRINT1.md)

สถานะคำย่อ: **มี** = ใช้ได้ในรีโปแล้ว · **บางส่วน** = มีแนวทาง/ของใกล้เคียงแต่ไม่ตรง brief · **ขาด** = ยังไม่มี · **พัก** = มีในแผนแต่ยังไม่ลงโค้ดจนกว่าเกต 0.3.3

---

## 1) เทียบ deliverables ตาม brief NOTT

| # | ข้อ brief | สถานะ | ของจริง / ช่องว่าง | แผนใน Roadmap |
|---|-----------|--------|---------------------|----------------|
| 1 | Review/fix ERD + constraints/indexes + migration: users, catalog, orders, payments, key inventory, allocations, preorder, chat, notifications, audit | **บางส่วน** | มี users/catalog/orders/inventory/preorder(`reservations`)/audit (+ reviews/ledger) ใน `server/migrations/001–003` · **ไม่มี** ตาราง `payments` / `allocations` แยก / `chat` / `notifications` · ยังเป็น DO SQLite ไม่ใช่ D1 · ไม่มี `db/migrations/0001_init.sql` | Phase 0.3.1 design → Phase 1 migration (**พักโค้ด**) |
| 2 | Catalog list + product detail API บน local D1 ไม่รั่ว key | **บางส่วน** | มี `GET /api/products` (list+variants ในก้อนเดียว) บน DO/local SQLite — ไม่คืน unused keys · **ไม่มี** product detail endpoint แยก · **ไม่มี** D1 | Phase 3 (**พักโค้ด**) |
| 3 | Publish I/O types → `packages/contracts` ตกลง Mark/Bank | **ขาด** | ไม่มีโฟลเดอร์ `packages/` | Phase 3.2 · dependency **Mark/Bank** agree |
| 4 | Auth/RBAC design ก่อน แล้ว implement คนละ PR; ไม่รับ role จาก client | **บางส่วน** | พฤติกรรมจริงมี session hash + CUSTOMER/ADMIN + เทสกัน role injection · **ยังไม่มีเอกสาร design** ตาม brief · implement ใหม่ต้องรอหลัง design | Phase 0.2 design → Phase 2 implement |
| 5 | Design PaymentAdapter เดียว — ห้ามเปิด SlipOK/Gateway จนกว่าลูกค้ายืนยัน | **ขาด** (ออกแบบ) / **พัก** (โค้ด) | มีแค่ sandbox `pay` + TEST top-up · ไม่มี adapter interface | Phase 0.3.2 doc → Phase 4.1 · dependency **Client** เลือก provider |
| 6 | Document + test idempotent payment / one-key-per-order-item; race/retry | **บางส่วน** | มี atomic allocate + unique fingerprint/ledger.reference + เทส race/retry ใน `tests/commerce.test.mjs` · ยังผูก sandbox ไม่ใช่ provider webhook replay | Phase 0.3.2 doc + Phase 4.2 ขยายเมื่อมี adapter |
| 7 | Deliver: migration, ERD, tested Product APIs, API Contract, Payment+Fulfillment proposal, blockers | **บางส่วน** | มีของใกล้เคียงใน demo · ชุด deliverable ตาม brief ยังไม่ครบเป็นแพ็กเกจ Sprint 1 | Phase 5 closeout |

---

## 2) เทียบโดเมนข้อมูล

| โดเมน brief | สถานะ | หมายเหตุ |
|-------------|--------|----------|
| users | **มี** | + username จาก 003 |
| catalog (products/variants) | **มี** | |
| orders | **มี** | |
| payments | **ขาด** ตารางแยก | logic อยู่ใน order/reservation + payment_hash |
| key inventory | **มี** | `inventory.secret` เข้ารหัส |
| allocations | **บางส่วน** | เป็นคอลัมน์ `inventory.order_id` ไม่ใช่ตาราง allocations |
| preorder | **มี** | ตาราง `reservations` |
| chat | **ขาด** | |
| notifications | **ขาด** | |
| audit | **มี** | |

---

## 3) เทียบ API / สัญญา

| รายการ | สถานะ | Dependency |
|--------|--------|------------|
| Catalog list | **มี** (`GET /api/products`) | — |
| Product detail แยก | **ขาด** | Bank อาจต้องการ shape ชัดใน contracts |
| ไม่รั่ว digital key ก่อนจ่าย | **มี** (พฤติกรรม + เทส) | — |
| Shared contracts package | **ขาด** | **Mark + Bank** รีวิว/agree |
| Admin/product write APIs | **มี** (นอก brief Sprint 1 หลัก แต่มีในรีโป) | Mark ใช้ Admin UI — นอก ownership NOTT UI |

---

## 4) Auth / Payment / Runtime gaps

| รายการ | สถานะ | ความเสี่ยงถ้าข้าม |
|--------|--------|-------------------|
| Auth/RBAC design doc | **มี** (Approved 2026-11-09) | — |
| Session + role server-side | **มี** | — |
| `demo-merchant` boundary | **มี** (workspace) | ต้องคงใน design ว่าไม่ใช่ production identity |
| D1 runtime | **ขาด** | งาน migration/API ตาม brief ยังไม่ตรงสภาพแวดล้อมเป้าหมาย |
| PaymentAdapter | **ขาด** | ห้าม activate provider |
| Gateway/SlipOK credentials | **BLOCKED** | รอ **Client** ยืนยัน provider + credentials เป็นลายลักษณ์ |
| Idempotent allocate tests | **มี** (sandbox) | ต้องเพิ่มเคส webhook replay เมื่อมี provider |

---

## 5) ความเสี่ยงหลัก (เรียงผลกระทบ)

| ID | ความเสี่ยง | ผลกระทบ | แนวกันในแผน |
|----|------------|----------|-------------|
| R1 | DO SQLite → D1 ไม่เทียบเท่า 1:1 | Phase 1–3 ล่าช้า / พฤติกรรม transaction ต่าง | ERD+ADR ใน 0.3/1.1 ก่อนย้ายหนัก |
| R2 | สร้าง `packages/contracts` โดยไม่มี Mark/Bank agree | สัญญาแตก งานคู่ขนานพัง | Phase 3.2 ทำ draft แล้วตั้ง BLOCKED จนมี agree |
| R3 | เปิด payment provider ก่อนลูกค้าเลือก | นอก brief / เสี่ยง credential | Phase 4 interface-only |
| R4 | ทำ Product API บน D1 ก่อน Auth design | ช่องโหว่สิทธิ์ | บังคับ 0.2 ก่อน Phase 2/3 ที่แตะข้อมูลผู้ใช้ |
| R5 | ขยาย chat/notifications ใน Sprint 1 เกินแรง | งานล้น | schema placeholder ใน ERD ได้ — ไม่ implement ลึกใน Sprint 1 นอก brief ขั้นต่ำ |

---

## 6) Dependency ภายนอก ownership NOTT

| ฝ่าย | ต้องการจากเขา | เราส่งให้เขา |
|------|----------------|--------------|
| **Mark** | Agree API contracts; Admin UI ไม่ใช่งานเรา; CI/ADR โครงสร้างใหญ่ถ้ากระทบ monorepo | Product/Admin API shapes, Auth design, ERD |
| **Bank** | Agree storefront contracts; ใช้ fixtures จนกว่า API พร้อม | Catalog/Product/Cart-related types เมื่อมี contracts |
| **Owner** | Approve design Phase 0; ปลดล็อก Phase 1+ ที่เกต 0.3.3 | Roadmap, Gap Map, design docs |
| **Client (ผู้ว่าจ้าง)** | เลือก payment provider + credentials | PaymentAdapter interface + blockers ชัดเจน |

---

## 7) สิ่งที่ทำได้ทันที vs ต้องพัก

### ทำได้ใน Phase 0 (เอกสาร — ไม่แตะโค้ด DB/API/Payment)
- [x] 0.1.1 Inventory
- [x] 0.1.2 Gap Map (เอกสารนี้)
- [ ] 0.2.1–0.2.2 Auth/RBAC design + Owner Approve
- [ ] 0.3.1 ERD เป้าหมาย
- [ ] 0.3.2 PaymentAdapter + Fulfillment proposal (เอกสาร)
- [ ] 0.3.3 Owner ปลดล็อก Phase 1+

### พักไว้หลังเกต 0.3.3
- Phase 1 D1 migration
- Phase 2 Auth implement PR
- Phase 3 Product APIs + contracts
- Phase 4 PaymentAdapter code + เทสขยาย
- Phase 5 Sprint closeout package

---

## 8) สรุปสั้นสำหรับ Owner

ของที่มีอยู่ครอบคลุมเดโม commerce ได้ดี (ซื้อ/ส่งโค้ด/กันซ้ำ/กันข้ามผู้ใช้) แต่เทียบ brief Sprint 1 ยังขาดชั้นเป้าหมายหลักสามอย่าง: **D1 + contracts package + PaymentAdapter design/implement แบบไม่เปิด gateway** และเอกสาร **Auth/RBAC design**  
Milestone 0.1 **ปิดได้** หลังเอกสารนี้ — ถัดไปเข้า **0.2 Auth/RBAC design**
