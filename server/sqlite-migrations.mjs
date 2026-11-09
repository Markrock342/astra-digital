/** Apply schema SQL inside the caller's transaction, preserving foreign-key integrity. */
export function executeSqliteMigration(db, source) {
  // Legacy migrations toggle foreign_keys, which SQLite ignores within a transaction.
  // Durable Objects run schema upgrades transactionally, so defer checks instead.
  const sql = source.replace(
    /PRAGMA\s+foreign_keys\s*=\s*(?:OFF|ON)\s*;/gi,
    "",
  );
  db.exec("PRAGMA defer_foreign_keys=ON");
  db.exec(sql);
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length)
    throw new Error("Schema migration failed foreign-key integrity check");
  // DROP/recreate of a referenced parent can leave SQLite's deferred counter set,
  // even after every parent key is restored. Reset it ONLY after the full check
  // above proves that no orphan exists. foreign_keys remains enabled throughout.
  db.exec("PRAGMA defer_foreign_keys=OFF");
}
