// Data retention purge (server/retention.mjs): old read notifications, unused chat
// uploads, expired password resets / sessions — unread notifications stay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { RETENTION_BATCH } from "../server/retention.mjs";

const ADMIN_PASSWORD = "retention-admin-" + randomBytes(6).toString("hex");

function fixture(t) {
  let now = Date.UTC(2026, 10, 13, 12, 0, 0);
  const deleted = [];
  const s = createCommerce({
    adminPassword: ADMIN_PASSWORD,
    clock: () => now,
    fileStore: {
      async put() {},
      async get() {
        return null;
      },
      async delete(key) {
        deleted.push(key);
      },
    },
  });
  t.after(() => s.db.close());
  return {
    s,
    deleted,
    advance: (ms) => {
      now += ms;
    },
    now: () => now,
  };
}

const count = (s, sql, ...params) => s.db.prepare(sql).get(...params).n;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

test("purges old read notifications only; unread and recent stay", (t) => {
  const { s, advance, now } = fixture(t);
  const userId = s.db.prepare("SELECT id FROM users WHERE role='ADMIN' LIMIT 1").get().id;
  const oldRead = randomUUID();
  const oldUnread = randomUUID();
  const newRead = randomUUID();
  const oldAt = sqlTime(now() - 100 * 86400000);
  const newAt = sqlTime(now() - 10 * 86400000);
  s.db
    .prepare(
      "INSERT INTO notifications(id,user_id,kind,title,body,read_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(oldRead, userId, "test", "old read", "x", oldAt, oldAt);
  s.db
    .prepare(
      "INSERT INTO notifications(id,user_id,kind,title,body,read_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(oldUnread, userId, "test", "old unread", "x", null, oldAt);
  s.db
    .prepare(
      "INSERT INTO notifications(id,user_id,kind,title,body,read_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(newRead, userId, "test", "new read", "x", newAt, newAt);

  const result = s.retentionPurge({ now: now() });
  assert.equal(result.notifications, 1);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM notifications WHERE id=?", oldRead), 0);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM notifications WHERE id=?", oldUnread), 1);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM notifications WHERE id=?", newRead), 1);
  advance(1000);
});

test("purges unused chat uploads older than 24h and deletes files best-effort", (t) => {
  const { s, deleted, now } = fixture(t);
  const userId = s.db.prepare("SELECT id FROM users WHERE role='ADMIN' LIMIT 1").get().id;
  const oldKey = "chatimg-" + randomUUID().replace(/-/g, "").slice(0, 24);
  const usedKey = "chatimg-" + randomUUID().replace(/-/g, "").slice(0, 24);
  const freshKey = "chatimg-" + randomUUID().replace(/-/g, "").slice(0, 24);
  const oldAt = sqlTime(now() - 48 * 3600000);
  const freshAt = sqlTime(now() - 1 * 3600000);
  s.db.prepare("INSERT INTO chat_uploads(key,user_id,used,created_at) VALUES(?,?,0,?)").run(oldKey, userId, oldAt);
  s.db.prepare("INSERT INTO chat_uploads(key,user_id,used,created_at) VALUES(?,?,1,?)").run(usedKey, userId, oldAt);
  s.db.prepare("INSERT INTO chat_uploads(key,user_id,used,created_at) VALUES(?,?,0,?)").run(freshKey, userId, freshAt);

  const result = s.retentionPurge({ now: now() });
  assert.equal(result.chatUploads, 1);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM chat_uploads WHERE key=?", oldKey), 0);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM chat_uploads WHERE key=?", usedKey), 1);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM chat_uploads WHERE key=?", freshKey), 1);
  assert.ok(deleted.includes(oldKey));
});

test("purges expired password_resets and sessions; batch capped", (t) => {
  const { s, now } = fixture(t);
  const userId = s.db.prepare("SELECT id FROM users WHERE role='ADMIN' LIMIT 1").get().id;
  const expired = now() - 3600000;
  const future = now() + 3600000;
  for (let i = 0; i < 3; i += 1) {
    s.db
      .prepare(
        "INSERT INTO password_resets(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
      )
      .run("hash-old-" + i, userId, expired, expired);
  }
  s.db
    .prepare(
      "INSERT INTO password_resets(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    )
    .run("hash-live", userId, future, now());
  s.db
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_seen) VALUES(?,?,?,?,?)",
    )
    .run("sess-old", userId, expired, sqlTime(expired), sqlTime(expired));
  s.db
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_seen) VALUES(?,?,?,?,?)",
    )
    .run("sess-live", userId, future, sqlTime(now()), sqlTime(now()));

  const result = s.retentionPurge({ now: now(), limit: RETENTION_BATCH });
  assert.equal(result.passwordResets, 3);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM password_resets WHERE token_hash='hash-live'"), 1);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM password_resets WHERE token_hash LIKE 'hash-old-%'"), 0);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM sessions WHERE token_hash='sess-old'"), 0);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM sessions WHERE token_hash='sess-live'"), 1);
});

test("alertsTick runs retention behind the same lazy gate", (t) => {
  const { s, now, advance } = fixture(t);
  const userId = s.db.prepare("SELECT id FROM users WHERE role='ADMIN' LIMIT 1").get().id;
  const id = randomUUID();
  const oldAt = sqlTime(now() - 100 * 86400000);
  s.db
    .prepare(
      "INSERT INTO notifications(id,user_id,kind,title,body,read_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(id, userId, "test", "tick", "x", oldAt, oldAt);
  s.alertsTick(now());
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM notifications WHERE id=?", id), 0);
  // Gate: immediate second tick should not error.
  advance(1000);
  s.alertsTick(now());
});
