// Basic fraud signals + email blocklist (server/fraud.mjs) and editable email templates
// (server/email-templates.mjs). Fake mailer and fake alert fetch; nothing leaves the machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { domainSuffixes, isPrivateIp, BLOCKED_LOGIN, BLOCKED_REGISTER } from "../server/fraud.mjs";
import {
  EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_KEYS,
  TEST_SEND_PER_HOUR,
  renderTemplate,
  validateTemplate,
} from "../server/email-templates.mjs";

const BASE = "https://shop.example.com";
const PASSWORD = "Buyer-only-Password-123";
const ADMIN_PASSWORD = "Admin-only-Password-123";
const HOUR = 3600000;

function fakeMailer() {
  const sent = [];
  return {
    sent,
    enabled: true,
    provider: "test",
    from: "shop@mail.example.com",
    async send(message) {
      sent.push(message);
      return { id: "msg-" + sent.length };
    },
  };
}

function shop(t, options = {}) {
  let now = Date.UTC(2026, 10, 13, 3, 0, 0);
  const s = createCommerce({ adminPassword: ADMIN_PASSWORD, clock: () => now, ...options });
  t.after(async () => {
    await s.emailIdle();
    await s.alertsIdle();
    s.db.close();
  });
  const handle = createAPIHandler(s);
  let ipSeq = 0;
  async function call(method, path, { cookie, body, ip } = {}) {
    const headers = { Cookie: cookie ?? "" };
    // Default: a different public /24 per request, so the signup rule stays quiet.
    ipSeq += 1;
    headers["CF-Connecting-IP"] = ip ?? "198.51." + (ipSeq % 250) + "." + 7;
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      headers["X-Astra-Request"] = "1";
    }
    const res = await handle(
      new Request(BASE + path, {
        method,
        headers,
        body: method === "GET" || body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const token = /astra_session=([a-f0-9]+)/.exec(res.headers.get("Set-Cookie") ?? "")?.[1];
    return { status: res.status, body: await res.json(), cookie: token ? "astra_session=" + token : undefined };
  }
  const admin = s.session(s.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token);
  const adminCookie = "astra_session=" + s.login({ email: "admin@astra.local", password: ADMIN_PASSWORD }).token;
  return {
    s,
    admin,
    adminCookie,
    advance: (ms) => (now += ms),
    call,
    get: (path, cookie) => call("GET", path, { cookie }),
    post: (path, body, opts = {}) => call("POST", path, { body, ...opts }),
  };
}
function buyer(s, email = "buyer" + Math.random().toString(16).slice(2, 8) + "@mail.example.com") {
  return s.session(s.register({ name: "ลูกค้า ทดสอบ", email, password: PASSWORD }).token);
}
/** A ready product with `stock` units at `price` satang. */
function product(api, { stock = 10, price = 1000, name = "Fraud Test Item" } = {}) {
  const { s, admin } = api;
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const p = s.saveProduct(admin, { name, description: "ทดสอบ", category: "streaming", price, active: true });
  const variantId = s.adminProductVariants(admin, p.id).variants[0].id;
  s.importCodes(admin, {
    variantId,
    items: Array.from({ length: stock }, (_, i) => ({ loginId: name + "-login-" + i, password: "pw-" + i + "-secret" })),
  });
  return variantId;
}
let keySeq = 0;
function buy(s, user, variantId, outcome = "success") {
  const order = s.createOrder(user, { variantId, quantity: 1, requestKey: "fraud-req-" + ++keySeq + "-" + Date.now() });
  return s.pay(user, order.id, { paymentToken: order.paymentToken, outcome });
}
const signals = (s, rule) => s.db.prepare("SELECT * FROM fraud_signals WHERE rule=? ORDER BY at_ms").all(rule);
const adminNotices = (s, admin) =>
  s.db.prepare("SELECT * FROM notifications WHERE user_id=? AND kind='fraud_signal'").all(admin.id);
function staffUser(api, email = "staff@mail.example.com") {
  const user = buyer(api.s, email);
  api.s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, user.id);
  return { user: api.s.session(api.s.login({ email, password: PASSWORD }).token), email };
}

// ---------------------------------------------------------------- fraud rules

test("paid_orders: flags at the threshold once per window, notifies admins once, never suspends", (t) => {
  const api = shop(t);
  const { s, admin } = api;
  const variantId = product(api, { stock: 12 });
  const user = buyer(s);
  for (let i = 0; i < 5; i += 1) assert.equal(buy(s, user, variantId).status, "DELIVERED");
  assert.equal(signals(s, "paid_orders").length, 0, "5 orders: below the default 6");
  buy(s, user, variantId);
  const [signal] = signals(s, "paid_orders");
  assert.ok(signal, "6th paid order raises a signal");
  assert.equal(signal.user_id, user.id);
  assert.equal(signal.value, 6);
  assert.equal(signal.threshold, 6);
  assert.equal(signal.status, "OPEN");
  buy(s, user, variantId);
  buy(s, user, variantId);
  const after = signals(s, "paid_orders");
  assert.equal(after.length, 1, "deduped inside the window");
  assert.equal(after[0].hits, 3);
  assert.equal(after[0].value, 8);
  assert.equal(adminNotices(s, admin).length, 1, "one admin notification per signal");
  assert.equal(adminNotices(s, admin)[0].link, "/admin/fraud");
  // Flag only: the account keeps working.
  assert.equal(s.db.prepare("SELECT COALESCE(status,'ACTIVE') AS st FROM users WHERE id=?").get(user.id).st, "ACTIVE");
  // Another buyer has their own subject.
  const other = buyer(s);
  buy(s, other, variantId);
  assert.equal(signals(s, "paid_orders").length, 1);
});

test("paid_amount: flags when the baht total in the window reaches the threshold", (t) => {
  const api = shop(t);
  const { s, admin } = api;
  s.adminSaveFraudSettings(admin, { rules: { paid_amount: { threshold: 25 } } });
  const variantId = product(api, { stock: 5, price: 1000 }); // 10 baht each
  const user = buyer(s);
  buy(s, user, variantId);
  buy(s, user, variantId);
  assert.equal(signals(s, "paid_amount").length, 0, "20 baht < 25");
  buy(s, user, variantId);
  const [signal] = signals(s, "paid_amount");
  assert.equal(signal.value, 30);
  assert.equal(signal.threshold, 25);
});

test("failed_payments: threshold, dedupe inside the window, a new signal after it", (t) => {
  const api = shop(t);
  const { s, admin } = api;
  const variantId = product(api, { stock: 2 });
  const user = buyer(s);
  for (let i = 0; i < 4; i += 1) assert.equal(buy(s, user, variantId, "failure").status, "FAILED");
  assert.equal(signals(s, "failed_payments").length, 0);
  buy(s, user, variantId, "failure");
  assert.equal(signals(s, "failed_payments").length, 1);
  buy(s, user, variantId, "failure");
  assert.equal(signals(s, "failed_payments").length, 1, "same window: no second signal");
  assert.equal(signals(s, "failed_payments")[0].hits, 2);
  // An hour later the old failures are outside the window: 4 new ones are not enough …
  api.advance(HOUR + 1000);
  for (let i = 0; i < 4; i += 1) buy(s, user, variantId, "failure");
  assert.equal(signals(s, "failed_payments").length, 1);
  // … the 5th is, and it is a new signal (the old one is out of its window).
  buy(s, user, variantId, "failure");
  assert.equal(signals(s, "failed_payments").length, 2);
  assert.equal(adminNotices(s, admin).length, 2);
});

test("a disabled rule never flags; settings validate and need ADMIN", async (t) => {
  const api = shop(t);
  const { s, admin } = api;
  const saved = s.adminSaveFraudSettings(admin, { rules: { failed_payments: { enabled: false } } });
  assert.equal(saved.settings.rules.find((r) => r.key === "failed_payments").enabled, false);
  const variantId = product(api, { stock: 1 });
  const user = buyer(s);
  for (let i = 0; i < 6; i += 1) buy(s, user, variantId, "failure");
  assert.equal(signals(s, "failed_payments").length, 0);

  assert.throws(() => s.adminSaveFraudSettings(admin, { rules: { paid_orders: { threshold: 0 } } }), /เกณฑ์/);
  assert.throws(() => s.adminSaveFraudSettings(admin, { rules: { paid_orders: { windowHours: 721 } } }), /ช่วงเวลา/);
  assert.throws(() => s.adminSaveFraudSettings(admin, { rules: { paid_orders: { enabled: "yes" } } }), /สถานะ/);
  const staff = staffUser(api);
  assert.throws(() => s.adminSaveFraudSettings(staff.user, { rules: {} }), (e) => e.status === 403);
  assert.throws(() => s.adminFraud(staff.user), (e) => e.status === 403);
  assert.throws(() => s.adminFraud(user), (e) => e.status === 403);
  const audit = s.db.prepare("SELECT detail FROM audit WHERE action='FRAUD_SETTINGS'").all();
  assert.equal(audit.length, 1, "only the successful save is audited");
  assert.deepEqual(JSON.parse(audit[0].detail).changed.failed_payments.enabled, false);
  // HTTP: customers and staff get 403, guests 401.
  assert.equal((await api.get("/api/admin/fraud")).status, 401);
  const login = await api.post("/api/login", { email: staff.email, password: PASSWORD });
  assert.equal((await api.get("/api/admin/fraud", login.cookie)).status, 403);
  assert.equal((await api.post("/api/admin/fraud/settings", { rules: {} }, { cookie: login.cookie })).status, 403);
  const ok = await api.get("/api/admin/fraud?status=all", api.adminCookie);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.settings.rules.length, 5);
});

test("issue_reports: reports opened from the order page count per customer", async (t) => {
  const api = shop(t);
  const { s } = api;
  const variantId = product(api, { stock: 4 });
  const user = buyer(s);
  const orders = [buy(s, user, variantId), buy(s, user, variantId)];
  s.openChatThread(user, { body: "เข้าไม่ได้", orderId: orders[0].id, reportReason: "cannot_login" });
  const thread = s.chatThreads(user)[0] ?? s.chatThreads(user).threads?.[0];
  assert.ok(thread);
  s.postChatMessage(user, thread.id, { body: "ยังเข้าไม่ได้", orderId: orders[1].id, reportReason: "wrong_password" });
  // A plain message is not a report.
  s.postChatMessage(user, thread.id, { body: "สวัสดีครับ" });
  assert.equal(signals(s, "issue_reports").length, 0, "2 reports < 3");
  s.postChatMessage(user, thread.id, { body: "รหัสถูกเปลี่ยน", orderId: orders[0].id, reportReason: "password_changed" });
  const [signal] = signals(s, "issue_reports");
  assert.equal(signal.value, 3);
  assert.equal(signal.user_id, user.id);
  // A rejected report (bad reason) is not counted.
  assert.throws(() => s.postChatMessage(user, thread.id, { body: "x", orderId: orders[1].id, reportReason: "bogus" }));
  assert.equal(signals(s, "issue_reports")[0].hits, 1);
});

test("signup_ip: many accounts from one masked prefix; private IPs and other prefixes never count", async (t) => {
  const api = shop(t);
  const { s } = api;
  for (let i = 1; i <= 4; i += 1) {
    const r = await api.post("/api/register", { name: "สมัคร " + i, email: "ip" + i + "@mail.example.com", password: PASSWORD }, { ip: "203.0.113." + i });
    assert.equal(r.status, 200);
  }
  for (let i = 1; i <= 6; i += 1)
    await api.post("/api/register", { name: "ภายใน " + i, email: "lan" + i + "@mail.example.com", password: PASSWORD }, { ip: "10.0.0." + i });
  await api.post("/api/register", { name: "อื่น", email: "other@mail.example.com", password: PASSWORD }, { ip: "203.0.114.9" });
  assert.equal(signals(s, "signup_ip").length, 0);
  await api.post("/api/register", { name: "สมัคร 5", email: "ip5@mail.example.com", password: PASSWORD }, { ip: "203.0.113.200" });
  const [signal] = signals(s, "signup_ip");
  assert.ok(signal);
  assert.equal(signal.ip_masked, "203.0.113.0/24");
  assert.equal(signal.subject, "ip:203.0.113.0/24");
  assert.equal(signal.value, 5);
  assert.equal(JSON.parse(signal.detail).accounts.length, 5);
  // Only the masked prefix is stored anywhere in the fraud tables.
  const blob = JSON.stringify(s.db.prepare("SELECT * FROM fraud_events").all()) + JSON.stringify(signals(s, "signup_ip"));
  assert.ok(!blob.includes("203.0.113.200"));
  assert.ok(!blob.includes("10.0.0."));
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("172.20.1.1"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
});

test("a broken fraud table never fails checkout", (t) => {
  const api = shop(t);
  const { s } = api;
  const variantId = product(api, { stock: 8 });
  s.db.exec("DROP TABLE fraud_signals");
  s.db.exec("DROP TABLE fraud_events");
  s.db.exec("DROP TABLE fraud_blocks");
  const user = buyer(s);
  for (let i = 0; i < 7; i += 1) assert.equal(buy(s, user, variantId).status, "DELIVERED");
  assert.equal(buy(s, user, variantId, "failure").status, "FAILED");
});

test("review: mark reviewed with a note, filter open / reviewed, audited", async (t) => {
  const api = shop(t);
  const { s, admin } = api;
  const variantId = product(api, { stock: 2 });
  const user = buyer(s);
  for (let i = 0; i < 5; i += 1) buy(s, user, variantId, "failure");
  const open = s.adminFraud(admin, { status: "open" });
  assert.equal(open.counts.open, 1);
  assert.equal(open.signals[0].customer.id, user.id);
  assert.equal(open.signals[0].label, "ชำระเงินไม่สำเร็จบ่อย");
  assert.equal(s.adminFraud(admin, { status: "reviewed" }).signals.length, 0);
  assert.throws(() => s.adminReviewFraudSignal(admin, open.signals[0].id, { note: "x".repeat(301) }), /300/);
  const reviewed = s.adminReviewFraudSignal(admin, open.signals[0].id, { note: "โทรคุยแล้ว บัตรมีปัญหา" });
  assert.equal(reviewed.signal.status, "REVIEWED");
  assert.equal(reviewed.signal.note, "โทรคุยแล้ว บัตรมีปัญหา");
  assert.equal(reviewed.signal.reviewedBy, "ผู้ดูแลร้าน");
  assert.throws(() => s.adminReviewFraudSignal(admin, open.signals[0].id, {}), (e) => e.status === 409);
  assert.throws(() => s.adminReviewFraudSignal(admin, "missing-id", {}), (e) => e.status === 404);
  const lists = s.adminFraud(admin, { status: "reviewed" });
  assert.equal(lists.signals.length, 1);
  assert.equal(lists.counts.reviewed, 1);
  assert.equal(s.adminFraud(admin, { status: "open" }).signals.length, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='FRAUD_SIGNAL_REVIEWED'").get().n, 1);
  // Suspend from the signal reuses the normal status change (and its audit).
  s.adminSetCustomerStatus(admin, user.id, { status: "SUSPENDED", reason: "สัญญาณผิดปกติ" });
  assert.equal(s.adminFraud(admin, { status: "all" }).signals[0].customer.status, "SUSPENDED");
  // HTTP review route
  const second = buyer(s, "second@mail.example.com");
  for (let i = 0; i < 5; i += 1) buy(s, second, variantId, "failure");
  const id = s.adminFraud(admin, { status: "open" }).signals[0].id;
  const viaHttp = await api.post("/api/admin/fraud/signals/" + id + "/review", { note: "" }, { cookie: api.adminCookie });
  assert.equal(viaHttp.status, 200, JSON.stringify(viaHttp.body));
  assert.equal(viaHttp.body.signal.note, null);
});

test("a fraud signal goes out through the outside alerts with a masked email only", async (t) => {
  const calls = [];
  const api = shop(t, {
    alertFetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response("", { status: 204 });
    },
  });
  const { s, admin } = api;
  s.saveAlertSettings(admin, {
    currentPassword: ADMIN_PASSWORD,
    channels: {
      discord: {
        enabled: true,
        url: "https://discord.com/api/webhooks/123456789012345678/fake-webhook-token-for-unit-test-0000",
      },
    },
    events: { order_paid: false, stock_low: false },
  });
  const variantId = product(api, { stock: 2 });
  const user = buyer(s, "fraudster.person@mail.example.com");
  for (let i = 0; i < 5; i += 1) buy(s, user, variantId, "failure");
  await s.alertsIdle();
  const text = calls.map((c) => c.body.content).join("\n");
  assert.match(text, /สัญญาณผิดปกติ: ชำระเงินไม่สำเร็จบ่อย/);
  assert.match(text, /fr\*\*\*@mail\.example\.com/);
  assert.ok(!text.includes("fraudster.person@"), "never the full email");
  assert.equal(calls.filter((c) => c.body.content.includes("สัญญาณผิดปกติ")).length, 1);
});

// ---------------------------------------------------------------- blocklist

test("blocklist: email and domain block register + login until expiry; lift early; staff never blocked", async (t) => {
  const api = shop(t);
  const { s, admin } = api;
  buyer(s, "victim@mail.example.com");
  buyer(s, "someone@bad.example.net");
  const r1 = await api.post("/api/admin/fraud/blocks", { kind: "EMAIL", value: "Victim@Mail.Example.com", hours: 24, reason: "สมัครถี่" }, { cookie: api.adminCookie });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.block.value, "victim@mail.example.com");
  const login = await api.post("/api/login", { email: "victim@mail.example.com", password: PASSWORD });
  assert.equal(login.status, 403);
  assert.equal(login.body.error, BLOCKED_LOGIN);
  const other = await api.post("/api/login", { email: "someone@bad.example.net", password: PASSWORD });
  assert.equal(other.status, 200, "not blocked yet");

  const r2 = await api.post("/api/admin/fraud/blocks", { kind: "DOMAIN", value: "@example.net", hours: 2 }, { cookie: api.adminCookie });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(r2.body.block.value, "example.net");
  assert.equal((await api.post("/api/login", { email: "someone@bad.example.net", password: PASSWORD })).status, 403, "sub-domain covered");
  const reg = await api.post("/api/register", { name: "ใหม่", email: "new@example.net", password: PASSWORD });
  assert.equal(reg.status, 403);
  assert.equal(reg.body.error, BLOCKED_REGISTER);
  assert.equal((await api.post("/api/register", { name: "ใหม่", email: "new@example.org", password: PASSWORD })).status, 200);

  // Expiry: the domain block (2 h) ends by itself; the email block (24 h) still holds.
  api.advance(2 * HOUR + 1000);
  assert.equal((await api.post("/api/register", { name: "ใหม่", email: "new@example.net", password: PASSWORD })).status, 200);
  assert.equal((await api.post("/api/login", { email: "victim@mail.example.com", password: PASSWORD })).status, 403);
  // Lift early (admin sessions idle out after 2 h: sign in again).
  const adminCookie = (await api.post("/api/login", { email: "admin@astra.local", password: ADMIN_PASSWORD })).cookie;
  const listed = (await api.get("/api/admin/fraud", adminCookie)).body.blocks;
  assert.equal(listed.length, 1, "expired blocks drop off the list");
  const lifted = await api.call("DELETE", "/api/admin/fraud/blocks/" + listed[0].id, { cookie: adminCookie });
  assert.equal(lifted.status, 200);
  assert.equal(lifted.body.block.active, false);
  assert.equal((await api.post("/api/login", { email: "victim@mail.example.com", password: PASSWORD })).status, 200);
  assert.equal((await api.call("DELETE", "/api/admin/fraud/blocks/" + listed[0].id, { cookie: adminCookie })).status, 409);

  // Staff and the owner cannot be blocked, and STAFF cannot block.
  const staff = staffUser(api, "helper@team.example.com");
  assert.throws(() => s.adminBlockEmail(admin, { kind: "EMAIL", value: "admin@astra.local", hours: 1 }), /ทีมงาน/);
  assert.throws(() => s.adminBlockEmail(admin, { kind: "DOMAIN", value: "team.example.com", hours: 1 }), /ทีมงาน/);
  assert.throws(() => s.adminBlockEmail(staff.user, { kind: "EMAIL", value: "x@mail.example.com", hours: 1 }), (e) => e.status === 403);
  // Validation.
  assert.throws(() => s.adminBlockEmail(admin, { kind: "EMAIL", value: "not-an-email", hours: 1 }), /อีเมล/);
  assert.throws(() => s.adminBlockEmail(admin, { kind: "DOMAIN", value: "com", hours: 1 }), /โดเมน/);
  assert.throws(() => s.adminBlockEmail(admin, { kind: "EMAIL", value: "a@b.example.com", hours: 0 }), /ระยะเวลา/);
  assert.throws(() => s.adminBlockEmail(admin, { kind: "EMAIL", value: "a@b.example.com", hours: 24 * 91 }), /ระยะเวลา/);
  assert.throws(() => s.adminBlockEmail(admin, { kind: "PHONE", value: "a@b.example.com", hours: 1 }), /อีเมลหรือโดเมน/);
  // Audit: masked email, never the full address.
  const audit = s.db.prepare("SELECT action, detail FROM audit WHERE action IN ('FRAUD_BLOCK','FRAUD_UNBLOCK') ORDER BY rowid").all();
  assert.deepEqual(audit.map((a) => a.action), ["FRAUD_BLOCK", "FRAUD_BLOCK", "FRAUD_UNBLOCK"]);
  assert.ok(!audit.map((a) => a.detail).join().includes("victim@"));
  assert.deepEqual(domainSuffixes("a@x.mail.example.com"), ["x.mail.example.com", "mail.example.com", "example.com"]);
});

// ---------------------------------------------------------------- email templates

test("validateTemplate: unknown placeholders, required reset link, one-line subject, lengths", () => {
  const base = EMAIL_TEMPLATES.order_confirmed.defaults;
  for (const key of EMAIL_TEMPLATE_KEYS) assert.deepEqual(validateTemplate(key, EMAIL_TEMPLATES[key].defaults), EMAIL_TEMPLATES[key].defaults, key);
  assert.throws(() => validateTemplate("order_confirmed", { ...base, body: "สวัสดี {ชื่อลูกค้า} {ลิงค์ออเดอร์}" }), /ไม่รู้จัก \{ลิงค์ออเดอร์\}/);
  assert.throws(() => validateTemplate("order_confirmed", { ...base, subject: "{ลิงก์รีเซ็ต}" }), /ไม่รู้จัก/);
  assert.throws(() => validateTemplate("password_reset", { subject: "s", heading: "h", body: "ไม่มีลิงก์" }), /\{ลิงก์รีเซ็ต\}/);
  assert.throws(() => validateTemplate("broadcast", { subject: "s", heading: "h", body: "ไม่มีข้อความ" }), /\{ข้อความประกาศ\}/);
  assert.throws(() => validateTemplate("order_confirmed", { ...base, subject: "a\nb" }), /บรรทัดเดียว/);
  assert.throws(() => validateTemplate("order_confirmed", { ...base, body: "   " }), /กรุณากรอก/);
  assert.throws(() => validateTemplate("order_confirmed", { ...base, body: "x".repeat(4001) }), /ยาวเกิน/);
  assert.throws(() => validateTemplate("nope", base), /ไม่พบ/);
  // Plain braces that are not placeholders-looking ({ alone) are fine.
  assert.equal(validateTemplate("order_confirmed", { ...base, body: "ราคา { พิเศษ" }).body, "ราคา { พิเศษ");
});

test("renderTemplate escapes every value and the admin text; only server URLs become links", () => {
  const custom = {
    subject: "สวัสดี {ชื่อลูกค้า} <b>ด่วน</b>",
    heading: "คำสั่งซื้อ {เลขออเดอร์}",
    body: "<script>alert(1)</script> เปิด {ลิงก์ออเดอร์} หรือ https://evil.example.com/x\nสินค้า: {สินค้า}",
  };
  const mail = renderTemplate(
    "order_confirmed",
    {
      shopName: "<i>ร้าน</i>",
      customerName: '<img src=x onerror="a">',
      orderNumber: "AB12CD34",
      product: "{ชื่อลูกค้า} & <u>Pack</u>",
      quantity: 1,
      total: 15000,
      link: BASE + "/orders/abc?x=1&y=2",
    },
    validateTemplate("order_confirmed", custom),
  );
  assert.equal(mail.subject, 'สวัสดี <img src=x onerror="a"> <b>ด่วน</b>', "subject is plain text");
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.html.includes("&lt;script&gt;"));
  assert.ok(!mail.html.includes("<img"));
  assert.ok(!mail.html.includes("<u>"));
  assert.ok(!mail.html.includes("<i>ร้าน"));
  assert.ok(mail.html.includes('<a href="' + BASE + '/orders/abc?x=1&amp;y=2"'), "server link is a link");
  assert.ok(!mail.html.includes('href="https://evil.example.com'), "admin-typed URL stays text");
  assert.ok(mail.html.includes("{ชื่อลูกค้า} &amp; &lt;u&gt;Pack"), "values are never filled twice");
  assert.ok(mail.text.includes("<script>alert(1)</script>"), "plain-text part keeps the raw text");
  assert.ok(mail.text.includes("150.00 บาท"));
  assert.ok(mail.text.includes(BASE + "/orders/abc?x=1&y=2"));
});

test("saved templates are used for real emails; reset to default restores them; audited", async (t) => {
  const mailer = fakeMailer();
  const api = shop(t, { email: mailer });
  const { s, admin } = api;
  const variantId = product(api, { stock: 3, name: "Mail Item" });
  const saved = await api.call("PATCH", "/api/admin/email-templates/order_confirmed", {
    cookie: api.adminCookie,
    body: { subject: "ขอบคุณ {ชื่อลูกค้า} · #{เลขออเดอร์}", heading: "ได้รับเงินแล้ว", body: "สวัสดีคุณ {ชื่อลูกค้า}\nดูได้ที่ {ลิงก์ออเดอร์}" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.template.customized, true);
  const user = buyer(s, "mailbuyer@mail.example.com");
  const paid = buy(s, user, variantId);
  await s.emailIdle();
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].subject, "ขอบคุณ ลูกค้า ทดสอบ · #" + paid.id.slice(0, 8).toUpperCase());
  assert.ok(mailer.sent[0].text.includes("สวัสดีคุณ ลูกค้า ทดสอบ"));
  assert.ok(mailer.sent[0].text.includes("/orders/" + paid.id));
  assert.ok(!JSON.stringify(mailer.sent).includes("pw-0-secret"), "no credentials");

  const unknown = await api.call("PATCH", "/api/admin/email-templates/order_confirmed", {
    cookie: api.adminCookie,
    body: { subject: "x", heading: "y", body: "{รหัสผ่าน}" },
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /ไม่รู้จัก \{รหัสผ่าน\}/);
  const noLink = await api.call("PATCH", "/api/admin/email-templates/password_reset", {
    cookie: api.adminCookie,
    body: { subject: "x", heading: "y", body: "ไม่มีลิงก์" },
  });
  assert.equal(noLink.status, 400);

  const reset = await api.call("DELETE", "/api/admin/email-templates/order_confirmed", { cookie: api.adminCookie });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.template.customized, false);
  assert.equal(reset.body.template.subject, EMAIL_TEMPLATES.order_confirmed.defaults.subject);
  buy(s, user, variantId);
  await s.emailIdle();
  assert.match(mailer.sent[1].subject, /^ยืนยันคำสั่งซื้อ #/);
  const audit = s.db.prepare("SELECT action FROM audit WHERE action LIKE 'EMAIL_TEMPLATE_%' ORDER BY rowid").all();
  assert.deepEqual(audit.map((a) => a.action), ["EMAIL_TEMPLATE_SAVE", "EMAIL_TEMPLATE_RESET"]);
  assert.equal(s.adminEmailTemplates(admin).templates.length, EMAIL_TEMPLATE_KEYS.length);
  assert.equal((await api.get("/api/admin/email-templates/nope", api.adminCookie)).status, 404);
});

test("custom password-reset template still carries a working link", async (t) => {
  const mailer = fakeMailer();
  const api = shop(t, { email: mailer });
  const { s, admin } = api;
  s.adminSaveEmailTemplate(admin, "password_reset", {
    subject: "รีเซ็ตรหัส {ชื่อร้าน}",
    heading: "สวัสดี {ชื่อลูกค้า}",
    body: "กดลิงก์นี้ภายใน {นาที} นาที: {ลิงก์รีเซ็ต}",
  });
  buyer(s, "forgot@mail.example.com");
  assert.equal((await api.post("/api/password/forgot", { email: "forgot@mail.example.com" })).status, 200);
  await s.emailIdle();
  const mail = mailer.sent.at(-1);
  assert.equal(mail.subject, "รีเซ็ตรหัส ASIA EXTRA");
  const token = /reset-password\?token=([a-f0-9]{64})/.exec(mail.text)?.[1];
  assert.ok(token);
  assert.equal(mail.text.split(token).length - 1, 1, "link appears once in the text part");
  assert.ok(mail.html.includes("สวัสดี ลูกค้า ทดสอบ"));
  const done = await api.post("/api/password/reset", { token, newPassword: "Brand-new-Password-9" });
  assert.equal(done.status, 200);
});

test("a stored template that no longer validates falls back to the default", async (t) => {
  const mailer = fakeMailer();
  const api = shop(t, { email: mailer });
  const { s } = api;
  s.db
    .prepare("INSERT INTO email_templates(key,subject,heading,body) VALUES(?,?,?,?)")
    .run("password_reset", "เก่า", "เก่า", "ไม่มีลิงก์ {ตัวแปรเก่า}");
  buyer(s, "fallback@mail.example.com");
  await api.post("/api/password/forgot", { email: "fallback@mail.example.com" });
  await s.emailIdle();
  assert.match(mailer.sent.at(-1).subject, /^ตั้งรหัสผ่านใหม่ — /);
  assert.match(mailer.sent.at(-1).text, /reset-password\?token=[a-f0-9]{64}/);
});

test("preview with sample data; send test needs email set up, a real admin email and stays rate limited", async (t) => {
  // No provider: preview works, test send explains.
  const plain = shop(t);
  const preview = await plain.post(
    "/api/admin/email-templates/order_confirmed/preview",
    { subject: "ทดสอบ {ชื่อลูกค้า}", heading: "หัวเรื่อง", body: "<b>{สินค้า}</b> {ลิงก์ออเดอร์}" },
    { cookie: plain.adminCookie },
  );
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.preview.subject, "ทดสอบ สมชาย ใจดี");
  assert.ok(preview.body.preview.html.includes("&lt;b&gt;บัญชีสตรีมมิง"));
  assert.ok(preview.body.preview.html.includes('<a href="' + BASE + "/orders/"));
  const bad = await plain.post("/api/admin/email-templates/order_confirmed/preview", { subject: "x", heading: "y", body: "{x}" }, { cookie: plain.adminCookie });
  assert.equal(bad.status, 400);
  const saved = await plain.post("/api/admin/email-templates/broadcast/preview", {}, { cookie: plain.adminCookie });
  assert.equal(saved.status, 200, "no draft: previews the saved / default version");
  assert.match(saved.body.preview.subject, /^โปรโมชันเดือนนี้ — /);
  const off = await plain.post("/api/admin/email-templates/order_confirmed/test", {}, { cookie: plain.adminCookie });
  assert.equal(off.status, 409);
  assert.match(off.body.error, /ยังไม่ได้ตั้งค่าระบบส่งอีเมล/);
  assert.equal(plain.s.adminEmailTemplates(plain.admin).email.enabled, false);

  // Provider on, owner account has a .local address: explain.
  const mailer = fakeMailer();
  const api = shop(t, { email: mailer });
  const ownerTry = await api.post("/api/admin/email-templates/order_confirmed/test", {}, { cookie: api.adminCookie });
  assert.equal(ownerTry.status, 400);
  // An ADMIN with a real address: queued to their own email, at most N per hour.
  const second = buyer(api.s, "owner2@mail.example.com");
  api.s.db.prepare("UPDATE users SET role='ADMIN' WHERE id=?").run(second.id);
  const cookie = (await api.post("/api/login", { email: "owner2@mail.example.com", password: PASSWORD })).cookie;
  for (let i = 0; i < TEST_SEND_PER_HOUR; i += 1) {
    const r = await api.post("/api/admin/email-templates/password_reset/test", {}, { cookie });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.to, "ow***@mail.example.com");
  }
  const limited = await api.post("/api/admin/email-templates/password_reset/test", {}, { cookie });
  assert.equal(limited.status, 429);
  await api.s.emailIdle();
  assert.equal(mailer.sent.length, TEST_SEND_PER_HOUR);
  assert.match(mailer.sent[0].subject, /^\[ทดสอบ\] ตั้งรหัสผ่านใหม่/);
  // An hour later the budget is back.
  api.s.db.prepare("UPDATE email_log SET created_at=datetime(created_at,'-2 hours') WHERE kind='template_test'").run();
  assert.equal((await api.post("/api/admin/email-templates/password_reset/test", {}, { cookie })).status, 200);
});

test("email template APIs are ADMIN only", async (t) => {
  const api = shop(t, { email: fakeMailer() });
  const staff = staffUser(api, "tplstaff@mail.example.com");
  const staffCookie = (await api.post("/api/login", { email: staff.email, password: PASSWORD })).cookie;
  const customer = buyer(api.s, "tplcustomer@mail.example.com");
  const customerCookie = (await api.post("/api/login", { email: "tplcustomer@mail.example.com", password: PASSWORD })).cookie;
  const body = EMAIL_TEMPLATES.order_confirmed.defaults;
  for (const cookie of [staffCookie, customerCookie, undefined]) {
    const want = cookie ? 403 : 401;
    assert.equal((await api.get("/api/admin/email-templates", cookie)).status, want);
    assert.equal((await api.call("PATCH", "/api/admin/email-templates/order_confirmed", { cookie, body })).status, want);
    assert.equal((await api.call("DELETE", "/api/admin/email-templates/order_confirmed", { cookie })).status, want);
    assert.equal((await api.post("/api/admin/email-templates/order_confirmed/preview", body, { cookie })).status, want);
    assert.equal((await api.post("/api/admin/email-templates/order_confirmed/test", body, { cookie })).status, want);
  }
  assert.throws(() => api.s.adminSaveEmailTemplate(customer, "order_confirmed", body), (e) => e.status === 403);
  assert.equal(api.s.db.prepare("SELECT COUNT(*) AS n FROM email_templates").get().n, 0);
});
