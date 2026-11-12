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
  // Only accounts made by the demo buttons are wiped at launch (never chosen by email pattern).
  add("users", "is_demo", "INTEGER NOT NULL DEFAULT 0");
  add("audit", "detail", "TEXT");
  add("chat_threads", "assigned_to", "TEXT");
  add("orders", "admin_note", "TEXT");
  add("reservations", "admin_note", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit(entity_id)");
}

/**
 * Products + stock round (idempotent, no numbered migration):
 * - variants.warranty_days: 0–365, 0 = no warranty.
 * - orders/reservations.warranty_days: snapshot taken when the order is placed;
 *   warranty_until is fixed at delivery, so later variant edits never change sold orders.
 * - inventory.login_key: keyed hash of the normalised loginId (or code text) so an
 *   import can spot an account that is already in stock without decrypting everything.
 *   Not unique: older rows may legitimately share a loginId with a different password.
 */
export function ensureProductsStock(db) {
  const has = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  const add = (table, column, ddl) => {
    if (!has(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  add("variants", "warranty_days", "INTEGER NOT NULL DEFAULT 0");
  add("orders", "warranty_days", "INTEGER");
  add("orders", "warranty_until", "TEXT");
  add("reservations", "warranty_days", "INTEGER");
  add("reservations", "warranty_until", "TEXT");
  add("inventory", "login_key", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS inventory_login_key ON inventory(login_key)");
}
