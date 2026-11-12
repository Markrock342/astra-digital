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
- คืนเงินยังไม่มีในระบบ → ส่วนลบเป็น 0 จนกว่างานเงิน (FR-F6)
- ห้ามนับจากสถานะออเดอร์ `DELIVERED`/`PREORDER` คนละสูตรกับหน้าการเงิน

### Features ให้หน้าจอรู้ว่าพร้อม

- `GET /api/health` และ `GET /api/me` ส่ง `features` ชุดเดียวกัน
- หลังงาน 1 มีอย่างน้อย: `credentialPair`, `preorderDelivery`, `adminChatInbox`, `adminOpsNotifications`, `salesRevenueFromPayments` (boolean)
- หลังงาน 2 เพิ่ม: `adminOrdersApi`, `adminCustomersApi`, `adminProductsApi`, `adminSummaryApi` (boolean)

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
- คืน `{ customers[], nextCursor }` · มี `spentSatang`, `orderCount`, `status: "ACTIVE"`

`GET /api/admin/products?q&category&status=active|inactive&type=ready|preorder&stock=out|low|in&sort&cursor&limit`

- `sort` = name|stock|sold|id · คืน `{ products[], nextCursor }` · มี stock / stockStatus / sold  
- `POST /api/admin/products` (บันทึกสินค้า) ยังเป็นของเดิม ไม่เปลี่ยน

### สต็อกที่หน้าร้านเห็น

- `GET /api/products` และ `/api/products/:id` ส่ง `stock` ไม่เกิน 10 (เท่าจำนวนสูงสุดต่อคำสั่งซื้อ) และ `stockStatus` = `in` | `low` (เหลือ ≤ 3) | `out`
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
{ "variantId": "…", "items": [{ "loginId": "…", "password": "…" }] }
```

- 1–100 รายการต่อครั้ง · `loginId` ถูก trim · `password` **ไม่ trim** ส่งมาตามที่กรอก (อาจมีช่องว่าง `:` `|` หรือแท็บ)
- ตอบ `{ "imported": n }` · ซ้ำ (fingerprint ชน) ตอบ 409 ทั้งชุด ไม่บันทึกบางส่วน
- ยังรับ `codes` แบบเดิมได้ระหว่างเปลี่ยนผ่าน

**ส่งของพรีออเดอร์** — `POST /api/admin/reservations/:id/deliver` (ADMIN, body `{}`)

- ตอบ metadata เท่านั้น เช่น `{ "id", "status": "DELIVERED", "delivered_at", "delivered_by", "delivered": n }` ไม่มีรหัส
- เรียกซ้ำหลังส่งแล้วตอบ metadata เดิม 200 · ไม่ใช่ PREORDER ตอบ 409 · ของไม่พอตอบ 409
- กระดานคิวใช้ `GET /api/queue` เดิม

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
