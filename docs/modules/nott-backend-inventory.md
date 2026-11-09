# NOTT Backend Inventory (ของจริงในรีโป)

Task: **0.1.1** · วันที่: 2026-11-09  
ขอบเขต: สำรวจเท่านั้น — **ไม่แก้โค้ดระบบหลัก**  
แหล่งสำรวจ: `server/`, `cloud/`, `wrangler.jsonc`, `docs/architecture.md`, `tests/`

## 1) Runtime

| รายการ | ของจริง | หลักฐาน |
|--------|---------|---------|
| Local Node API | `server/http.mjs` + SQLite `.data/commerce.sqlite` | README, `server/commerce.mjs` |
| Shared domain | `server/domain.mjs` → `createCommerceCore` | ใช้ทั้ง Node และ Cloudflare |
| Shared HTTP API | `server/api-handler.mjs` → `createAPIHandler` | Fetch Request/Response |
| Cloudflare | Worker `astra` + Durable Object class `Commerce` + SQLite ใน DO | `cloud/worker.mjs`, `wrangler.jsonc` |
| Frontend host | Pages `astra-demo` proxy `/api/*` → Worker | `pages/wrangler.jsonc`, `cloud/pages-proxy.mjs` |
| D1 | **ไม่มีในรีโป** | ไม่มี binding D1 ใน `wrangler.jsonc` |
| `packages/contracts` | **ไม่มี** | ไม่มีโฟลเดอร์ `packages/` |
| Hono | **ไม่มี** | API มือเขียนใน `api-handler.mjs` |

Secrets ที่เอกสาร/โค้ดอ้าง (ห้าม commit ค่า): `SPACE_SIGNING_KEY`, `INVENTORY_KEY`, local `.data/inventory.key`, optional `ASTRA_ADMIN_PASSWORD`

Cookies: `astra_session` (auth) · `astra_space` (Cloudflare workspace HMAC)

## 2) Schema (migrations)

ที่อยู่: `server/migrations/` (append-only ตาม architecture)  
Cloud บันทึกใน `schema_migrations` ภายในแต่ละ Durable Object

### `001_initial.sql`
| ตาราง | หมายเหตุสำคัญ |
|-------|----------------|
| `users` | `role` CHECK `CUSTOMER\|ADMIN`; email unique |
| `sessions` | เก็บ `token_hash` ไม่เก็บ raw token |
| `products` | catalog |
| `variants` | `price INTEGER` (หน่วยเงินจำนวนเต็ม — top-up ใช้ `amount * 100`) |
| `orders` | statuses: PENDING_PAYMENT, DELIVERED, FAILED, CANCELLED, OUT_OF_STOCK; UNIQUE(user_id, request_key) |
| `inventory` | `fingerprint` UNIQUE; `secret` เข้ารหัส; allocate ผ่าน `order_id` |
| `ledger` | `reference` UNIQUE (idempotent debit/top-up) |
| `audit` | action log |

Indexes: `inventory_available(variant_id, order_id)`, `orders_owner(user_id, created_at)`

### `002_reviews.sql`
| ตาราง | หมายเหตุ |
|-------|----------|
| `reviews` | UNIQUE `order_id`; rating 1–5 |

### `003_reference_layout.sql`
| การเปลี่ยน | หมายเหตุ |
|------------|----------|
| `products.hidden_seed`, `products.preorder` | ซ่อน seed เก่า / preorder flag |
| `users.username` | unique partial index เมื่อไม่ null |
| `runtime_flags` | one-shot catalog migration flags |
| `reservations` | preorder queue; statuses PENDING_PAYMENT, PREORDER, FAILED, CANCELLED |

### สิ่งที่ brief ขอแต่**ยังไม่มีตารางแยก**
- `payments` (payment อยู่ใน order/reservation + sandbox confirm)
- `allocations` (allocation = อัปเดตแถว `inventory.order_id`)
- `chat`, `notifications` (ยังไม่มีใน schema)

## 3) API routes (`server/api-handler.mjs`)

กฎร่วม: GET/POST เท่านั้น · POST ต้องมี `X-Astra-Request: 1`, JSON, same-origin Origin · auth rate limit บน login/register/demo/demo-merchant · security headers คงที่

| Method | Path | Domain | Auth |
|--------|------|--------|------|
| GET | `/api/health` | health + `storageKind` | public |
| GET | `/api/me` | `publicUser` | session optional→user/null |
| GET | `/api/products` | `products` | public (ไม่คืน unused keys) |
| GET | `/api/overview` | `overview` | public |
| GET | `/api/reviews` | `reviews` | public |
| GET | `/api/orders` | `orders` | require user |
| GET | `/api/orders/:id` | `orderDetail` | owner; ส่ง codes เฉพาะของตนเมื่อ DELIVERED |
| GET | `/api/ledger` | `ledger` | require user |
| GET | `/api/admin` | `adminOverview` | ADMIN |
| POST | `/api/login` | `login` | sets session cookie |
| POST | `/api/register` | `register` | sets session cookie |
| POST | `/api/demo` | `demo` | guest customer + credits |
| POST | `/api/demo-merchant` | `demoMerchant` | elevate ADMIN ใน workspace ที่อนุญาต |
| POST | `/api/logout` | `logout` | clear cookie |
| POST | `/api/orders` | `createOrder` | user |
| POST | `/api/orders/:id/pay` | `pay` | owner; sandbox outcome |
| POST | `/api/orders/:id/retry` | `retry` | owner pending |
| POST | `/api/topup` | `topup` | user; TEST presets |
| POST | `/api/profile` | `profile` | user |
| POST | `/api/reviews` | `addReview` | delivered-order owner |
| POST | `/api/admin/inventory` | `importCodes` | ADMIN |
| POST | `/api/admin/settings` | `saveSettings` | ADMIN |
| POST | `/api/admin/products` | `saveProduct` | ADMIN |

Client เรียกผ่าน `src/api.ts` (`fetch("/api" + path)` + header `X-Astra-Request`)

## 4) Domain capabilities (`createCommerceCore`)

| กลุ่ม | ฟังก์ชันหลัก |
|-------|---------------|
| Identity | `register`, `login`, `demo`, `demoMerchant`, `session`, `profile`, `logout`, `publicUser` |
| Catalog | `products`, `overview`, `settings`, `saveSettings`, `saveProduct` |
| Commerce | `createOrder`, `orderDetail`, `orders`, `pay`, `retry`, `topup`, `ledger` |
| Inventory | `importCodes` (AES-GCM encrypt at rest; list ไม่คืน plaintext unused) |
| Reviews | `reviews`, `addReview` |
| Admin | `adminOverview` |
| Guards | `requireUser`, `requireAdmin`; **role ไม่รับจาก client body** (มีเทสครอบ) |

Payment ปัจจุบัน = sandbox confirmation token บน order/reservation — **ไม่มี PaymentAdapter / provider webhook**

## 5) Cloudflare isolation (`cloud/worker.mjs`)

- Cookie `astra_space` ลงนาม HMAC → เลือก Durable Object ส่วนตัว
- Object ชื่อ `presentation` = อ่านอย่างเดียว (POST ถูก 403)
- `allowDemoAdmin: !presentation`
- Inventory key ต่อ object: HMAC(`INVENTORY_KEY`, object id)
- Auth rate limits เก็บใน SQLite ตาราง `rate_limits`

## 6) Tests ที่เกี่ยวกับ backend

| ไฟล์ | ครอบคลุม (สรุป) |
|------|------------------|
| `tests/commerce.test.mjs` | allocation, idempotent pay/retry, last-key race, ownership/IDOR, import duplicate, password/role injection, encrypt persistence, HTTP CSRF/owner, reviews, demo-merchant gate, preorder, settings/closure |
| `tests/storefront.spec.mjs` | E2E ซื้อ/ส่งโค้ด/top-up/admin import/export/responsive |

## 7) สิ่งที่ brief ชื่อไว้แต่**ไม่มีในรีโป**

| Brief | สถานะในรีโป |
|-------|-------------|
| `README_TH.md`, `docs/SOW_CHECKLIST.md`, `MODULES_AND_API.md`, `SECURITY.md`, `SPRINT_01.md` | ไม่มี (ใช้ docs ผลิตภัณฑ์แทน) |
| `db/migrations/0001_init.sql` | ไม่มี — ใช้ `server/migrations/001_initial.sql` |
| D1 + Hono monorepo | ไม่มี |
| `packages/contracts` | ไม่มี |
| Chat / notifications schema+API | ไม่มี |
| Payment provider adapter | ไม่มี (มีแค่ sandbox pay) |

## 8) หลักฐานคำสั่งสำรวจ

- อ่าน/ค้นด้วยเครื่องมือในแชท: `server/api-handler.mjs` (ครบทุก route), `server/migrations/*.sql`, `server/domain.mjs` (exports + pay/topup), `cloud/worker.mjs`, `tests/*.mjs`
- ไม่รัน mutate ต่อ production; งานนี้เป็นเอกสารอย่างเดียว
