#!/usr/bin/env node
/**
 * Restore an ASIA EXTRA backup (.json.gz from admin › ตั้งค่า › สำรองข้อมูล, or from the
 * BACKUPS R2 bucket) into a new local SQLite file for inspection or recovery.
 *
 *   node scripts/restore-backup.mjs <backup.json.gz> <out.sqlite> [--force]
 *
 * - The output file must not exist (use --force to replace it).
 * - Secrets stay encrypted exactly as in the shop. To read stock credentials with the app,
 *   open the file with the same key the shop used (see docs/operations/backup.md).
 * - Reads the whole file into memory: fine up to a few hundred MB of JSON.
 */
import { readFileSync, existsSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { restoreBackup } from "../server/backup.mjs";

export function restoreBackupFile(input, output, { force = false } = {}) {
  if (existsSync(output)) {
    if (!force) throw new Error(output + " already exists (add --force to replace it)");
    for (const suffix of ["", "-wal", "-shm"]) rmSync(output + suffix, { force: true });
  }
  const raw = readFileSync(input);
  const text = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString("utf8");
  const backup = JSON.parse(text);
  const db = new DatabaseSync(output);
  try {
    // Rows go in table by table, so foreign keys are checked by the shop, not here.
    db.exec("PRAGMA foreign_keys=OFF");
    const counts = restoreBackup(db, backup);
    const problems = db.prepare("PRAGMA integrity_check").all();
    return {
      createdAt: backup.createdAt,
      version: backup.version,
      latestMigration: backup.schema?.latestMigration ?? null,
      counts,
      integrity: problems.map((r) => Object.values(r)[0]).join(", "),
    };
  } finally {
    db.close();
  }
}

const isMain = process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const [input, output] = args.filter((a) => a !== "--force");
  if (!input || !output) {
    console.error("Usage: node scripts/restore-backup.mjs <backup.json.gz> <out.sqlite> [--force]");
    process.exit(2);
  }
  try {
    const result = restoreBackupFile(input, output, { force });
    const rows = Object.values(result.counts).reduce((a, b) => a + b, 0);
    console.log("Backup created:   " + result.createdAt);
    console.log("Format version:   " + result.version);
    console.log("Latest migration: " + result.latestMigration);
    console.log("Tables restored:  " + Object.keys(result.counts).length + " (" + rows + " rows)");
    for (const [name, n] of Object.entries(result.counts)) console.log("  " + name.padEnd(28) + n);
    console.log("Integrity check:  " + result.integrity);
    console.log("Wrote " + output);
  } catch (error) {
    console.error("Restore failed: " + error.message);
    process.exit(1);
  }
}
