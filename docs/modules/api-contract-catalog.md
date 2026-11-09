# API Contract — Catalog (D1 schema)

สถานะ: **Draft** สำหรับ Mark/Bank agree · NOTT เผยแพร่แล้วในรีโป (Phase 3)  
Types: `@astra/contracts` → `packages/contracts`  
Storage label ใน response: `d1-schema-sqlite` (local stand-in ของ D1 target schema)

## Endpoints

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/d1/products` | Public | `{ products: CatalogProductSummary[], storage }` |
| GET | `/api/d1/products/:id` | Public | `{ product: CatalogProductDetail, storage }` |
| GET | `/api/d1/inventory/secrets` | — | **403** เสมอ (negative guard) |

เงิน: `price` เป็น integer **satang**  
สต็อก: advisory count ของ `inventory_units` ที่ยังไม่มี `allocations`  
**ห้าม** มี field `secret` / `fingerprint` / plaintext key ใน response

## เทียบของเดิม

| ของเดิม (DO/Node demo) | ของใหม่ (Phase 3) |
|------------------------|-------------------|
| `GET /api/products` | ยังมีอยู่บนแทร็ก A |
| — | `GET /api/d1/products` + detail แยกบนแทร็ก B |

## Dependency / BLOCKED

| รายการ | สถานะ |
|--------|--------|
| Mark agree บน types/Admin consumption | **BLOCKED** — รอรีวิว |
| Bank agree บน storefront mapping | **BLOCKED** — รอรีวิว |
| Worker cutover ไป D1 binding จริง | ยังไม่ทำ (dual-track) |
| Remote D1 database_id | ยัง placeholder |

## หลักฐานเทส

```sh
npm test
```

รวม `tests/d1-catalog.test.mjs` — list/detail ไม่รั่ว secret, HTTP 403 บน secret dump path
