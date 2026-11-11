# [TASK] MIG-005 — credential + preorder schema

ระบบ: ASTRA / NOTT  
แผนงาน: Phase 1–4 → Migration 005  
Current Task: **MIG-005** — ไฟล์เดียวตาม MIGRATION_PLAN §3

**รายละเอียดเทคนิค:**
- **เป้าหมาย:** rebuild `inventory` (dual credential + `reservation_id` XOR) และ `reservations` (DELIVERED + delivered_*) + indexes; wire worker; เทสต์อัปเกรด
- **Flow:** SQL DDL ผ่าน `executeSqliteMigration` + JS backfill (AES-GCM + HMAC) ใน `applyMigration005`
- **ไฟล์:** `server/migrations/005_credential_preorder_indexes.sql`, `server/migrate-005.mjs`, `server/commerce.mjs`, `cloud/worker.mjs`, `server/domain.mjs`, tests
- **ข้อห้าม:** ห้าม deploy · ห้าม flip `features.*` · ห้าม implement deliver route · ห้ามแก้ `004_commerce_ops.sql`
- **เกณฑ์ผ่าน:** MU1/MU2/MU3/MU5 + `npm test` เขียว + PR ให้ Mark รีวิว
- **หลักฐาน:** ผลรัน `npm test` · ลิงก์ PR
