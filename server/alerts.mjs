/**
 * Outside-the-website admin alerts: Discord webhook, Telegram bot and LINE Messaging API
 * push (LINE Notify was shut down in March 2025 and is not used).
 *
 * - Settings live in alert_state under "settings". Every secret (webhook URL, bot token,
 *   chat id, channel access token, to-id) is encrypted with the same INVENTORY_KEY-derived
 *   AES-256-GCM key as stock credentials and TOTP secrets. The client only ever sees the
 *   last 4 characters. Saving needs the admin password again.
 * - Domain code calls emit() inside its transaction. Nothing is sent there: events wait in
 *   memory and go out after the service call returns (dropped if it throws), so a failed
 *   order never alerts and an alert can never fail an order.
 * - Sending is fire-and-forget with a 5 s timeout. Every attempt is written to alert_log.
 * - At most 30 messages per channel per 10 minutes. Events in one service call are joined
 *   into one message; events over the limit are counted and mentioned in the next message.
 */
import { randomUUID } from "node:crypto";

export const ALERT_CHANNELS = ["discord", "telegram", "line"];
export const ALERT_EVENTS = [
  "order_paid",
  "preorder_paid",
  "stock_low",
  "chat_message",
  "chat_assigned",
  "refund",
  "daily_summary",
];
export const ALERT_RATE_MAX = 30;
export const ALERT_RATE_WINDOW_MS = 10 * 60000;
export const ALERT_TIMEOUT_MS = 5000;
export const DAILY_SUMMARY_HOUR = 21;
const BANGKOK_OFFSET_MS = 7 * 3600000;
const LOG_KEEP_MS = 30 * 86400000;

const CHANNEL_FIELDS = {
  discord: ["url"],
  telegram: ["token", "chatId"],
  line: ["token", "to"],
};
const CHANNEL_LABEL = { discord: "Discord", telegram: "Telegram", line: "LINE" };
const FIELD_LABEL = {
  discord: { url: "Webhook URL ของ Discord" },
  telegram: { token: "Bot token ของ Telegram", chatId: "Chat ID ของ Telegram" },
  line: { token: "Channel access token ของ LINE", to: "User ID หรือ Group ID ของ LINE" },
};
const FIELD_PATTERN = {
  discord: {
    url: /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,30}\/[A-Za-z0-9_-]{20,120}$/,
  },
  telegram: {
    token: /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/,
    chatId: /^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/,
  },
  line: {
    token: /^[A-Za-z0-9+/=._-]{20,400}$/,
    to: /^[UCR][0-9a-f]{32}$/,
  },
};
export const DISCORD_PREFIXES = [
  "https://discord.com/api/webhooks/",
  "https://discordapp.com/api/webhooks/",
];

/** Asia/Bangkok calendar day (UTC+7, no DST) for a timestamp in ms. */
export const bangkokDay = (ms) => new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
export const bangkokHour = (ms) => new Date(ms + BANGKOK_OFFSET_MS).getUTCHours();
/** Next time strictly after `ms` when the Bangkok clock reads hour:00. */
export function nextBangkokHour(ms, hour) {
  const local = new Date(ms + BANGKOK_OFFSET_MS);
  let at =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) -
    BANGKOK_OFFSET_MS;
  if (at <= ms) at += 86400000;
  return at;
}
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
export const thb = (satang) => {
  const n = Math.round(Number(satang) || 0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const baht = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + "฿" + baht + "." + String(abs % 100).padStart(2, "0");
};
const shortId = (id) => String(id ?? "").slice(0, 8).toUpperCase();
const oneLine = (value, max) =>
  String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, max);
export const maskTail = (value) => (value ? "••••" + String(value).slice(-4) : "");

/** Loopback-only base URL that local tests may use instead of the real provider hosts. */
export function loopbackRedirect(value) {
  if (typeof value !== "string" || !value) return null;
  return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(value.replace(/\/$/, ""))
    ? value.replace(/\/$/, "")
    : null;
}

export function createStateStore({ one, run }) {
  return {
    get(key) {
      return one("SELECT value FROM alert_state WHERE key=?", key)?.value ?? null;
    },
    set(key, value) {
      run(
        "INSERT INTO alert_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        key,
        String(value),
      );
    },
  };
}

const STOCK_RANK = { out: 0, low: 1, ok: 2 };
// After these calls stock can only go up (or be re-read), so a variant that was low may be
// "ok" again and alert again on the next crossing.
const STOCK_REFRESH_METHODS = new Set([
  "importCodes",
  "createVariant",
  "updateVariant",
  "markInventoryDefect",
  "deleteInventoryUnit",
  "saveProduct",
  "bulkUpdateProducts",
  "saveSettings",
]);

export function createAlerts({
  one,
  all,
  run,
  encrypt,
  decrypt,
  fail,
  requireAdmin,
  reauthAdmin,
  shopName = () => "ร้านค้า",
  summaryFor = () => ({ gross: 0, paidCount: 0, refunds: 0 }),
  stockInfo = () => null,
  clock = () => Date.now(),
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  waitUntil,
  redirect,
}) {
  const state = createStateStore({ one, run });
  const redirectBase = loopbackRedirect(redirect);
  const pending = [];
  const inFlight = new Set();
  let depth = 0;
  let lastTick = 0;

  // ------------------------------------------------------------------ settings

  const defaults = () => ({
    v: 1,
    channels: {
      discord: { enabled: false, url: null },
      telegram: { enabled: false, token: null, chatId: null },
      line: { enabled: false, token: null, to: null },
    },
    events: Object.fromEntries(ALERT_EVENTS.map((e) => [e, true])),
    origin: "",
    updatedAt: null,
  });
  function load() {
    const base = defaults();
    const raw = state.get("settings");
    if (!raw) return base;
    try {
      const saved = JSON.parse(raw);
      for (const ch of ALERT_CHANNELS)
        base.channels[ch] = { ...base.channels[ch], ...(saved.channels?.[ch] ?? {}) };
      for (const e of ALERT_EVENTS)
        if (typeof saved.events?.[e] === "boolean") base.events[e] = saved.events[e];
      base.origin = typeof saved.origin === "string" ? saved.origin : "";
      base.updatedAt = saved.updatedAt ?? null;
    } catch {
      // Corrupt row: behave as "nothing configured" rather than break orders.
    }
    return base;
  }
  const configured = (ch, c) => CHANNEL_FIELDS[ch].every((f) => typeof c[f] === "string" && c[f]);
  const active = (cfg) => ALERT_CHANNELS.filter((ch) => cfg.channels[ch].enabled && configured(ch, cfg.channels[ch]));
  const open = (ch, c) => Object.fromEntries(CHANNEL_FIELDS[ch].map((f) => [f, decrypt(c[f])]));

  function publicView(cfg) {
    const channels = {};
    for (const ch of ALERT_CHANNELS) {
      const c = cfg.channels[ch];
      const masked = {};
      for (const f of CHANNEL_FIELDS[ch]) {
        let value = "";
        try {
          value = c[f] ? maskTail(decrypt(c[f])) : "";
        } catch {
          value = "••••";
        }
        masked[f] = value;
      }
      channels[ch] = { enabled: !!c.enabled, configured: configured(ch, c), masked };
    }
    return { channels, events: { ...cfg.events }, origin: cfg.origin, updatedAt: cfg.updatedAt };
  }

  function alertSettings(user) {
    requireAdmin(user);
    const cfg = load();
    return {
      ...publicView(cfg),
      log: all(
        "SELECT id,created_at,channel,event,ok,status,error FROM alert_log ORDER BY at_ms DESC, rowid DESC LIMIT 50",
      ).map((r) => ({ ...r, ok: !!r.ok })),
      limits: {
        perChannel: ALERT_RATE_MAX,
        windowMinutes: ALERT_RATE_WINDOW_MS / 60000,
        timeoutSeconds: ALERT_TIMEOUT_MS / 1000,
        dailySummaryHour: DAILY_SUMMARY_HOUR,
      },
    };
  }

  function saveAlertSettings(user, input = {}, ctx = {}) {
    // ADMIN first, then the password (wrong password counts towards the lockout).
    reauthAdmin(user, input);
    const cfg = load();
    const changes = {};
    const inputChannels = input.channels && typeof input.channels === "object" ? input.channels : {};
    for (const ch of ALERT_CHANNELS) {
      const given = inputChannels[ch];
      if (!given || typeof given !== "object") continue;
      const c = cfg.channels[ch];
      const change = {};
      if (given.clear === true) {
        for (const f of CHANNEL_FIELDS[ch]) c[f] = null;
        c.enabled = false;
        change.cleared = true;
      }
      for (const f of CHANNEL_FIELDS[ch]) {
        const value = given[f];
        if (value === undefined || value === null) continue;
        if (typeof value !== "string") fail(400, FIELD_LABEL[ch][f] + "ไม่ถูกต้อง");
        const trimmed = value.trim();
        if (!trimmed) continue; // empty = keep what is saved
        if (ch === "discord" && !DISCORD_PREFIXES.some((p) => trimmed.startsWith(p)))
          fail(400, "Webhook URL ต้องขึ้นต้นด้วย https://discord.com/api/webhooks/");
        if (trimmed.length > 500 || !FIELD_PATTERN[ch][f].test(trimmed))
          fail(400, FIELD_LABEL[ch][f] + "ไม่ถูกต้อง");
        c[f] = encrypt(trimmed);
        change[f] = "changed";
      }
      if (given.enabled !== undefined) {
        if (typeof given.enabled !== "boolean") fail(400, "สถานะช่องทางไม่ถูกต้อง");
        if (given.enabled && !configured(ch, c))
          fail(400, "กรอกข้อมูล " + CHANNEL_LABEL[ch] + " ให้ครบก่อนเปิดใช้งาน");
        if (c.enabled !== given.enabled) change.enabled = given.enabled;
        c.enabled = given.enabled;
      }
      if (Object.keys(change).length) changes[ch] = change;
    }
    if (input.events && typeof input.events === "object") {
      for (const e of ALERT_EVENTS) {
        const value = input.events[e];
        if (value === undefined) continue;
        if (typeof value !== "boolean") fail(400, "การเลือกเหตุการณ์ไม่ถูกต้อง");
        if (cfg.events[e] !== value) (changes.events ??= {})[e] = value;
        cfg.events[e] = value;
      }
    }
    // Absolute admin links in messages come from the address the admin saved from.
    if (typeof ctx.origin === "string" && /^https?:\/\/[^/\s]+$/.test(ctx.origin)) cfg.origin = ctx.origin;
    cfg.updatedAt = sqlTime(clock());
    state.set("settings", JSON.stringify(cfg));
    // Audit: which channels/events changed, never the secret values.
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      "SAVE_ALERTS",
      user.id,
      JSON.stringify({ changed: changes }),
    );
    return alertSettings(user);
  }

  // ------------------------------------------------------------------ messages

  function link(cfg, path) {
    return cfg.origin ? "\nเปิดหลังร้าน: " + cfg.origin + path : "";
  }
  function variantName(variantId) {
    const row = one(
      "SELECT p.id AS product_id,p.name,v.label FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?",
      variantId,
    );
    return row ? { productId: row.product_id, text: oneLine(row.name, 80) + " / " + oneLine(row.label, 60) } : null;
  }
  function buildMessage(event, data, cfg) {
    switch (event) {
      case "order_paid": {
        const v = variantName(data.variantId);
        return {
          title: "ออเดอร์ใหม่ชำระแล้ว",
          body:
            (v ? "สินค้า: " + v.text + " x" + data.quantity + "\n" : "") +
            "ยอด: " + thb(data.total) + "\nเลขที่: " + shortId(data.id) +
            link(cfg, "/admin/orders/" + data.id),
        };
      }
      case "preorder_paid": {
        const v = variantName(data.variantId);
        return {
          title: "พรีออเดอร์ใหม่ชำระแล้ว (คิว #" + data.queueNumber + ")",
          body:
            (v ? "สินค้า: " + v.text + " x" + data.quantity + "\n" : "") +
            "ยอด: " + thb(data.total) + "\nเลขที่: " + shortId(data.id) +
            link(cfg, "/admin/preorders"),
        };
      }
      case "stock_low":
        return {
          title: data.level === "out" ? "สต็อกหมด" : "สต็อกใกล้หมด",
          body:
            oneLine(data.name, 80) + " / " + oneLine(data.label, 60) + " เหลือ " + data.stock + " ชิ้น" +
            link(cfg, "/admin/products/" + data.productId),
        };
      case "chat_message": {
        const row = one(
          "SELECT u.name FROM chat_threads t JOIN users u ON u.id=t.user_id WHERE t.id=?",
          data.threadId,
        );
        // The message text stays in the shop: customers sometimes paste account details.
        return {
          title: "ลูกค้าส่งข้อความใหม่ในแชท",
          body: "จาก: " + oneLine(row?.name ?? "ลูกค้า", 40) + link(cfg, "/admin/chat"),
        };
      }
      case "chat_assigned":
        return {
          title: "มอบหมายแชทแล้ว",
          body:
            oneLine(data.by, 40) + " มอบหมายแชทให้ " + oneLine(data.assignee, 40) + link(cfg, "/admin/chat"),
        };
      case "refund":
        return {
          title: "คืนเงินแล้ว",
          body:
            "ออเดอร์ " + shortId(data.orderId) + " คืน " + thb(data.amount) +
            (data.destination === "CREDIT" ? " เข้าเครดิตลูกค้า" : " โอนคืนนอกระบบ") +
            "\nโดย: " + oneLine(data.by, 40) +
            link(cfg, "/admin/orders/" + data.orderId),
        };
      case "daily_summary": {
        const s = summaryFor(data.day);
        return {
          title: "สรุปยอดวันนี้ " + data.day,
          body:
            "ยอดขาย: " + thb(s.gross) + " จาก " + s.paidCount + " รายการชำระ" +
            (s.refunds ? "\nคืนเงิน: " + thb(s.refunds) : "") +
            "\nสุทธิ: " + thb(s.gross - s.refunds) +
            link(cfg, "/admin/reports"),
        };
      }
      default:
        return null;
    }
  }

  /** Queue an event. Never throws: a broken alert must not fail the order that caused it. */
  function emit(event, data = {}) {
    try {
      const cfg = load();
      if (!cfg.events[event] || !active(cfg).length) return;
      const message = buildMessage(event, data, cfg);
      if (message) pending.push({ event, message });
    } catch (error) {
      console.error("Alert skipped:", error?.message);
    }
  }

  // ------------------------------------------------------------------ delivery

  function request(ch, secrets, text) {
    if (ch === "discord")
      return {
        url: secrets.url,
        headers: { "Content-Type": "application/json" },
        // No @everyone / role pings from customer-controlled text.
        body: { content: text.slice(0, 1900), allowed_mentions: { parse: [] } },
      };
    if (ch === "telegram")
      return {
        url: "https://api.telegram.org/bot" + secrets.token + "/sendMessage",
        headers: { "Content-Type": "application/json" },
        body: { chat_id: secrets.chatId, text: text.slice(0, 4000), disable_web_page_preview: true },
      };
    return {
      url: "https://api.line.me/v2/bot/message/push",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + secrets.token },
      body: { to: secrets.to, messages: [{ type: "text", text: text.slice(0, 4900) }] },
    };
  }
  /** Every saved secret of every channel (error text from one provider may echo another's). */
  function knownSecrets() {
    const values = [];
    try {
      const cfg = load();
      for (const ch of ALERT_CHANNELS)
        for (const f of CHANNEL_FIELDS[ch]) {
          const enc = cfg.channels[ch][f];
          if (enc) values.push(decrypt(enc));
        }
    } catch {
      // unreadable settings: fall back to the patterns below
    }
    return values;
  }
  function scrub(text, secrets) {
    let out = String(text ?? "");
    const values = [...Object.values(secrets), ...knownSecrets()].filter((v) => v && v.length >= 4);
    // Longest first so a URL is hidden before the token inside it.
    for (const value of values.sort((a, b) => b.length - a.length)) out = out.split(value).join("***");
    // Anything shaped like a bot token or a webhook path is hidden too, whichever channel it came from.
    return out
      .replace(/\d{5,15}:[A-Za-z0-9_-]{30,60}/g, "***")
      .replace(/webhooks\/\d+\/[A-Za-z0-9_-]+/g, "webhooks/***")
      .replace(/Bearer\s+\S+/gi, "Bearer ***")
      .slice(0, 200);
  }
  function underLimit(ch) {
    return (
      one(
        "SELECT COUNT(*) AS n FROM alert_log WHERE channel=? AND attempt=1 AND at_ms>?",
        ch,
        clock() - ALERT_RATE_WINDOW_MS,
      ).n < ALERT_RATE_MAX
    );
  }
  function logRow(ch, event, { attempt = 1, ok = 0, status = null, error = null } = {}) {
    const id = randomUUID();
    const now = clock();
    run(
      "INSERT INTO alert_log(id,at_ms,created_at,channel,event,attempt,ok,status,error) VALUES(?,?,?,?,?,?,?,?,?)",
      id,
      now,
      sqlTime(now),
      ch,
      event,
      attempt,
      ok,
      status,
      error,
    );
    return id;
  }
  /** One outbound request. Resolves to {ok,status,error}; never rejects. */
  function deliver(ch, c, text, event) {
    let secrets = {};
    let logId = null;
    const task = (async () => {
      let ok = false,
        status = null,
        error = null;
      try {
        secrets = open(ch, c);
        logId = logRow(ch, event, { error: "กำลังส่ง" });
        const req = request(ch, secrets, text);
        let url = req.url;
        if (redirectBase) {
          const u = new URL(url);
          url = redirectBase + u.pathname + u.search;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
        try {
          const res = await fetchImpl(url, {
            method: "POST",
            headers: { ...req.headers, "X-Astra-Alert-Channel": ch },
            body: JSON.stringify(req.body),
            signal: controller.signal,
          });
          status = res.status;
          ok = res.ok;
          const detail = await res.text().catch(() => "");
          if (!ok) error = scrub(detail, secrets) || "HTTP " + status;
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        error = e?.name === "AbortError" ? "หมดเวลา (" + ALERT_TIMEOUT_MS / 1000 + " วินาที)" : scrub(e?.message || "ส่งไม่สำเร็จ", secrets);
      }
      try {
        if (logId) run("UPDATE alert_log SET ok=?,status=?,error=? WHERE id=?", ok ? 1 : 0, status, ok ? null : error, logId);
        else logRow(ch, event, { ok: 0, error });
      } catch {
        // database closed (tests / shutdown): nothing else to do
      }
      return { ok, status, error: ok ? null : error };
    })();
    inFlight.add(task);
    task.finally(() => inFlight.delete(task));
    return task;
  }

  /** Send everything queued by the service call that just returned. */
  function flush() {
    if (!pending.length) return null;
    const events = pending.splice(0);
    try {
      const cfg = load();
      const channels = active(cfg);
      if (!channels.length) return null;
      const shop = oneLine(shopName() || "ร้านค้า", 60);
      const text = events
        .map((e, i) => (i === 0 ? "[" + shop + "] " : "") + e.message.title + "\n" + e.message.body)
        .join("\n\n");
      const eventName = [...new Set(events.map((e) => e.event))].join("+").slice(0, 120);
      run("DELETE FROM alert_log WHERE at_ms<?", clock() - LOG_KEEP_MS);
      const jobs = [];
      for (const ch of channels) {
        if (!underLimit(ch)) {
          const held = Number(state.get("collapsed:" + ch) ?? 0) + events.length;
          state.set("collapsed:" + ch, held);
          logRow(ch, eventName, {
            attempt: 0,
            error: "เกินโควตา " + ALERT_RATE_MAX + " ข้อความ/" + ALERT_RATE_WINDOW_MS / 60000 + " นาที — รวบไว้แจ้งรอบถัดไป",
          });
          continue;
        }
        let body = text;
        const held = Number(state.get("collapsed:" + ch) ?? 0);
        if (held) {
          body += "\n\n(+" + held + " เหตุการณ์ก่อนหน้านี้ไม่ได้ส่งเพราะเกินโควตา ดูได้ในหลังร้าน)";
          state.set("collapsed:" + ch, 0);
        }
        jobs.push(deliver(ch, cfg.channels[ch], body, eventName));
      }
      if (!jobs.length) return null;
      const all = Promise.allSettled(jobs);
      try {
        waitUntil?.(all);
      } catch {
        // runtime without waitUntil
      }
      return all;
    } catch (error) {
      console.error("Alert flush failed:", error?.message);
      return null;
    }
  }

  async function testAlert(user, input = {}) {
    requireAdmin(user);
    const ch = String(input.channel ?? "");
    if (!ALERT_CHANNELS.includes(ch)) fail(400, "ช่องทางไม่ถูกต้อง");
    const cfg = load();
    const c = cfg.channels[ch];
    if (!configured(ch, c)) fail(400, "บันทึกข้อมูล " + CHANNEL_LABEL[ch] + " ก่อนกดทดสอบส่ง");
    if (!underLimit(ch)) fail(429, "ส่งถึงโควตา " + ALERT_RATE_MAX + " ข้อความใน 10 นาทีแล้ว กรุณารอสักครู่");
    const text =
      "[" + oneLine(shopName() || "ร้านค้า", 60) + "] ทดสอบการแจ้งเตือนนอกเว็บ\n" +
      "ช่องทาง " + CHANNEL_LABEL[ch] + " เชื่อมต่อสำเร็จ" + link(cfg, "/admin/settings/alerts");
    return deliver(ch, c, text, "test");
  }

  // ------------------------------------------------------------------ stock crossings

  /** After a sale: alert once when an option drops into "low" or "out", not on every sale. */
  function stockAfterSale(variantId) {
    try {
      const info = stockInfo(variantId);
      if (!info) return;
      const key = "stock:" + variantId;
      const before = state.get(key) ?? "ok";
      if (before === info.level) return;
      state.set(key, info.level);
      if (STOCK_RANK[info.level] < STOCK_RANK[before]) emit("stock_low", info);
    } catch (error) {
      console.error("Stock alert check failed:", error?.message);
    }
  }
  /** Restock / edits: a variant that recovered goes back to "ok" (no alert). */
  function refreshStockLevels() {
    try {
      for (const row of all("SELECT key,value FROM alert_state WHERE key LIKE 'stock:%' AND value<>'ok'")) {
        const info = stockInfo(row.key.slice(6));
        const level = info?.level ?? "ok";
        if (STOCK_RANK[level] > STOCK_RANK[row.value]) state.set(row.key, level);
      }
    } catch (error) {
      console.error("Stock level refresh failed:", error?.message);
    }
  }

  // ------------------------------------------------------------------ daily summary

  /** Lazy trigger (any request) and the Durable Object alarm both call this; idempotent per day. */
  function tick(now = clock(), { force = false } = {}) {
    if (!force && now - lastTick < 60000) return null;
    lastTick = now;
    try {
      if (bangkokHour(now) < DAILY_SUMMARY_HOUR) return null;
      const cfg = load();
      if (!cfg.events.daily_summary || !active(cfg).length) return null;
      const day = bangkokDay(now);
      if (state.get("summary-day") === day) return null;
      state.set("summary-day", day);
      emit("daily_summary", { day });
      return flush();
    } catch (error) {
      console.error("Daily summary failed:", error?.message);
      return null;
    }
  }
  function wantsSchedule() {
    try {
      const cfg = load();
      return !!cfg.events.daily_summary && active(cfg).length > 0;
    } catch {
      return false;
    }
  }

  /** Wrap service methods: flush queued alerts after a successful call, drop them on error. */
  function wrap(service) {
    const wrapped = { ...service };
    for (const [name, fn] of Object.entries(service)) {
      if (typeof fn !== "function") continue;
      wrapped[name] = (...args) => {
        depth += 1;
        let result;
        try {
          result = fn(...args);
        } catch (error) {
          depth -= 1;
          if (!depth) pending.length = 0;
          throw error;
        }
        depth -= 1;
        if (!depth) {
          if (STOCK_REFRESH_METHODS.has(name)) refreshStockLevels();
          flush();
        }
        return result;
      };
    }
    return wrapped;
  }

  return {
    emit,
    flush,
    wrap,
    tick,
    wantsSchedule,
    stockAfterSale,
    refreshStockLevels,
    alertSettings,
    saveAlertSettings,
    testAlert,
    state,
    /** Tests: wait until every outbound request has finished and been logged. */
    idle: async () => {
      while (inFlight.size) await Promise.allSettled([...inFlight]);
    },
  };
}
