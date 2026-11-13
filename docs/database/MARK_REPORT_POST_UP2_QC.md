# รายงานส่งมาร์ค — QC คิวหลัง UP-2 (5 รอบ + แก้ช่องโหว่)

| ฟิลด์ | ค่า |
|--------|-----|
| Brief | `BRIEF-20261113-post-up2-queue` |
| วันที่ QC | 2026-11-13 |
| สาขา QC | `feat/admin-health-invariants` (ซ้อน #53–#58) |
| ผู้ตรวจ | NOTT (Agent) |

---

## 1) เทียบโจทย์ (MUST) — ครบหรือไม่

| MUST | สถานะ | หลักฐาน |
|------|--------|---------|
| 0) Rebase PR #21 เหลือ race/A4/A5 · ทิ้ง payment_events | **ครบ** | [#21](https://github.com/Markrock342/astra-digital/pull/21) · เทส C1/A4 ในรอบ 5 |
| 1) ต้นทุน+กำไร ADMIN · moneyScope | **ครบ** | MIG-009 · `GET /api/admin/reports/profit` · [#53](https://github.com/Markrock342/astra-digital/pull/53) |
| 2) expires_at · ไม่ขายในหน้าต่าง warranty · notify | **ครบ** | MIG-010 · pay/deliver filter · `stock_expiry` · [#54](https://github.com/Markrock342/astra-digital/pull/54) |
| 3) PDPA export/delete/anonymize · ห้ามแตะ append-only | **ครบ** (+ เสริม UI) | API + หน้าบัญชี + อนุมัติในตรวจระบบ · [#56](https://github.com/Markrock342/astra-digital/pull/56) |
| 4) 10k + index p95 &lt; 500ms | **ครบ** | MIG-011 · `npm run perf:10k` · [#57](https://github.com/Markrock342/astra-digital/pull/57) |
| 5) หน้าตรวจระบบ + api-contract | **ครบ** | `/admin/settings/health` · `GET /api/admin/health` · [#58](https://github.com/Markrock342/astra-digital/pull/58) |

### MUST_NOT (ยึดแล้ว)

- ไม่ deploy · ไม่ `qa:cloud` ร้านจริง  
- ไม่ UP-3 · ไม่แตะงานหมวดหมู่/FAQ/รีวิว/ฯลฯ ของมาร์ค  
- ไม่ลบ/UPDATE แถว ledger·audit (PDPA เก็บออเดอร์+ledger · append-only triggers ยังอยู่)

---

## 2) สิ่งที่ทำในแต่ละ Task (สรุปจุดส่งมอบ)

### Task 0 — Race tests
- เก็บเฉพาะ C1 concurrent last-unit + A4/A5  
- ไม่มี `payment_events`

### Task 1 — Cost / Profit
- Schema: `inventory.cost` (สตางค์, NULL ได้)  
- Import: `items[].cost` · `CODE,cost` · CSV ท้ายบรรทัด  
- รายงาน: `profit = revenue − refunds − SUM(cost)` · live ตัด sandbox  
- UI รายงานยอดขายแสดงต้นทุน/กำไร + CSV

### Task 2 — Expires
- Schema: `inventory.expires_at` + index FEFO  
- กติกา: ไม่ขายถ้า `expires_at` อยู่ในหน้าต่าง `warranty_days`  
- แท็บใกล้หมดอายุ/หมดอายุ · notify `stock_expiry`

### Task 3 — PDPA
- ลูกค้า: export JSON · ขอลบ  
- แอดมิน: อนุมัติ → anonymize ชื่อ/อีเมล/เบอร์/username/avatar/แชท · `status=DELETED`  
- เก็บ orders/payments/ledger

### Task 4 — Perf
- MIG-011 indexes  
- สคริปต์ `npm run perf:10k` · summary p95 ~4377ms → ~25ms

### Task 5 — Health
- Invariant: migrations · append-only · เครดิตไม่ติดลบ · PAYMENT_IN · สต็อกค้าง/กำพร้า · คอลัมน์ inventory  
- UI ตั้งค่า › ตรวจระบบ

---

## 3) ช่องโหว่ / บั๊กที่พบตอน QC และแก้แล้ว

| # | ระดับ | รายละเอียด | การแก้ |
|---|--------|------------|--------|
| V1 | **สูง (authz/stale state)** | หลัง approve PDPA ถ้ายังมี object session เก่า `exportMyData` / `requestAccountDeletion` อาจอ่าน `user.status` จากหน่วยความจำแล้วอนุญาตต่อ | อ่าน `status` จาก DB ทุกครั้ง · ปฏิเสธถ้าไม่ `ACTIVE` |
| V2 | กลาง (regression เทส) | `local-migrate` ยังคาด migrations ถึงแค่ 008 → แดงหลัง MIG-009–011 | อัปเดต expect ถึง `011` + assert คอลัมน์ cost/expires_at |
| V3 | กลาง (regression เทส) | backup assert `latestMigration /^008_/` ล้มเพราะเป็น `011_…` | เปลี่ยนเป็น `/^011_/` |
| V4 | ต่ำ (คุณภาพ runtime) | `waitUntil` ซ้ำใน `cloud/worker.mjs` (esbuild warning) | ลบ key ซ้ำ |
| V5 | ต่ำ (Windows flake) | EPERM ตอน `rmSync` temp ใน coupons/backup | ปิด DB แล้ว `rmSync` ใน try/catch |
| V6 | UX ช่องว่าง | PDPA มีแค่ API ไม่มีปุ่มลูกค้า/แอดมิน | เพิ่มแผงใน `/account` + อนุมัติใน `/admin/settings/health` |
| V7 | ต่ำ | `deleteFile` บน R2 เป็น async ไม่ await | `Promise.resolve(...).catch(() => {})` หลังเคลียร์ avatar_key แล้ว |

ไม่พบ: SQL injection จากพารามิเตอร์ที่ bind แล้ว · IDOR ข้ามลูกค้าใน export · STAFF เข้า profit/health/privacy admin

---

## 4) Prove Matrix — 5 รอบเทส

### รอบ 1 — Unit จุดที่ทำ (ต่างจุด: โมดูลคิว)
คำสั่ง:  
`node --test tests/inventory-cost-profit.test.mjs tests/inventory-expires.test.mjs tests/privacy-pdpa.test.mjs tests/perf-indexes.test.mjs tests/admin-health.test.mjs tests/worker-migrations.test.mjs tests/local-migrate.test.mjs`  
ผลแรก: 14/15 · แดงที่ local-migrate → แก้ V2 แล้วผ่าน

### รอบ 2 — Regression กว้าง (`npm test`)
ผลแรก: 221/223 · แดง backup expect + coupons EPERM → แก้ V3/V5  
ผลหลังแก้ (รอบ 5): **223/223 ผ่าน**

### รอบ 3 — Runtime ต่างชั้น (Node smoke + wrangler --local + security negatives)
| ชั้น | คำสั่ง / หลักฐาน | ผล |
|------|------------------|-----|
| Node HTTP-like smoke | `node scripts/post-up2-local-smoke.mjs` | PASS · profit 12000−4500=7500 · health ok · anonymize |
| Security negatives | `tests/post-up2-security.test.mjs` | PASS · ไม่รั่ว PII ข้ามคน · STAFF/anon 403 |
| Miniflare/DO | `auth-hardening-do` + `do-sqlite-adapter` deliver | PASS |
| `wrangler dev --local :4342` | `qa:wrangler-local` ops smoke | **11/11 PASS** |
| Wrangler ฟีเจอร์คิว | profit/health/PDPA บน DO | PASS · cost≥5000 · health ok · approve |

### รอบ 4 — เทสซ้ำจุดที่แก้
`node --test` ชุด local-migrate + security + privacy + alerts-backup + cost + expires + health + perf + MU3 → **30/30**  
+ `post-up2-local-smoke` ซ้ำ → PASS

### รอบ 5 — เทสทุกจุดใหม่
| ชุด | ผล |
|-----|-----|
| `npm test` | **223/223** |
| commerce + nott-ops (+ C1 race) | **76/76** |
| wrangler ops smoke อีกรอบ | **11/11** |

---

## 5) จุดที่เกี่ยวข้องที่ตรวจแล้ว

- Import / pay / deliver / warranty snapshot  
- moneyScope live vs sandbox ใน profit  
- Append-only: DELETE ledger หลัง anonymize ยัง abort  
- Backup schema latestMigration สะท้อน 011  
- Worker migration list = โฟลเดอร์ migrations  

---

## 6) ช่องว่างที่เหลือ (ไม่บล็อกปิด QC แต่ควรรู้)

1. PR ซ้อน (#53→#58) — แนะนำ merge ตามลำดับ หรือรวมปลาย `#58` แล้วปิด PR ย่อย  
2. E2E Playwright เต็มร้านไม่ได้รันในรอบนี้ (มี wrangler HTTP + unit/integration ครบแทนตาม DoD Cloudflare)  
3. ไม่มี UI แยกเมนู “คำขอ PDPA” นอกหน้าตรวจระบบ (มีใน settings/health แล้ว)

---

## 7) คำสั่งที่มาร์คใช้ยืนยันซ้ำได้

```bash
node --test tests/inventory-cost-profit.test.mjs tests/inventory-expires.test.mjs tests/privacy-pdpa.test.mjs tests/post-up2-security.test.mjs tests/admin-health.test.mjs tests/perf-indexes.test.mjs tests/local-migrate.test.mjs
npm test
node scripts/post-up2-local-smoke.mjs
# เปิด wrangler: npx wrangler dev --local --port 4342
npm run qa:wrangler-local -- http://127.0.0.1:4342
npm run perf:10k
```

---

## 8) คำตัดสิน

**โจทย์คิวหลัง UP-2 ทำครบตาม MUST** · พบและแก้ช่องโหว่/regression ตอน QC แล้ว · Prove 5 รอบผ่านรวม `npm test` เขียวเต็ม และ wrangler `--local` ผ่าน  

รอ Owner/Mark รีวิว merge · **ยังไม่ deploy** ตามข้อห้าม
