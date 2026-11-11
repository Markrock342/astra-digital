-- MIG-005: dual credential inventory + reservation DELIVERED + ranking indexes.
-- Inventory row crypto backfill (secret → login_id_enc/password_enc) runs in
-- server/migrate-005.mjs — this file only rebuilds table shapes and indexes.
-- Applied via executeSqliteMigration (FK deferral). Do not edit 004.

PRAGMA foreign_keys = OFF;

-- 1) Rebuild reservations: add DELIVERED + delivered_at / delivered_by
CREATE TABLE reservations_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  variant_id TEXT NOT NULL REFERENCES variants (id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  total INTEGER NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (
    status IN (
      'PENDING_PAYMENT',
      'PREORDER',
      'DELIVERED',
      'FAILED',
      'CANCELLED'
    )
  ),
  request_key TEXT NOT NULL,
  payment_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  queue_number INTEGER,
  delivered_at TEXT,
  delivered_by TEXT REFERENCES users (id),
  UNIQUE (user_id, request_key)
);

INSERT INTO reservations_new (
  id,
  user_id,
  variant_id,
  quantity,
  total,
  status,
  request_key,
  payment_hash,
  created_at,
  queue_number,
  delivered_at,
  delivered_by
)
SELECT
  id,
  user_id,
  variant_id,
  quantity,
  total,
  status,
  request_key,
  payment_hash,
  created_at,
  queue_number,
  NULL,
  NULL
FROM reservations;

DROP TABLE reservations;
ALTER TABLE reservations_new RENAME TO reservations;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_queue_number ON reservations (queue_number)
WHERE
  queue_number IS NOT NULL;

-- 2) Stage inventory_new (data filled by migrate-005.mjs, then swap)
CREATE TABLE inventory_new (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES variants (id),
  fingerprint TEXT NOT NULL UNIQUE,
  login_id_enc TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  legacy_single_secret INTEGER NOT NULL DEFAULT 0 CHECK (legacy_single_secret IN (0, 1)),
  order_id TEXT REFERENCES orders (id),
  reservation_id TEXT REFERENCES reservations (id),
  sold_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (
      order_id IS NOT NULL
      AND reservation_id IS NULL
    )
    OR (
      order_id IS NULL
      AND reservation_id IS NOT NULL
    )
    OR (
      order_id IS NULL
      AND reservation_id IS NULL
    )
  )
);

-- 3) Ranking / period indexes
CREATE INDEX IF NOT EXISTS orders_status_created ON orders (status, created_at);

CREATE INDEX IF NOT EXISTS reservations_status_created ON reservations (status, created_at);

PRAGMA foreign_keys = ON;
