import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations",
);

/** Open a SQLite DB using the D1 target migrations (local stand-in for D1). */
export function openD1Schema(options = {}) {
  const path = options.path ?? ":memory:";
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (
      !db.prepare("SELECT name FROM schema_migrations WHERE name=?").get(file)
    ) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(readFileSync(join(migrationsDir, file), "utf8"));
        db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(file);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  }
  return db;
}
