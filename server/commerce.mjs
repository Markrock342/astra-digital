import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createCommerceCore } from "./domain.mjs";
import { executeSqliteMigration } from "./sqlite-migrations.mjs";
import {
  applyMigration005,
  ensureInventoryAvailableIndex,
  MIGRATION_005_NAME,
} from "./migrate-005.mjs";
import { applyMigration006, MIGRATION_006_NAME } from "./migrate-006.mjs";
import { ensureLiveVersions } from "./live.mjs";
import { applyMigration007, MIGRATION_007_NAME } from "./migrate-007.mjs";
import { ensureChatThreadReads, ensureCustomerAdmin } from "./ensure-admin-fr.mjs";
export { ApiError } from "./domain.mjs";

export function createCommerce(options = {}) {
  const path = options.path ?? ":memory:";
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const key = options.key ?? randomBytes(32);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  for (const file of readdirSync(new URL("./migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (
      !db.prepare("SELECT name FROM schema_migrations WHERE name=?").get(file)
    ) {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (file === MIGRATION_005_NAME) {
          applyMigration005(db, key);
        } else if (file === MIGRATION_006_NAME) {
          applyMigration006(db);
        } else if (file === MIGRATION_007_NAME) {
          applyMigration007(db);
        } else {
          const sql = readFileSync(
            new URL("./migrations/" + file, import.meta.url),
            "utf8",
          );
          executeSqliteMigration(db, sql);
          db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(file);
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  }
  ensureInventoryAvailableIndex(db);
  ensureChatThreadReads(db);
  ensureCustomerAdmin(db);
  ensureLiveVersions(db);
  return createCommerceCore({ ...options, db, key });
}
export function openLocalCommerce({
  seed = true,
  allowSandbox = true,
  allowDemoAdmin = false,
} = {}) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../.data");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const keyPath = join(root, "inventory.key");
  if (!existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
  return createCommerce({
    path: join(root, "commerce.sqlite"),
    key: readFileSync(keyPath),
    adminPassword: process.env.ASTRA_ADMIN_PASSWORD,
    seed,
    allowSandbox,
    allowDemoAdmin,
  });
}
