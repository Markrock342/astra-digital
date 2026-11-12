import { readFileSync } from "node:fs";
import { executeSqliteMigration } from "./sqlite-migrations.mjs";

export const MIGRATION_006_NAME = "006_ledger_money.sql";

function tableHasColumn(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function loadMigrationSql(sqlSource) {
  if (typeof sqlSource === "string" && sqlSource.trim()) return sqlSource;
  return readFileSync(
    new URL("./migrations/" + MIGRATION_006_NAME, import.meta.url),
    "utf8",
  );
}

/**
 * Rebuild ledger with money columns. Idempotent: skip if `direction` already exists.
 * Preserves DEMO_CREDIT rows; maps amount sign → direction/net.
 */
export function applyMigration006(db, sqlSource) {
  if (
    db
      .prepare("SELECT name FROM schema_migrations WHERE name=?")
      .get(MIGRATION_006_NAME)
  )
    return { skipped: true };

  if (tableHasColumn(db, "ledger", "direction")) {
    db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
      MIGRATION_006_NAME,
    );
    return { skipped: true };
  }

  const oldRows = db
    .prepare(
      "SELECT id,user_id,amount,reference,label,kind,created_at FROM ledger",
    )
    .all();

  db.exec("DROP TABLE IF EXISTS ledger_new");
  executeSqliteMigration(db, loadMigrationSql(sqlSource));

  const insert = db.prepare(
    `INSERT INTO ledger_new(
      id,user_id,amount,reference,label,kind,direction,fee,net,status,
      order_id,payment_id,provider_ref,actor_id,reason,finalized_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,'SUCCEEDED',NULL,NULL,NULL,NULL,NULL,?,?)`,
  );

  for (const row of oldRows) {
    const amount = row.amount;
    const direction = amount < 0 ? "out" : "in";
    const net = amount;
    insert.run(
      row.id,
      row.user_id,
      amount,
      row.reference,
      row.label,
      row.kind || "DEMO_CREDIT",
      direction,
      0,
      net,
      row.created_at,
      row.created_at,
    );
  }

  db.exec("DROP TABLE ledger");
  db.exec("ALTER TABLE ledger_new RENAME TO ledger");

  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length)
    throw new Error("MIG-006 failed foreign-key integrity check");

  db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
    MIGRATION_006_NAME,
  );
  return { skipped: false, migrated: oldRows.length };
}

/** Ensure money columns exist even if migration marker raced (idempotent). */
export function ensureLedgerMoneyColumns(db) {
  if (tableHasColumn(db, "ledger", "direction")) return;
  applyMigration006(db);
}
