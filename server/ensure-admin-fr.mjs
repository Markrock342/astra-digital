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

/**
 * Order history (B2 + appended notes). Idempotent, no numbered migration.
 * - order_replacements: one row per replaced account. The old unit also stays
 *   linked to the order (marked defective), so the history is never lost.
 * - order_notes: append-only internal notes. The old single admin_note value is
 *   copied in once as a legacy note with a fixed id, so re-runs change nothing.
 * Run after ensureCustomerAdmin (needs admin_note and audit.detail).
 */
export function ensureOrderHistory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS order_replacements (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    old_inventory_id TEXT NOT NULL,
    new_inventory_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_order_replacements_order ON order_replacements(order_id, created_at)",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS order_notes (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    author_id TEXT,
    body TEXT NOT NULL,
    legacy INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_notes_order ON order_notes(order_id, created_at)");
  for (const table of ["orders", "reservations"])
    db.exec(`INSERT OR IGNORE INTO order_notes(id, order_id, author_id, body, legacy, created_at)
      SELECT 'legacy-' || o.id, o.id,
        (SELECT a.user_id FROM audit a WHERE a.action='ORDER_NOTE' AND a.entity_id=o.id ORDER BY a.id DESC LIMIT 1),
        o.admin_note, 1,
        COALESCE((SELECT MAX(a.created_at) FROM audit a WHERE a.action='ORDER_NOTE' AND a.entity_id=o.id), o.created_at)
      FROM ${table} o
      WHERE o.admin_note IS NOT NULL AND trim(o.admin_note) <> ''`);
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

/**
 * Notification deep links (idempotent, no numbered migration): an optional
 * in-app path the bell opens, e.g. /orders/<id> or /admin/chat?thread=<id>.
 * Older rows keep NULL and fall back to the kind-based target.
 */
export function ensureNotificationLinks(db) {
  const has = db
    .prepare("PRAGMA table_info(notifications)")
    .all()
    .some((c) => c.name === "link");
  if (!has) db.exec("ALTER TABLE notifications ADD COLUMN link TEXT");
}

/**
 * Small UX round B (idempotent, no numbered migration):
 * - orders/reservations.expired_at: set when an unpaid order is cancelled because the
 *   payment window ran out (server/pending-expiry.mjs). NULL for every other cancel.
 * - sessions.device / sessions.ip_masked: a coarse device label ("Chrome · macOS") and the
 *   IP cut to /24 (IPv6 /48), stored when the session is created, for "my devices".
 *   Never the full User-Agent or the full IP.
 * Run after ensureAuthHardening (which adds sessions.created_at / last_seen).
 */
export function ensureSmallUxB(db) {
  const has = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  const add = (table, column, ddl) => {
    if (!has(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  add("orders", "expired_at", "TEXT");
  add("reservations", "expired_at", "TEXT");
  add("sessions", "device", "TEXT");
  add("sessions", "ip_masked", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)");
}

/**
 * Order extras (idempotent, no numbered migration):
 * - products.usage_instructions: plain text shown to the buyer after delivery only.
 * - chat_messages.order_id / report_reason: "แจ้งปัญหาบัญชีนี้" messages linked to an
 *   order (also the per-order daily report limit).
 * - chat_threads.order_id: latest order reported in the thread, for the admin inbox.
 */
export function ensureOrderExtras(db) {
  const has = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  const add = (table, column, ddl) => {
    if (!has(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  add("products", "usage_instructions", "TEXT");
  add("chat_messages", "order_id", "TEXT");
  add("chat_messages", "report_reason", "TEXT");
  add("chat_threads", "order_id", "TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_chat_messages_order ON chat_messages(order_id, created_at)",
  );
}

/**
 * Outside-the-website alerts + backups (idempotent, no numbered migration):
 * - alert_log: one row per outbound attempt (attempt=1) or per event held back by the
 *   rate limit (attempt=0). Rows older than 30 days are pruned when new alerts go out.
 * - alert_state: small key/value store (encrypted alert settings, stock level per variant
 *   for "once per crossing", daily-summary day, last R2 backup result).
 */
export function ensureAlertsBackup(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS alert_log (
    id TEXT PRIMARY KEY,
    at_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    channel TEXT NOT NULL,
    event TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    ok INTEGER NOT NULL DEFAULT 0,
    status INTEGER,
    error TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_alert_log_channel_time ON alert_log(channel, at_ms)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_alert_log_time ON alert_log(at_ms)");
  db.exec(`CREATE TABLE IF NOT EXISTS alert_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
}
