/** Idempotent schema helpers for Admin FR Work 1 (no numbered migration — 006 reserved for ledger). */

export function ensureChatThreadReads(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_thread_reads (
    user_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, thread_id)
  )`);
}

/**
 * FR-C4/C5 customer admin columns and audit detail (idempotent ALTERs, no numbered
 * migration — 006 is reserved for the ledger).
 */
export function ensureCustomerAdmin(db) {
  const has = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  const add = (table, column, ddl) => {
    if (!has(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  add("users", "status", "TEXT NOT NULL DEFAULT 'ACTIVE'");
  add("users", "status_reason", "TEXT");
  add("users", "status_changed_at", "TEXT");
  add("users", "status_changed_by", "TEXT");
  add("users", "first_name", "TEXT");
  add("users", "last_name", "TEXT");
  add("users", "phone", "TEXT");
  add("users", "note", "TEXT");
  add("audit", "detail", "TEXT");
  add("chat_threads", "assigned_to", "TEXT");
  add("orders", "admin_note", "TEXT");
  add("reservations", "admin_note", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit(entity_id)");
}

/**
 * S9: money and audit rows are append-only at the database level. Idempotent
 * (CREATE TRIGGER IF NOT EXISTS). The one-time demo cleanup that runs when test mode
 * is switched off drops these triggers and recreates them inside its own transaction.
 */
const APPEND_ONLY_TABLES = ["ledger", "audit"];
export function ensureAppendOnlyMoney(db) {
  for (const table of APPEND_ONLY_TABLES) {
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS ${table}_append_only_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} rows are append-only'); END`,
    );
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS ${table}_append_only_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} rows are append-only'); END`,
    );
  }
}
export function dropAppendOnlyMoney(db) {
  for (const table of APPEND_ONLY_TABLES) {
    db.exec(`DROP TRIGGER IF EXISTS ${table}_append_only_update`);
    db.exec(`DROP TRIGGER IF EXISTS ${table}_append_only_delete`);
  }
}
