/** Idempotent schema helpers for Admin FR Work 1 (no numbered migration — 006 reserved for ledger). */

export function ensureChatThreadReads(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_thread_reads (
    user_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, thread_id)
  )`);
}
