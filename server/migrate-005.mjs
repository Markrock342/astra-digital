import { readFileSync } from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { executeSqliteMigration } from "./sqlite-migrations.mjs";

export const MIGRATION_005_NAME = "005_credential_preorder_indexes.sql";

/** Canonical Track A migration filenames (must match server/migrations + worker list). */
export const TRACK_A_MIGRATION_FILES = [
  "001_initial.sql",
  "002_reviews.sql",
  "003_reference_layout.sql",
  "004_commerce_ops.sql",
  MIGRATION_005_NAME,
];

/** Widen inventory_available so freeness checks can use reservation_id (idempotent). */
export function ensureInventoryAvailableIndex(db) {
  db.exec("DROP INDEX IF EXISTS inventory_available");
  db.exec(
    "CREATE INDEX IF NOT EXISTS inventory_available ON inventory(variant_id, order_id, reservation_id)",
  );
}

export function credentialFingerprint(serverKey, loginId, password) {
  const canonical = JSON.stringify({
    v: 1,
    login: loginId,
    password,
  });
  return createHmac("sha256", serverKey).update(canonical, "utf8").digest("hex");
}

function encryptWithKey(key, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return [
    iv.toString("hex"),
    cipher.update(value, "utf8", "hex") + cipher.final("hex"),
    cipher.getAuthTag().toString("hex"),
  ].join(":");
}

function decryptWithKey(key, value) {
  const [iv, data, tag] = value.split(":");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return decipher.update(data, "hex", "utf8") + decipher.final("utf8");
}

function loadMigrationSql(sqlSource) {
  if (typeof sqlSource === "string" && sqlSource.trim()) return sqlSource;
  return readFileSync(
    new URL("./migrations/" + MIGRATION_005_NAME, import.meta.url),
    "utf8",
  );
}

function tableHasColumn(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => row.name === column);
}

/**
 * Apply MIG-005 once: rebuild reservations + inventory (dual credential), indexes.
 * Legacy rows: login_id = decrypted secret, password = "", legacy_single_secret = 1.
 * Pass `sqlSource` in Workers (bundled import); Node may omit and read from disk.
 */
export function applyMigration005(db, key, sqlSource) {
  if (!key || !(key instanceof Uint8Array || Buffer.isBuffer(key)))
    throw new Error("MIG-005 requires inventory key");
  const keyBuf = Buffer.from(key);
  if (
    db.prepare("SELECT name FROM schema_migrations WHERE name=?").get(MIGRATION_005_NAME)
  )
    return { skipped: true, legacyRows: 0 };

  if (!tableHasColumn(db, "inventory", "secret")) {
    // Already on dual-credential shape without marker — just mark.
    if (tableHasColumn(db, "inventory", "login_id_enc")) {
      db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
        MIGRATION_005_NAME,
      );
      return { skipped: true, legacyRows: 0 };
    }
    throw new Error("MIG-005 expected inventory.secret or login_id_enc");
  }

  const legacyRows = db
    .prepare("SELECT COUNT(*) AS n FROM inventory")
    .get().n;

  executeSqliteMigration(db, loadMigrationSql(sqlSource));

  const oldRows = db
    .prepare(
      "SELECT id,variant_id,secret,order_id,sold_at FROM inventory",
    )
    .all();

  const insert = db.prepare(
    `INSERT INTO inventory_new(
      id, variant_id, fingerprint, login_id_enc, password_enc,
      legacy_single_secret, order_id, reservation_id, sold_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`,
  );

  for (const row of oldRows) {
    const loginId = decryptWithKey(keyBuf, row.secret);
    const password = "";
    const fingerprint = credentialFingerprint(keyBuf, loginId, password);
    insert.run(
      row.id,
      row.variant_id,
      fingerprint,
      encryptWithKey(keyBuf, loginId),
      encryptWithKey(keyBuf, password),
      1,
      row.order_id ?? null,
      null,
      row.sold_at ?? null,
    );
  }

  db.exec("DROP TABLE inventory");
  db.exec("ALTER TABLE inventory_new RENAME TO inventory");
  ensureInventoryAvailableIndex(db);

  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length)
    throw new Error("MIG-005 failed foreign-key integrity check");

  db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
    MIGRATION_005_NAME,
  );
  return { skipped: false, legacyRows };
}
