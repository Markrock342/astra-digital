-- Admin FR Work 3: real-money ledger columns (idempotent rebuild via migrate-006.mjs).
-- DEMO_CREDIT rows are preserved and excluded from finance reports by default.

PRAGMA foreign_keys = OFF;

CREATE TABLE ledger_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  amount INTEGER NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'DEMO_CREDIT' CHECK (
    kind IN (
      'DEMO_CREDIT',
      'PAYMENT_IN',
      'TOPUP',
      'PURCHASE',
      'REFUND',
      'ADJUSTMENT',
      'WITHDRAWAL',
      'FEE'
    )
  ),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  net INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUCCEEDED' CHECK (
    status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED')
  ),
  order_id TEXT,
  payment_id TEXT,
  provider_ref TEXT,
  actor_id TEXT,
  reason TEXT,
  finalized_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ledger_created ON ledger_new (created_at, id);
CREATE INDEX IF NOT EXISTS ledger_kind_status ON ledger_new (kind, status);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger_new (user_id, created_at);

PRAGMA foreign_keys = ON;
