import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createCommerceCore } from "./domain.mjs";
export { ApiError } from "./domain.mjs";
export function createCommerce(options = {}) {
  const path = options.path ?? ":memory:";
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
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
        db.exec(
          readFileSync(
            new URL("./migrations/" + file, import.meta.url),
            "utf8",
          ),
        );
        db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(file);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  }
  return createCommerceCore({ ...options, db });
}
export function openLocalCommerce({ seed = true } = {}) {
  const root = resolve(new URL("../.data", import.meta.url).pathname);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const keyPath = root + "/inventory.key";
  if (!existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
  return createCommerce({
    path: root + "/commerce.sqlite",
    key: readFileSync(keyPath),
    adminPassword: process.env.ASTRA_ADMIN_PASSWORD,
    seed,
  });
}
