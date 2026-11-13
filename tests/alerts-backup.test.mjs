// Outside-the-website alerts (Discord / Telegram / LINE Messaging API) and backups:
// encrypted + masked settings behind the password, fan-out with a fake fetch, rate limit,
// failures never reach the order, low stock once per crossing, daily summary, export →
// restore script round trip, and the R2 backup with retention.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { randomBytes, randomFillSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { restoreBackup } from "../server/backup.mjs";
import { ALERT_RATE_MAX, bangkokDay, nextBangkokHour } from "../server/alerts.mjs";

// Fake values only — shaped like the real thing so validation passes.
const DISCORD = "https://discord.com/api/webhooks/123456789012345678/fake-webhook-token-for-tests-only-0000";
const TG_TOKEN = "123456789:FAKE_test_token_not_real_abcdefghijklmnop";
const TG_CHAT = "-1001234567890";
const LINE_TOKEN = "fakeLineChannelAccessToken+forTests/only=";
const LINE_TO = "U0123456789abcdef0123456789abcdef";
const SECRETS = [DISCORD, TG_TOKEN, TG_CHAT, LINE_TOKEN, LINE_TO, "fake-webhook-token-for-tests-only-0000"];
const OWNER = "Owner-alerts-Password-1";
const ORIGIN = "https://shop.example.test";
const TEN_AM_BKK = Date.UTC(2026, 10, 13, 3, 0, 0);

function fakeFetch(behavior = () => new Response(null, { status: 204 })) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return behavior(url, init);
  };
  fn.calls = calls;
  return fn;
}
const textOf = (call) => call.body.content ?? call.body.text ?? call.body.messages?.[0]?.text;

function fixture(t, { fetch = fakeFetch(), now = TEN_AM_BKK, ...extra } = {}) {
  let clockNow = now;
  const s = createCommerce({ adminPassword: OWNER, clock: () => clockNow, alertFetch: fetch, ...extra });
  t.after(() => s.db.close());
  const handle = createAPIHandler(s);
  const adminToken = s.login({ email: "admin@astra.local", password: OWNER }).token;
  const admin = s.session(adminToken);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const buyerAuth = s.register({ name: "Alert Buyer", email: "alert-buyer@example.invalid", password: "Buyer-only-Password-123" });
  const buyer = s.session(buyerAuth.token);
  s.topup(buyer, { amount: 1000, requestKey: "alert-topup-0001" });
  async function call(method, path, body, token = adminToken) {
    const res = await handle(
      new Request(ORIGIN + path, {
        method,
        headers: {
          Cookie: "astra_session=" + token,
          ...(method === "POST" ? { "Content-Type": "application/json", "X-Astra-Request": "1" } : {}),
        },
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      }),
    );
    const type = res.headers.get("Content-Type") ?? "";
    return {
      status: res.status,
      headers: res.headers,
      data: type.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer()),
    };
  }
  function product(name, logins, price = 100) {
    const p = s.saveProduct(admin, { name, description: "ทดสอบแจ้งเตือน", category: "streaming", price, active: true });
    const variantId = s.adminProductVariants(admin, p.id).variants[0].id;
    if (logins.length)
      s.importCodes(admin, { variantId, items: logins.map((loginId) => ({ loginId, password: "pw-" + loginId })) });
    return { productId: p.id, variantId };
  }
  let seq = 0;
  function buy(variantId, quantity = 1) {
    const order = s.createOrder(buyer, { variantId, quantity, requestKey: "alert-buy-" + String(++seq).padStart(4, "0") });
    return s.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  }
  return {
    s,
    admin,
    adminToken,
    buyer,
    buyerToken: buyerAuth.token,
    call,
    product,
    buy,
    fetch,
    tick: (ms) => (clockNow += ms),
    setNow: (ms) => (clockNow = ms),
  };
}
const saveAll = (f, extra = {}) =>
  f.call("POST", "/api/admin/alerts", {
    currentPassword: OWNER,
    channels: {
      discord: { enabled: true, url: DISCORD },
      telegram: { enabled: true, token: TG_TOKEN, chatId: TG_CHAT },
      line: { enabled: true, token: LINE_TOKEN, to: LINE_TO },
    },
    ...extra,
  });
const onlyDiscord = (f, events) =>
  f.call("POST", "/api/admin/alerts", {
    currentPassword: OWNER,
    channels: { discord: { enabled: true, url: DISCORD } },
    ...(events ? { events } : {}),
  });
const logRows = (s, where = "1=1") => s.db.prepare(`SELECT * FROM alert_log WHERE ${where} ORDER BY at_ms, rowid`).all();

test("alert settings: password again, stored encrypted, only the last 4 characters come back", async (t) => {
  const f = fixture(t);
  const noPassword = await f.call("POST", "/api/admin/alerts", { channels: { discord: { enabled: true, url: DISCORD } } });
  assert.equal(noPassword.status, 403);
  const wrong = await f.call("POST", "/api/admin/alerts", {
    currentPassword: "not-the-password",
    channels: { discord: { enabled: true, url: DISCORD } },
  });
  assert.equal(wrong.status, 403);
  assert.match(wrong.data.error, /รหัสผ่านไม่ถูกต้อง/);
  const customer = await f.call("GET", "/api/admin/alerts", undefined, f.buyerToken);
  assert.equal(customer.status, 403);

  const badPrefix = await f.call("POST", "/api/admin/alerts", {
    currentPassword: OWNER,
    channels: { discord: { url: "https://example.com/api/webhooks/1234567/abcdefghijklmnopqrstuvwxyz" } },
  });
  assert.equal(badPrefix.status, 400);
  assert.match(badPrefix.data.error, /discord\.com\/api\/webhooks/);
  const notConfigured = await f.call("POST", "/api/admin/alerts", { currentPassword: OWNER, channels: { line: { enabled: true } } });
  assert.equal(notConfigured.status, 400);

  const saved = await saveAll(f, { events: { refund: false } });
  assert.equal(saved.status, 200);
  const view = await f.call("GET", "/api/admin/alerts");
  const json = JSON.stringify(view.data);
  for (const secret of SECRETS) assert.ok(!json.includes(secret), "response leaks " + secret.slice(0, 12));
  assert.equal(view.data.channels.discord.masked.url, "••••0000");
  assert.equal(view.data.channels.telegram.masked.token, "••••mnop");
  assert.equal(view.data.channels.telegram.masked.chatId, "••••7890");
  assert.equal(view.data.channels.line.masked.to, "••••cdef");
  assert.equal(view.data.channels.line.enabled, true);
  assert.equal(view.data.events.refund, false);
  assert.equal(view.data.events.order_paid, true);
  assert.equal(view.data.origin, ORIGIN);

  const raw = f.s.db.prepare("SELECT value FROM alert_state WHERE key='settings'").get().value;
  for (const secret of SECRETS) assert.ok(!raw.includes(secret), "stored in plain text: " + secret.slice(0, 12));
  assert.match(JSON.parse(raw).channels.discord.url, /^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$/);
  const audit = f.s.db.prepare("SELECT detail FROM audit WHERE action='SAVE_ALERTS'").all();
  assert.equal(audit.length, 1);
  for (const secret of SECRETS) assert.ok(!audit[0].detail.includes(secret));

  // Empty secret fields keep what is saved; switching a channel off still needs the password.
  const off = await f.call("POST", "/api/admin/alerts", {
    currentPassword: OWNER,
    channels: { telegram: { enabled: false, token: "", chatId: "" } },
  });
  assert.equal(off.status, 200);
  assert.equal(off.data.channels.telegram.enabled, false);
  assert.equal(off.data.channels.telegram.configured, true);
  assert.equal(off.data.channels.telegram.masked.token, "••••mnop");
});

test("a paid order fans out to every channel with a short Thai message, an admin link and no secrets", async (t) => {
  const f = fixture(t);
  await saveAll(f);
  const { variantId } = f.product("Alert Stream Pack", ["acct-one", "acct-two", "acct-three", "acct-four", "acct-five", "acct-six"]);
  const order = f.buy(variantId);
  assert.equal(order.status, "DELIVERED");
  await f.s.alertsIdle();
  assert.equal(f.fetch.calls.length, 3);
  const byChannel = Object.fromEntries(f.fetch.calls.map((c) => [c.init.headers["X-Astra-Alert-Channel"], c]));
  assert.equal(byChannel.discord.url, DISCORD);
  assert.deepEqual(byChannel.discord.body.allowed_mentions, { parse: [] });
  assert.equal(byChannel.telegram.url, "https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage");
  assert.equal(byChannel.telegram.body.chat_id, TG_CHAT);
  assert.equal(byChannel.line.url, "https://api.line.me/v2/bot/message/push");
  assert.equal(byChannel.line.init.headers.Authorization, "Bearer " + LINE_TOKEN);
  assert.equal(byChannel.line.body.to, LINE_TO);
  for (const call of f.fetch.calls) {
    const text = textOf(call);
    assert.match(text, /^\[ร้านค้า\] ออเดอร์ใหม่ชำระแล้ว/);
    assert.match(text, /Alert Stream Pack/);
    assert.match(text, /฿1\.00/);
    assert.ok(text.includes(ORIGIN + "/admin/orders/" + order.id), "deep link");
    for (const secret of [...SECRETS, OWNER, "acct-one", "pw-acct-one"]) assert.ok(!text.includes(secret), "message leaks " + secret);
  }
  const rows = logRows(f.s);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.ok === 1 && r.status === 204 && r.event === "order_paid"));
  const view = await f.call("GET", "/api/admin/alerts");
  assert.equal(view.data.log.length, 3);
});

test("chat, assignment, refund and preorder events reach the channel; unticked events do not", async (t) => {
  const f = fixture(t);
  await onlyDiscord(f, { chat_assigned: false });
  f.s.openChatThread(f.buyer, { body: "ขอรหัสผ่านใหม่ password123" });
  const thread = f.s.chatThreads(f.admin)[0];
  f.s.assignChatThread(f.admin, thread.id, { assigneeId: f.admin.id });
  const pre = f.s.saveProduct(f.admin, { name: "Alert Preorder", description: "พรีออเดอร์", category: "streaming", price: 200, preorder: true, active: true });
  const preVariant = f.s.adminProductVariants(f.admin, pre.id).variants[0].id;
  const reservation = f.s.createOrder(f.buyer, { variantId: preVariant, quantity: 1, requestKey: "alert-pre-0001" });
  f.s.pay(f.buyer, reservation.id, { paymentToken: reservation.paymentToken, outcome: "success" });
  const { variantId } = f.product("Alert Refund Item", ["r1", "r2", "r3", "r4", "r5"]);
  const order = f.buy(variantId);
  f.s.refundOrder(f.admin, order.id, { amount: 100, reasonCode: "OTHER", note: "ลูกค้าขอคืน", destination: "CREDIT", requestKey: "alert-refund-0001" });
  await f.s.alertsIdle();
  const texts = f.fetch.calls.map(textOf);
  assert.ok(texts.some((x) => x.includes("ลูกค้าส่งข้อความใหม่ในแชท") && x.includes("Alert Buyer")));
  assert.ok(!texts.some((x) => x.includes("password123")), "chat text stays in the shop");
  assert.ok(!texts.some((x) => x.includes("มอบหมายแชท")), "chat_assigned is unticked");
  assert.ok(texts.some((x) => x.includes("พรีออเดอร์ใหม่ชำระแล้ว (คิว #1)") && x.includes("/admin/preorders")));
  assert.ok(texts.some((x) => x.includes("คืนเงินแล้ว") && x.includes("฿1.00") && x.includes("/admin/orders/" + order.id)));
});

test("a failing channel never fails the order and the error is logged without secrets", async (t) => {
  let mode = "throw";
  const fetch = fakeFetch(() => {
    if (mode === "throw") throw new Error("connect ECONNREFUSED to " + TG_TOKEN);
    return new Response("bad token " + LINE_TOKEN, { status: 401 });
  });
  const f = fixture(t, { fetch });
  await saveAll(f);
  const { variantId } = f.product("Alert Fail Item", ["f1", "f2", "f3", "f4", "f5", "f6", "f7"]);
  const first = f.buy(variantId);
  assert.equal(first.status, "DELIVERED");
  mode = "http";
  const second = f.buy(variantId);
  assert.equal(second.status, "DELIVERED");
  await f.s.alertsIdle();
  const rows = logRows(f.s);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.ok === 0 && r.error));
  assert.ok(rows.slice(3).every((r) => r.status === 401));
  for (const r of rows) for (const secret of SECRETS) assert.ok(!r.error.includes(secret), "log leaks " + secret.slice(0, 10));
  // A queued alert is dropped when the call fails (no alert for an order that did not happen).
  const before = fetch.calls.length;
  assert.throws(() => f.s.pay(f.buyer, "missing-order", { paymentToken: "x", outcome: "success" }));
  await f.s.alertsIdle();
  assert.equal(fetch.calls.length, before);
});

test("a hanging channel times out after 5 seconds and is logged", { timeout: 15000 }, async (t) => {
  const fetch = fakeFetch(
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
  );
  const f = fixture(t, { fetch });
  await onlyDiscord(f);
  const { variantId } = f.product("Alert Slow Item", ["s1", "s2", "s3", "s4", "s5"]);
  const started = Date.now();
  assert.equal(f.buy(variantId).status, "DELIVERED");
  assert.ok(Date.now() - started < 1000, "order does not wait for the alert");
  await f.s.alertsIdle();
  const [row] = logRows(f.s);
  assert.equal(row.ok, 0);
  assert.match(row.error, /หมดเวลา \(5 วินาที\)/);
});

test("rate limit: at most 30 messages per channel per 10 minutes, the rest are collapsed into the next one", async (t) => {
  const f = fixture(t);
  await onlyDiscord(f, { stock_low: false });
  const logins = Array.from({ length: 40 }, (_, i) => "rl-" + i);
  const { variantId } = f.product("Alert Burst Item", logins);
  for (let i = 0; i < ALERT_RATE_MAX + 5; i++) {
    assert.equal(f.buy(variantId).status, "DELIVERED");
    f.tick(1000);
  }
  await f.s.alertsIdle();
  assert.equal(f.fetch.calls.length, ALERT_RATE_MAX);
  assert.equal(logRows(f.s, "attempt=0").length, 5);
  const test429 = await f.call("POST", "/api/admin/alerts/test", { channel: "discord" });
  assert.equal(test429.status, 429);
  f.tick(10 * 60000);
  f.buy(variantId);
  await f.s.alertsIdle();
  assert.equal(f.fetch.calls.length, ALERT_RATE_MAX + 1);
  assert.match(textOf(f.fetch.calls.at(-1)), /\(\+5 เหตุการณ์ก่อนหน้านี้ไม่ได้ส่งเพราะเกินโควตา/);
});

test("low stock alerts once per crossing (low, then out), and again only after a restock", async (t) => {
  const f = fixture(t);
  await onlyDiscord(f, { order_paid: false });
  const { variantId } = f.product("Alert Stock Item", ["k1", "k2", "k3", "k4", "k5"]);
  const stockTexts = async () => {
    await f.s.alertsIdle();
    return f.fetch.calls.map(textOf).filter((x) => x.includes("สต็อก"));
  };
  f.buy(variantId); // 4 left: fine
  assert.equal((await stockTexts()).length, 0);
  f.buy(variantId); // 3 left: low (threshold 3)
  f.buy(variantId); // 2 left: still low, no repeat
  f.buy(variantId); // 1 left
  let texts = await stockTexts();
  assert.equal(texts.length, 1);
  assert.match(texts[0], /สต็อกใกล้หมด\nAlert Stock Item .* เหลือ 3 ชิ้น/);
  f.buy(variantId); // 0 left: out
  texts = await stockTexts();
  assert.equal(texts.length, 2);
  assert.match(texts[1], /สต็อกหมด\n/);
  f.s.importCodes(f.admin, { variantId, items: ["n1", "n2", "n3", "n4", "n5", "n6"].map((loginId) => ({ loginId, password: "pw-" + loginId })) });
  f.buy(variantId); // 5 left after restock: ok again, no alert
  f.buy(variantId); // 4
  assert.equal((await stockTexts()).length, 2);
  f.buy(variantId); // 3: low again — a new crossing
  assert.equal((await stockTexts()).length, 3);
});

test("test send uses the saved channel and reports the provider status", async (t) => {
  const fetch = fakeFetch((url) =>
    url.includes("telegram") ? Response.json({ ok: false, description: "Bad Request: chat not found" }, { status: 400 }) : new Response(null, { status: 204 }),
  );
  const f = fixture(t, { fetch });
  const unsaved = await f.call("POST", "/api/admin/alerts/test", { channel: "discord" });
  assert.equal(unsaved.status, 400);
  await saveAll(f);
  const ok = await f.call("POST", "/api/admin/alerts/test", { channel: "discord" });
  assert.deepEqual(ok.data, { ok: true, status: 204, error: null });
  assert.match(textOf(fetch.calls[0]), /ทดสอบการแจ้งเตือนนอกเว็บ/);
  const bad = await f.call("POST", "/api/admin/alerts/test", { channel: "telegram" });
  assert.equal(bad.data.ok, false);
  assert.equal(bad.data.status, 400);
  assert.match(bad.data.error, /chat not found/);
  const staff = await f.call("POST", "/api/admin/alerts/test", { channel: "discord" }, f.buyerToken);
  assert.equal(staff.status, 403);
});

test("daily summary goes out once after 21:00 Bangkok, lazily or from the alarm", async (t) => {
  const f = fixture(t);
  assert.equal(f.s.nextScheduledRun(TEN_AM_BKK), null, "nothing to schedule before alerts are on");
  await onlyDiscord(f, { order_paid: false, stock_low: false });
  assert.equal(f.s.nextScheduledRun(TEN_AM_BKK), Date.UTC(2026, 10, 13, 14, 0, 0));
  const { variantId } = f.product("Alert Summary Item", ["d1", "d2", "d3", "d4", "d5"], 25000);
  f.buy(variantId);
  f.buy(variantId);
  // Payment rows use the database clock; pin them to the test's Bangkok day.
  f.s.db.prepare("UPDATE payments SET created_at='2026-11-13 05:00:00', finalized_at='2026-11-13 05:00:00'").run();
  f.s.alertsTick(TEN_AM_BKK + 60000);
  await f.s.alertsIdle();
  assert.equal(f.fetch.calls.length, 0, "not before 21:00");
  const evening = Date.UTC(2026, 10, 13, 14, 30, 0);
  f.setNow(evening);
  await f.call("GET", "/api/me"); // any request triggers the lazy check
  await f.s.alertsIdle();
  assert.equal(f.fetch.calls.length, 1);
  const text = textOf(f.fetch.calls[0]);
  assert.match(text, new RegExp("สรุปยอดวันนี้ " + bangkokDay(evening)));
  assert.match(text, /ยอดขาย: ฿500\.00 จาก 2 รายการชำระ/);
  await f.s.runScheduledJobs(evening + 5 * 60000);
  f.s.alertsTick(evening + 10 * 60000);
  await f.s.alertsIdle();
  assert.equal(f.fetch.calls.length, 1, "once per day");
  await f.s.runScheduledJobs(evening + 86400000);
  assert.equal(f.fetch.calls.length, 2, "next day again");
  assert.equal(nextBangkokHour(evening, 21), Date.UTC(2026, 10, 14, 14, 0, 0));
});

test("backup export needs the password, writes BACKUP_EXPORT and round-trips through the restore script", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-backup-"));
  const key = randomBytes(32);
  const f = fixture(t, { path: join(dir, "shop.sqlite"), key });
  t.after(() => {
    try {
      f.s.db.close();
    } catch {
      /* already closed by fixture */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
  });
  await onlyDiscord(f);
  const { variantId } = f.product("Backup Item", ["b-login-1", "b-login-2", "b-login-3"]);
  const order = f.buy(variantId);
  const image = randomFillSync(new Uint8Array(3000));
  f.s.db.prepare("INSERT INTO files(key,mime,size,bytes) VALUES(?,?,?,?)").run("img/test.png", "image/png", image.length, image);

  const noPassword = await f.call("POST", "/api/admin/backup/export", {});
  assert.equal(noPassword.status, 403);
  const customer = await f.call("POST", "/api/admin/backup/export", { currentPassword: "Buyer-only-Password-123" }, f.buyerToken);
  assert.equal(customer.status, 403);
  assert.equal(f.s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='BACKUP_EXPORT'").get().n, 0);

  const res = await f.call("POST", "/api/admin/backup/export", { currentPassword: OWNER });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/gzip");
  assert.match(res.headers.get("Content-Disposition"), /attachment; filename="asiaextra-backup-\d{8}-\d{4}Z\.json\.gz"/);
  assert.deepEqual([...res.data.slice(0, 2)], [0x1f, 0x8b]);
  assert.equal(f.s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='BACKUP_EXPORT'").get().n, 1);

  const json = JSON.parse(gunzipSync(res.data).toString("utf8"));
  assert.equal(json.format, "astra-backup");
  assert.equal(json.version, 1);
  assert.match(json.schema.latestMigration, /^011_/);
  const plain = JSON.stringify(json);
  for (const secret of [DISCORD, "b-login-1", "pw-b-login-1"]) assert.ok(!plain.includes(secret), "backup has plain " + secret);
  assert.deepEqual(json.tables.find((tb) => tb.name === "sessions").rows, [], "sessions are not exported");

  const input = join(dir, "backup.json.gz");
  const output = join(dir, "restored.sqlite");
  writeFileSync(input, res.data);
  const log = execFileSync(process.execPath, ["scripts/restore-backup.mjs", input, output], { encoding: "utf8" });
  assert.match(log, /Integrity check:  ok/);
  assert.throws(() => execFileSync(process.execPath, ["scripts/restore-backup.mjs", input, output], { stdio: "pipe" }), /already exists/);

  const restored = new DatabaseSync(output, { readOnly: true });
  for (const table of ["users", "orders", "inventory", "ledger", "payments", "audit", "alert_state", "alert_log", "files", "schema_migrations"]) {
    // The BACKUP_EXPORT audit row is written once the snapshot is taken, so it is not inside.
    const where = table === "audit" ? " WHERE action<>'BACKUP_EXPORT'" : "";
    const a = f.s.db.prepare(`SELECT * FROM ${table}${where} ORDER BY rowid`).all();
    const b = restored.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    assert.ok(a.length > 0, table + " has rows");
    assert.deepEqual(b, a, table + " restored exactly");
  }
  const triggers = restored.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all().map((r) => r.name);
  assert.ok(triggers.includes("audit_append_only_delete"));
  restored.close();

  // With the same key the restored file is a working shop: the buyer still sees the account.
  const shop2 = createCommerce({ path: output, key, adminPassword: OWNER });
  t.after(() => shop2.db.close());
  const buyer2 = shop2.session(shop2.login({ email: "alert-buyer@example.invalid", password: "Buyer-only-Password-123" }).token);
  const detail = shop2.orderDetail(buyer2, order.id);
  assert.equal(detail.credentials[0].loginId, "b-login-1");
});

function fakeBucket() {
  const objects = new Map();
  const multipart = [];
  return {
    objects,
    multipart,
    async put(key, body, opts) {
      objects.set(key, { body: new Uint8Array(body), uploaded: new Date(), opts });
    },
    async createMultipartUpload(key) {
      const parts = [];
      multipart.push({ key, parts });
      return {
        async uploadPart(n, body) {
          parts.push(new Uint8Array(body));
          return { partNumber: n, etag: "e" + n };
        },
        async complete() {
          const total = parts.reduce((a, p) => a + p.byteLength, 0);
          const out = new Uint8Array(total);
          let o = 0;
          for (const p of parts) {
            out.set(p, o);
            o += p.byteLength;
          }
          objects.set(key, { body: out, uploaded: new Date() });
        },
        async abort() {},
      };
    },
    async list({ prefix }) {
      return {
        objects: [...objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, uploaded: o.uploaded })),
        truncated: false,
      };
    },
    async delete(keys) {
      for (const k of [].concat(keys)) objects.delete(k);
    },
  };
}

test("automatic R2 backup: off without the binding, daily with it, keeps 14 days, multipart for big files", async (t) => {
  const plain = fixture(t);
  assert.equal(plain.s.backupStatus(plain.admin).r2, false);
  assert.equal(plain.s.nextScheduledRun(TEN_AM_BKK), null);
  assert.deepEqual(await plain.s.runScheduledJobs(TEN_AM_BKK), { backup: null });

  const morning = Date.UTC(2026, 10, 13, 0, 0, 0); // 07:00 Bangkok
  const bucket = fakeBucket();
  bucket.objects.set("backups/asiaextra-backup-old.json.gz", { body: new Uint8Array(1), uploaded: new Date(morning - 20 * 86400000) });
  bucket.objects.set("backups/asiaextra-backup-recent.json.gz", { body: new Uint8Array(1), uploaded: new Date(morning - 2 * 86400000) });
  bucket.objects.set("uploads/keep-me.png", { body: new Uint8Array(1), uploaded: new Date(0) });
  const f = fixture(t, { backups: bucket, now: morning });
  assert.equal(f.s.nextScheduledRun(morning), nextBangkokHour(morning, 4));
  assert.equal(f.s.nextScheduledRun(morning), Date.UTC(2026, 10, 13, 21, 0, 0));
  const big = randomFillSync(new Uint8Array(9 * 1024 * 1024));
  f.s.db.prepare("INSERT INTO files(key,mime,size,bytes) VALUES(?,?,?,?)").run("img/big.png", "image/png", big.length, big);
  const first = await f.s.runScheduledJobs(morning);
  assert.equal(first.backup.ok, true, first.backup.error);
  assert.equal(first.backup.deleted, 1);
  assert.ok(!bucket.objects.has("backups/asiaextra-backup-old.json.gz"));
  assert.ok(bucket.objects.has("backups/asiaextra-backup-recent.json.gz"));
  assert.ok(bucket.objects.has("uploads/keep-me.png"));
  assert.equal(bucket.multipart.length, 1, "over 8 MB goes multipart");
  const sizes = bucket.multipart[0].parts.map((p) => p.byteLength);
  assert.ok(sizes.slice(0, -1).every((n) => n === 8 * 1024 * 1024));
  const stored = bucket.objects.get(first.backup.key).body;
  const db = new DatabaseSync(":memory:");
  restoreBackup(db, JSON.parse(gunzipSync(stored).toString("utf8")));
  assert.deepEqual(new Uint8Array(db.prepare("SELECT bytes FROM files WHERE key='img/big.png'").get().bytes), big);
  db.close();
  const again = await f.s.runScheduledJobs(morning + 3600000);
  assert.equal(again.backup, null, "one backup per Bangkok day");
  const status = f.s.backupStatus(f.admin);
  assert.equal(status.r2, true);
  assert.equal(status.last.ok, true);
  assert.equal(status.retentionDays, 14);

  // Admin "back up to R2 now": password again, audited; refused when R2 is not bound.
  const noPassword = await f.call("POST", "/api/admin/backup/run", {});
  assert.equal(noPassword.status, 403);
  const now = await f.call("POST", "/api/admin/backup/run", { currentPassword: OWNER });
  assert.equal(now.status, 200);
  assert.equal(now.data.result.ok, true);
  assert.equal(f.s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='BACKUP_R2_RUN'").get().n, 1);
  const unbound = await plain.call("POST", "/api/admin/backup/run", { currentPassword: OWNER });
  assert.equal(unbound.status, 409);
  assert.match(unbound.data.error, /ยังไม่ได้ตั้งค่าที่เก็บสำรอง \(R2\)/);
});
