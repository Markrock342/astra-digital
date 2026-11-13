/** Idempotent schema helpers for Admin FR Work 1 (no numbered migration — 006 reserved for ledger). */
import { ACCOUNT_SHOP_CATEGORIES, DEFAULT_CATEGORIES } from "./catalog.mjs";
import { DEFAULT_CANNED_REPLIES } from "./canned-replies.mjs";

/**
 * Product categories (idempotent, no numbered migration). products.category holds the id.
 * - First run on an existing shop: the five built-in categories (same ids, so every product
 *   stays valid). First run on a fresh shop (no products yet): those five plus the
 *   account-shop defaults ai / productivity / vpn. INSERT OR IGNORE, so nothing is
 *   overwritten, and a category the admin deleted later is never brought back.
 * - Every run: a product whose category has no row (data written outside the app) gets a
 *   plain row named after its id, so saveProduct / the storefront never meet an unknown id.
 */
export function ensureCategories(db) {
  const existed = !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'")
    .get();
  db.exec(`CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name_th TEXT NOT NULL,
    name_en TEXT,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)");
  if (!existed) {
    const fresh = !db.prepare("SELECT id FROM products LIMIT 1").get();
    const seed = fresh ? [...DEFAULT_CATEGORIES, ...ACCOUNT_SHOP_CATEGORIES] : DEFAULT_CATEGORIES;
    const insert = db.prepare(
      "INSERT OR IGNORE INTO categories(id,name_th,name_en,icon,sort_order,hidden) VALUES(?,?,?,?,?,0)",
    );
    seed.forEach((c, i) => insert.run(c.id, c.name, c.name_en ?? null, c.icon ?? null, (i + 1) * 10));
  }
  const orphans = db
    .prepare(
      "SELECT DISTINCT category AS id FROM products WHERE category IS NOT NULL AND category NOT IN (SELECT id FROM categories)",
    )
    .all();
  if (orphans.length) {
    let next = db.prepare("SELECT COALESCE(MAX(sort_order),0) AS n FROM categories").get().n;
    const insert = db.prepare(
      "INSERT OR IGNORE INTO categories(id,name_th,sort_order,hidden) VALUES(?,?,?,0)",
    );
    for (const { id } of orphans) insert.run(id, String(id).slice(0, 40) || "หมวดหมู่", (next += 10));
  }
}

export { ensurePrivacyRequests } from "./privacy.mjs";
export { ensureManualOrders } from "./manual-orders.mjs";
// Compare-at / sale / purchase limit / customer tags + tag prices (server/pricing.mjs).
export { ensurePricing } from "./pricing.mjs";
// การเงิน › ปิดยอดรายวัน / กระทบยอด / ถอนเงิน (append-only tables, server/finance-close.mjs).
export { ensureFinanceBooks } from "./finance-close.mjs";
// Preorder modes: product settings table + reservation stage / deposit columns (preorder.mjs).
export { ensurePreorderModes } from "./preorder.mjs";

export function ensureChatThreadReads(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_thread_reads (
    user_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, thread_id)
  )`);
}

/** Shared team pins on a chat thread. Idempotent; safe to call on every boot. */
export function ensureChatPins(db) {
  const names = new Set(db.prepare("PRAGMA table_info(chat_threads)").all().map((c) => c.name));
  if (!names.has("pinned_at")) db.exec("ALTER TABLE chat_threads ADD COLUMN pinned_at TEXT");
  if (!names.has("pinned_by")) db.exec("ALTER TABLE chat_threads ADD COLUMN pinned_by TEXT");
}

/**
 * ข้อความสำเร็จรูปในแชท (canned-replies.mjs). Idempotent; the formal Thai defaults are
 * seeded only when the table is first created, so a default the admin deleted stays gone.
 */
export function ensureCannedReplies(db) {
  const existed = !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='canned_replies'")
    .get();
  db.exec(`CREATE TABLE IF NOT EXISTS canned_replies (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  if (existed) return;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO canned_replies(id,title,body,sort_order) VALUES(?,?,?,?)",
  );
  DEFAULT_CANNED_REPLIES.forEach((r, i) =>
    insert.run("default-" + (i + 1), r.title, r.body, (i + 1) * 10),
  );
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

/**
 * Coupons / discount codes (idempotent, no numbered migration).
 * - coupons: one row per code. `code` is stored upper-case and unique (NOCASE).
 *   type PERCENT (value 1–90, optional max_discount cap in satang) or FIXED (value
 *   in satang). starts_at / ends_at are UTC "YYYY-MM-DD HH:MM:SS" (the admin enters
 *   Bangkok time). usage_limit / per_user_limit NULL = unlimited.
 * - coupon_products: the chosen products when scope = 'PRODUCTS'.
 * - coupon_redemptions: one row per order or preorder that used a code. A row whose
 *   released_at is set no longer counts towards the limits (order cancelled, failed,
 *   out of stock or expired before payment). No foreign keys, so the one-time demo
 *   cleanup can delete orders without touching this table first.
 * - orders / reservations get `discount` (satang, 0 = none) and `coupon_code`.
 *   `total` stays the amount the customer pays (after the discount).
 */
export function ensureCoupons(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    type TEXT NOT NULL CHECK (type IN ('PERCENT','FIXED')),
    value INTEGER NOT NULL CHECK (value > 0),
    max_discount INTEGER CHECK (max_discount IS NULL OR max_discount > 0),
    min_total INTEGER NOT NULL DEFAULT 0 CHECK (min_total >= 0),
    starts_at TEXT,
    ends_at TEXT,
    usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
    per_user_limit INTEGER CHECK (per_user_limit IS NULL OR per_user_limit > 0),
    scope TEXT NOT NULL DEFAULT 'ALL' CHECK (scope IN ('ALL','PRODUCTS')),
    first_order_only INTEGER NOT NULL DEFAULT 0 CHECK (first_order_only IN (0,1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS coupon_products (
    coupon_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    PRIMARY KEY (coupon_id, product_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id TEXT PRIMARY KEY,
    coupon_id TEXT NOT NULL,
    code TEXT NOT NULL,
    user_id TEXT NOT NULL,
    order_id TEXT,
    reservation_id TEXT,
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TEXT,
    released_reason TEXT,
    CHECK ((order_id IS NULL) <> (reservation_id IS NULL))
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id, user_id)",
  );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_redemptions_order ON coupon_redemptions(order_id) WHERE order_id IS NOT NULL",
  );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_redemptions_reservation ON coupon_redemptions(reservation_id) WHERE reservation_id IS NOT NULL",
  );
  const has = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  for (const table of ["orders", "reservations"]) {
    if (!has(table, "discount"))
      db.exec(`ALTER TABLE ${table} ADD COLUMN discount INTEGER NOT NULL DEFAULT 0`);
    if (!has(table, "coupon_code")) db.exec(`ALTER TABLE ${table} ADD COLUMN coupon_code TEXT`);
  }
}

/**
 * Email + self-service password reset (idempotent, no numbered migration).
 * - email_log: one row per outgoing email. The recipient is stored masked only. `ref` is
 *   a unique dedupe key (e.g. "order-confirmed:<id>") so a repeated request never mails twice.
 * - password_resets: single-use tokens; only the keyed hash is stored; 30-minute expiry.
 */
export function ensureEmailAndReset(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS email_log (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    kind TEXT NOT NULL,
    recipient TEXT NOT NULL,
    ref TEXT UNIQUE,
    ok INTEGER,
    provider TEXT,
    provider_id TEXT,
    error TEXT,
    finished_at TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at)");
  db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id)");
}

/**
 * Announcements to customers (broadcast.mjs). One row per send; the notifications themselves
 * live in `notifications` (kind 'broadcast'). created_ms drives the 5-per-24h limit.
 */
export function ensureBroadcasts(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS broadcasts (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_ms INTEGER NOT NULL,
    sender_id TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    link TEXT,
    audience TEXT NOT NULL,
    audience_label TEXT NOT NULL,
    recipients INTEGER NOT NULL DEFAULT 0,
    email_requested INTEGER NOT NULL DEFAULT 0,
    emails_queued INTEGER NOT NULL DEFAULT 0
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_ms)");
}

/**
 * Back-in-stock notices ("แจ้งเตือนเมื่อสินค้าเข้า", server/stock-watch.mjs). Idempotent.
 * - stock_watch: one row per customer and option while they wait. One-shot: notified_at is
 *   set when the option comes back, and subscribing again starts a fresh row (new place in
 *   the line). No foreign keys, so the one-time demo cleanup can delete freely; lookups
 *   join variants/products, so a row for a deleted option is simply never shown.
 */
export function ensureStockWatch(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS stock_watch (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notified_at TEXT,
    UNIQUE (user_id, variant_id)
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_stock_watch_waiting ON stock_watch(variant_id, notified_at, created_at)",
  );
}

/**
 * Review replies + moderation (server/review-moderation.mjs). Idempotent ALTERs.
 * - One public shop reply per review (reply_text, editable; reply_at = first reply,
 *   reply_updated_at = last edit, reply_by = who wrote the current text).
 * - Hidden reviews keep their row: hidden_at / hidden_by / hidden_reason (SPAM, ABUSE,
 *   OFF_TOPIC, OTHER) / hidden_note. Public lists and rating averages skip hidden_at IS NOT NULL.
 */
export function ensureReviewModeration(db) {
  const has = (column) =>
    db.prepare("PRAGMA table_info(reviews)").all().some((c) => c.name === column);
  for (const column of [
    "reply_text",
    "reply_by",
    "reply_at",
    "reply_updated_at",
    "hidden_at",
    "hidden_by",
    "hidden_reason",
    "hidden_note",
  ])
    if (!has(column)) db.exec(`ALTER TABLE reviews ADD COLUMN ${column} TEXT`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at)");
}

/**
 * Promo banners on the storefront home (server/banners.mjs). Idempotent, no numbered migration.
 * - image_key / mobile_image_key: file-store keys (public /api/files/<key>); a row without
 *   image_key is a draft and never shown. starts_at / ends_at: UTC "YYYY-MM-DD HH:MM:SS"
 *   (the admin enters Bangkok time); NULL = no limit. At most MAX_BANNERS rows (app rule).
 */
export function ensureBanners(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS banners (
    id TEXT PRIMARY KEY,
    image_key TEXT,
    mobile_image_key TEXT,
    alt TEXT NOT NULL,
    link TEXT,
    starts_at TEXT,
    ends_at TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_banners_order ON banners(sort_order)");
}

/**
 * Fraud signals (server/fraud.mjs). Idempotent; nothing here blocks an order by itself.
 * - fraud_events: cheap counters the rules read (payment_failed / issue_report per account,
 *   signup per masked IP prefix — the same /24 or /48 that sessions keep, never a full IP).
 *   Rows older than 31 days are pruned.
 * - fraud_signals: one "สัญญาณผิดปกติ" per rule + subject (account or IP prefix) per window;
 *   repeats inside the window only bump hits / last_at_ms. Admin marks it REVIEWED + note.
 * - fraud_blocks: temporary block of one email or a whole email domain from registering and
 *   logging in. Expires by itself (expires_ms); lifting early keeps the row (lifted_at).
 */
export function ensureFraudSignals(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS fraud_events (
    kind TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT,
    at_ms INTEGER NOT NULL
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_fraud_events_subject ON fraud_events(kind, subject, at_ms)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_fraud_events_at ON fraud_events(at_ms)");
  db.exec(`CREATE TABLE IF NOT EXISTS fraud_signals (
    id TEXT PRIMARY KEY,
    rule TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT,
    ip_masked TEXT,
    value INTEGER NOT NULL DEFAULT 0,
    threshold INTEGER NOT NULL DEFAULT 0,
    window_hours INTEGER NOT NULL DEFAULT 1,
    detail TEXT,
    hits INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'OPEN',
    at_ms INTEGER NOT NULL,
    last_at_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_note TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_fraud_signals_dedupe ON fraud_signals(rule, subject, at_ms)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_fraud_signals_status ON fraud_signals(status, at_ms)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_fraud_signals_user ON fraud_signals(user_id)");
  db.exec(`CREATE TABLE IF NOT EXISTS fraud_blocks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    reason TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    at_ms INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL,
    lifted_at TEXT,
    lifted_by TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_fraud_blocks_value ON fraud_blocks(value, expires_ms)");
}

/**
 * Admin-edited email templates (server/email-templates.mjs). One row per edited template;
 * no row = the built-in default ("reset to default" deletes the row).
 */
export function ensureEmailTemplates(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS email_templates (
    key TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    heading TEXT NOT NULL,
    body TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT
  )`);
}

/**
 * Receipts in the shop's own name + full tax invoices (ใบกำกับภาษีเต็มรูป, server/tax-invoices.mjs).
 * Idempotent, no numbered migration. Settings live in runtime_flags 'receipt-settings'.
 * - tax_invoice_requests: one row per order (PK order_id) with the buyer details the customer
 *   (or the admin) entered and the workflow state. SAVED = buyer details for a ใบเสร็จรับเงิน
 *   only (shop not VAT-registered); PENDING → ISSUED | REJECTED; VOIDED once the issued
 *   invoice was cancelled (a new request / issue is then allowed). Mutable on purpose.
 * - tax_invoices: the issued documents, a full snapshot (seller, buyer, items, VAT split) so a
 *   later settings change never alters an issued invoice. Number = prefix + Bangkok year +
 *   running number per (scope, year); UNIQUE, allocated inside the issuing transaction and
 *   never reused (rows are never deleted). Test-mode invoices carry scope 'sandbox' and a TEST-
 *   prefix, so the live sequence starts clean at launch.
 * - tax_invoice_voids: cancellation of an issued invoice (one per invoice, with a reason).
 * Both document tables are append-only (triggers): an issued invoice is a legal record and is
 * never updated or deleted, also not by the PDPA account deletion (Revenue Code record keeping).
 */
export const TAX_INVOICE_APPEND_ONLY_TABLES = ["tax_invoices", "tax_invoice_voids"];
/** Trigger names the admin health page expects (admin-health.mjs). */
export const TAX_INVOICE_APPEND_ONLY_TRIGGERS = TAX_INVOICE_APPEND_ONLY_TABLES.flatMap((t) => [
  t + "_append_only_update",
  t + "_append_only_delete",
]);
export function ensureTaxInvoices(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS tax_invoice_requests (
    order_id TEXT PRIMARY KEY,
    preorder INTEGER NOT NULL DEFAULT 0 CHECK (preorder IN (0,1)),
    user_id TEXT NOT NULL,
    buyer_type TEXT CHECK (buyer_type IS NULL OR buyer_type IN ('PERSON','COMPANY')),
    buyer_name TEXT,
    buyer_tax_id TEXT,
    buyer_branch TEXT,
    buyer_address TEXT,
    status TEXT NOT NULL CHECK (status IN ('SAVED','PENDING','ISSUED','REJECTED','VOIDED')),
    reason TEXT,
    invoice_id TEXT,
    requested_at TEXT,
    updated_at TEXT NOT NULL,
    updated_by TEXT,
    resolved_at TEXT,
    resolved_by TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_tax_invoice_requests_status ON tax_invoice_requests(status, requested_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tax_invoice_requests_user ON tax_invoice_requests(user_id)");
  db.exec(`CREATE TABLE IF NOT EXISTS tax_invoices (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL CHECK (scope IN ('sandbox','live')),
    year INTEGER NOT NULL,
    seq INTEGER NOT NULL CHECK (seq > 0),
    order_id TEXT NOT NULL,
    preorder INTEGER NOT NULL DEFAULT 0,
    user_id TEXT NOT NULL,
    seller TEXT NOT NULL,
    buyer_type TEXT NOT NULL CHECK (buyer_type IN ('PERSON','COMPANY')),
    buyer_name TEXT NOT NULL,
    buyer_tax_id TEXT NOT NULL,
    buyer_branch TEXT,
    buyer_address TEXT NOT NULL,
    items TEXT NOT NULL,
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL CHECK (total >= 0),
    vat_rate INTEGER NOT NULL,
    vat INTEGER NOT NULL CHECK (vat >= 0),
    net INTEGER NOT NULL CHECK (net >= 0),
    paid_at TEXT,
    issued_at TEXT NOT NULL,
    issued_by TEXT,
    UNIQUE (scope, year, seq),
    CHECK (net + vat = total)
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_tax_invoices_order ON tax_invoices(order_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tax_invoices_issued ON tax_invoices(scope, issued_at)");
  db.exec(`CREATE TABLE IF NOT EXISTS tax_invoice_voids (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    voided_by TEXT,
    created_at TEXT NOT NULL
  )`);
  for (const table of TAX_INVOICE_APPEND_ONLY_TABLES) {
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS ${table}_append_only_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} rows are append-only'); END`,
    );
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS ${table}_append_only_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} rows are append-only'); END`,
    );
  }
}
