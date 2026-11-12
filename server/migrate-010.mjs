import { readFileSync } from "node:fs";
import { executeSqliteMigration } from "./sqlite-migrations.mjs";

export const MIGRATION_010_NAME = "010_inventory_expires.sql";

function tableHasColumn(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function loadMigrationSql(sqlSource) {
  if (typeof sqlSource === "string" && sqlSource.trim()) return sqlSource;
  return readFileSync(
    new URL("./migrations/" + MIGRATION_010_NAME, import.meta.url),
    "utf8",
  );
}

/**
 * Add inventory.expires_at + index (variant_id, expires_at). Idempotent.
 */
export function applyMigration010(db, sqlSource) {
  const marked = db
    .prepare("SELECT name FROM schema_migrations WHERE name=?")
    .get(MIGRATION_010_NAME);

  if (!tableHasColumn(db, "inventory", "expires_at"))
    db.exec("ALTER TABLE inventory ADD COLUMN expires_at TEXT");

  db.exec(
    "CREATE INDEX IF NOT EXISTS inventory_variant_expires ON inventory (variant_id, expires_at)",
  );

  if (!marked) {
    executeSqliteMigration(db, loadMigrationSql(sqlSource));
    db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
      MIGRATION_010_NAME,
    );
  }
  return { skipped: !!marked };
}

export function ensureInventoryExpires(db) {
  if (tableHasColumn(db, "inventory", "expires_at")) {
    db.exec(
      "CREATE INDEX IF NOT EXISTS inventory_variant_expires ON inventory (variant_id, expires_at)",
    );
    return;
  }
  applyMigration010(db);
}
