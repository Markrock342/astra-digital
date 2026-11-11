# Roadmap: NOTT หลังผลตรวจ 11 พ.ย.

สถานะ: **เสนอ รอมาร์คล็อก** (อัปเดตตามรีวิวมาร์ครอบ 2 — ไม่ใช่ Approved)  
ฐาน: `origin/main` (มี shop DO `141ffad`, ranking `22657a2`, API-FIX-02/03/04 merged)  
กติกา: **1 PR = 1 Task ID** · rebase ทับ main ก่อน · ให้มาร์ครีวิว  
**ห้ามแตะ** shop DO ใน `cloud/worker.mjs` (มาร์คทำแล้ว)  
**ยังไม่เขียน migration 005** จนกว่า #6 #7 #9 แก้และ **merge**

## ค่าที่เสนอ รอมาร์คล็อก / ที่มาร์คตอบแล้ว

| หัวข้อ | ค่า |
|--------|-----|
| ลำดับ merge | `#4 → #6 → #7 → #9 → #8 → #10 → #5 → #11` (#15 ปิดแล้ว) |
| Legacy credential | `login_id` = โค้ดเดิม, `password` = `""` + ธงของเก่า; นับแถวก่อน 005 |
| Shop data | **S1** ฐานว่าง (`141ffad`) — ตัด S2 |
| Deliver พรีออเดอร์ | **ADMIN เท่านั้น** |
| คิว | รวมทั้งร้าน; default `after_payment`; `on_create` ต้องมี expiry (เสนอ 30 นาที) |
| `price >= 0` | ตัดทิ้งรอบนี้ |
| Fingerprint | HMAC-SHA256(serverKey, JSON canonical) — ห้าม SHA-256 เปล่า |

## สถานะ PR (หลังรีวิวมาร์ค)

| PR | Task | สถานะ |
|----|------|--------|
| #12 #13 #14 | API-FIX-02…04 | **merged** บน main |
| #4 | DB-DOC-06 | แก้ wording แล้ว รอ merge |
| #6 #7 #9 | credential / preorder / migration | แก้ตามรีวิวแล้ว รอ merge (ก่อน 005) |
| #8 #10 #5 | ranking docs / queue / roadmap | แก้ตามรีวิวแล้ว รอ merge |
| #11 | API-FIX-01 | ต้องแก้ openChat rate/throttle + ตัด ranking hunk |
| #15 | Self-QC report | **ปิดแล้ว** |
| (ใหม่) | API-FIX-05 | ย้าย staffOrders cursor/limit เข้า SQL |

---

```
Module/Project: ASTRA — NOTT Post-Review 11 Nov (rewiew-rework)

Phase R: Mark Review Rework
  Milestone R.0: Sync
    Task R.0.1: rebase ทุก PR ทับ main · ปิด #15
  Milestone R.1: Docs ตามลำดับ merge
    Task R.1.1 [DB-DOC-06 / #4]: ตัด Approved/Owner lock → เสนอ รอมาร์คล็อก
    Task R.1.2 [DB-DOC-01 / #6]: HMAC fingerprint + rebuild inventory รวม reservation_id
    Task R.1.3 [DB-DOC-02 / #7]: DELIVERED/XOR rebuild · metadata-only · owner codes · ADMIN-only
    Task R.1.4 [DB-DOC-04 / #9]: S1-only · แผน 005 ไฟล์เดียวอ้าง symbol
    Task R.1.5 [DB-DOC-03 / #8]: เอกสาร ranking ตรง 22657a2
    Task R.1.6 [DB-DOC-05 / #10]: ไม่มี product_id · expiry · queueBoard กรอง unpaid
    Task R.1.7 [Roadmap / #5]: อัปเดตสถานะ/ลำดับงานนี้
  Milestone R.2: API
    Task R.2.1 [API-FIX-01 / #11]: openChat rate+throttle · คง inactive pay · ตัด ranking hunk
    Task R.2.2 [API-FIX-05]: staffOrders pagination ใน SQL (PR ใหม่)

Phase G: Migration 005 (บล็อก)
  Milestone G.1: หลัง Mark merge #6 #7 #9
    Task G.1.1: 005 ไฟล์เดียว — rebuild inventory+reservations + indexes + worker import + เทสต์ populated
```

## ลำดับลงมือ (ตรงที่มาร์คล็อก)

```text
#4 → #6 → #7 → #9 → #8 → #10 → #5 → #11
แล้ว API-FIX-05
ห้าม 005.sql จนกว่า #6 #7 #9 merge
```
