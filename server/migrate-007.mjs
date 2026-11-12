import { readFileSync } from "node:fs";
import { executeSqliteMigration } from "./sqlite-migrations.mjs";

export const MIGRATION_007_NAME = "007_variant_stock.sql";

function tableHasColumn(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function loadMigrationSql(sqlSource) {
  if (typeof sqlSource === "string" && sqlSource.trim()) return sqlSource;
  return readFileSync(
    new URL("./migrations/" + MIGRATION_007_NAME, import.meta.url),
    "utf8",
  );
}

/**
 * Add variant active/sort_order and inventory defective columns.
 * Idempotent: safe to call when columns or schema_migrations marker already exist.
 */
export function applyMigration007(db, sqlSource) {
  const marked = db
    .prepare("SELECT name FROM schema_migrations WHERE name=?")
    .get(MIGRATION_007_NAME);

  if (!tableHasColumn(db, "variants", "active"))
    db.exec(
      "ALTER TABLE variants ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
    );
  if (!tableHasColumn(db, "variants", "sort_order"))
    db.exec(
      "ALTER TABLE variants ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    );

  if (!tableHasColumn(db, "inventory", "defective"))
    db.exec(
      "ALTER TABLE inventory ADD COLUMN defective INTEGER NOT NULL DEFAULT 0",
    );
  if (!tableHasColumn(db, "inventory", "defective_at"))
    db.exec("ALTER TABLE inventory ADD COLUMN defective_at TEXT");
  if (!tableHasColumn(db, "inventory", "defective_by"))
    db.exec("ALTER TABLE inventory ADD COLUMN defective_by TEXT");
  if (!tableHasColumn(db, "inventory", "defective_reason"))
    db.exec("ALTER TABLE inventory ADD COLUMN defective_reason TEXT");

  db.exec(
    "CREATE INDEX IF NOT EXISTS variants_product_sort ON variants (product_id, sort_order, id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS inventory_variant_defective ON inventory (variant_id, defective, order_id, reservation_id)",
  );

  if (!marked) {
    executeSqliteMigration(db, loadMigrationSql(sqlSource));
    db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
      MIGRATION_007_NAME,
    );
  }
  return { skipped: !!marked };
}

/** Ensure Work 4 columns exist even if marker raced (idempotent). */
export function ensureVariantStockColumns(db) {
  if (
    tableHasColumn(db, "variants", "active") &&
    tableHasColumn(db, "variants", "sort_order") &&
    tableHasColumn(db, "inventory", "defective")
  )
    return;
  applyMigration007(db);
}
