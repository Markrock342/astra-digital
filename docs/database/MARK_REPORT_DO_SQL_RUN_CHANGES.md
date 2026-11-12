# รายงานส่งมาร์ค — Hotfix DO `run().changes` (ตรวจซ้ำ 2 รอบ · ละเอียด)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่ตรวจซ้ำ:** 2026-11-12 (รอบยืนยันหลังเปิด PR)  
**PR:** https://github.com/Markrock342/astra-digital/pull/37  
**Branch:** `fix/do-sql-run-changes`  
**หัวข้อรวม:** แก้ Cloudflare DO adapter + FR-O5 (#35) + `units[]` ใน admin order detail  
**Deploy:** **ยังไม่ทำ** — รอมาร์ค merge แล้วขึ้นพร้อมกัน

---

## 0) คำตัดสินหลังตรวจซ้ำ 2 รอบ

| คำถาม | คำตอบ | หลักฐาน |
|-------|--------|---------|
| บั๊ก `.changes` บน DO หายแล้วจริงหรือไม่ | **หายแล้ว** | Miniflare ×2 + `wrangler dev --local` smoke ×2 ผ่าน deliver **และ** replace |
| deliver พรีออเดอร์ยัง 409 "สต็อกไม่พอ" บน workerd หรือไม่ | **ไม่** — ได้ 200 `DELIVERED` | smoke รอบ 1 และ 2 ข้อ PASS 9 |
| replace (#35 / FR-O5) พังบน DO หรือไม่ | **ไม่** — ได้ 200 + `newInventoryId` | smoke รอบ 1 และ 2 ข้อ PASS 11 |
| node เทสต์อย่างเดียวพอหรือไม่ | **ไม่พอ** (ยืนยัน root cause) | mock cursor ไม่มี `.changes` แต่ node:sqlite มี — เลยหลุดมาตลอด |

**สรุปให้มาร์ค:** พร้อม merge **PR #37** แล้ว deploy · ปิด #35 ได้หลัง #37 เข้า (O5 รวมอยู่ใน #37 แล้ว)

---

## 1) Root cause (ยืนยันจากโค้ดจริง)

### 1.1 จุดที่โดเมนพึ่ง `.changes`

| ไฟล์ | บรรทัดพฤติกรรม | อาการเมื่อ `changes` เป็น falsy |
|------|----------------|----------------------------------|
| `server/domain.mjs` → `deliverReservation` | `if (!updated.changes) fail(409, "สต็อกไม่พอสำหรับส่งของ")` | ส่งพรีออเดอร์ไม่ได้ทุกครั้งบน Cloudflare (มาตั้งแต่ DB-005) |
| `server/admin-order-replace.mjs` → `replaceOrderCredential` | `if (!cleared.changes)` / `if (!bound.changes)` | ปุ่มเปลี่ยนบัญชีเสีย (#35) พังบน Cloudflare |

### 1.2 ความต่าง runtime

| Runtime | `prepare().run()` คืนค่า | `if (!x.changes)` |
|---------|---------------------------|-------------------|
| Node `node:sqlite` (เทสต์เดิม) | `{ changes: N }` | ผ่านเมื่อเขียนสำเร็จ |
| Cloudflare DO `sql.exec()` | **SqlStorageCursor** มี `rowsWritten` **ไม่มี** `changes` | **fail เสมอ** แม้ UPDATE สำเร็จ |

### 1.3 โค้ดเก่าใน `cloud/worker.mjs` (ก่อนแก้)

```js
run: (...a) => sql.exec(s, ...a)  // ส่ง cursor ดิบ → ไม่มี .changes
```

### 1.4 ทำไมเทสต์เก่าไม่จับ

ชุด `npm test` ส่วนใหญ่ใช้ `createCommerce()` บน Node SQLite — **คนละชนิดกับ DO**  
เลยเขียวในเครื่อง แต่พังบนร้าน Cloudflare

---

## 2) สิ่งที่แก้ใน PR #37

### 2.1 Adapter ใหม่ `server/do-sqlite-adapter.mjs`

1. เรียก `sql.exec(...)`  
2. **drain** cursor ด้วย `Array.from(cursor)`  
3. คืน `{ changes: cursor.rowsWritten ?? 0 }`

`cloud/worker.mjs` ใช้ `createDoSqliteAdapter(sql)` แทน inline prepare เดิม

### 2.2 ของแถมที่มาร์คต้องการคู่ deploy

| รายการ | สถานะใน #37 |
|--------|-------------|
| FR-O5 `POST /api/admin/orders/:id/replace` | รวมจาก #35 |
| `features.adminReplaceCredential` | มี |
| Admin order detail `units[]` (inventory id ตาม `rowid`) | เพิ่มแล้ว — รองรับปุ่ม UI ของมาร์ค |
| ห้าม deploy จากเครื่องน็อต | ยังถือตามโจทย์ |

### 2.3 กระบวนการเทสต์ (กันหลุดซ้ำ)

อัปเดต `docs/process/definition-of-done.md`:

- แตะ DO adapter / `run().changes` → บังคับ **Miniflare/workerd** + **`wrangler dev --local`**
- **ห้ามนับ** แค่ node SQLite

สคริปต์:

- `npm run test:do`
- `npm run cloud:dev` (= `wrangler dev --local`)
- `npm run qa:wrangler-local`

---

## 3) หลักฐานตรวจซ้ำ 2 รอบ (รอบยืนยันหลังเปิด PR)

สภาพแวดล้อม: Windows · branch `fix/do-sql-run-changes` · tip ก่อนอัปเดตรายงานนี้รวม `19469a5` + แก้ timeout ใน smoke script (ถ้ามี commit ตามหลัง)

### รอบที่ 1

| ขั้น | คำสั่ง | ผล |
|------|--------|-----|
| 1A Unit + Miniflare | `node --test tests/do-sqlite-adapter.test.mjs` | **3/3 ผ่าน** (mock พิสูจน์บั๊กเดิม + deliver บน DO) |
| 1B Domain O5 (node) | `ADMIN-FR-W5-O5` + order detail `units[]` | **3/3 ผ่าน** |
| 1C Wrangler local | `wrangler dev --local --port 4340` + `qa:wrangler-local` | **11/11 ผ่าน** รวม deliver + units + replace |

รายการ smoke รอบ 1:

1. health = `cloudflare-durable-sqlite`  
2. admin login  
3. สร้างสินค้าพรีออเดอร์  
4. นำเข้าคู่ login/password ×2  
5. สมัครลูกค้า  
6. topup sandbox  
7. สร้างพรีออเดอร์  
8. จ่าย → `PREORDER`  
9. **deliver → 200 DELIVERED** (ไม่ใช่ 409 สต็อกไม่พอ)  
10. **detail.units[0].id มีค่า**  
11. **replace → 200 + newInventoryId**

### รอบที่ 2 (ทำซ้ำทั้งก้อน)

| ขั้น | คำสั่ง | ผล |
|------|--------|-----|
| 2A Wrangler smoke ซ้ำ | `qa:wrangler-local` ครั้งที่ 2 บนพอร์ตเดิม | **11/11 ผ่าน** (deliver + replace อีกชุดออเดอร์ใหม่) |
| 2B Miniflare ซ้ำ | หลังหยุด workerd แล้วรัน `do-sqlite-adapter.test.mjs` อีกครั้ง | **3/3 ผ่าน** |
| 2C Full suite | `npm test` | **88/88 ผ่าน** |

### หลักฐานเชิงลบ (ยืนยันว่าบั๊กเดิมมีจริง)

ใน `tests/do-sqlite-adapter.test.mjs`:

- cursor จำลองแบบ DO: `rowsWritten: 1` แต่ **`changes === undefined`**
- `!!raw.changes === false` → โดเมนจะ 409  
- หลัง adapter: `result.changes === 1` และ truthy

นี่คือคำอธิบายว่าทำไม node เขียวแต่ Cloudflare พัง

---

## 4) ขอบเขตที่ตรวจแล้ว / ยังไม่ตรวจ

| รายการ | สถานะ |
|--------|--------|
| deliver บน DO (Miniflare) | ผ่าน ×2 |
| deliver บน `wrangler --local` | ผ่าน ×2 |
| replace บน `wrangler --local` | ผ่าน ×2 |
| `units[]` บน order detail | ผ่าน ×2 (smoke) + unit |
| ร้าน Cloudflare โปรดักชันหลัง deploy | **ยังไม่ขึ้น** — ขอมาร์ค smoke หลัง deploy: ส่งพรีออเดอร์ + ปุ่มเปลี่ยนบัญชี |

---

## 5) ไฟล์สำคัญใน PR

| ไฟล์ | บทบาท |
|------|--------|
| `server/do-sqlite-adapter.mjs` | แก้ root cause |
| `cloud/worker.mjs` | ใช้ adapter |
| `server/admin-order-replace.mjs` | FR-O5 |
| `server/admin-list-apis.mjs` | `units[]` |
| `tests/do-sqlite-adapter.test.mjs` | mock + Miniflare |
| `scripts/wrangler-local-ops-smoke.mjs` | smoke deliver/replace บน wrangler |
| `docs/process/definition-of-done.md` | บังคับเทสต์ DO ครบ |

---

## 6) ขอมาร์ค

1. รีวิว/merge **https://github.com/Markrock342/astra-digital/pull/37**  
2. ปิด #35 ได้หลัง #37 merge (O5 ซ้ำซ้อน)  
3. Deploy พร้อมกันตามแผนมาร์ค  
4. หลังขึ้นร้าน: ลอง **ส่งพรีออเดอร์ 1 ใบ** + **ปุ่มบัญชีเสีย · เปลี่ยนให้ลูกค้า 1 ครั้ง**  
5. งาน 5 ข้ออื่นเริ่มได้หลัง merge ตามที่มาร์คบอก — น็อตจะ `pull main` ก่อน

---

## 7) บันทึกสั้นเรื่องคุณภาพเทสต์ (เรียนมาร์ค/เจ้าของ)

บั๊กรอบนี้หลุดเพราะเทสต์ไม่ครอบ runtime จริงของร้าน  
หลังแก้: DoD ทีมบังคับ Miniflare + wrangler local เมื่อแตะ path นี้ — จะไม่ยอมปิดงานด้วยแค่ `npm test` อีก
