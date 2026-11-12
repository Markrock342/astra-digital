# รายงานส่งมาร์ค — Hotfix DO `run().changes` (Cloudflare)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12  
**PR:** https://github.com/Markrock342/astra-digital/pull/37  
**Branch:** `fix/do-sql-run-changes` (รวม FR-O5 จาก #35 + hotfix + `units[]`)  
**สาเหตุ:** มาร์คแจ้งบน Cloudflare — `db.prepare().run()` คืน cursor ไม่มี `.changes` → `if (!x.changes)` fail เสมอ (deliver ตั้งแต่ DB-005 + replace #35)

---

## 1) Root cause

| ชั้น | พฤติกรรม |
|------|----------|
| Node `node:sqlite` | `prepare().run()` คืน `{ changes }` |
| Cloudflare DO `sql.exec()` | คืน **SqlStorageCursor** มี `rowsWritten` **ไม่มี** `changes` |
| `cloud/worker.mjs` เดิม | `run: (...a) => sql.exec(s, ...a)` → ส่ง cursor ดิบเข้าโดเมน |
| โดเมน | `deliverReservation` / `replaceOrderCredential` เช็ก `if (!x.changes)` → 409 ทุกครั้งบนเว็บจริง |

Node เทสต์ไม่เจอ เพราะใช้ SQLite คนละชนิด

---

## 2) แก้แล้ว

ไฟล์ใหม่ `server/do-sqlite-adapter.mjs` + ใช้ใน `cloud/worker.mjs`:

1. `sql.exec(...)`  
2. วน cursor ให้จบ (`Array.from`)  
3. คืน `{ changes: cursor.rowsWritten ?? 0 }`

---

## 3) หลักฐานเทส (เต็มรูปแบบตามที่ปรับ DoD)

| ชั้น | คำสั่ง / ผล |
|------|-------------|
| Unit (mock cursor) | `tests/do-sqlite-adapter.test.mjs` — พิสูจน์ cursor ไม่มี `.changes` + adapter map ถูก |
| workerd / Miniflare | เทสเดียวกัน — **deliver พรีออเดอร์บน DO จริง ผ่าน** (ไม่ 409 สต็อกไม่พอ) |
| Full node suite | `npm test` → **86/86** (รวม DO adapter) |
| `wrangler dev --local` | `npm run qa:wrangler-local` บน `http://127.0.0.1:4333` → **11/11** รวม deliver + `units[]` + replace |

**กฎใหม่ใน** `docs/process/definition-of-done.md`: แตะ DO adapter / `run().changes` ต้องมี Miniflare **และ** wrangler local — ห้ามนับแค่ node

สคริปต์ใหม่:

- `npm run test:do`
- `npm run cloud:dev` → `wrangler dev --local --port 4332`
- `npm run qa:wrangler-local`

---

## 4) ขอมาร์ค

1. รีวิว/merge PR hotfix นี้ **ก่อนหรือพร้อม** #35 แล้วค่อย deploy  
2. #35 FR-O5 ยังใช้ `run().changes` — ถ้า merge #35 โดยไม่มี hotfix นี้ replace บน Cloudflare จะพังแบบเดียวกับ deliver  
3. หลังขึ้น: smoke ส่งพรีออเดอร์ + ปุ่มเปลี่ยนบัญชีเสียบนร้าน (มาร์คต่อ UI แล้ว)

---

## 5) นอกขอบเขต

- งาน 5 ข้ออื่น — ยังไม่เริ่ม (รอ merge ตามที่มาร์คบอก)  
- ห้าม deploy จากเครื่องน็อตจนกว่ามาร์คสั่ง  
