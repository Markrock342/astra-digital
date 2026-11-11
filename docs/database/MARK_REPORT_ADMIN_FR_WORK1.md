# รายงานส่งมาร์ค — Admin FR งาน 1 (ตรวจครบเทียบโจทย์)

**ถึง:** มาร์ค  
**จาก:** น็อต  
**วันที่:** 2026-11-12 (อัปเดตหลังตรวจซ้ำ)  
**PR:** https://github.com/Markrock342/astra-digital/pull/25  
**Branch:** `feat/admin-fr-work1-api-contract-revenue`  
**ฐาน:** `main` @ `30d1f00`  
**Commits:** `c52ef1c` (โค้ด) · `ae4872d` / `fe2f9a4` (+ docs รายงานนี้)  
**Deploy:** **ยังไม่ทำ** · **ไม่ได้รัน `qa:cloud` กับร้านจริง**  
**ขอบเขตรอบนี้:** **งาน 1 เท่านั้น** · งาน 2–5 ยังไม่เริ่ม (ตามลำดับที่มาร์คสั่ง)

อ้างอิง: [`docs/requirements/ADMIN-FR-20261111.md`](../requirements/ADMIN-FR-20261111.md) · โจทย์งานหลังบ้านรอบใหม่จากมาร์ค

---

## 0. คำตัดสินรวม

| มุม | ผล |
|-----|-----|
| งาน 1 ตามโจทย์มาร์ค (1.1 + 1.2) | **ผ่าน** — รายละเอียด §1–§2 |
| กติการ่วม (สิทธิ์ / features / เงินสตางค์ / UTC / ห้าม deploy) | **ผ่าน** ในขอบเขตงาน 1 |
| เทสต์ | **ผ่านซ้ำ** — `npm test` **63/63** · `npm run test:e2e` **11/11** (รันใหม่ตอนเขียนรายงานนี้) |
| งาน 2 / 3 / 4 / 5 | **ยังไม่ทำ** — รอ approve งาน 1 |

---

## 1. Checklist เทียบโจทย์มาร์คทีละข้อ (งาน 1)

### 1.0 กติกาโปรแกรมก่อนลงมือ

| ข้อมาร์ค | สถานะ | หลักฐาน |
|----------|--------|---------|
| pull main ก่อน | **ผ่าน** | branch จาก `30d1f00` |
| 1 งาน = 1 branch = 1 PR | **ผ่าน** | PR #25 |
| ห้าม deploy | **ผ่าน** | ไม่ได้ deploy Worker/Pages จาก PR นี้ |
| เก็บ FR เข้า docs | **ผ่าน** | `docs/requirements/ADMIN-FR-20261111.md` + ลิงก์ใน `docs/index.md` |
| รายงานใน `docs/database/` | **ผ่าน** | ไฟล์นี้ |
| เทสต์ใหม่ใน `tests/` + `npm test` + `test:e2e` | **ผ่าน** | `ADMIN-FR-W1` ×3 ใน `tests/nott-ops.test.mjs` |

### 1.1 สัญญา + API แชท / แจ้งเตือน / อันดับ (FR-M1, FR-M3, FR-R1)

#### FR-M1 — กล่องแชทแอดมิน

| ข้อโจทย์ | สถานะ | ทำอย่างไร |
|----------|--------|-----------|
| แอดมิน/พนักงานดู**ทุกห้อง** | **ผ่าน** | `chatThreads` สำหรับ STAFF/ADMIN คืนทุก `chat_threads` |
| เรียงตามข้อความล่าสุด | **ผ่าน** | `ORDER BY lastMessageAt DESC` · `lastMessageAt = MAX(chat_messages.created_at)` fallback `thread.created_at` |
| จำนวนยังไม่อ่าน | **ผ่าน** | field `unreadCount` · นับข้อความ `sender_type='USER'` ที่ใหม่กว่า `chat_thread_reads.last_read_at` ของ staff คนนั้น |
| ตอบได้ | **ผ่าน** (มีอยู่แล้ว + สัญญาชัด) | `POST /api/chat/threads/:id/messages` |
| ปิดห้องได้ | **ผ่าน** (มีอยู่แล้ว + สัญญาชัด) | `POST /api/chat/threads/:id/close` |
| เขียน request/response ในสัญญาให้แบงค์ | **ผ่าน** | `docs/architecture/api-contract-shop.md` หมวด «แชทฝั่งแอดมิน / พนักงาน (FR-M1)» |
| ห้องผูกกับลูกค้า | **ผ่าน** | join `users` → `customer`, `customer_email` |
| ห้องผูกกับออเดอร์ (ข้อความ FR-M1 เต็ม) | **ยังไม่ครบ** | ตาราง `chat_threads` ยังไม่มี `order_id` · โจทย์งาน 1.1 ของมาร์คระบุเรียง/unread/ตอบ/ปิด — **ยังไม่ผูกออเดอร์ในงานนี้** · ถ้ามาร์คต้องการผูกออเดอร์ในรอบถัดไป บอกได้ จะออกแบบคอลัมน์โดยไม่กินเลข 006 |

เทสต์: `ADMIN-FR-W1: chat inbox sorts by last message and tracks unread`  
- ห้องที่ข้อความใหม่กว่าอยู่ก่อน · `unreadCount >= 1` ก่อนอ่าน · = 0 หลัง `chatMessages(staff, …)`

Schema ย่อย: `server/ensure-admin-fr.mjs` → `CREATE TABLE IF NOT EXISTS chat_thread_reads` (**ไม่ใช้เลข migration 006** — เก็บไว้ให้ ledger งาน 3)

#### FR-M3 — แจ้งเตือนฝั่งแอดมิน

| kind | เมื่อไหร่ | สถานะ |
|------|----------|--------|
| `order_new` | ออเดอร์พร้อมส่งจ่ายสำเร็จและส่งของแล้ว | **ผ่าน** · `notifyStaffRoles` หลัง pay สำเร็จ |
| `chat` | ลูกค้าเปิด/ส่งแชท | **ผ่าน** (มีอยู่แล้ว + throttle staff) |
| `preorder_queue_admin` | พรีออเดอร์จ่ายแล้วได้เลขคิว | **ผ่าน** |
| `stock_low` | สต็อกตัวเลือกเหลือ ≤ 3 | **ผ่าน** · throttle ~5 นาที/variant |

อ่าน/mark-read: `GET /api/notifications` · `POST /api/notifications/:id/read` (มีอยู่แล้ว · ระบุในสัญญา)

ฝั่งลูกค้า (`code_delivery` / `preorder_queue` / `chat`) คงของเดิม — ไม่พังจากการเพิ่มชนิดแอดมิน

เทสต์: `ADMIN-FR-W1: admin gets order/preorder/stock notifications; me exposes features`

#### FR-R1 — อันดับผู้ซื้อ

| ข้อโจทย์ | สถานะ | หมายเหตุ |
|----------|--------|----------|
| `period=day\|week\|month\|all` | **ผ่าน** (API มีอยู่แล้ว) | ตรวจซ้ำในเทสต์ ranking เดิม |
| เวลา Asia/Bangkok | **ผ่าน** | ตัดรอบตาม Bangkok ใน domain |
| ADMIN only | **ผ่าน** | ลูกค้า 403 · ไม่ล็อกอิน 401 · STAFF ไม่ได้ |
| เขียนสัญญาให้แบงค์ | **ผ่าน** | หมวด «อันดับผู้ซื้อ» ใน `api-contract-shop.md` |
| หน้าจอ + กดชื่อไปหน้าลูกค้า | **งานแบงค์** | น็อตไม่ทำ UI ในงานนี้ |

#### Features ใน `/api/me` (กติการ่วมมาร์ค)

| flag | ค่า | ความหมาย |
|------|-----|----------|
| `credentialPair` | `true` | นำเข้า ID+รหัสผ่าน |
| `preorderDelivery` | `true` | ส่งของพรีออเดอร์ |
| `adminChatInbox` | `true` | inbox เรียง + unread พร้อม |
| `adminOpsNotifications` | `true` | notify ออเดอร์/คิว/สต็อก พร้อม |
| `salesRevenueFromPayments` | `true` | ยอดขายใช้สูตร FR-F10 |

แหล่งเดียว: `service.features` · mirror ทั้ง `GET /api/health` และ `GET /api/me`

ตาราง RBAC ในสัญญา: ADMIN ครบ · STAFF แชท/แจ้งเตือนได้ · STAFF/`CUSTOMER` ห้ามการเงิน/อันดับตามตาราง

### 1.2 สูตรยอดขายเดียว FR-F10

| ข้อโจทย์ | สถานะ | หลักฐาน |
|----------|--------|---------|
| สูตร = `SUM(payments WHERE status=SUCCEEDED) − ยอดคืนเงิน` | **ผ่าน** | `salesRevenueSatang()` ใน `server/domain.mjs` |
| `adminOverview.revenue` ใช้สูตรนี้เท่านั้น | **ผ่าน** | ไม่นับจาก `orders.DELIVERED` อีกต่อไป |
| คืนเงินยังไม่มี → ส่วนลบ = 0 | **ผ่าน** | `SUM(ABS(amount)) FROM ledger WHERE kind='REFUND'` · ตอนนี้ไม่มีแถว REFUND |
| DEMO_CREDIT / ออเดอร์ไม่จ่าย ไม่เข้าสูตร | **ผ่าน** | นับจาก `payments` สำเร็จเท่านั้น |
| แดชบอร์ดกับ**หน้ารายงานการเงิน**ได้เลขเดียวกัน | **ผ่านในชั้นสูตรเดียว** | ฟังก์ชันเดียว `salesRevenueSatang` · **แต่** หน้าประวัติเงินเข้าออกยังอ่าน `ledger` แบบ DEMO จนกว่างาน 3 (`GET /api/admin/transactions`) — งาน 1 ล็อกตัวเลขแดชบอร์ด + สัญญาไว้ก่อน ไม่สร้างรายงานเงินจริงซ้ำ |

เทสต์: `ADMIN-FR-W1: revenue uses payments SUCCEEDED not delivered orders only (FR-F10)`  
- หลัง pay → `adminOverview.revenue === SUM(payments SUCCEEDED) === salesRevenueSatang()`

---

## 2. งาน 2–5 เทียบโจทย์ (ยืนยันว่า**ยังไม่ทำ**)

| งาน | ขอบเขตมาร์ค | สถานะใน PR #25 |
|-----|-------------|----------------|
| **2** | `GET /api/admin/orders` (+ filters/cursor), `.../:id`, reveal+audit, customers, products · เลื่อนตัด blob `/api/admin` | **ยังไม่เริ่ม** |
| **3** | migration `006_ledger_money.sql` · kinds เงินจริง · transactions+summary+CSV | **ยังไม่เริ่ม** · เลข 006 ว่างไว้ |
| **4** | variant CRUD · saveProduct preorder · สต็อกปิดบัง | **ยังไม่เริ่ม** |
| **5** | แบน/เครดิต/คืนเงิน/ถอน/เปลี่ยนบัญชี/R2 — ร่าง SCHEMA อย่างเดียว | **ยังไม่เริ่ม** · ห้ามโค้ดจนกว่ามาร์คยืนยันลูกค้า |

---

## 3. หลักฐานเทสต์ (รันซ้ำตอนเขียนรายงาน)

เครื่องน็อต · branch ปัจจุบัน · 2026-11-12:

```
npm test          → 63/63 ผ่าน
npm run test:e2e  → 11/11 ผ่าน
```

เทสต์ใหม่เฉพาะงาน 1 (`tests/nott-ops.test.mjs`):

1. `ADMIN-FR-W1: chat inbox sorts by last message and tracks unread`
2. `ADMIN-FR-W1: admin gets order/preorder/stock notifications; me exposes features`
3. `ADMIN-FR-W1: revenue uses payments SUCCEEDED not delivered orders only (FR-F10)`

เทสต์เดิมที่ยังเขียวและเกี่ยว: ranking Bangkok ADMIN-only · UC5/UC5b chat notify · UC6 ranking · UC7 features

หมายเหตุ e2e: harness `production: true` เสิร์ฟ `dist/` — ถ้ารีบิลด์ Admin UI ต้อง `npm run build` ก่อน `test:e2e`

---

## 4. ไฟล์ที่เปลี่ยน (สรุป)

**โค้ด**

- `server/domain.mjs` — inbox/unread · notifyStaffRoles · stock_low · salesRevenueSatang · features
- `server/ensure-admin-fr.mjs` — `chat_thread_reads` idempotent
- `server/commerce.mjs` · `cloud/worker.mjs` — เรียก ensure
- `server/api-handler.mjs` — `/api/me` ส่ง `features`
- `src/types.ts` — ขยาย `Features`
- `tests/nott-ops.test.mjs` (+ ปรับ soft-assert features ใน UC7 / admin-preorder / e2e เล็กน้อย)

**เอกสาร**

- `docs/requirements/ADMIN-FR-20261111.md`
- `docs/roadmaps/NOTT-ADMIN-FR-20261111.md`
- `docs/architecture/api-contract-shop.md`
- `docs/prompts/ADMIN-FR-WORK1-api-contract-revenue.md`
- `docs/status/CURRENT.md` · `docs/index.md`
- รายงานนี้

---

## 5. ช่องว่าง / ความเสี่ยงที่มาร์คควรรู้ (ตรงไปตรงมา)

1. **ผูกแชทกับออเดอร์** — ยังไม่มีคอลัมน์บน thread (มีแค่ลูกค้า) · ถ้าต้องการตามข้อความ FR-M1 เต็ม ขอเป็นงานย่อยหลัง approve
2. **หน้ารายงานการเงิน UI** ยังโชว์ DEMO ledger จนงาน 3 — งาน 1 ทำให้แดชบอร์ดใช้สูตร payments แล้ว และล็อกสูตรในสัญญา/ฟังก์ชันเดียว
3. **งาน 2.5** (ตัด blob `/api/admin`) ยังเลื่อนตามที่มาร์คสั่ง รอแบงค์ย้ายหน้า
4. สัญญาเดิมย่อหน้า DB-005 ที่เขียนว่า features เป็น `false` — **แก้ในรอบนี้ให้ตรงความจริงแล้ว** (`true`)

ไม่พบ regression จากเทสต์ชุดเต็มหลังแก้

---

## 6. ขอมาร์ค

1. รีวิว / merge **PR #25**
2. **ห้าม deploy** จาก PR นี้จนกว่ามาร์คสั่ง
3. ยืนยันว่างาน 1 ผ่านตามโจทย์ → น็อตจะเริ่ม **งาน 2** (list APIs) คนละ branch/PR
4. (ถ้าต้องการ) ยืนยันว่าจะผูก `order_id` บนแชทในรอบไหน
