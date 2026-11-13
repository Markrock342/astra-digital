/**
 * Lazy data retention: prune old read notifications, unused chat uploads, expired
 * password resets and sessions. Called from alertsTick / scheduled jobs — no new cron.
 * Batch size caps work per request (default 500 rows per table).
 */
export const RETENTION_BATCH = 500;
export const NOTIFICATION_KEEP_DAYS = 90;
export const CHAT_UPLOAD_UNUSED_HOURS = 24;
const FLAG = "retention-purge";
const EVERY_MS = 60000;

const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

export function createRetention({ one, all, run, clock, fileStore }) {
  function maybePurge(now = clock(), { force = false, limit = RETENTION_BATCH } = {}) {
    if (!force) {
      const prev = one("SELECT value FROM runtime_flags WHERE key=?", FLAG)?.value;
      if (prev && now - Number(prev) < EVERY_MS) return null;
    }
    run(
      "INSERT INTO runtime_flags(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      FLAG,
      String(now),
    );
    return purgeOnce({ now, limit });
  }

  function purgeOnce({ now = clock(), limit = RETENTION_BATCH } = {}) {
    const batch = Math.min(Math.max(1, Number(limit) || RETENTION_BATCH), RETENTION_BATCH);
    const notifCutoff = sqlTime(now - NOTIFICATION_KEEP_DAYS * 86400000);
    const uploadCutoff = sqlTime(now - CHAT_UPLOAD_UNUSED_HOURS * 3600000);
    // sessions.expires_at and password_resets.expires_at are epoch milliseconds (numbers).
    const sessionCutoff = now;
    const resetCutoff = now;

    const notificationIds = all(
      `SELECT id FROM notifications
       WHERE read_at IS NOT NULL AND created_at < ?
       ORDER BY created_at ASC LIMIT ?`,
      notifCutoff,
      batch,
    ).map((r) => r.id);
    if (notificationIds.length)
      run(
        `DELETE FROM notifications WHERE id IN (${notificationIds.map(() => "?").join(",")})`,
        ...notificationIds,
      );

    const uploads = all(
      `SELECT key FROM chat_uploads WHERE used=0 AND created_at < ? ORDER BY created_at ASC LIMIT ?`,
      uploadCutoff,
      batch,
    );
    for (const row of uploads) {
      run("DELETE FROM chat_uploads WHERE key=?", row.key);
      if (fileStore?.delete) Promise.resolve(fileStore.delete(row.key)).catch(() => {});
    }

    const resetHashes = all(
      `SELECT token_hash FROM password_resets WHERE expires_at < ? ORDER BY expires_at ASC LIMIT ?`,
      resetCutoff,
      batch,
    ).map((r) => r.token_hash);
    if (resetHashes.length)
      run(
        `DELETE FROM password_resets WHERE token_hash IN (${resetHashes.map(() => "?").join(",")})`,
        ...resetHashes,
      );

    const sessionIds = all(
      `SELECT rowid AS id FROM sessions WHERE expires_at < ? ORDER BY expires_at ASC LIMIT ?`,
      sessionCutoff,
      batch,
    ).map((r) => r.id);
    if (sessionIds.length)
      run(
        `DELETE FROM sessions WHERE rowid IN (${sessionIds.map(() => "?").join(",")})`,
        ...sessionIds,
      );

    return {
      notifications: notificationIds.length,
      chatUploads: uploads.length,
      passwordResets: resetHashes.length,
      sessions: sessionIds.length,
    };
  }

  return { maybePurge, purgeOnce };
}
