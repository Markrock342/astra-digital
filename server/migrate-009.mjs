import { readFileSync } from "node:fs";
import { executeSqliteMigration } from "./sqlite-migrations.mjs";

export const MIGRATION_009_NAME = "009_inventory_cost.sql";

function tableHasColumn(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function loadMigrationSql(sqlSource) {
  if (typeof sqlSource === "string" && sqlSource.trim()) return sqlSource;
  return readFileSync(
    new URL("./migrations/" + MIGRATION_009_NAME, import.meta.url),
    "utf8",
  );
}

/**
 * Add inventory.cost (INTEGER NULL, satang). Idempotent.
 */
export function applyMigration009(db, sqlSource) {
  const marked = db
    .prepare("SELECT name FROM schema_migrations WHERE name=?")
    .get(MIGRATION_009_NAME);

  if (!tableHasColumn(db, "inventory", "cost"))
    db.exec("ALTER TABLE inventory ADD COLUMN cost INTEGER");

  if (!marked) {
    executeSqliteMigration(db, loadMigrationSql(sqlSource));
    db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
      MIGRATION_009_NAME,
    );
  }
  return { skipped: !!marked };
}

/** Ensure cost column exists even if marker raced (idempotent). */
export function ensureInventoryCost(db) {
  if (tableHasColumn(db, "inventory", "cost")) return;
  applyMigration009(db);
}
