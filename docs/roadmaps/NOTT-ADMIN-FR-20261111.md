# Roadmap: Admin FR Backend (NOTT) — 11 พ.ย. 2026

สถานะ: **Approved โดย Owner** · อ้างอิง [ADMIN-FR-20261111](../requirements/ADMIN-FR-20261111.md) + โจทย์ Mark  
กติกา: 1 งาน = 1 branch = 1 PR · ห้าม deploy · แจ้ง Mark ก่อนไปงานถัดไป

## ลำดับ

| งาน | ขอบเขต | FR หลัก | สถานะ |
|-----|--------|---------|--------|
| 0 | เก็บเอกสาร FR + roadmap | — | เสร็จ |
| 1 | สัญญาแชท/แจ้งเตือน/อันดับ + FR-F10 ยอดขาย | M1, M3, R1, F10 | เสร็จ (PR #25) |
| 2 | Admin list APIs แบ่งหน้า+กรอง + order detail/reveal | O2–O4, C1–C2, P1 | เสร็จ (PR #26) |
| 2.5 | FR-P3 saveProduct รับ preorder (ดึงจากงาน 4 ตาม Mark) | P3 | Current |
| 3 | Migration ledger เงินจริง + transactions | F1–F4, F9 | รอหลัง P3 |
| 4 | Variant CRUD / สต็อก (P3 ย้ายไป 2.5 แล้ว) | P2, P7 | รอ |
| 5 | ร่าง schema งานที่ยืนยันลูกค้า (ห้ามโค้ด) | C3–C9, F6–F7, O5, P4 | docs only |

## งาน 1 — เกณฑ์ผ่าน

- สัญญา API ใน `api-contract-shop.md` ให้แบงค์ใช้ได้
- แชทแอดมินเรียงข้อความล่าสุด + unreadCount
- แจ้งเตือนแอดมิน: ออเดอร์ใหม่ / แชท / คิวพรีออเดอร์ / สต็อกใกล้หมด
- `/api/me` ส่ง `features`
- `adminOverview.revenue` = payments SUCCEEDED − คืนเงิน (คืนเงินยัง 0 จนกว่างาน 3/F6)
- `npm test` + `npm run test:e2e` ผ่าน · รายงาน Mark · ห้าม deploy
