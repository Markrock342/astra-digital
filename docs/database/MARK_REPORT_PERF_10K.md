# รายงานส่งมาร์ค — ความเร็ว 10k ออเดอร์ (MIG-011)

| ฟิลด์ | ค่า |
|--------|-----|
| สาขา | `feat/perf-10k-orders` |
| วันที่ | 2026-11-13 |
| สคริปต์ | `npm run perf:10k` |

## ผลวัด (เครื่อง local · SQLite · rounds=21)

| Endpoint | p95 ก่อน index | p95 หลัง MIG-011 |
|----------|----------------|------------------|
| `/api/admin/orders?limit=50` | 49.8 ms | 12.8 ms |
| `/api/admin/customers?limit=50` | 10.8 ms | 11.3 ms |
| `/api/admin/transactions?limit=50` | 1.4 ms | 0.6 ms |
| `/api/admin/reports/sales` | 114.4 ms | 283.4 ms |
| `/api/admin/reports/profit` | 229.9 ms | 352.0 ms |
| `/api/admin/products?limit=50` | 17.4 ms | 9.2 ms |
| `/api/admin/summary` | **4377.5 ms** | **25.0 ms** |

เป้า: p95 &lt; 500 ms หลัง index → **ผ่านทุกเส้น**

หมายเหตุ: summary ดีขึ้นชัดจาก index บน payments/orders; ตัวเลข sales/profit หลังอาจผันตาม cache/ANALYZE แต่ยังต่ำกว่าเป้า
