/** File bytes adapter: R2 binding UPLOADS when present, else SQLite `files` BLOB. */

export function ensureFilesTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS files (
    key TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    bytes BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

export function createSqliteFileStore(db) {
  ensureFilesTable(db);
  return {
    kind: "sqlite",
    async put(key, bytes, mime) {
      const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      db.prepare(
        `INSERT INTO files(key,mime,size,bytes) VALUES(?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET mime=excluded.mime, size=excluded.size, bytes=excluded.bytes`,
      ).run(key, mime, buf.byteLength, buf);
    },
    async get(key) {
      const row = db.prepare("SELECT mime, bytes FROM files WHERE key=?").get(key);
      if (!row) return null;
      const bytes =
        row.bytes instanceof Uint8Array
          ? row.bytes
          : new Uint8Array(row.bytes);
      return { mime: row.mime, bytes };
    },
    async delete(key) {
      db.prepare("DELETE FROM files WHERE key=?").run(key);
    },
  };
}

export function createR2FileStore(bucket) {
  return {
    kind: "r2",
    async put(key, bytes, mime) {
      const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      await bucket.put(key, buf, {
        httpMetadata: { contentType: mime },
      });
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      const mime =
        obj.httpMetadata?.contentType || "application/octet-stream";
      return { mime, bytes: new Uint8Array(await obj.arrayBuffer()) };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

/** Prefer R2 when binding exists; otherwise Durable Object / Node SQLite. */
export function createFileStore({ db, uploads }) {
  if (uploads) return createR2FileStore(uploads);
  return createSqliteFileStore(db);
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47];

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const ALLOWED_MIME = new Map([
  ["image/jpeg", "jpeg"],
  ["image/jpg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export function sniffImageMime(bytes) {
  if (!bytes || bytes.byteLength < 12) return null;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === JPEG[0] && b[1] === JPEG[1] && b[2] === JPEG[2]) return "image/jpeg";
  if (b[0] === PNG[0] && b[1] === PNG[1] && b[2] === PNG[2] && b[3] === PNG[3])
    return "image/png";
  // RIFF....WEBP
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "image/webp";
  return null;
}

/** Validate Content-Type header + magic bytes; returns canonical mime or throws via fail(). */
export function assertAllowedImage(contentType, bytes, fail) {
  const header = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_MIME.has(header))
    fail(415, "รองรับเฉพาะไฟล์ JPEG PNG หรือ WebP");
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
  const headerKind = ALLOWED_MIME.get(header);
  const sniffedKind = ALLOWED_MIME.get(sniffed);
  if (headerKind !== sniffedKind) fail(415, "ชนิดไฟล์ไม่ตรงกับเนื้อหา");
  return sniffed;
}
