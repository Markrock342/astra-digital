/**
 * Backup: a gzipped JSON copy of every table, with the schema (CREATE statements, indexes,
 * triggers) and the applied migrations. Works on node:sqlite and on the Durable Object
 * SQLite adapter.
 *
 * - Values are copied exactly as stored. Stock credentials, TOTP secrets and alert secrets
 *   stay AES-256-GCM encrypted; the key (derived from INVENTORY_KEY and the Durable Object
 *   id) is never in the file, so a restore needs the same INVENTORY_KEY to read them.
 * - Rows of short-lived tables (sessions, rate limits, pending 2FA challenges) are skipped;
 *   their schema is still included. Restored shops start with everyone signed out.
 * - Consistency: every table without BLOB columns is read in one synchronous pass, so it is
 *   one snapshot (nothing else runs inside a Durable Object while sync code runs). Tables
 *   with BLOB columns (`files`: uploaded images, write-once) are streamed afterwards in
 *   small pages so memory stays flat.
 * - Limits: the snapshot part is capped at 64 MB of JSON text (DO memory is 128 MB).
 *   BLOB tables have no cap (streamed 16 rows at a time, each image is at most 2 MB).
 */
import { bangkokDay, bangkokHour } from "./alerts.mjs";

export const BACKUP_FORMAT = "astra-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_TRANSIENT_TABLES = ["sessions", "rate_limits", "login_challenges"];
export const BACKUP_SNAPSHOT_LIMIT = 64 * 1024 * 1024;
export const BACKUP_KEEP_DAYS = 14;
export const BACKUP_HOUR_BANGKOK = 4;
export const BACKUP_PREFIX = "backups/";
const R2_PART_BYTES = 8 * 1024 * 1024;
const CHUNK_TARGET = 256 * 1024;
const BLOB_PAGE = 16;

export class BackupTooLargeError extends Error {}

const quote = (name) => '"' + String(name).replace(/"/g, '""') + '"';
function toBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}
const encodeValue = (v) =>
  v instanceof Uint8Array || v instanceof ArrayBuffer
    ? { $b64: toBase64(v) }
    : typeof v === "bigint"
      ? Number.isSafeInteger(Number(v))
        ? Number(v)
        : { $int: v.toString() }
      : v;
export const decodeValue = (v) =>
  v && typeof v === "object"
    ? "$b64" in v
      ? new Uint8Array(Buffer.from(v.$b64, "base64"))
      : "$int" in v
        ? BigInt(v.$int)
        : v
    : v;

/** Readable tables (DO-internal `_cf_*` and SQLite-internal tables are skipped). */
function listTables(db) {
  return db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    )
    .all();
}
function tableColumns(db, name) {
  return db.prepare(`PRAGMA table_info(${quote(name)})`).all();
}

/**
 * Gzip stream of the backup JSON. The snapshot part is read before this returns.
 * `meta` is copied into the header (shop mode, storage kind…).
 */
export function createBackupStream(db, meta = {}, { createdAt = new Date().toISOString() } = {}) {
  const tables = listTables(db);
  const schemaObjects = db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('index','trigger','view') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND tbl_name NOT LIKE '_cf_%' ORDER BY type,name",
    )
    .all();
  let migrations = [];
  try {
    migrations = db.prepare("SELECT name,applied_at FROM schema_migrations ORDER BY name").all();
  } catch {
    // very old database without the table
  }
  const parts = [];
  let size = 0;
  const push = (text) => {
    parts.push(text);
    size += text.length;
    if (size > BACKUP_SNAPSHOT_LIMIT) throw new BackupTooLargeError("backup snapshot over limit");
  };
  const header = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    schema: {
      latestMigration: migrations.at(-1)?.name ?? null,
      migrations,
    },
    encryption:
      "Secrets stay encrypted as stored (AES-256-GCM, key = HMAC-SHA256(INVENTORY_KEY, Durable Object id)). The key is not in this file.",
    skippedRows: BACKUP_TRANSIENT_TABLES,
    ...meta,
  };
  push(JSON.stringify(header).slice(0, -1) + ',"tables":[');
  const streamed = [];
  let first = true;
  const tableOpen = (t, columns) =>
    (first ? "" : ",") +
    JSON.stringify({ name: t.name, sql: t.sql, columns: columns.map((c) => c.name) }).slice(0, -1) +
    ',"rows":[';
  for (const t of tables) {
    const columns = tableColumns(db, t.name);
    if (columns.some((c) => /BLOB/i.test(c.type ?? ""))) {
      streamed.push({ table: t, columns });
      continue;
    }
    push(tableOpen(t, columns));
    first = false;
    if (!BACKUP_TRANSIENT_TABLES.includes(t.name)) {
      const rows = db.prepare(`SELECT * FROM ${quote(t.name)}`).all();
      let batch = [];
      let batchSize = 0;
      for (let i = 0; i < rows.length; i++) {
        const text = JSON.stringify(columns.map((c) => encodeValue(rows[i][c.name])));
        batch.push(text);
        batchSize += text.length;
        if (batchSize > CHUNK_TARGET) {
          push((i + 1 - batch.length ? "," : "") + batch.join(","));
          batch = [];
          batchSize = 0;
        }
      }
      if (batch.length) push((rows.length - batch.length ? "," : "") + batch.join(","));
    }
    push("]}");
  }
  const footer =
    '],"schemaObjects":' +
    JSON.stringify(schemaObjects.map((o) => ({ type: o.type, name: o.name, table: o.tbl_name, sql: o.sql }))) +
    "}";

  const encoder = new TextEncoder();
  let partIndex = 0;
  let blobIndex = 0;
  let blobOpen = false;
  let blobRows = 0;
  let lastRowid = null;
  let done = false;
  const source = new ReadableStream({
    pull(controller) {
      if (done) return;
      if (partIndex < parts.length) {
        let text = "";
        while (partIndex < parts.length && text.length < CHUNK_TARGET) {
          text += parts[partIndex];
          parts[partIndex++] = null; // free as we go
        }
        controller.enqueue(encoder.encode(text));
        return;
      }
      while (blobIndex < streamed.length) {
        const { table, columns } = streamed[blobIndex];
        let text = "";
        if (!blobOpen) {
          text += tableOpen(table, columns);
          first = false;
          blobOpen = true;
          blobRows = 0;
          lastRowid = null;
        }
        const page = BACKUP_TRANSIENT_TABLES.includes(table.name)
          ? []
          : db
              .prepare(
                `SELECT rowid AS "__backup_rowid", * FROM ${quote(table.name)} WHERE ? IS NULL OR rowid>? ORDER BY rowid LIMIT ${BLOB_PAGE}`,
              )
              .all(lastRowid, lastRowid);
        if (page.length) {
          for (const row of page) {
            text += (blobRows++ ? "," : "") + JSON.stringify(columns.map((c) => encodeValue(row[c.name])));
            lastRowid = row.__backup_rowid;
          }
          controller.enqueue(encoder.encode(text));
          return;
        }
        text += "]}";
        blobOpen = false;
        blobIndex += 1;
        controller.enqueue(encoder.encode(text));
        return;
      }
      controller.enqueue(encoder.encode(footer));
      done = true;
      controller.close();
    },
  });
  return source.pipeThrough(new CompressionStream("gzip"));
}

/**
 * Restore a parsed backup into an empty SQLite database (node:sqlite DatabaseSync or the DO
 * adapter). Tables first, then rows, then indexes/views/triggers (so append-only triggers do
 * not fire during the copy). Returns the row count per table.
 */
export function restoreBackup(db, backup, { transaction } = {}) {
  if (!backup || backup.format !== BACKUP_FORMAT) throw new Error("ไม่ใช่ไฟล์สำรองของร้าน (format ไม่ตรง)");
  if (backup.version > BACKUP_VERSION)
    throw new Error("ไฟล์สำรองเวอร์ชัน " + backup.version + " ใหม่กว่าสคริปต์นี้ (" + BACKUP_VERSION + ")");
  const existing = new Set(listTables(db).map((t) => t.name));
  const clash = backup.tables.map((t) => t.name).filter((n) => existing.has(n));
  if (clash.length) throw new Error("ฐานข้อมูลปลายทางต้องว่าง (มีตารางอยู่แล้ว: " + clash.slice(0, 5).join(", ") + ")");
  const counts = {};
  const work = () => {
    // Durable Objects keep foreign keys on; deferring checks them once, at commit.
    db.exec("PRAGMA defer_foreign_keys=ON");
    for (const t of backup.tables) db.exec(t.sql);
    for (const t of backup.tables) {
      counts[t.name] = t.rows.length;
      if (!t.rows.length) continue;
      const insert = db.prepare(
        `INSERT INTO ${quote(t.name)}(${t.columns.map(quote).join(",")}) VALUES(${t.columns.map(() => "?").join(",")})`,
      );
      for (const row of t.rows) insert.run(...row.map(decodeValue));
    }
    for (const type of ["index", "view", "trigger"])
      for (const o of backup.schemaObjects ?? []) if (o.type === type) db.exec(o.sql);
  };
  if (transaction) transaction(work);
  else {
    // Local restore: copy rows as they are (older rows may point at deleted demo users).
    const fk = db.prepare("PRAGMA foreign_keys").get()?.foreign_keys;
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      work();
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      if (fk) db.exec("PRAGMA foreign_keys=ON");
    }
  }
  return counts;
}

function concatBytes(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
export const backupFileName = (ms) => "asiaextra-backup-" + stamp(ms) + "Z.json.gz";

/**
 * Upload one backup to R2 (multipart for anything over 8 MB, so memory stays small) and
 * delete backups older than `keepDays`.
 */
export async function backupToR2({ db, bucket, meta, now = Date.now(), keepDays = BACKUP_KEEP_DAYS }) {
  const key = BACKUP_PREFIX + backupFileName(now);
  const reader = createBackupStream(db, meta, { createdAt: new Date(now).toISOString() }).getReader();
  const httpMetadata = { contentType: "application/gzip" };
  let buffered = [];
  let bufferedBytes = 0;
  let total = 0;
  let upload = null;
  const uploaded = [];
  const takePart = (size) => {
    const all = concatBytes(buffered, bufferedBytes);
    const part = all.slice(0, size);
    const rest = all.slice(size);
    buffered = rest.byteLength ? [rest] : [];
    bufferedBytes = rest.byteLength;
    return part;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered.push(value);
      bufferedBytes += value.byteLength;
      total += value.byteLength;
      // R2 multipart: every part except the last has the same size (≥ 5 MiB).
      while (bufferedBytes >= R2_PART_BYTES) {
        upload ??= await bucket.createMultipartUpload(key, { httpMetadata });
        uploaded.push(await upload.uploadPart(uploaded.length + 1, takePart(R2_PART_BYTES)));
      }
    }
    if (!upload) await bucket.put(key, concatBytes(buffered, bufferedBytes), { httpMetadata });
    else {
      if (bufferedBytes) uploaded.push(await upload.uploadPart(uploaded.length + 1, takePart(bufferedBytes)));
      await upload.complete(uploaded);
    }
  } catch (error) {
    if (upload) await upload.abort().catch(() => {});
    throw error;
  }
  const cutoff = now - keepDays * 86400000;
  const old = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor });
    for (const o of page.objects) if (new Date(o.uploaded).getTime() < cutoff && o.key !== key) old.push(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < old.length; i += 1000) await bucket.delete(old.slice(i, i + 1000));
  return { key, bytes: total, deleted: old.length };
}

/** Service methods: status, manual export (password again + audit), scheduled R2 backup. */
export function createBackupApis({ db, one, run, requireAdmin, reauthAdmin, fail, clock, backups, state, meta }) {
  const lastBackup = () => {
    try {
      return JSON.parse(state.get("backup:last") ?? "null");
    } catch {
      return null;
    }
  };
  function backupStatus(user) {
    requireAdmin(user);
    return {
      r2: !!backups,
      last: lastBackup(),
      retentionDays: BACKUP_KEEP_DAYS,
      hourBangkok: BACKUP_HOUR_BANGKOK,
      snapshotLimitMB: BACKUP_SNAPSHOT_LIMIT / 1024 / 1024,
    };
  }
  function exportBackup(user, input = {}) {
    reauthAdmin(user, input);
    const now = clock();
    let stream;
    try {
      stream = createBackupStream(db, meta(), { createdAt: new Date(now).toISOString() });
    } catch (error) {
      if (error instanceof BackupTooLargeError)
        fail(507, "ข้อมูลใหญ่เกิน 64 MB ส่งออกครั้งเดียวไม่ได้ ใช้การสำรองอัตโนมัติไป R2 แทน");
      throw error;
    }
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      "BACKUP_EXPORT",
      user.id,
      JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION }),
    );
    return { stream, filename: backupFileName(now) };
  }
  const backupDue = (now) => {
    if (!backups || bangkokHour(now) < BACKUP_HOUR_BANGKOK) return false;
    const last = lastBackup();
    return !(last?.ok && last.day === bangkokDay(now));
  };
  async function runBackup(now = clock()) {
    if (!backups) return null;
    let record;
    try {
      const result = await backupToR2({ db, bucket: backups, meta: meta(), now });
      record = { ok: true, at: new Date(now).toISOString(), day: bangkokDay(now), ...result };
    } catch (error) {
      record = { ok: false, at: new Date(now).toISOString(), day: bangkokDay(now), error: String(error?.message ?? error).slice(0, 200) };
      console.error("R2 backup failed:", record.error);
    }
    state.set("backup:last", JSON.stringify(record));
    return record;
  }
  /** Admin button "สำรองไป R2 ตอนนี้": checks the bucket right after Mark binds it. */
  async function runBackupNow(user, input = {}) {
    reauthAdmin(user, input);
    if (!backups) fail(409, "ยังไม่ได้ตั้งค่าที่เก็บสำรอง (R2)");
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      "BACKUP_R2_RUN",
      user.id,
      null,
    );
    const record = await runBackup(clock());
    return { ...backupStatus(user), result: record };
  }
  return { backupStatus, exportBackup, runBackup, runBackupNow, backupDue, hasBackups: !!backups };
}
