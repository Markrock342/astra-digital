import { readFileSync } from "node:fs";
import { executeSqliteMigration } from "./sqlite-migrations.mjs";

export const MIGRATION_011_NAME = "011_perf_indexes.sql";

function loadMigrationSql(sqlSource) {
  if (typeof sqlSource === "string" && sqlSource.trim()) return sqlSource;
  return readFileSync(
    new URL("./migrations/" + MIGRATION_011_NAME, import.meta.url),
    "utf8",
  );
}

/** Indexes that keep admin order/customer/payment lists under p95 target at ~10k rows. */
export const PERF_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS payments_order ON payments (order_id)",
  "CREATE INDEX IF NOT EXISTS payments_reservation ON payments (reservation_id)",
  "CREATE INDEX IF NOT EXISTS payments_user_status ON payments (user_id, status)",
  "CREATE INDEX IF NOT EXISTS payments_status_finalized ON payments (status, finalized_at, created_at)",
  "CREATE INDEX IF NOT EXISTS orders_created_id ON orders (created_at, id)",
  "CREATE INDEX IF NOT EXISTS reservations_user_created ON reservations (user_id, created_at)",
  "CREATE INDEX IF NOT EXISTS inventory_order ON inventory (order_id)",
  "CREATE INDEX IF NOT EXISTS inventory_reservation ON inventory (reservation_id)",
  "CREATE INDEX IF NOT EXISTS ledger_payment ON ledger (payment_id)",
];

export function applyPerfIndexes(db) {
  for (const sql of PERF_INDEX_SQL) db.exec(sql);
}

/**
 * Apply performance indexes. Idempotent.
 */
export function applyMigration011(db, sqlSource) {
  const marked = db
    .prepare("SELECT name FROM schema_migrations WHERE name=?")
    .get(MIGRATION_011_NAME);

  applyPerfIndexes(db);

  if (!marked) {
    executeSqliteMigration(db, loadMigrationSql(sqlSource));
    db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
      MIGRATION_011_NAME,
    );
  }
  return { skipped: !!marked };
}
