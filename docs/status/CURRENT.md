# สถานะปัจจุบัน (CURRENT)

อัปเดตล่าสุด: 2026-11-11

## ตำแหน่งงานปัจจุบัน
| ระดับ | ค่า |
|-------|-----|
| โปรเจกต์ | ASTRA — NOTT หลังผลตรวจ 11 พ.ย. |
| Roadmap | [NOTT-POST-REVIEW-11NOV.md](../roadmaps/NOTT-POST-REVIEW-11NOV.md) (**Approved**) |
| สถานะ | Self-QC ผ่าน — รายงานส่งมาร์คพร้อม · รอ Mark Review/merge |

## รายงานส่งมาร์ค
[MARK_REPORT_POST_REVIEW_11NOV.md](../database/MARK_REPORT_POST_REVIEW_11NOV.md)

## PR ที่เปิดแล้ว (1 Task = 1 PR)

| Task | PR |
|------|-----|
| Roadmap Approved | https://github.com/Markrock342/astra-digital/pull/5 |
| DB-DOC-06 | https://github.com/Markrock342/astra-digital/pull/4 |
| DB-DOC-01 | https://github.com/Markrock342/astra-digital/pull/6 |
| DB-DOC-02 | https://github.com/Markrock342/astra-digital/pull/7 |
| DB-DOC-03 | https://github.com/Markrock342/astra-digital/pull/8 |
| DB-DOC-04 | https://github.com/Markrock342/astra-digital/pull/9 |
| DB-DOC-05 | https://github.com/Markrock342/astra-digital/pull/10 |
| API-FIX-01 | https://github.com/Markrock342/astra-digital/pull/11 |
| API-FIX-02 | https://github.com/Markrock342/astra-digital/pull/12 |
| API-FIX-03 | https://github.com/Markrock342/astra-digital/pull/13 |
| API-FIX-04 | https://github.com/Markrock342/astra-digital/pull/14 |

## Self-QC (11 พ.ย.)
- ข้อ 1–10 ตามโจทย์: **ครบในขอบเขต** (เอกสารออกแบบ + API fix; ยังไม่ 005)
- ข้อห้าม: ไม่แตะ `cloud/worker.mjs` shop DO · 1 PR = 1 Task
- `npm test` บน `fix/api-fix-01` … `04`: **41 passed** ทั้งสี่ branch

## ค่าที่ล็อก
- คิวรวมทั้งร้าน · ตัด `price >= 0` · ไม่แตะ shop DO ใน worker  
- ยังไม่เขียน migration 005 จนกว่าเอกสารผ่านรีวิว
