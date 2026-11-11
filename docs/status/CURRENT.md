# สถานะปัจจุบัน (CURRENT)

อัปเดตล่าสุด: 2026-11-11

## ตำแหน่งงานปัจจุบัน
| ระดับ | ค่า |
|-------|-----|
| โปรเจกต์ | ASTRA — NOTT MIG-005 |
| Roadmap | [NOTT-POST-REVIEW-11NOV.md](../roadmaps/NOTT-POST-REVIEW-11NOV.md) |
| Current Task | **MIG-005** — credential + preorder schema |
| Branch | `feat/mig-005-credential-preorder` |
| สถานะ | เปิด PR รอ Mark Review — **ยังไม่ deploy** |

## MIG-005 (รอบนี้)
- ไฟล์: `server/migrations/005_credential_preorder_indexes.sql` + `server/migrate-005.mjs`
- rebuild `inventory` (login_id_enc/password_enc/legacy + reservation_id XOR) และ `reservations` (DELIVERED + delivered_*)
- index `orders/reservations(status, created_at)`
- import ใน `cloud/worker.mjs` + เทสต์ MU3 list=โฟลเดอร์
- เทสต์อัปเกรด MU1/MU2/MU5 · `npm test` 57 passed
- **ยังไม่** flip `features.credentialPair` / `preorderDelivery` · ยังไม่ implement deliver route · **ห้าม deploy**

## ค่าที่ล็อกแล้ว (มาร์ค)
- คิว = `after_payment` + รวมทั้งร้าน
- ส่งของ = `POST /api/admin/reservations/:id/deliver` (ADMIN) — รอ API หลัง 005 merge
- Legacy = login=โค้ดเดิม, password="", ธง legacy · นับแถวก่อน ถ้า 0 ข้าม

## Deploy ล่าสุดบน main (ก่อน MIG-005)
- Worker/Pages จาก `0b97c90` / `4b520a3` — ดูประวัติ deploy ใน changelog
- `features` ทั้งคู่ยัง `false` จนกว่า API คู่/ส่งของพร้อม
