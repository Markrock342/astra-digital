# รายงานส่งมาร์ค — คิวหลัง UP-2

| ฟิลด์ | ค่า |
|--------|-----|
| Brief | `BRIEF-20261113-post-up2-queue` |
| วันที่ | 2026-11-13 |
| ฐาน | `origin/main` @ UP-2 merge (#52) |

## PR ที่เปิดแล้ว (เรียงตามคิว · ซ้อนสาขา)

| Task | PR | สรุป |
|------|-----|------|
| 0 race | [#21](https://github.com/Markrock342/astra-digital/pull/21) | C1 concurrent + A4/A5 เท่านั้น |
| 1 cost/profit | [#53](https://github.com/Markrock342/astra-digital/pull/53) | MIG-009 `inventory.cost` + `/api/admin/reports/profit` |
| 2 expires | [#54](https://github.com/Markrock342/astra-digital/pull/54) | MIG-010 `expires_at` + กติกา warranty + notify |
| 3 PDPA | [#56](https://github.com/Markrock342/astra-digital/pull/56) | export / delete request / anonymize |
| 4 10k | [#57](https://github.com/Markrock342/astra-digital/pull/57) | MIG-011 indexes · `npm run perf:10k` · summary 4377→25ms |
| 5 health | (PR นี้) | `GET /api/admin/health` + หน้า `/admin/settings/health` |

## ข้อห้ามที่ยึด

- ไม่ deploy · ไม่ `qa:cloud` ร้านจริง (Turnstile เปิด)
- ไม่ UP-3 · ไม่แตะงานมาร์คที่ระบุใน brief

## Prove (สรุป)

- unit ตามแต่ละ PR · `perf:10k` ผ่านเป้า p95 &lt; 500ms หลัง index
- health: fresh shop `ok:true` · STAFF 403 · ตรวจ stuck stock ได้
