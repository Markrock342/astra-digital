# Backup and restore

This page covers admin › ตั้งค่า › สำรองข้อมูล, the automatic daily backup to R2, and how to restore. Outside-the-website alerts are covered at the end.

## What a backup contains

- **File type.** One gzipped JSON file named `asiaextra-backup-YYYYMMDD-HHMMZ.json.gz`. Code: `server/backup.mjs`.
- **Header.** `format: "astra-backup"`, `version: 1`, `createdAt`, the shop name, mode (`sandbox`/`live`) and storage kind. It also has `schema.migrations`, the list of applied numbered migrations with `latestMigration`.
- **`tables[]`.** Every table, with its `CREATE TABLE` SQL (as SQLite stores it, including columns added later by the `ensure*` helpers), the column names and every row. Blobs (uploaded images in `files`) are stored as `{"$b64": "..."}`.
- **`schemaObjects[]`.** Indexes, views and triggers, including the append-only triggers on `ledger` and `audit`.
- **Rows that are not exported.** `sessions`, `rate_limits` and `login_challenges` are short-lived, so only their schema is kept. After a restore, everyone signs in again.
- **Internal tables are skipped.** That means Durable Object tables (`_cf_*`) and SQLite tables (`sqlite_*`).
- **Secrets stay encrypted, exactly as stored.** That covers stock credentials (`inventory.login_id_enc` / `password_enc`), TOTP secrets and the alert channel secrets. They use AES-256-GCM.
  - **The key is not in the file.** It is `HMAC-SHA256(INVENTORY_KEY, Durable Object id)`.
  - **Keep `INVENTORY_KEY` safe and separate from the backups.** Without it the encrypted fields cannot be read. With it plus a backup, someone can read every stock account.
  - **Password hashes are included** (scrypt, salted), along with customer names, emails and orders. Treat backup files as confidential.

## Manual export (admin › ตั้งค่า › สำรองข้อมูล › ดาวน์โหลดไฟล์สำรอง)

- **Endpoint.** `POST /api/admin/backup/export` with `{ "currentPassword": "..." }`. ADMIN only, and the password must be entered again (wrong attempts count towards the normal lockout).
- **Audit.** Each export writes a `BACKUP_EXPORT` audit row ("ดาวน์โหลดไฟล์สำรองข้อมูล" in ประวัติการทำงาน).
- **Response.** `Content-Type: application/gzip` with `Content-Disposition: attachment`, gzipped as a stream (`CompressionStream`).

### Size limits

| Part | Limit | Why |
| --- | --- | --- |
| Every table without BLOB columns | 64 MB of JSON text, read in one synchronous pass | This is a consistent snapshot (nothing else runs inside a Durable Object during sync code), and a DO has 128 MB of memory. Over the limit, the export answers 507 with a Thai message. |
| `files` (uploaded images in SQLite) | No cap | Streamed 16 rows at a time after the snapshot. Each image is at most 2 MB. Files are write-once, so streaming them later is safe. When the `UPLOADS` R2 bucket is bound, images live in R2 and are **not** in this backup. |
| Download | Streamed | The Worker passes the stream through unchanged. |

A shop of this size (thousands of orders) is far below 64 MB. As a reference, the local wrangler test shop was 7.5 KB compressed.

## Automatic daily backup to R2 (only when `BACKUPS` is bound)

It is off until Mark binds a bucket.

1. Create the bucket:
   ```
   npx wrangler r2 bucket create asiax-backups
   ```
2. In `wrangler.jsonc`, add the commented `BACKUPS` entry to `r2_buckets`:
   ```jsonc
   { "binding": "BACKUPS", "bucket_name": "asiax-backups" }
   ```
3. Deploy.

### How it runs

- **Trigger.** A Durable Object alarm (`ctx.storage.setAlarm`), not a Worker cron trigger.
  - The data lives in the DO, so the backup has to run inside it anyway. A cron would only wake the Worker to call the DO.
  - The alarm needs no extra `triggers` block in `wrangler.jsonc`. It stays off automatically when there is nothing to do (no `BACKUPS` binding and no daily summary).
  - Cloudflare retries a failed alarm.
- **When.** The alarm is checked on requests (at most every 5 minutes) and after each run. The backup runs once per Bangkok day, from 04:00 Asia/Bangkok. If the DO was asleep, it runs on the first alarm after that.
- **Where.** `backups/asiaextra-backup-YYYYMMDD-HHMMZ.json.gz` in the bucket.
  - Files over 8 MB use multipart upload with equal 8 MiB parts, so memory stays small.
- **Retention.** After each upload, objects under `backups/` older than 14 days are deleted. Other prefixes are never touched.
- **Status.** The admin page shows the last backup time, size and status. It shows "ยังไม่ได้ตั้งค่าที่เก็บสำรอง (R2)" with these steps when the binding is missing.
- **Test button.** "สำรองไป R2 ตอนนี้" (`POST /api/admin/backup/run`, password again, audit `BACKUP_R2_RUN`) checks the bucket right after it is bound.
- **Download a copy from R2:**
  ```
  npx wrangler r2 object get asiax-backups/backups/<file>.json.gz --file <file>.json.gz
  ```

## Restore into a local SQLite file (inspection or recovery)

```
node scripts/restore-backup.mjs asiaextra-backup-20261113-0400Z.json.gz restored.sqlite
```

- **What it does.** It creates the tables, inserts all rows, then the indexes, views and triggers, and runs `PRAGMA integrity_check`. It prints the row counts per table.
- **The output file must not exist.** Add `--force` to replace it.
- **Memory.** The script reads the whole backup into memory. That is fine up to a few hundred MB of JSON.
- **Open it read-only** with any SQLite tool (`sqlite3 restored.sqlite`).
- **Run it as the shop, locally.** Use the same key the live shop uses: the 32-byte `HMAC-SHA256(INVENTORY_KEY, <Durable Object id of "shop">)`. Then call `createCommerce({ path: "restored.sqlite", key })` from `server/commerce.mjs`. The unit test `tests/alerts-backup.test.mjs` does exactly this, and the buyer still sees their delivered account.

## Restore into the Durable Object (production): manual

There is **no restore button or endpoint**, on purpose: one wrong click would replace live orders and money. Restoring the live shop is a manual, planned operation:

1. Close the shop (the open/closed switch on the admin overview page) and take a fresh export first.
2. Deploy a one-off build with a temporary ADMIN-only route that calls `restoreBackup(db, backup, { transaction })` from `server/backup.mjs`. The function already works with the DO adapter, and the route would pass `transaction = (fn) => ctx.storage.transactionSync(fn)`.
   - `restoreBackup` refuses a database that already has the tables. So the route must first drop the existing tables, or the data must go into a **new** Durable Object name.
   - A new DO name changes the DO id, and with it the encryption key. Encrypted fields only work again in a DO whose id gives the same key. That means the same object name, `shop`, in the same Worker namespace.
3. Upload the backup to that route (the request body limit must be raised for this one route), check the counts, then remove the route and deploy again.
4. Uploaded images: with `UPLOADS` (R2) bound, they are in R2 and not in the backup. Back up that bucket separately if needed.

Steps 2–3 have not been built or rehearsed. Plan and test them on a staging copy before a real incident.

## Outside-the-website alerts (admin › ตั้งค่า › แจ้งเตือนนอกเว็บ)

- **Code.** `server/alerts.mjs`.
- **Channels.** Discord webhook, Telegram bot (token + chat id) and LINE Messaging API push (channel access token + user/group id). LINE Notify was shut down in March 2025 and is not used.
- **Secrets.** Encrypted with the same key as stock credentials. Only the last 4 characters are ever returned. Saving needs the admin password again (audit `SAVE_ALERTS`, values not logged).
- **Events.** New paid order, new paid preorder (queue), low/out of stock (once per crossing), new customer chat message (the text itself is not sent out), chat assigned, refund, and a daily summary at 21:00 Bangkok. The summary is sent lazily on the first request after 21:00, or by the same DO alarm.
- **Delivery.**
  - Alerts go out after the order's transaction succeeds. They are fire-and-forget with a 5 s timeout and never fail or slow an order.
  - Every attempt is logged in `alert_log` (shown as "ประวัติการส่ง", last 50 entries; rows older than 30 days are pruned).
  - At most 30 messages per channel per 10 minutes. Events in one call are joined into one message. Events over the limit are counted and mentioned in the next message.
- **Local test hook.** `ASTRA_ALERT_REDIRECT=http://127.0.0.1:<port>` (Node option `alertRedirect`) sends every alert to a loopback mock instead of the provider host. Only `127.0.0.1`/`localhost` URLs are accepted. Never set it in `wrangler.jsonc`.
