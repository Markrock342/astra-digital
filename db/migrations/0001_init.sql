-- ASTRA D1 target schema (NOTT Sprint 1) — from docs/architecture/erd-target.md
-- Money: integer satang. No plaintext digital keys in this file.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  username TEXT,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER', 'ADMIN')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (email)
);

CREATE UNIQUE INDEX users_username ON users (username) WHERE username IS NOT NULL;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  art TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  hidden_seed INTEGER NOT NULL DEFAULT 0 CHECK (hidden_seed IN (0, 1)),
  preorder INTEGER NOT NULL DEFAULT 0 CHECK (preorder IN (0, 1))
);

CREATE INDEX products_listing ON products (active, hidden_seed);

CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id),
  label TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0)
);

CREATE INDEX variants_product ON variants (product_id);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  variant_id TEXT NOT NULL REFERENCES variants (id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  total INTEGER NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (
    status IN (
      'PENDING_PAYMENT',
      'DELIVERED',
      'FAILED',
      'CANCELLED',
      'OUT_OF_STOCK'
    )
  ),
  request_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, request_key)
);

CREATE INDEX orders_owner ON orders (user_id, created_at);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  variant_id TEXT NOT NULL REFERENCES variants (id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  total INTEGER NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (
    status IN ('PENDING_PAYMENT', 'PREORDER', 'FAILED', 'CANCELLED')
  ),
  request_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, request_key)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders (id),
  reservation_id TEXT REFERENCES reservations (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'THB',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  provider TEXT NOT NULL DEFAULT 'sandbox',
  provider_ref TEXT,
  idempotency_key TEXT NOT NULL,
  confirmation_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TEXT,
  UNIQUE (idempotency_key),
  CHECK (
    (order_id IS NOT NULL AND reservation_id IS NULL)
    OR (order_id IS NULL AND reservation_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX payments_provider_ref ON payments (provider, provider_ref)
WHERE
  provider_ref IS NOT NULL;

CREATE TABLE inventory_units (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES variants (id),
  fingerprint TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX inventory_units_variant ON inventory_units (variant_id);

CREATE TABLE allocations (
  id TEXT PRIMARY KEY,
  inventory_unit_id TEXT NOT NULL UNIQUE REFERENCES inventory_units (id),
  order_id TEXT NOT NULL REFERENCES orders (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  allocated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX allocations_order ON allocations (order_id);

CREATE TABLE ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  amount INTEGER NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX audit_created ON audit (created_at);

CREATE TABLE runtime_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads (id),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('USER', 'STAFF', 'SYSTEM')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX chat_messages_thread ON chat_messages (thread_id, created_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX notifications_user ON notifications (user_id, created_at);
