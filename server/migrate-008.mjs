import { readFileSync } from "node:fs";
import { executeSqliteMigration } from "./sqlite-migrations.mjs";
import { ensureFilesTable } from "./file-store.mjs";

export const MIGRATION_008_NAME = "008_uploads.sql";

function tableHasColumn(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function loadMigrationSql(sqlSource) {
  if (typeof sqlSource === "string" && sqlSource.trim()) return sqlSource;
  return readFileSync(
    new URL("./migrations/" + MIGRATION_008_NAME, import.meta.url),
    "utf8",
  );
}

/**
 * Product images + files BLOB store + users.avatar_key (API avatar in UP-2).
 * Idempotent.
 */
export function applyMigration008(db, sqlSource) {
  const marked = db
    .prepare("SELECT name FROM schema_migrations WHERE name=?")
    .get(MIGRATION_008_NAME);

  db.exec(`CREATE TABLE IF NOT EXISTS product_images (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    file_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS product_images_product_sort ON product_images (product_id, sort_order, id)",
  );
  ensureFilesTable(db);
  if (!tableHasColumn(db, "users", "avatar_key"))
    db.exec("ALTER TABLE users ADD COLUMN avatar_key TEXT");

  if (!marked) {
    executeSqliteMigration(db, loadMigrationSql(sqlSource));
    db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
      MIGRATION_008_NAME,
    );
  }
  return { skipped: !!marked };
}

export function ensureUploadsSchema(db) {
  applyMigration008(db);
}
