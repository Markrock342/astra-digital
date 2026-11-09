-- Align D1 track with Node 004 ops: STAFF, payment_channel, queue_number, DEMO_CREDIT ledger.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER', 'ADMIN', 'STAFF')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (id, email, username, name, password_hash, role, created_at)
SELECT
  id,
  email,
  username,
  name,
  password_hash,
  role,
  created_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX users_username ON users (username) WHERE username IS NOT NULL;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS payment_channel (
  id TEXT PRIMARY KEY CHECK (id = 'primary'),
  provider TEXT NOT NULL DEFAULT 'unset' CHECK (
    provider IN ('unset', 'sandbox', 'slipok', 'gateway')
  ),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  note TEXT NOT NULL DEFAULT 'ช่องทางเดียว — ห้ามเปิด SlipOK/Gateway จนกว่าลูกค้าเลือก'
);

INSERT OR IGNORE INTO payment_channel (id, provider, active)
VALUES (
  'primary',
  'unset',
  0
);

ALTER TABLE reservations
ADD COLUMN queue_number INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_queue_number ON reservations (queue_number)
WHERE
  queue_number IS NOT NULL;

ALTER TABLE ledger
ADD COLUMN kind TEXT NOT NULL DEFAULT 'DEMO_CREDIT';
