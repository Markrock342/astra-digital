/**
 * Basic fraud signals ("สัญญาณผิดปกติ") + a temporary email / email-domain blocklist.
 *
 * Rules (admin › ลูกค้า › สัญญาณผิดปกติ › ตั้งค่า; all on by default):
 *   paid_orders      ≥ N paid orders by one account in the window      (default 6 / 1 h)
 *   paid_amount      ≥ N baht paid by one account in the window         (default 5,000 / 1 h)
 *   issue_reports    ≥ N "แจ้งปัญหา" reports by one account               (default 3 / 7 days)
 *   failed_payments  ≥ N failed payments by one account                 (default 5 / 1 h)
 *   signup_ip        ≥ N new accounts from one masked IP prefix (/24, /48) (default 5 / 24 h)
 * Customer credential views are not tracked separately by the shop (the order page shows
 * them), so there is no rule for them.
 *
 * Behaviour:
 * - Checks run AFTER the wrapped call returned (its transaction is committed), inside
 *   try/catch: a broken rule never fails or slows an order beyond one or two indexed
 *   COUNT queries.
 * - A hit creates one signal per rule + subject per window (repeats inside the window only
 *   bump `hits`), an in-site notification for every ADMIN and an outside alert
 *   (alerts.mjs event "fraud_signal"). Nothing is ever banned automatically.
 * - Blocks stop register + login for an email or a domain (and its sub-domains) until they
 *   expire. ADMIN / STAFF accounts are never blocked by the list (no self lock-out).
 * - Only masked IP prefixes are stored (same maskIp() as "my devices"); private and
 *   loopback addresses are ignored for the signup rule.
 * Schema: ensureFraudSignals() in ensure-admin-fr.mjs.
 */
import { randomUUID } from "node:crypto";
import { maskIp } from "./account-sessions.mjs";

export const FRAUD_RULES = {
  paid_orders: {
    label: "สั่งซื้อถี่ผิดปกติ",
    help: "จำนวนออเดอร์ที่ชำระแล้วของลูกค้าคนเดียว",
    unit: "ออเดอร์",
    defaults: { enabled: true, threshold: 6, windowHours: 1 },
    max: 1000,
  },
  paid_amount: {
    label: "ยอดซื้อสูงผิดปกติ",
    help: "ยอดเงินที่ลูกค้าคนเดียวจ่าย (บาท)",
    unit: "บาท",
    defaults: { enabled: true, threshold: 5000, windowHours: 1 },
    max: 10000000,
  },
  issue_reports: {
    label: "แจ้งปัญหาบ่อย",
    help: "จำนวนครั้งที่ลูกค้าคนเดียวกด “แจ้งปัญหา” ออเดอร์",
    unit: "ครั้ง",
    defaults: { enabled: true, threshold: 3, windowHours: 168 },
    max: 1000,
  },
  failed_payments: {
    label: "ชำระเงินไม่สำเร็จบ่อย",
    help: "จำนวนการชำระเงินที่ไม่สำเร็จของลูกค้าคนเดียว",
    unit: "ครั้ง",
    defaults: { enabled: true, threshold: 5, windowHours: 1 },
    max: 1000,
  },
  signup_ip: {
    label: "สมัครหลายบัญชีจากเครือข่ายเดียวกัน",
    help: "จำนวนบัญชีใหม่จากเครือข่ายเดียวกัน (เก็บเฉพาะเลข IP แบบย่อ)",
    unit: "บัญชี",
    defaults: { enabled: true, threshold: 5, windowHours: 24 },
    max: 1000,
  },
};
export const FRAUD_RULE_KEYS = Object.keys(FRAUD_RULES);
export const MAX_WINDOW_HOURS = 720;
export const BLOCK_MAX_HOURS = 90 * 24;
const EVENT_KEEP_MS = 31 * 86400000;
const PRUNE_EVERY_MS = 3600000;
const SETTINGS_KEY = "fraud-settings";
export const BLOCKED_REGISTER = "อีเมลนี้ถูกระงับการสมัครชั่วคราว กรุณาติดต่อร้าน";
export const BLOCKED_LOGIN = "บัญชีนี้ถูกระงับการเข้าสู่ระบบชั่วคราว กรุณาติดต่อร้าน";

const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?=.{3,160}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "a@x.mail.com" → ["x.mail.com", "mail.com"] (never the bare TLD). */
export function domainSuffixes(email) {
  const domain = String(email ?? "").trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return [];
  const parts = domain.split(".");
  const out = [];
  for (let i = 0; i < parts.length - 1; i += 1) out.push(parts.slice(i).join("."));
  return out;
}
/** Loopback / private / link-local ranges never count for the signup rule. */
export function isPrivateIp(ip) {
  const value = String(ip ?? "").trim().replace(/^::ffff:/i, "");
  if (!value) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(value)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return true;
  const lower = value.toLowerCase();
  return lower === "::1" || lower === "::" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

export function createFraud({
  one,
  all,
  run,
  tx,
  fail,
  clock = () => Date.now(),
  requireAdmin,
  notify,
  alerts,
  maskEmail = (v) => v,
}) {
  let cached = null;
  let lastPrune = 0;
  const auditDetail = (userId, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      userId ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );

  // ------------------------------------------------------------------ settings

  function defaults() {
    return Object.fromEntries(FRAUD_RULE_KEYS.map((k) => [k, { ...FRAUD_RULES[k].defaults }]));
  }
  function loadSettings() {
    if (cached) return cached;
    const rules = defaults();
    let updatedAt = null;
    try {
      const raw = one("SELECT value FROM runtime_flags WHERE key=?", SETTINGS_KEY)?.value;
      if (raw) {
        const saved = JSON.parse(raw);
        for (const k of FRAUD_RULE_KEYS) {
          const r = saved.rules?.[k];
          if (!r) continue;
          if (typeof r.enabled === "boolean") rules[k].enabled = r.enabled;
          if (Number.isSafeInteger(r.threshold) && r.threshold >= 1 && r.threshold <= FRAUD_RULES[k].max)
            rules[k].threshold = r.threshold;
          if (Number.isSafeInteger(r.windowHours) && r.windowHours >= 1 && r.windowHours <= MAX_WINDOW_HOURS)
            rules[k].windowHours = r.windowHours;
        }
        updatedAt = saved.updatedAt ?? null;
      }
    } catch {
      // unreadable: defaults
    }
    cached = { rules, updatedAt };
    return cached;
  }

  function saveFraudSettings(user, input = {}) {
    requireAdmin(user);
    const current = loadSettings();
    const next = JSON.parse(JSON.stringify(current.rules));
    const given = input.rules && typeof input.rules === "object" ? input.rules : {};
    const changed = {};
    for (const k of FRAUD_RULE_KEYS) {
      const r = given[k];
      if (!r || typeof r !== "object") continue;
      const label = FRAUD_RULES[k].label;
      if (r.enabled !== undefined) {
        if (typeof r.enabled !== "boolean") fail(400, "สถานะของกฎ “" + label + "” ไม่ถูกต้อง");
        next[k].enabled = r.enabled;
      }
      if (r.threshold !== undefined) {
        const n = Number(r.threshold);
        if (!Number.isSafeInteger(n) || n < 1 || n > FRAUD_RULES[k].max)
          fail(400, "เกณฑ์ของกฎ “" + label + "” ต้องเป็นจำนวนเต็ม 1–" + FRAUD_RULES[k].max.toLocaleString("en-US"));
        next[k].threshold = n;
      }
      if (r.windowHours !== undefined) {
        const n = Number(r.windowHours);
        if (!Number.isSafeInteger(n) || n < 1 || n > MAX_WINDOW_HOURS)
          fail(400, "ช่วงเวลาของกฎ “" + label + "” ต้องเป็น 1–" + MAX_WINDOW_HOURS + " ชั่วโมง");
        next[k].windowHours = n;
      }
      if (JSON.stringify(next[k]) !== JSON.stringify(current.rules[k])) changed[k] = next[k];
    }
    const updatedAt = sqlTime(clock());
    run(
      "INSERT INTO runtime_flags(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      SETTINGS_KEY,
      JSON.stringify({ v: 1, rules: next, updatedAt }),
    );
    cached = null;
    auditDetail(user.id, "FRAUD_SETTINGS", null, { changed });
    return { settings: settingsView() };
  }
  function settingsView() {
    const s = loadSettings();
    return {
      updatedAt: s.updatedAt,
      maxWindowHours: MAX_WINDOW_HOURS,
      rules: FRAUD_RULE_KEYS.map((k) => ({
        key: k,
        label: FRAUD_RULES[k].label,
        help: FRAUD_RULES[k].help,
        unit: FRAUD_RULES[k].unit,
        max: FRAUD_RULES[k].max,
        defaults: { ...FRAUD_RULES[k].defaults },
        ...s.rules[k],
      })),
    };
  }

  // ------------------------------------------------------------------ counters + signals

  function prune(now) {
    if (now - lastPrune < PRUNE_EVERY_MS) return;
    lastPrune = now;
    run("DELETE FROM fraud_events WHERE at_ms<?", now - EVENT_KEEP_MS);
  }
  function record(kind, subject, userId) {
    const now = clock();
    run("INSERT INTO fraud_events(kind,subject,user_id,at_ms) VALUES(?,?,?,?)", kind, subject, userId ?? null, now);
    prune(now);
  }
  function countEvents(kind, subject, windowHours) {
    return one(
      "SELECT COUNT(*) AS n FROM fraud_events WHERE kind=? AND subject=? AND at_ms>?",
      kind,
      subject,
      clock() - windowHours * 3600000,
    ).n;
  }
  function customerLine(userId) {
    const row = userId ? one("SELECT name,email FROM users WHERE id=?", userId) : null;
    return row ? String(row.name ?? "").slice(0, 40) + " (" + maskEmail(row.email) + ")" : "";
  }
  function valueText(rule, value) {
    return rule === "paid_amount"
      ? value.toLocaleString("en-US") + " บาท"
      : value + " " + FRAUD_RULES[rule].unit;
  }
  function windowText(hours) {
    return hours % 24 === 0 ? hours / 24 + " วัน" : hours + " ชั่วโมง";
  }

  /**
   * One hit. Same rule + subject inside its window → bump the open row; else a new signal,
   * admin notifications and the outside alert. Returns the new signal id or null.
   */
  function raise(rule, { subject, userId = null, ipMasked = null, value, detail = null }) {
    const cfg = loadSettings().rules[rule];
    const now = clock();
    const windowMs = cfg.windowHours * 3600000;
    const existing = one(
      "SELECT id FROM fraud_signals WHERE rule=? AND subject=? AND at_ms>? ORDER BY at_ms DESC LIMIT 1",
      rule,
      subject,
      now - windowMs,
    );
    if (existing) {
      run(
        "UPDATE fraud_signals SET hits=hits+1, last_at_ms=?, value=MAX(value,?), user_id=COALESCE(user_id,?) WHERE id=?",
        now,
        value,
        userId,
        existing.id,
      );
      return null;
    }
    const id = randomUUID();
    tx(() => {
      run(
        `INSERT INTO fraud_signals(id,rule,subject,user_id,ip_masked,value,threshold,window_hours,detail,at_ms,last_at_ms,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        rule,
        subject,
        userId,
        ipMasked,
        value,
        cfg.threshold,
        cfg.windowHours,
        detail == null ? null : JSON.stringify(detail),
        now,
        now,
        sqlTime(now),
      );
      const who = customerLine(userId) || (ipMasked ? "เครือข่าย " + ipMasked : "");
      const body =
        FRAUD_RULES[rule].label + " · " + valueText(rule, value) + " ใน " + windowText(cfg.windowHours) + (who ? " · " + who : "");
      for (const admin of all("SELECT id FROM users WHERE role='ADMIN'"))
        notify(admin.id, "fraud_signal", "สัญญาณผิดปกติ", body.slice(0, 200), "/admin/fraud");
    });
    alerts?.emit?.("fraud_signal", {
      id,
      rule,
      label: FRAUD_RULES[rule].label,
      value: valueText(rule, value),
      window: windowText(cfg.windowHours),
      who: customerLine(userId) || (ipMasked ? "เครือข่าย " + ipMasked : ""),
    });
    return id;
  }
  /** Run one rule check; never throws (fraud checks must not break the shop). */
  function safely(label, fn) {
    try {
      return fn();
    } catch (error) {
      console.error("Fraud check skipped:", label, error?.message);
      return null;
    }
  }

  function checkPaid(userId) {
    const { rules } = loadSettings();
    if (!rules.paid_orders.enabled && !rules.paid_amount.enabled) return;
    const hours = Math.max(
      rules.paid_orders.enabled ? rules.paid_orders.windowHours : 0,
      rules.paid_amount.enabled ? rules.paid_amount.windowHours : 0,
    );
    // payments.created_at is the database clock (CURRENT_TIMESTAMP), so the window is too.
    // Uses the payments_user_status index; one account's recent payments only.
    const rows = all(
      `SELECT amount, (julianday('now') - julianday(created_at)) * 24 AS age_hours FROM payments
       WHERE user_id=? AND status='SUCCEEDED' AND (order_id IS NOT NULL OR reservation_id IS NOT NULL)
         AND created_at>datetime('now', ?) LIMIT 5000`,
      userId,
      "-" + hours + " hours",
    );
    for (const [rule, measure] of [
      ["paid_orders", (list) => list.length],
      ["paid_amount", (list) => Math.floor(list.reduce((sum, r) => sum + Number(r.amount || 0), 0) / 100)],
    ]) {
      const cfg = rules[rule];
      if (!cfg.enabled) continue;
      const value = measure(rows.filter((r) => Number(r.age_hours) < cfg.windowHours));
      if (value >= cfg.threshold) raise(rule, { subject: "user:" + userId, userId, value });
    }
  }
  function checkCount(rule, kind, subject, extra = {}) {
    const cfg = loadSettings().rules[rule];
    if (!cfg.enabled) return;
    const value = countEvents(kind, subject, cfg.windowHours);
    if (value >= cfg.threshold) raise(rule, { subject, value, ...extra });
  }

  // ------------------------------------------------------------------ blocklist

  /** The active block that covers this email, or null. */
  function activeBlock(email) {
    const value = String(email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(value)) return null;
    const domains = domainSuffixes(value);
    const marks = domains.map(() => "?").join(",");
    return (
      one(
        `SELECT id, kind, value, expires_ms FROM fraud_blocks
         WHERE lifted_at IS NULL AND expires_ms>? AND ((kind='EMAIL' AND value=?)${
           domains.length ? ` OR (kind='DOMAIN' AND value IN (${marks}))` : ""
         }) ORDER BY expires_ms DESC LIMIT 1`,
        clock(),
        value,
        ...domains,
      ) ?? null
    );
  }
  function blockedSafe(email) {
    try {
      return activeBlock(email);
    } catch {
      return null; // table missing: never block
    }
  }
  function assertCanRegister(input) {
    const email = typeof input?.email === "string" ? input.email : "";
    if (email && blockedSafe(email)) fail(403, BLOCKED_REGISTER);
  }
  function assertCanLogin(input) {
    const identifier = String(input?.email ?? input?.username ?? "").trim();
    if (!identifier || identifier.length > 160) return;
    let user = null;
    try {
      user = one("SELECT email, role FROM users WHERE email=? OR username=?", identifier, identifier) ?? null;
    } catch {
      return;
    }
    if (user && user.role !== "CUSTOMER") return; // staff are never locked out by the list
    const email = user?.email ?? (identifier.includes("@") ? identifier : "");
    if (email && blockedSafe(email)) fail(403, BLOCKED_LOGIN);
  }

  function addBlock(user, input = {}) {
    requireAdmin(user);
    const kind = String(input.kind ?? "").toUpperCase();
    if (kind !== "EMAIL" && kind !== "DOMAIN") fail(400, "เลือกว่าจะบล็อกอีเมลหรือโดเมน");
    let value = typeof input.value === "string" ? input.value.trim().toLowerCase() : "";
    if (kind === "DOMAIN") value = value.replace(/^@/, "");
    if (kind === "EMAIL" && (value.length > 160 || !EMAIL_RE.test(value))) fail(400, "อีเมลไม่ถูกต้อง");
    if (kind === "DOMAIN" && !DOMAIN_RE.test(value)) fail(400, "โดเมนไม่ถูกต้อง เช่น example.com");
    const hours = Number(input.hours);
    if (!Number.isSafeInteger(hours) || hours < 1 || hours > BLOCK_MAX_HOURS)
      fail(400, "ระยะเวลาบล็อกต้องเป็น 1–" + BLOCK_MAX_HOURS + " ชั่วโมง (สูงสุด 90 วัน)");
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
    // Never block the people who run the shop.
    const staff =
      kind === "EMAIL"
        ? one("SELECT id FROM users WHERE lower(email)=? AND role<>'CUSTOMER'", value)
        : all("SELECT email FROM users WHERE role<>'CUSTOMER'").find((r) =>
            domainSuffixes(r.email).includes(value),
          );
    if (staff) fail(400, "บล็อกอีเมลหรือโดเมนของทีมงานไม่ได้");
    const now = clock();
    const id = randomUUID();
    tx(() => {
      run(
        "INSERT INTO fraud_blocks(id,kind,value,reason,created_by,created_at,at_ms,expires_ms) VALUES(?,?,?,?,?,?,?,?)",
        id,
        kind,
        value,
        reason || null,
        user.id,
        sqlTime(now),
        now,
        now + hours * 3600000,
      );
      auditDetail(user.id, "FRAUD_BLOCK", id, {
        kind,
        value: kind === "EMAIL" ? maskEmail(value) : value,
        hours,
        reason: reason || null,
      });
    });
    return { block: blockView(one("SELECT * FROM fraud_blocks WHERE id=?", id)) };
  }
  function liftBlock(user, id) {
    requireAdmin(user);
    const row = typeof id === "string" ? one("SELECT * FROM fraud_blocks WHERE id=?", id) : null;
    if (!row) fail(404, "ไม่พบรายการบล็อก");
    if (row.lifted_at || row.expires_ms <= clock()) fail(409, "รายการนี้หมดผลแล้ว");
    tx(() => {
      run("UPDATE fraud_blocks SET lifted_at=?, lifted_by=? WHERE id=?", sqlTime(clock()), user.id, row.id);
      auditDetail(user.id, "FRAUD_UNBLOCK", row.id, {
        kind: row.kind,
        value: row.kind === "EMAIL" ? maskEmail(row.value) : row.value,
      });
    });
    return { block: blockView(one("SELECT * FROM fraud_blocks WHERE id=?", row.id)) };
  }
  function blockView(row) {
    const now = clock();
    return {
      id: row.id,
      kind: row.kind,
      value: row.value,
      reason: row.reason,
      createdAt: row.created_at,
      expiresAt: sqlTime(row.expires_ms),
      active: !row.lifted_at && row.expires_ms > now,
      liftedAt: row.lifted_at,
    };
  }

  // ------------------------------------------------------------------ admin list

  function signalView(row) {
    let detail = null;
    try {
      detail = row.detail ? JSON.parse(row.detail) : null;
    } catch {
      detail = null;
    }
    return {
      id: row.id,
      rule: row.rule,
      label: FRAUD_RULES[row.rule]?.label ?? row.rule,
      unit: FRAUD_RULES[row.rule]?.unit ?? "",
      value: row.value,
      threshold: row.threshold,
      windowHours: row.window_hours,
      hits: row.hits,
      status: row.status,
      createdAt: row.created_at,
      lastAt: sqlTime(row.last_at_ms),
      ipMasked: row.ip_masked,
      customer: row.user_id
        ? {
            id: row.user_id,
            name: row.customer_name ?? null,
            email: row.customer_email ?? null,
            status: row.customer_status ?? "ACTIVE",
            role: row.customer_role ?? null,
          }
        : null,
      accounts: Array.isArray(detail?.accounts) ? detail.accounts : [],
      reviewedAt: row.reviewed_at,
      reviewedBy: row.reviewer_name ?? null,
      note: row.review_note,
    };
  }
  function adminFraud(user, query = {}) {
    requireAdmin(user);
    const status = String(query.status ?? "open").toLowerCase();
    if (!["open", "reviewed", "all"].includes(status)) fail(400, "ตัวกรองไม่ถูกต้อง");
    const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), 100);
    const where = status === "all" ? "" : "WHERE s.status=?";
    const rows = all(
      `SELECT s.*, u.name AS customer_name, u.email AS customer_email, COALESCE(u.status,'ACTIVE') AS customer_status,
              u.role AS customer_role, r.name AS reviewer_name
       FROM fraud_signals s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN users r ON r.id=s.reviewed_by
       ${where} ORDER BY s.at_ms DESC, s.rowid DESC LIMIT ?`,
      ...(status === "all" ? [] : [status.toUpperCase()]),
      limit,
    );
    const counts = { open: 0, reviewed: 0 };
    for (const r of all("SELECT status, COUNT(*) AS n FROM fraud_signals GROUP BY status"))
      counts[String(r.status).toLowerCase()] = r.n;
    return {
      signals: rows.map(signalView),
      counts,
      settings: settingsView(),
      blocks: all(
        "SELECT * FROM fraud_blocks WHERE lifted_at IS NULL AND expires_ms>? ORDER BY expires_ms ASC LIMIT 100",
        clock(),
      ).map(blockView),
      blockMaxHours: BLOCK_MAX_HOURS,
    };
  }
  function reviewSignal(user, id, input = {}) {
    requireAdmin(user);
    const row = typeof id === "string" ? one("SELECT * FROM fraud_signals WHERE id=?", id) : null;
    if (!row) fail(404, "ไม่พบสัญญาณนี้");
    if (row.status === "REVIEWED") fail(409, "ตรวจสอบรายการนี้แล้ว");
    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (note.length > 300) fail(400, "บันทึกยาวเกิน 300 ตัวอักษร");
    tx(() => {
      run(
        "UPDATE fraud_signals SET status='REVIEWED', reviewed_by=?, reviewed_at=?, review_note=? WHERE id=? AND status='OPEN'",
        user.id,
        sqlTime(clock()),
        note || null,
        row.id,
      );
      auditDetail(user.id, "FRAUD_SIGNAL_REVIEWED", row.id, { rule: row.rule, note: note || null });
    });
    return {
      signal: signalView(
        one(
          `SELECT s.*, u.name AS customer_name, u.email AS customer_email, COALESCE(u.status,'ACTIVE') AS customer_status,
                  u.role AS customer_role, r.name AS reviewer_name
           FROM fraud_signals s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN users r ON r.id=s.reviewed_by WHERE s.id=?`,
          row.id,
        ),
      ),
    };
  }

  // ------------------------------------------------------------------ hooks

  /**
   * Wrap register / login / pay / adminCreateManualOrder / postChatMessage.
   * The block check runs before register and login; the rules run after the original
   * returned (committed) and never throw. Manual admin orders count as paid for the customer.
   */
  function hook(service) {
    const { register, login, pay, openChatThread, postChatMessage, adminCreateManualOrder } = service;
    service.register = (input, ctx = {}) => {
      assertCanRegister(input);
      const result = register(input, ctx);
      safely("signup_ip", () => {
        if (isPrivateIp(ctx.ip)) return;
        const prefix = maskIp(ctx.ip);
        const userId = result?.user?.id;
        if (!prefix || !userId) return;
        record("signup", "ip:" + prefix, userId);
        const cfg = loadSettings().rules.signup_ip;
        if (!cfg.enabled) return;
        const accounts = all(
          "SELECT DISTINCT user_id FROM fraud_events WHERE kind='signup' AND subject=? AND at_ms>? ORDER BY at_ms DESC LIMIT 10",
          "ip:" + prefix,
          clock() - cfg.windowHours * 3600000,
        ).map((r) => r.user_id);
        checkCount("signup_ip", "signup", "ip:" + prefix, { userId, ipMasked: prefix, detail: { accounts } });
      });
      return result;
    };
    service.login = (input, ctx) => {
      assertCanLogin(input);
      return login(input, ctx);
    };
    service.pay = (user, id, input, ctx) => {
      const result = pay(user, id, input, ctx);
      if (user?.id)
        safely("pay", () => {
          if (input?.outcome === "success" && ["DELIVERED", "PREORDER"].includes(result?.status)) checkPaid(user.id);
          else if (input?.outcome === "failure" && result?.status === "FAILED") {
            record("payment_failed", "user:" + user.id, user.id);
            checkCount("failed_payments", "payment_failed", "user:" + user.id, { userId: user.id });
          }
        });
      return result;
    };
    if (typeof adminCreateManualOrder === "function")
      service.adminCreateManualOrder = (user, input = {}, ctx = {}) => {
        const result = adminCreateManualOrder(user, input, ctx);
        const customerId = typeof input?.customerId === "string" ? input.customerId : null;
        if (customerId && result && !result.replayed)
          safely("manual_paid", () => checkPaid(customerId));
        return result;
      };
    // A customer "แจ้งปัญหา" is a chat message linked to an order (order-extras.mjs); it can
    // open a new thread or go into the open one. Both only succeed for a valid report.
    const countReport = (user, input) => {
      if (user?.id && user.role === "CUSTOMER" && input?.orderId)
        safely("issue_reports", () => {
          record("issue_report", "user:" + user.id, user.id);
          checkCount("issue_reports", "issue_report", "user:" + user.id, { userId: user.id });
        });
    };
    service.openChatThread = (user, input) => {
      const result = openChatThread(user, input);
      countReport(user, input);
      return result;
    };
    service.postChatMessage = (user, threadId, input) => {
      const result = postChatMessage(user, threadId, input);
      countReport(user, input);
      return result;
    };
  }

  return {
    hook,
    // Email verification › change email: the same blocklist as sign-up.
    assertCanRegister,
    activeBlock,
    adminFraud,
    reviewSignal,
    saveFraudSettings,
    addBlock,
    liftBlock,
    settingsView,
  };
}
