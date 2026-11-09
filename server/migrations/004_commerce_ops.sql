-- W1 NOTT: payments channel stub, STAFF role, preorder queue, chat, in-app notifications.
-- Prices remain integer satang. Inventory allocation rules unchanged (fingerprint unique / order_id).
-- Ledger is DEMO_CREDIT only — not real shop money.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER', 'ADMIN', 'STAFF')),
  username TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (id, email, name, password_hash, role, username, created_at)
SELECT
  id,
  email,
  name,
  password_hash,
  role,
  username,
  created_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX users_username ON users (username) WHERE username IS NOT NULL;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders (id),
  reservation_id TEXT REFERENCES reservations (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'THB',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  provider TEXT NOT NULL DEFAULT 'unset',
  provider_ref TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  confirmation_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TEXT,
  CHECK (
    (
      order_id IS NOT NULL
      AND reservation_id IS NULL
    )
    OR (
      order_id IS NULL
      AND reservation_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref ON payments (provider, provider_ref)
WHERE
  provider_ref IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('USER', 'STAFF', 'SYSTEM', 'ADMIN')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS chat_messages_thread ON chat_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at);
