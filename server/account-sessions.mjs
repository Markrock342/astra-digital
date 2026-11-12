/**
 * "My devices": every signed-in user (customer, staff, admin) can see their own
 * sessions and sign out the ones they do not recognise.
 *
 * Privacy: a session keeps only a coarse device label parsed from the User-Agent
 * ("Chrome · macOS") and the IP cut to /24 (IPv6 /48), written once when the session
 * is created. The id sent to the browser is a keyed hash of the token hash, so the
 * stored token hash never leaves the server.
 *
 * Works on node:sqlite and on the Durable Object adapter (prepare().get/all/run only).
 */
import { createHmac } from "node:crypto";
import { STAFF_IDLE_MS, STAFF_SESSION_MS } from "./auth-hardening.mjs";
import { isStaff } from "./auth-policy.mjs";

const UNKNOWN_DEVICE = "อุปกรณ์ที่ไม่รู้จัก";

/** Coarse "Browser · OS" label; never stores the raw User-Agent. */
export function deviceLabel(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent.slice(0, 512) : "";
  if (!ua.trim()) return UNKNOWN_DEVICE;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Windows/.test(ua)
            ? "Windows"
            : /Mac OS X|Macintosh/.test(ua)
              ? "macOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  const browser = /\bLine\//.test(ua)
    ? "LINE"
    : /FBAN|FBAV/.test(ua)
      ? "Facebook"
      : /Edg(?:e|A|iOS)?\//.test(ua)
        ? "Edge"
        : /OPR\/|Opera/.test(ua)
          ? "Opera"
          : /SamsungBrowser/.test(ua)
            ? "Samsung Internet"
            : /Firefox\/|FxiOS/.test(ua)
              ? "Firefox"
              : /Chrome\/|CriOS|Chromium/.test(ua)
                ? "Chrome"
                : /Safari\//.test(ua)
                  ? "Safari"
                  : null;
  if (browser && os) return browser + " · " + os;
  return browser ?? os ?? UNKNOWN_DEVICE;
}

/** IPv4 → a.b.c.0/24, IPv6 → first three groups ::/48. Anything else → null. */
export function maskIp(ip) {
  if (typeof ip !== "string") return null;
  let value = ip.trim();
  if (!value || value.length > 64) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mapped) value = mapped[1];
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    const parts = v4.slice(1, 4).map(Number);
    if (parts.some((p) => p > 255) || Number(v4[4]) > 255) return null;
    return parts.join(".") + ".0/24";
  }
  value = value.replace(/%.*$/, "");
  if (!/^[0-9a-f:]+$/i.test(value) || !value.includes(":")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  const prefix = groups.slice(0, 3).map((g) => parseInt(g, 16).toString(16));
  return prefix.join(":") + "::/48";
}

/** Columns written by issueSession for a new session. */
export function sessionContext(ctx = {}) {
  return { device: deviceLabel(ctx.userAgent), ipMasked: maskIp(ctx.ip) };
}

export function createAccountSessionApis({ one, all, run, tx, fail, key, clock, hash, requireUser }) {
  const publicId = (tokenHash) =>
    createHmac("sha256", key).update("session-id:" + tokenHash).digest("hex").slice(0, 32);
  const auditDetail = (userId, action, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      userId,
      action,
      userId,
      detail == null ? null : JSON.stringify(detail),
    );

  /** Live sessions of this user (expired or idle-timed-out staff sessions are left out). */
  function liveRows(user) {
    const t = clock();
    const staff = isStaff(user);
    return all(
      `SELECT token_hash,created_at,last_seen,expires_at,device,ip_masked
       FROM sessions WHERE user_id=? AND expires_at>?`,
      user.id,
      t,
    ).filter(
      (r) =>
        !staff ||
        r.created_at == null ||
        (t - r.created_at < STAFF_SESSION_MS && t - (r.last_seen ?? r.created_at) < STAFF_IDLE_MS),
    );
  }
  const currentHash = (token) => (typeof token === "string" && token ? hash(token) : "");
  // Same UTC text as SQLite CURRENT_TIMESTAMP, like every other time the API returns.
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString().slice(0, 19).replace("T", " "));

  function listSessions(user, token) {
    requireUser(user);
    const mine = currentHash(token);
    const sessions = liveRows(user)
      .map((r) => ({
        id: publicId(r.token_hash),
        device: r.device ?? UNKNOWN_DEVICE,
        ip: r.ip_masked ?? null,
        createdAt: iso(r.created_at),
        lastSeenAt: iso(r.last_seen ?? r.created_at),
        current: r.token_hash === mine,
      }))
      .sort(
        (a, b) =>
          Number(b.current) - Number(a.current) ||
          String(b.lastSeenAt ?? "").localeCompare(String(a.lastSeenAt ?? "")),
      );
    return { sessions };
  }

  /** Sign out one of the caller's own sessions. `current: true` means the cookie must go too. */
  function revokeSession(user, token, id) {
    requireUser(user);
    if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) fail(400, "รหัสอุปกรณ์ไม่ถูกต้อง");
    return tx(() => {
      const row = all(
        "SELECT token_hash,device FROM sessions WHERE user_id=?",
        user.id,
      ).find((r) => publicId(r.token_hash) === id);
      if (!row) fail(404, "ไม่พบอุปกรณ์นี้ หรือออกจากระบบไปแล้ว");
      run("DELETE FROM sessions WHERE token_hash=? AND user_id=?", row.token_hash, user.id);
      const current = row.token_hash === currentHash(token);
      auditDetail(user.id, "SESSION_REVOKE", { device: row.device ?? null, current });
      return { revoked: 1, current };
    });
  }

  /** Sign out every session of the caller except the one making this request. */
  function revokeOtherSessions(user, token) {
    requireUser(user);
    const mine = currentHash(token);
    if (!mine) fail(401, "กรุณาเข้าสู่ระบบ");
    return tx(() => {
      const removed = run(
        "DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
        user.id,
        mine,
      ).changes;
      auditDetail(user.id, "SESSION_REVOKE_OTHERS", { sessions: removed });
      return { revoked: removed };
    });
  }

  return { listSessions, revokeSession, revokeOtherSessions, publicSessionId: publicId };
}
