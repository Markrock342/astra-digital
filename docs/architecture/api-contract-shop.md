# สัญญา API ร้านกลาง (Shop API Contract)

สถานะ: ใช้กับร้านที่ขึ้นแล้วเมื่อ 10 พ.ย. 2026  
ฐาน: Cloudflare Workers + Durable Object SQLite ชุดเดียวชื่อ `shop`  
ยังไม่ย้ายไป Cloudflare D1 หรือ Neon PostgreSQL

## กติกา

- ทุกคำขอ `/api` เข้าฐานชุดเดียวกัน
- สิทธิ์ตัดสินบน server จาก session ไม่รับ role จาก client
- ลูกค้าอ่านและแก้ได้เฉพาะข้อมูลของตัวเอง
- รหัสสินค้าไม่โผล่ใน API สาธารณะ และยังไม่ส่งก่อนมียอดยืนยัน
- ของที่ส่งคือ ID กับรหัสผ่าน เข้ารหัสทั้งคู่ ตาม [SOW](../prompts/SOW-FIFACORP-FINAL-20261110.md)
- ช่องทางจ่ายยังปิด
- อันดับผู้ซื้อเปิดเฉพาะผู้ดูแล จนกว่าลูกค้าจะตอบว่าให้คนซื้อเห็นด้วย

## ใครเรียกอะไรได้

| กลุ่ม | ไม่ล็อกอิน | ลูกค้า | พนักงาน | ผู้ดูแล |
|---|---|---|---|---|
| สุขภาพระบบ สินค้า หน้าร้าน รีวิวที่เปิดสาธารณะ | ได้ | ได้ | ได้ | ได้ |
| คำสั่งซื้อ แชท คิวของตน ข้อความในเว็บ | ไม่ได้ | เฉพาะของตน | ของตน และงานที่ได้รับมอบ | ได้ตามสิทธิผู้ดูแล |
| คลังสินค้า ตั้งค่าร้าน นำเข้ารหัสสินค้า | ไม่ได้ | ไม่ได้ | ไม่ได้ | ได้ |
| อันดับผู้ซื้อ `GET /api/rankings/buyers` | ไม่ได้ | ไม่ได้ | ไม่ได้ | ได้ |
| แชทหลังบ้าน (ทุกห้อง / ปิดห้อง) | ไม่ได้ | ของตน | ได้ | ได้ |
| แจ้งเตือนในเว็บ | ไม่ได้ | ของตน | ของตน (รวมออเดอร์/คิว/สต็อก) | ของตน |
| สรุปยอดขาย `adminOverview.revenue` / การเงิน | ไม่ได้ | ไม่ได้ | ไม่ได้ | ได้ |

### แชทฝั่งแอดมิน / พนักงาน (FR-M1)

`GET /api/chat/threads` (STAFF หรือ ADMIN)

- คืนทุกห้องเรียง `lastMessageAt` (ข้อความล่าสุด · ถ้าไม่มีข้อความใช้เวลาเปิดห้อง) จากใหม่ไปเก่า
- แต่ละแถวมีอย่างน้อย: `id`, `status`, `customer`, `customer_email`, `messages`, `lastMessageAt`, `unreadCount`
- `unreadCount` = จำนวนข้อความ `sender_type=USER` ที่ใหม่กว่าเวลาที่ staff คนนั้นอ่านห้องล่าสุด (อ่านเมื่อเรียก `GET /api/chat/threads/:id/messages`)
- ลูกค้าเรียก endpoint เดียวกันได้เฉพาะห้องของตน · `unreadCount` เป็น 0

ตอบ / ปิดห้อง (มีอยู่แล้ว)

- `POST /api/chat/threads/:id/messages` — body `{ "body": "…" }`
- `POST /api/chat/threads/:id/close` — ปิดห้อง · ส่งซ้ำบนห้องปิดได้ 409

### แจ้งเตือนฝั่งแอดมิน (FR-M3)

`GET /api/notifications` · `POST /api/notifications/:id/read`

ชนิดที่ระบบสร้างให้ STAFF/ADMIN นอกจาก `chat`:

| kind | เมื่อไหร่ |
|------|----------|
| `order_new` | ออเดอร์พร้อมส่งชำระสำเร็จและส่งของแล้ว |
| `preorder_queue_admin` | พรีออเดอร์จ่ายแล้วได้เลขคิว |
| `stock_low` | สต็อกตัวเลือกเหลือ ≤ 3 (throttle ~5 นาทีต่อ variant) |

ลูกค้ายังได้ `code_delivery` / `preorder_queue` / `chat` / `order` ตามเดิม

### ยอดขายแดชบอร์ด (FR-F10)

- `GET /api/admin` → `revenue` คิดจากสูตรเดียว: `SUM(payments.amount WHERE status='SUCCEEDED') − SUM(|ledger.amount| WHERE kind='REFUND')`
- ส่วนลบใช้แถว `ledger.kind='REFUND'` จริงเมื่อมี (งาน 5 ยังไม่เปิด UI คืนเงิน) · แถว `DEMO_CREDIT` ไม่เข้าสูตรนี้
- ห้ามนับจากสถานะออเดอร์ `DELIVERED`/`PREORDER` คนละสูตรกับหน้าการเงิน

### Features ให้หน้าจอรู้ว่าพร้อม

- `GET /api/health` และ `GET /api/me` ส่ง `features` ชุดเดียวกัน
- หลังงาน 1 มีอย่างน้อย: `credentialPair`, `preorderDelivery`, `adminChatInbox`, `adminOpsNotifications`, `salesRevenueFromPayments` (boolean)
- หลังงาน 2 เพิ่ม: `adminOrdersApi`, `adminCustomersApi`, `adminProductsApi`, `adminSummaryApi` (boolean)
- หลัง FR-P3: `productPreorderForm` (boolean) — `POST /api/admin/products` รับ `preorder`
- หลังงาน 3: `adminFinance` (boolean) — `GET /api/admin/transactions` พร้อม
- หลังงาน 4: `adminVariantCrud`, `adminStockApi` (boolean)
- หลังงาน 5 (FR-O5): `adminReplaceCredential` (boolean) — `POST /api/admin/orders/:id/replace`
- หลังงาน 5 (UP-1/UP-2 uploads): `uploads` (boolean) — รูปสินค้า + avatar + logo + `GET /api/files/:key`

### สินค้า — ตั้งพรีออเดอร์จากฟอร์ม (FR-P3)

`POST /api/admin/products` (ADMIN)

- body เดิม + `preorder` (boolean / `"on"` / `1`)
- สร้างใหม่: ไม่ส่ง `preorder` → `0` · ส่ง true → สินค้าเป็นพรีออเดอร์ (สั่งแล้วเข้า `reservations`)
- แก้ของเดิม: ไม่ส่ง `preorder` → คงค่าเดิม · ส่ง false → ปิดพรีออเดอร์
- ตอบ `{ id, preorder }`

### สรุปยอดตามช่วงวัน (Admin FR งาน 2 เพิ่ม · FR-F10 / FR-R2)

`GET /api/admin/summary?from&to` — **ADMIN only** (STAFF/CUSTOMER → 403)

- `from` / `to` เป็น `YYYY-MM-DD` ตีความเป็นวันปฏิทิน **Asia/Bangkok** (ส่งคู่กัน หรือไม่ส่งทั้งคู่ = ทั้งช่วง)
- คืน `{ from, to, timezone: "Asia/Bangkok", revenue, orderCount, newCustomers }`
- `revenue` = สูตร FR-F10 ในช่วง (`payments SUCCEEDED` ตาม `COALESCE(finalized_at,created_at)` − `ledger REFUND`)
- `orderCount` = จำนวนแถว `orders` + `reservations` ที่ `created_at` ในช่วง
- `newCustomers` = ผู้ใช้ `role=CUSTOMER` ที่สมัครในช่วง
- ให้แบงค์เลิกคำนวณยอดจาก blob ใน `Admin.tsx` แล้วใช้เลขนี้

### รายการหลังบ้านแบบแบ่งหน้า (Admin FR งาน 2 · NFR-1)

สิทธิ์: STAFF หรือ ADMIN · CUSTOMER → 403  
ยังคง `GET /api/admin` (blob สรุป) ไว้จนกว่าแบงค์ย้ายหน้าจอ (งาน 2.5 เลื่อน)

`GET /api/admin/orders?status&from&to&product&customer&type=ready|preorder&q&cursor&limit`

- คืน `{ orders[], nextCursor }` · เรียง `created_at DESC, id DESC`
- แต่ละแถว: id, status, total, quantity, created_at, customer_*, product_*, variant_*, type, queue_number

`GET /api/admin/orders/:id`

- สินค้า · ลูกค้า · payments[] · timeline[] · บัญชีที่ส่งแบบ**ปิดบัง** (`credentialsMasked: true`)

`POST /api/admin/orders/:id/reveal`

- คืน plaintext codes/credentials · บันทึก audit `REVEAL_ORDER_CREDENTIALS` ใน transaction ทุกครั้ง · ยังไม่ DELIVERED → 409

`GET /api/admin/customers?q&status&from&to&minSpent&maxSpent&hasOrders&sort&cursor&limit`

- `status` นอกจาก `ACTIVE` คืนรายการว่าง (ยังไม่มีแบนจนกว่างาน 5) · `sort` = created_at|spent|orders|name
- คืน `{ customers[], nextCursor }` · มี `orderCount`, `status: "ACTIVE"`
- `spentSatang` ส่งเฉพาะ **ADMIN** (STAFF ไม่ได้ตาม NFR-3)
- `from`/`to` ตีความวันปฏิทิน **Asia/Bangkok** เหมือน summary · คำค้น LIKE escape `%` `_`

`GET /api/admin/products?q&category&status=active|inactive&type=ready|preorder&stock=out|low|in&sort&cursor&limit`

- `sort` = name|stock|sold|id · คืน `{ products[], nextCursor }` · มี stock / stockStatus / sold  
- `sold` = ออเดอร์ `DELIVERED` + reservations สถานะ `PREORDER|DELIVERED`
- คำค้น LIKE escape `%` `_`
- `POST /api/admin/products` รับ `preorder` ตาม FR-P3

### การเงิน — รายการ ledger (Admin FR งาน 3 · FR-F2–F4, F9)

`GET /api/admin/transactions?from&to&kind&direction&status&customer&min&max&q&cursor&limit&format` — **ADMIN only** (STAFF/CUSTOMER → 403)

- `from`/`to` = `YYYY-MM-DD` Asia/Bangkok (ส่งคู่หรือไม่ส่ง)
- ค่าเริ่มต้น**ไม่รวม** `DEMO_CREDIT` · ส่ง `kind=DEMO_CREDIT` เท่านั้นจึงเห็นเครดิตทดลอง
- kinds เงินจริง: `PAYMENT_IN|TOPUP|PURCHASE|REFUND|ADJUSTMENT|WITHDRAWAL|FEE`
- คืน `{ transactions[], summary, nextCursor }`
- `summary` ตามตัวกรองเดียวกัน: `{ in, out, net, pending, count, daily[] }`
- `summary.daily[].day` = วันปฏิทิน **Asia/Bangkok** (ไม่ใช่ substr UTC ของ `created_at`)
- `format=csv` → ไฟล์ CSV **ทุกแถวตามตัวกรอง** (ไม่ตัดตามหน้า cursor) สูงสุด 10 000 แถว เกินแล้ว 400 (FR-F9)
- ตอนชำระ sandbox สำเร็จ บันทึกอย่างน้อย `PAYMENT_IN` ใน ledger (แยกจาก `DEMO_CREDIT` / `PURCHASE` ของ wallet)
- runtime **ห้าม** UPDATE/DELETE แถวเงิน — แก้ด้วยแถว `ADJUSTMENT` (UI คืนเงิน/ถอน = งาน 5)

Migration: `006_ledger_money.sql` (idempotent) ขยายคอลัมน์ `direction, fee, net, status, order_id, payment_id, provider_ref, actor_id, reason, finalized_at`

### ตัวเลือกสินค้า (Admin FR งาน 4 · FR-P2)

- `GET /api/admin/products/:id/variants` — STAFF+ · `{ variants[] }` มี label, price, active, sort_order, stock, stockStatus
- `POST /api/admin/products/:id/variants` — ADMIN · body `{ label, price, sort_order? }` → 201
- `PATCH /api/admin/variants/:id` — ADMIN · แก้ label/price/active/sort_order
- `DELETE /api/admin/variants/:id` — ADMIN · ลบได้เมื่อไม่มีออเดอร์/จอง/สต็อก · ถ้ามี → 409 ให้ปิด `active` แทน
- หน้าร้านและ checkout เห็นเฉพาะ `active=1` · เรียง `sort_order ASC`
- Migration `007_variant_stock.sql`: `variants.active`, `variants.sort_order`

### สต็อกต่อตัวเลือก (Admin FR งาน 4 · FR-P7)

- `GET /api/admin/variants/:id/inventory?status=available|sold|defective&cursor&limit` — STAFF+ · ปิดบังรหัส (`credentialsMasked`)
- `POST /api/admin/inventory/:id/defect` — ADMIN · `{ reason }` เฉพาะ available
- `DELETE /api/admin/inventory/:id` — ADMIN · ลบได้เฉพาะ available
- `POST /api/admin/inventory` รับ `csv` ข้อความเพิ่มจาก `codes`/`items` เดิม (บรรทัดละโค้ด หรือ `loginId,password`) · ฟิลด์ท้ายทางเลือก `cost` (สตางค์, integer ≥0) ทั้ง `items[].cost` และ `CODE,cost` / `loginId,password,cost`
- `POST /api/admin/settings` รับ `lowStockAt` (1–100, default 3) · แจ้งเตือน `stock_low` และ `stockStatus` ใช้ค่านี้
- สต็อก available ไม่นับแถว `defective=1` · Migration 007 เพิ่มคอลัมน์ defective*
- Migration `009_inventory_cost.sql`: `inventory.cost INTEGER NULL` (สตางค์)

### สต็อกที่หน้าร้านเห็น

- `GET /api/products` และ `/api/products/:id` ส่ง `stock` ไม่เกิน 10 (เท่าจำนวนสูงสุดต่อคำสั่งซื้อ) และ `stockStatus` = `in` | `low` (เหลือ ≤ `lowStockAt`, default 3) | `out`
- หน้าร้านแสดงแค่ "มีสินค้า / เหลือน้อย / สินค้าหมด" ไม่แสดงจำนวนจริง
- จำนวนจริงดูได้เฉพาะผู้ดูแลที่ `GET /api/admin`

### คิวพรีออเดอร์

- เลขคิวออกตอนชำระเงินสำเร็จ ใน transaction เดียวกับการรับเงิน คิวเป็นลำดับรวมทั้งร้าน
- จองแล้วยังไม่จ่าย = ไม่มีเลขคิว และไม่ขึ้นบนกระดานคิวของพนักงาน
- ยกเลิกหรือคืนเงินแล้วเลขเดิมว่างไว้ ไม่เลื่อนคิวคนอื่น
- ผู้ดูแลส่งของตามลำดับคิว (รอ migration 005)

### สัญญา DB-005 ที่หน้าหลังบ้านรอใช้ (issue #18)

หน้าหลังบ้านใช้ flag ใน `GET /api/health` และ `GET /api/me` → `features` · หลังงาน ISSUE-18 + Admin FR งาน 1 ทั้ง `credentialPair` และ `preorderDelivery` เป็น `true` (พร้อม flags งาน 1 ตามหมวด Features ด้านบน)

**นำเข้า ID + รหัสผ่าน** — `POST /api/admin/inventory` (ADMIN)

```json
{ "variantId": "…", "items": [{ "loginId": "…", "password": "…", "cost": 1500 }] }
```

- 1–100 รายการต่อครั้ง · `loginId` ถูก trim · `password` **ไม่ trim** ส่งมาตามที่กรอก (อาจมีช่องว่าง `:` `|` หรือแท็บ)
- `cost` ทางเลือก = ต้นทุนสตางค์ (integer ≥0) · เก็บใน `inventory.cost` · ไม่ส่ง = NULL
- `codes` รองรับ `CODE,cost` ต่อบรรทัด · CSV รองรับ `loginId,password,cost`
- ตอบ `{ "imported": n }` · ซ้ำ (fingerprint ชน) ตอบ 409 ทั้งชุด ไม่บันทึกบางส่วน
- ยังรับ `codes` แบบเดิมได้ระหว่างเปลี่ยนผ่าน

### รายงานกำไร (หลัง MIG-009)

`GET /api/admin/reports/profit?from&to&format` — **ADMIN only** (STAFF → 403)

- สูตร: `profit = revenue(payments SUCCEEDED) − refunds(ledger REFUND) − SUM(COALESCE(inventory.cost,0))` ของหน่วยที่ผูก `order_id`/`reservation_id` ในช่วง
- ใช้ `moneyScope` เหมือนรายงานยอดขาย · live ตัด sandbox
- `format=csv` → ไฟล์ CSV

**ส่งของพรีออเดอร์** — `POST /api/admin/reservations/:id/deliver` (STAFF+, body `{}`)

- ตอบ metadata เท่านั้น เช่น `{ "id", "status": "DELIVERED", "delivered_at", "delivered_by", "delivered": n }` ไม่มีรหัส
- เรียกซ้ำหลังส่งแล้วตอบ metadata เดิม 200 · ไม่ใช่ PREORDER ตอบ 409 · ของไม่พอตอบ 409
- กระดานคิวใช้ `GET /api/queue` เดิม

**อัปโหลดรูป (W5 UP-1 + UP-2)** — flag `uploads`

| Method | Path | สิทธิ์ |
|--------|------|--------|
| GET | `/api/files/:key` | สาธารณะ |
| POST | `/api/admin/products/:id/images` | ADMIN · body = ไบต์รูป · `Content-Type: image/jpeg\|png\|webp` |
| PATCH | `/api/admin/products/:id/images` | ADMIN · JSON `{ "order": [imageId…] }` ครบชุด |
| DELETE | `/api/admin/product-images/:id` | ADMIN |
| POST | `/api/profile/avatar` | ผู้ใช้ที่ล็อกอิน · body = ไบต์รูป |
| DELETE | `/api/profile/avatar` | ผู้ใช้ที่ล็อกอิน |
| POST | `/api/admin/settings/logo` | ADMIN · body = ไบต์รูป |
| DELETE | `/api/admin/settings/logo` | ADMIN |

- เก็บผ่าน `file-store`: R2 `UPLOADS` ถ้ามี · ไม่มีใช้ตาราง `files` (BLOB)
- ตรวจ magic bytes + Content-Type · ≤2MB · ห้าม SVG/GIF · key = UUID · rate 30 ครั้ง/10 นาที
- audit: `PRODUCT_IMAGE_*` · `AVATAR_SET`/`AVATAR_REMOVE` · `LOGO_SET`/`LOGO_REMOVE`
- `GET /api/files/:key` → `Content-Type` ตามไฟล์ · `nosniff` · `Content-Disposition: inline` · `Cache-Control: public, max-age=31536000, immutable`
- `products` / `productDetail` / admin products / admin overview ส่ง `images: [{ id, url }]` + `imageUrl` (รูปแรกหรือ null)
- `publicUser` (`/api/me`, ทีม, ลูกค้าหลังบ้าน) ส่ง `avatarUrl` (หรือ null)
- `settings()` / `GET /api/overview` ส่ง `logoUrl` (หรือ null) · เก็บจริงเป็น `logoKey` ใน shop-settings
- live: รูปสินค้า + logo bump `catalog` · avatar bump `customers`

**เปลี่ยนบัญชีที่เสีย (FR-O5)** — `POST /api/admin/orders/:id/replace` (ADMIN)

```json
{ "inventoryId": "…", "reason": "…" }
```

- ใช้ได้กับออเดอร์พร้อมส่งหรือพรีออเดอร์ที่ `DELIVERED` แล้ว (id เดียวกับ detail/reveal)
- `inventoryId` ต้องเป็นแถวที่ผูก order/reservation นั้นอยู่ · ดึงบัญชีใหม่จากสต็อก available ตัวเลือกเดียวกัน
- บัญชีเก่า → `defective=1` + เหตุผล · เคลียร์ bind · บัญชีใหม่ผูกแทน
- แจ้งเตือนลูกค้าในเว็บ · audit `REPLACE_ORDER_CREDENTIAL` · ตอบ metadata เท่านั้น (ไม่มี plaintext)
- สต็อกหมด / ยังไม่ DELIVERED / id ไม่ตรง → 409 · STAFF/CUSTOMER → 403

**เจ้าของอ่านของที่ได้รับ** — `GET /api/orders/:id` (ทั้งออเดอร์ปกติและพรีออเดอร์)

- เพิ่ม `credentials: [{ "loginId", "password" }]` เฉพาะเจ้าของ และสถานะ `DELIVERED`
- `codes` ยังอยู่สำหรับของเก่าแบบช่องเดียว · staff/admin ได้ทั้งสองค่าเป็น array ว่าง

### อันดับผู้ซื้อ

`GET /api/rankings/buyers?period=day|week|month|all&limit=1-50`

- `period` ไม่ส่งมา = `all`, `limit` ไม่ส่งมา = 10 ถ้าค่าไม่ถูกต้อง (เช่น `limit=1.5` หรือ `period=year`) ตอบ 400
- ตัดรอบวัน/สัปดาห์ (เริ่มวันจันทร์)/เดือน ตามเวลา Asia/Bangkok นับจาก `created_at` ของรายการ
- นับยอดจากคำสั่งซื้อที่ `DELIVERED` และพรีออเดอร์ที่จ่ายแล้ว (`PREORDER`)
- คืน `rank`, `name`, `email`, `orders`, `spentSatang` ไม่ส่ง user id และไม่ปิดชื่อ เพราะผู้ดูแลเท่านั้นที่เรียกได้ ถ้าภายหลังเปิดให้หน้าร้านเห็น ต้องมี endpoint แยกที่ปิดชื่อ

พนักงานกับผู้ดูแลใช้คนละสิทธิ์อยู่แล้ว การแบ่งละเอียดกว่านี้รอสรุปจากสายลูกค้า

## สิ่งที่ยังไม่เปลี่ยนในสัญญานี้

- วิธีส่งของพรีออเดอร์ จะส่งเองหรือรอผู้ดูแลกด
- การล็อกอินผ่าน LINE
- การให้อันดับผู้ซื้อโชว์บนหน้าร้าน
- จำนวนคนในหลังบ้านและสิทธิ์ย่อย

น็อตตรวจฐานเดิมเรื่อง transaction ตอนตัดสต็อก การกันขายโค้ดซ้ำ และสิทธิ์ตามตารางนี้ ยังไม่ต้องขึ้นเซิร์ฟเวอร์ซ้ำจากสัญญานี้

## Admin screens — Mark (12 พ.ย. 2026, branch `feat/admin-screens-mark`)

- `POST /api/admin/products` ใช้ `preorder: boolean` ของน็อต (#27) · หน้าจอส่งค่านี้จากช่อง "วิธีส่งของ" · เปลี่ยนแล้ว audit `PRODUCT_SET_PREORDER` / `PRODUCT_SET_READY`
- `GET /api/admin/customers/:id` (STAFF+) โปรไฟล์ สถานะ ออเดอร์ 50 รายการล่าสุด ประวัติ audit · ADMIN ได้ `spentSatang`, `creditSatang`, `ledger` เพิ่ม
- `POST /api/admin/customers/:id` (ADMIN) `{firstName, lastName, email, phone, note}` · อีเมลซ้ำ 409 · audit `CUSTOMER_UPDATE` พร้อมค่าก่อน/หลัง
- `POST /api/admin/customers/:id/status` (ADMIN) `{status: ACTIVE|SUSPENDED|BANNED, reason}` · ระงับ/แบนต้องมีเหตุผล ลบ session ทันที login ได้ 403 · audit `CUSTOMER_STATUS`
- `POST /api/admin/customers/:id/sign-out` (ADMIN) ลบ session ทั้งหมด
- Schema: `ensureCustomerAdmin` (idempotent ALTER) เพิ่ม `users.status, status_reason, status_changed_at, status_changed_by, first_name, last_name, phone, note` และ `audit.detail` (JSON) · ไม่ใช้เลข migration (006 สงวนให้ ledger ของน็อต)
- บั๊กรีวิว PR #26 ใช้ฉบับน็อต (#28) · มาร์คเพิ่ม: STAFF ส่ง `minSpent`/`maxSpent` ได้ 403
- แก้จาก #28: `GET /api/ledger` (กระเป๋าลูกค้า) และเครดิตในหน้าลูกค้าแสดงเฉพาะ kind เครดิต (ไม่รวม PAYMENT_IN/FEE/WITHDRAWAL) · `adminTransactions` summary ตอนกรองช่วงวันไม่พัง (เดิมตัดเงื่อนไข `created_at <=` ทิ้งแต่พารามิเตอร์ค้าง)
- หน้าจอ: `/admin/payments` ใช้ `GET /api/admin/transactions`
- `/api/admin/customers?status=` กรองสถานะจริงแล้ว
