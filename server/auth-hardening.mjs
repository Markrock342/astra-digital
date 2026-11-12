/**
 * Admin login hardening: per-account lockout, failed-login audit, short staff sessions,
 * password re-confirm for sensitive actions and optional TOTP 2FA (RFC 6238) for
 * ADMIN / STAFF. Works on node:sqlite and on the Durable Object SQLite adapter
 * (only prepare().get/all/run and `run().changes` are used).
 *
 * Owner escape hatch: when ASTRA_ADMIN_PASSWORD changes (its HMAC mark in
 * runtime_flags differs), domain.mjs resets the owner's password AND calls
 * resetSecondFactor() here, so an operator who lost the authenticator can recover
 * by rotating the secret. See docs/architecture/auth-rbac.md.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { withoutClientPrivileges, assertAuthenticated, assertAdmin, assertStaff, isStaff } from "./auth-policy.mjs";

export const CUSTOMER_SESSION_MS = 7 * 86400000;
export const STAFF_SESSION_MS = 12 * 3600000;
export const STAFF_IDLE_MS = 2 * 3600000;
export const LOCK_THRESHOLD = 5;
export const LOCK_WINDOW_MS = 15 * 60000;
export const LOCK_BASE_MS = 15 * 60000;
export const LOCK_MAX_MS = 24 * 3600000;
export const CHALLENGE_MS = 5 * 60000;
export const CHALLENGE_MAX_ATTEMPTS = 5;
const SETUP_MS = 15 * 60000;
const LAST_SEEN_WRITE_MS = 60000;
const RECOVERY_CODES = 8;
const ISSUER = "ASIA EXTRA";

export const LOCKED_MESSAGE =
  "เข้าสู่ระบบไม่สำเร็จหลายครั้ง ระบบพักการเข้าสู่ระบบชั่วคราว กรุณาลองใหม่ภายหลัง";
const BAD_LOGIN = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";

/** Idempotent schema (same pattern as ensure-admin-fr.mjs). */
export function ensureAuthHardening(db) {
  const has = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  const add = (table, column, ddl) => {
    if (!has(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  add("sessions", "created_at", "INTEGER");
  add("sessions", "last_seen", "INTEGER");
  add("audit", "detail", "TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS login_attempts (
    lock_key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    lock_count INTEGER NOT NULL DEFAULT 0
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS user_totp (
    user_id TEXT PRIMARY KEY,
    secret_enc TEXT,
    pending_enc TEXT,
    pending_at INTEGER,
    enabled_at TEXT,
    last_step INTEGER NOT NULL DEFAULT 0
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS totp_recovery_codes (
    user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    used_at TEXT,
    PRIMARY KEY (user_id, code_hash)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS login_challenges (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    lock_key TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  )`);
}

// ---------------------------------------------------------------- RFC 4648 base32 + RFC 6238 TOTP

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(bytes) {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0,
    value = 0;
  const out = [];
  for (const ch of clean) {
    const index = B32.indexOf(ch);
    if (index < 0) throw new Error("invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
/** RFC 4226 HOTP with HMAC-SHA1 and dynamic truncation. */
export function hotp(secret, counter, digits = 6) {
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}
export const totpStep = (ms) => Math.floor(ms / 30000);
export const totpCode = (secret, ms, digits = 6) => hotp(secret, totpStep(ms), digits);
/** Returns the matched time step (±1 window) or null. Steps <= afterStep are replays. */
export function verifyTotp(secret, code, ms, afterStep = -1) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = totpStep(ms);
  let matched = null;
  for (const s of [step - 1, step, step + 1]) {
    if (s <= afterStep) continue;
    const expected = Buffer.from(hotp(secret, s));
    if (timingSafeEqual(expected, Buffer.from(code)) && matched === null) matched = s;
  }
  return matched;
}

// ---------------------------------------------------------------- service

export function createAuthHardening({
  one,
  run,
  tx,
  fail,
  key,
  clock = () => Date.now(),
  encrypt,
  decrypt,
  passwordMatches,
  issueSession,
  ownerEmail = "admin@astra.local",
}) {
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const mac = (value) => createHmac("sha256", key).update(value).digest("hex");
  const requireAdmin = (user) => assertAdmin(user, fail);
  const requireStaff = (user) => assertStaff(user, fail);

  const auditDetail = (userId, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      userId ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );

  /** Masked + keyed hash: enough to correlate attempts, never the raw identifier. */
  function maskIdentifier(identifier) {
    const value = String(identifier).trim().toLowerCase();
    const [local, domain] = value.split("@");
    const head = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
    return {
      id: head + "***" + (domain ? "@" + domain : ""),
      idHash: mac("audit-id:" + value).slice(0, 12),
    };
  }

  // ------------------------------------------------ per-account lockout (SQLite, survives DO restarts)
  // Existing accounts are keyed by user id, so "admin" and "admin@astra.local" share one counter.
  // Unknown identifiers are keyed by the normalized text and lock the same way, so the response
  // never tells whether an account exists.
  const lockKeyFor = (identifier, user) =>
    mac("login-lock:" + (user ? "user:" + user.id : "id:" + String(identifier).trim().toLowerCase()));

  function lockedUntil(lockKey) {
    const row = one("SELECT locked_until FROM login_attempts WHERE lock_key=?", lockKey);
    return row && row.locked_until > clock() ? row.locked_until : 0;
  }
  function recordFailure(lockKey) {
    const t = clock();
    const row = one("SELECT * FROM login_attempts WHERE lock_key=?", lockKey);
    let failures = 1,
      windowStart = t,
      lockCount = row?.lock_count ?? 0,
      until = 0;
    // Backoff memory fades after a quiet day.
    if (row && row.locked_until && t - row.locked_until > LOCK_MAX_MS) lockCount = 0;
    if (row && t - row.window_start <= LOCK_WINDOW_MS) {
      failures = row.failures + 1;
      windowStart = row.window_start;
    }
    if (failures >= LOCK_THRESHOLD) {
      until = t + Math.min(LOCK_MAX_MS, LOCK_BASE_MS * 2 ** lockCount);
      lockCount += 1;
      failures = 0;
      windowStart = t;
    }
    run(
      `INSERT INTO login_attempts(lock_key,failures,window_start,locked_until,lock_count) VALUES(?,?,?,?,?)
       ON CONFLICT(lock_key) DO UPDATE SET failures=excluded.failures, window_start=excluded.window_start,
       locked_until=CASE WHEN excluded.locked_until>0 THEN excluded.locked_until ELSE login_attempts.locked_until END,
       lock_count=excluded.lock_count`,
      lockKey,
      failures,
      windowStart,
      until,
      lockCount,
    );
    return until ? { locked: true, minutes: Math.round((until - t) / 60000) } : { locked: false };
  }
  const clearFailures = (lockKey) => run("DELETE FROM login_attempts WHERE lock_key=?", lockKey);

  /** Audit + count one failure; throws the right error (lock message once the account locks). */
  function failAttempt(lockKey, user, action, detail, status, message) {
    auditDetail(user?.id, action, user?.id, detail);
    const result = recordFailure(lockKey);
    if (result.locked) {
      auditDetail(user?.id, "LOGIN_LOCKED", user?.id, { ...detail, minutes: result.minutes });
      fail(429, LOCKED_MESSAGE);
    }
    fail(status, message);
  }

  // ------------------------------------------------ sessions

  const staffRole = (user) => isStaff(user);
  /** Absolute lifetime in ms for a new session of this user. */
  const sessionLifetime = (user) => (staffRole(user) ? STAFF_SESSION_MS : CUSTOMER_SESSION_MS);

  /** Resolve a session row; ADMIN/STAFF get 12h absolute + 2h idle (sliding last_seen). */
  function sessionUser(tokenHash) {
    const t = clock();
    const row = one(
      `SELECT u.*, s.created_at AS session_created_at, s.last_seen AS session_last_seen
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=? AND s.expires_at>? AND COALESCE(u.status,'ACTIVE')='ACTIVE'`,
      tokenHash,
      t,
    );
    if (!row) return null;
    const { session_created_at: createdAt, session_last_seen: lastSeen, ...user } = row;
    if (!staffRole(user)) return user;
    if (createdAt == null) {
      // Session issued before this change (or a customer promoted mid-session): start the
      // admin clocks now and cap the absolute lifetime.
      run(
        "UPDATE sessions SET created_at=?, last_seen=?, expires_at=MIN(expires_at, ?) WHERE token_hash=?",
        t,
        t,
        t + STAFF_SESSION_MS,
        tokenHash,
      );
      return user;
    }
    if (t - createdAt >= STAFF_SESSION_MS || t - (lastSeen ?? createdAt) >= STAFF_IDLE_MS) {
      run("DELETE FROM sessions WHERE token_hash=?", tokenHash);
      return null;
    }
    if (t - (lastSeen ?? 0) >= LAST_SEEN_WRITE_MS)
      run("UPDATE sessions SET last_seen=? WHERE token_hash=?", t, tokenHash);
    return user;
  }

  // ------------------------------------------------ second factor

  const totpRow = (userId) => one("SELECT * FROM user_totp WHERE user_id=?", userId);
  const totpEnabled = (userId) => !!totpRow(userId)?.secret_enc;
  const recoveryHash = (userId, code) => mac("recovery:" + userId + ":" + code);
  const normalizeRecovery = (code) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
  const recoveryLeft = (userId) =>
    one("SELECT COUNT(*) AS n FROM totp_recovery_codes WHERE user_id=? AND used_at IS NULL", userId).n;

  /** TOTP code (6 digits, replay-protected) or one unused recovery code. */
  function checkSecondFactor(user, rawCode) {
    const row = totpRow(user.id);
    if (!row?.secret_enc) return { ok: false };
    const code = String(rawCode ?? "").replace(/\s/g, "");
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(base32Decode(decrypt(row.secret_enc)), code, clock(), row.last_step ?? -1);
      if (step === null) return { ok: false };
      // Conditional write: two requests racing with the same code cannot both win.
      const claimed = run(
        "UPDATE user_totp SET last_step=? WHERE user_id=? AND last_step<?",
        step,
        user.id,
        step,
      );
      return { ok: claimed.changes === 1 };
    }
    const recovery = normalizeRecovery(code);
    if (recovery.length !== 10) return { ok: false };
    const used = run(
      "UPDATE totp_recovery_codes SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND code_hash=? AND used_at IS NULL",
      user.id,
      recoveryHash(user.id, recovery),
    );
    return used.changes === 1 ? { ok: true, recovery: true } : { ok: false };
  }

  function newRecoveryCodes(userId) {
    run("DELETE FROM totp_recovery_codes WHERE user_id=?", userId);
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    const codes = [];
    while (codes.length < RECOVERY_CODES) {
      const raw = Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
      if (codes.includes(raw)) continue;
      codes.push(raw.slice(0, 5) + "-" + raw.slice(5));
      run(
        "INSERT INTO totp_recovery_codes(user_id,code_hash) VALUES(?,?)",
        userId,
        recoveryHash(userId, raw),
      );
    }
    return codes;
  }

  // ------------------------------------------------ login

  function login(rawInput, ctx = {}) {
    const input = withoutClientPrivileges(rawInput);
    const identifier = input.email ?? input.username;
    if (typeof identifier !== "string" || identifier.trim().length < 3 || identifier.trim().length > 160)
      fail(400, "ชื่อผู้ใช้หรืออีเมลไม่ถูกต้อง");
    if (typeof input.password !== "string" || !input.password.trim() || input.password.trim().length > 128)
      fail(400, "รหัสผ่านไม่ถูกต้อง");
    const email = identifier.trim();
    const password = input.password.trim();
    const user = one("SELECT * FROM users WHERE email=? OR username=?", email, email) ?? null;
    const lockKey = lockKeyFor(email, user);
    const detail = { ...maskIdentifier(email), ip: ctx.ip ?? null };
    if (lockedUntil(lockKey)) {
      auditDetail(user?.id, "LOGIN_FAILED", user?.id, { ...detail, reason: "locked" });
      fail(429, LOCKED_MESSAGE);
    }
    if (
      !passwordMatches(
        password,
        user?.password_hash ?? "00000000000000000000000000000000:" + "00".repeat(64),
      )
    )
      failAttempt(lockKey, user, "LOGIN_FAILED", { ...detail, reason: "password" }, 401, BAD_LOGIN);
    if ((user.status ?? "ACTIVE") !== "ACTIVE") fail(403, "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อร้าน");
    if (totpEnabled(user.id)) {
      // Password is right but the second factor is still owed: no session yet, and the
      // failure counter is kept so code guesses keep counting toward the same lock.
      const token = randomBytes(32).toString("hex");
      const t = clock();
      run("DELETE FROM login_challenges WHERE expires_at<? OR user_id=?", t, user.id);
      run(
        "INSERT INTO login_challenges(token_hash,user_id,lock_key,expires_at) VALUES(?,?,?,?)",
        sha(token),
        user.id,
        lockKey,
        t + CHALLENGE_MS,
      );
      return { needsTotp: true, challenge: token };
    }
    clearFailures(lockKey);
    auditDetail(user.id, "LOGIN", user.id, null);
    return issueSession(user);
  }

  function loginTotp(rawInput, ctx = {}) {
    const input = withoutClientPrivileges(rawInput);
    const challenge = typeof input.challenge === "string" ? input.challenge : "";
    if (!/^[a-f0-9]{64}$/.test(challenge)) fail(400, "ข้อมูลยืนยันตัวตนไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่");
    const code = typeof input.code === "string" ? input.code.trim() : "";
    if (code.length < 6 || code.length > 32) fail(400, "กรุณากรอกรหัส 6 หลักจากแอปยืนยันตัวตน");
    const row = one(
      "SELECT * FROM login_challenges WHERE token_hash=? AND expires_at>?",
      sha(challenge),
      clock(),
    );
    if (!row) fail(401, "หมดเวลายืนยันตัวตน กรุณาเข้าสู่ระบบใหม่");
    const user = one("SELECT * FROM users WHERE id=?", row.user_id);
    const detail = { ip: ctx.ip ?? null };
    if (!user || (user.status ?? "ACTIVE") !== "ACTIVE") {
      run("DELETE FROM login_challenges WHERE token_hash=?", row.token_hash);
      fail(403, "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อร้าน");
    }
    if (lockedUntil(row.lock_key)) {
      run("DELETE FROM login_challenges WHERE token_hash=?", row.token_hash);
      auditDetail(user.id, "LOGIN_TOTP_FAILED", user.id, { ...detail, reason: "locked" });
      fail(429, LOCKED_MESSAGE);
    }
    const result = checkSecondFactor(user, code);
    if (!result.ok) {
      if (row.attempts + 1 >= CHALLENGE_MAX_ATTEMPTS)
        run("DELETE FROM login_challenges WHERE token_hash=?", row.token_hash);
      else run("UPDATE login_challenges SET attempts=attempts+1 WHERE token_hash=?", row.token_hash);
      failAttempt(
        row.lock_key,
        user,
        "LOGIN_TOTP_FAILED",
        { ...detail, reason: "code" },
        401,
        row.attempts + 1 >= CHALLENGE_MAX_ATTEMPTS
          ? "รหัสยืนยันไม่ถูกต้องหลายครั้ง กรุณาเข้าสู่ระบบใหม่"
          : "รหัสยืนยันไม่ถูกต้อง",
      );
    }
    run("DELETE FROM login_challenges WHERE token_hash=?", row.token_hash);
    clearFailures(row.lock_key);
    if (result.recovery)
      auditDetail(user.id, "RECOVERY_CODE_USED", user.id, { ...detail, remaining: recoveryLeft(user.id) });
    auditDetail(user.id, "LOGIN", user.id, { totp: true });
    return issueSession(user);
  }

  // ------------------------------------------------ re-confirm password for sensitive actions

  function confirmPassword(user, currentPassword) {
    assertAuthenticated(user, fail);
    const lockKey = lockKeyFor(null, user);
    if (lockedUntil(lockKey)) fail(429, LOCKED_MESSAGE);
    if (typeof currentPassword !== "string" || !currentPassword.trim())
      fail(403, "กรุณากรอกรหัสผ่านของคุณเพื่อยืนยันการทำรายการนี้");
    if (currentPassword.length > 128 || !passwordMatches(currentPassword.trim(), user.password_hash))
      failAttempt(lockKey, user, "REAUTH_FAILED", { reason: "password" }, 403, "รหัสผ่านไม่ถูกต้อง ระบบยังไม่ได้ทำรายการนี้");
    return true;
  }
  /** ADMIN check first (STAFF/CUSTOMER get the usual 403), then the password. */
  function reauthAdmin(user, input = {}) {
    requireAdmin(user);
    return confirmPassword(user, input?.currentPassword);
  }

  // ------------------------------------------------ 2FA settings (ADMIN / STAFF, own account only)

  function totpStatus(user) {
    requireStaff(user);
    const row = totpRow(user.id);
    return {
      enabled: !!row?.secret_enc,
      enabledAt: row?.enabled_at ?? null,
      recoveryCodesLeft: row?.secret_enc ? recoveryLeft(user.id) : 0,
    };
  }

  function totpSetup(user, input = {}) {
    requireStaff(user);
    if (totpEnabled(user.id)) fail(409, "เปิดยืนยันตัวตน 2 ขั้นอยู่แล้ว ต้องปิดก่อนจึงตั้งค่าใหม่ได้");
    confirmPassword(user, input.currentPassword);
    const secret = base32Encode(randomBytes(20));
    run(
      `INSERT INTO user_totp(user_id,pending_enc,pending_at) VALUES(?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET pending_enc=excluded.pending_enc, pending_at=excluded.pending_at`,
      user.id,
      encrypt(secret),
      clock(),
    );
    const label = encodeURIComponent(ISSUER + ":" + user.email);
    return {
      secret,
      otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`,
    };
  }

  function totpEnable(user, input = {}) {
    requireStaff(user);
    const row = totpRow(user.id);
    if (row?.secret_enc) fail(409, "เปิดยืนยันตัวตน 2 ขั้นอยู่แล้ว");
    if (!row?.pending_enc || clock() - (row.pending_at ?? 0) > SETUP_MS)
      fail(400, "หมดเวลาตั้งค่า กรุณากดเริ่มตั้งค่าใหม่");
    const code = typeof input.code === "string" ? input.code.replace(/\s/g, "") : "";
    const step = verifyTotp(base32Decode(decrypt(row.pending_enc)), code, clock());
    if (step === null) fail(400, "รหัสยืนยันไม่ถูกต้อง ตรวจเวลาในโทรศัพท์แล้วลองใหม่");
    return tx(() => {
      run(
        "UPDATE user_totp SET secret_enc=pending_enc, pending_enc=NULL, pending_at=NULL, enabled_at=CURRENT_TIMESTAMP, last_step=? WHERE user_id=?",
        step,
        user.id,
      );
      const recoveryCodes = newRecoveryCodes(user.id);
      auditDetail(user.id, "TOTP_ENABLE", user.id, null);
      return { enabled: true, recoveryCodes };
    });
  }

  function totpDisable(user, input = {}) {
    requireStaff(user);
    if (!totpEnabled(user.id)) fail(409, "ยังไม่ได้เปิดยืนยันตัวตน 2 ขั้น");
    confirmPassword(user, input.currentPassword);
    const code = typeof input.code === "string" ? input.code.trim() : "";
    const result = checkSecondFactor(user, code);
    if (!result.ok)
      failAttempt(
        lockKeyFor(null, user),
        user,
        "LOGIN_TOTP_FAILED",
        { reason: "disable" },
        403,
        "รหัสยืนยันไม่ถูกต้อง ระบบยังไม่ได้ปิดการยืนยันตัวตน 2 ขั้น",
      );
    return tx(() => {
      if (result.recovery) auditDetail(user.id, "RECOVERY_CODE_USED", user.id, { reason: "disable" });
      run("DELETE FROM user_totp WHERE user_id=?", user.id);
      run("DELETE FROM totp_recovery_codes WHERE user_id=?", user.id);
      run("DELETE FROM login_challenges WHERE user_id=?", user.id);
      auditDetail(user.id, "TOTP_DISABLE", user.id, null);
      return { enabled: false };
    });
  }

  /** Owner escape hatch: called when the env admin secret is rotated. */
  function resetSecondFactor(userId, reason) {
    const had = totpRow(userId);
    run("DELETE FROM user_totp WHERE user_id=?", userId);
    run("DELETE FROM totp_recovery_codes WHERE user_id=?", userId);
    run("DELETE FROM login_challenges WHERE user_id=?", userId);
    run("DELETE FROM login_attempts WHERE lock_key=?", lockKeyFor(null, { id: userId }));
    if (had?.secret_enc) auditDetail(null, "TOTP_RESET", userId, { reason });
  }

  return {
    ownerEmail,
    sessionLifetime,
    sessionUser,
    login,
    loginTotp,
    confirmPassword,
    reauthAdmin,
    totpStatus,
    totpSetup,
    totpEnable,
    totpDisable,
    resetSecondFactor,
  };
}
