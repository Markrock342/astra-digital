// Small UX round B: unpaid orders expire after the shop's payment window, and every
// signed-in user can list and sign out their own sessions ("my devices").
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ensureSmallUxB } from "../server/ensure-admin-fr.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { deviceLabel, maskIp } from "../server/account-sessions.mjs";
import { STAFF_IDLE_MS } from "../server/auth-hardening.mjs";
import { EXPIRED_MESSAGE, SWEEP_EVERY_MS } from "../server/pending-expiry.mjs";

const BASE = "http://127.0.0.1:4331";
const MIN = 60000;
const OWNER_PASSWORD = "Owner-secret-Password-1";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

/** Clock = real time + offset, because SQLite fills created_at with the real CURRENT_TIMESTAMP. */
function shop(t, extra = {}) {
  let offset = 0;
  const s = createCommerce({
    adminPassword: OWNER_PASSWORD,
    allowDemoAdmin: true,
    clock: () => Date.now() + offset,
    ...extra,
  });
  t.after(() => s.db.close());
  const handle = createAPIHandler(s);
  async function call(method, path, { cookie, body, ip = "203.0.113.77", ua = MAC_CHROME } = {}) {
    const headers = { Cookie: cookie ?? "", "CF-Connecting-IP": ip, "User-Agent": ua };
    if (method !== "GET") headers["X-Astra-Request"] = "1";
    if (method === "POST") headers["Content-Type"] = "application/json";
    const res = await handle(
      new Request(BASE + path, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      }),
    );
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    const token = /astra_session=([a-f0-9]+)/.exec(setCookie)?.[1];
    return { status: res.status, body: await res.json(), cookie: token ? "astra_session=" + token : undefined, setCookie };
  }
  return {
    s,
    call,
    tick: (ms) => (offset += ms),
  };
}
const auditRows = (s, action) =>
  s.db
    .prepare("SELECT * FROM audit WHERE action=? ORDER BY id")
    .all(action)
    .map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
const availableStock = (s, variantId) =>
  s.db
    .prepare(
      "SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0",
    )
    .get(variantId).n;

function buyer(s, email = "expiry-buyer@example.invalid") {
  const auth = s.register({ name: "Expiry Buyer", email, password: "Expiry-buyer-Password-123" });
  return { user: s.session(auth.token), token: auth.token };
}
const owner = (s) => s.session(s.login({ email: "admin@astra.local", password: OWNER_PASSWORD }).token);

// ---------------------------------------------------------------- expiry: setting

test("pendingExpiryMinutes defaults to 30, accepts 5–1440 (number or form text) and is audited", (t) => {
  const { s } = shop(t);
  const admin = owner(s);
  assert.equal(s.settings().pendingExpiryMinutes, 30);
  assert.equal(s.overview().shop.pendingExpiryMinutes, 30);
  for (const bad of [4, 1441, 0, -5, 12.5, "abc", "", null, true])
    assert.throws(() => s.saveSettings(admin, { pendingExpiryMinutes: bad }), { status: 400 });
  assert.equal(s.saveSettings(admin, { pendingExpiryMinutes: "45" }).shop.pendingExpiryMinutes, 45);
  assert.equal(s.saveSettings(admin, { pendingExpiryMinutes: 5 }).shop.pendingExpiryMinutes, 5);
  assert.equal(s.saveSettings(admin, { pendingExpiryMinutes: 1440 }).shop.pendingExpiryMinutes, 1440);
  const last = auditRows(s, "SAVE_SETTINGS").at(-1);
  assert.deepEqual(last.detail.changed.pendingExpiryMinutes, { from: 5, to: 1440 });
  // Customers cannot change it.
  const { user } = buyer(s);
  assert.throws(() => s.saveSettings(user, { pendingExpiryMinutes: 10 }), { status: 403 });
});

// ---------------------------------------------------------------- expiry: orders

test("an unpaid order older than the window is cancelled by the system, never a paid one", (t) => {
  const { s, tick } = shop(t);
  const { user } = buyer(s);
  s.topup(user, { amount: 500, requestKey: "expiry-topup-0001" });
  const stockBefore = availableStock(s, "stream-plus-30");
  const unpaid = s.createOrder(user, { variantId: "stream-plus-30", quantity: 2, requestKey: "expiry-unpaid-0001" });
  const paidOrder = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "expiry-paid-0001" });
  s.pay(user, paidOrder.id, { paymentToken: paidOrder.paymentToken, outcome: "success" });
  // An unpaid order holds no units: stock only drops for the paid one.
  assert.equal(availableStock(s, "stream-plus-30"), stockBefore - 1);
  const ordersBefore = s.liveVersions().orders;

  tick(29 * MIN);
  assert.equal(s.orderDetail(user, unpaid.id).status, "PENDING_PAYMENT");
  tick(2 * MIN); // 31 minutes, and more than a minute since the last sweep
  const listed = s.orders(user);
  const expired = listed.find((o) => o.id === unpaid.id);
  assert.equal(expired.status, "CANCELLED");
  assert.ok(expired.expired_at, "expired_at is set");
  assert.equal(listed.find((o) => o.id === paidOrder.id).status, "DELIVERED");
  assert.equal(availableStock(s, "stream-plus-30"), stockBefore - 1, "nothing to release, nothing lost");
  assert.equal(s.liveVersions().orders, ordersBefore + 1, "orders topic bumped once");

  const rows = auditRows(s, "ORDER_EXPIRED");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, null, "system actor");
  assert.equal(rows[0].entity_id, unpaid.id);
  assert.equal(rows[0].detail.reason, "หมดเวลาชำระเงิน");
  assert.equal(rows[0].detail.minutes, 30);

  // Hours later the paid order is still delivered and nothing else was audited.
  tick(5 * 60 * MIN);
  s.orders(user);
  assert.equal(s.orderDetail(user, paidOrder.id).status, "DELIVERED");
  assert.equal(auditRows(s, "ORDER_EXPIRED").length, 1);
  assert.equal(s.liveVersions().orders, ordersBefore + 1, "no bump when nothing expired");

  // Back office timeline: cancelled by the system with the reason.
  const detail = s.adminOrderDetail(owner(s), unpaid.id);
  const cancelled = detail.timeline.filter((e) => e.event === "cancelled");
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].actor, null);
  assert.equal(cancelled[0].reason, "หมดเวลาชำระเงิน");
});

test("pay and retry on an expired order answer 409 with a clear Thai message", async (t) => {
  const { s, call, tick } = shop(t);
  const auth = s.register({ name: "Late Payer", email: "late-payer@example.invalid", password: "Late-payer-Password-123" });
  const user = s.session(auth.token);
  s.topup(user, { amount: 500, requestKey: "late-topup-0001" });
  const order = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "late-order-0001" });
  tick(31 * MIN);
  const cookie = "astra_session=" + auth.token;
  const paid = await call("POST", `/api/orders/${order.id}/pay`, {
    cookie,
    body: { paymentToken: order.paymentToken, outcome: "success" },
  });
  assert.equal(paid.status, 409);
  assert.equal(paid.body.error, EXPIRED_MESSAGE);
  const retried = await call("POST", `/api/orders/${order.id}/retry`, { cookie, body: {} });
  assert.equal(retried.status, 409);
  assert.equal(retried.body.error, EXPIRED_MESSAGE);
  const detail = await call("GET", `/api/orders/${order.id}`, { cookie });
  assert.equal(detail.body.status, "CANCELLED");
  assert.ok(detail.body.expired_at);
  // No money moved.
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM payments WHERE order_id=?").get(order.id).n, 0);
});

test("pay checks its own order even inside the once-a-minute sweep gate", (t) => {
  const { s, tick } = shop(t);
  const { user } = buyer(s);
  s.topup(user, { amount: 500, requestKey: "gate-topup-0001" });
  s.orders(user); // runs the sweep now, gate closed for a minute
  const order = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "gate-order-0001" });
  // Back-date the order so it is already past the window, while the gate is still closed.
  s.db.prepare("UPDATE orders SET created_at=datetime('now','-2 hours') WHERE id=?").run(order.id);
  tick(10000);
  assert.equal(s.orders(user).find((o) => o.id === order.id).status, "PENDING_PAYMENT", "gated list read");
  assert.throws(
    () => s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" }),
    (e) => e.status === 409 && e.message === EXPIRED_MESSAGE,
  );
  assert.equal(s.orderDetail(user, order.id).status, "CANCELLED");

  // A second stale order is picked up by the next sweep once the minute has passed.
  const other = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "gate-order-0002" });
  s.db.prepare("UPDATE orders SET created_at=datetime('now','-2 hours') WHERE id=?").run(other.id);
  assert.equal(s.orders(user).find((o) => o.id === other.id).status, "PENDING_PAYMENT");
  tick(SWEEP_EVERY_MS);
  assert.equal(s.orders(user).find((o) => o.id === other.id).status, "CANCELLED");
});

test("unpaid preorders expire too; paid preorders in the queue stay", (t) => {
  const { s, tick } = shop(t);
  const merchant = s.session(s.demoMerchant().token);
  const p = s.saveProduct(merchant, {
    name: "Expiry Preorder",
    description: "ทดสอบหมดเวลาชำระ",
    category: "streaming",
    price: 15000,
    preorder: true,
    active: true,
  });
  const variantId = s.adminProductVariants(merchant, p.id).variants[0].id;
  s.saveSettings(merchant, { pendingExpiryMinutes: 10 });
  const { user } = buyer(s);
  s.topup(user, { amount: 500, requestKey: "pre-topup-0001" });
  const unpaid = s.createOrder(user, { variantId, quantity: 1, requestKey: "pre-unpaid-0001" });
  const queued = s.createOrder(user, { variantId, quantity: 1, requestKey: "pre-queued-0001" });
  s.pay(user, queued.id, { paymentToken: queued.paymentToken, outcome: "success" });
  tick(11 * MIN);
  const list = s.orders(user);
  assert.equal(list.find((o) => o.id === unpaid.id).status, "CANCELLED");
  assert.ok(list.find((o) => o.id === unpaid.id).expired_at);
  assert.equal(list.find((o) => o.id === queued.id).status, "PREORDER");
  assert.equal(auditRows(s, "ORDER_EXPIRED")[0].detail.minutes, 10);
  assert.throws(
    () => s.pay(user, unpaid.id, { paymentToken: unpaid.paymentToken, outcome: "success" }),
    (e) => e.status === 409 && e.message === EXPIRED_MESSAGE,
  );
});

test("admin cancel still works through the shared helper and is not marked expired", (t) => {
  const { s } = shop(t);
  const { user } = buyer(s);
  const order = s.createOrder(user, { variantId: "stream-plus-30", quantity: 1, requestKey: "admin-cancel-0001" });
  const admin = owner(s);
  assert.deepEqual(s.adminCancelOrder(admin, order.id, { reason: "ลูกค้าขอยกเลิก" }), { id: order.id, status: "CANCELLED" });
  const row = s.db.prepare("SELECT status, expired_at FROM orders WHERE id=?").get(order.id);
  assert.deepEqual({ ...row }, { status: "CANCELLED", expired_at: null });
  assert.equal(auditRows(s, "CANCEL_ORDER")[0].user_id, admin.id);
  assert.throws(() => s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" }), (e) =>
    e.status === 409 && e.message !== EXPIRED_MESSAGE,
  );
});

test("ensureSmallUxB is idempotent", (t) => {
  const { s } = shop(t);
  ensureSmallUxB(s.db);
  ensureSmallUxB(s.db);
  const cols = (table) => s.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  assert.ok(cols("orders").includes("expired_at"));
  assert.ok(cols("reservations").includes("expired_at"));
  assert.ok(cols("sessions").includes("device"));
  assert.ok(cols("sessions").includes("ip_masked"));
});

// ---------------------------------------------------------------- sessions: parsing

test("device label is coarse and the IP is cut to /24 or /48", () => {
  assert.equal(deviceLabel(MAC_CHROME), "Chrome · macOS");
  assert.equal(deviceLabel(IPHONE_SAFARI), "Safari · iPhone");
  assert.equal(
    deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"),
    "Edge · Windows",
  );
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36"), "Chrome · Android");
  assert.equal(deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0"), "Firefox · Linux");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.20.0"), "LINE · iPhone");
  assert.equal(deviceLabel(""), "อุปกรณ์ที่ไม่รู้จัก");
  assert.equal(deviceLabel(undefined), "อุปกรณ์ที่ไม่รู้จัก");
  assert.equal(deviceLabel("curl/8.7.1"), "อุปกรณ์ที่ไม่รู้จัก");

  assert.equal(maskIp("203.0.113.77"), "203.0.113.0/24");
  assert.equal(maskIp("::ffff:198.51.100.9"), "198.51.100.0/24");
  assert.equal(maskIp("2001:db8:abcd:12:1:2:3:4"), "2001:db8:abcd::/48");
  assert.equal(maskIp("2001:0db8:0001::1"), "2001:db8:1::/48");
  assert.equal(maskIp("::1"), "0:0:0::/48");
  assert.equal(maskIp("fe80::1%en0"), "fe80:0:0::/48");
  for (const bad of ["", "local", "999.1.1.1", "1.2.3", "1:2:3", "1::2::3", null, undefined, 42])
    assert.equal(maskIp(bad), null, String(bad));
});

// ---------------------------------------------------------------- sessions: API

async function signIn(call, email, password, opts = {}) {
  const res = await call("POST", "/api/login", { body: { email, password }, ...opts });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.cookie;
}

test("a customer lists their own sessions with device, masked IP, last active and the current one", async (t) => {
  const { s, call, tick } = shop(t);
  const email = "devices@example.invalid";
  const password = "Devices-only-Password-123";
  s.register({ name: "Devices Buyer", email, password });
  s.db.prepare("DELETE FROM sessions").run();
  const mac = await signIn(call, email, password);
  tick(5 * MIN);
  const phone = await signIn(call, email, password, { ua: IPHONE_SAFARI, ip: "2001:db8:abcd:12::99" });
  tick(2 * MIN);

  const res = await call("GET", "/api/account/sessions", { cookie: phone });
  assert.equal(res.status, 200);
  const { sessions } = res.body;
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].current, true, "current first");
  assert.equal(sessions[0].device, "Safari · iPhone");
  assert.equal(sessions[0].ip, "2001:db8:abcd::/48");
  assert.equal(sessions[1].current, false);
  assert.equal(sessions[1].device, "Chrome · macOS");
  assert.equal(sessions[1].ip, "203.0.113.0/24");
  for (const row of sessions) {
    assert.match(row.id, /^[a-f0-9]{32}$/);
    assert.ok(row.createdAt && row.lastSeenAt);
  }
  // The stored token hash and the full IP never leave the server.
  const text = JSON.stringify(res.body);
  for (const r of s.db.prepare("SELECT token_hash FROM sessions").all()) assert.ok(!text.includes(r.token_hash));
  assert.ok(!text.includes("203.0.113.77"));
  assert.ok(!text.includes("Mozilla"));

  // Customer last_seen slides (at most one write a minute) so "last active" means something.
  tick(3 * MIN);
  await call("GET", "/api/me", { cookie: mac });
  const again = (await call("GET", "/api/account/sessions", { cookie: mac })).body.sessions;
  const macRow = again.find((r) => r.current);
  assert.equal(macRow.device, "Chrome · macOS");
  assert.ok(Date.parse(macRow.lastSeenAt) > Date.parse(macRow.createdAt));

  const anonymous = await call("GET", "/api/account/sessions");
  assert.equal(anonymous.status, 401);
});

test("revoke one session, revoke all others, never someone else's; all audited", async (t) => {
  const { s, call } = shop(t);
  const email = "revoke@example.invalid";
  const password = "Revoke-only-Password-123";
  s.register({ name: "Revoke Buyer", email, password });
  s.register({ name: "Other Buyer", email: "other@example.invalid", password: "Other-only-Password-123" });
  s.db.prepare("DELETE FROM sessions").run();
  const a = await signIn(call, email, password);
  const b = await signIn(call, email, password, { ua: IPHONE_SAFARI });
  const c = await signIn(call, email, password, { ip: "198.51.100.4" });
  const stranger = await signIn(call, "other@example.invalid", "Other-only-Password-123");

  const list = (await call("GET", "/api/account/sessions", { cookie: a })).body.sessions;
  const phoneId = list.find((r) => r.device === "Safari · iPhone").id;

  // Someone else cannot revoke it (same 404 as an unknown id).
  const foreign = await call("DELETE", "/api/account/sessions/" + phoneId, { cookie: stranger });
  assert.equal(foreign.status, 404);
  assert.equal((await call("DELETE", "/api/account/sessions/not-an-id", { cookie: a })).status, 400);
  assert.equal((await call("GET", "/api/me", { cookie: b })).body.user?.email, email);

  const revoked = await call("DELETE", "/api/account/sessions/" + phoneId, { cookie: a });
  assert.equal(revoked.status, 200);
  assert.deepEqual(revoked.body, { revoked: 1, current: false });
  assert.equal(revoked.setCookie, "", "the caller keeps its cookie");
  assert.equal((await call("GET", "/api/me", { cookie: b })).body.user, null, "phone signed out");
  assert.equal((await call("GET", "/api/me", { cookie: a })).body.user?.email, email);
  const one = auditRows(s, "SESSION_REVOKE");
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].detail, { device: "Safari · iPhone", current: false });

  // Sign out everywhere else: c goes, a stays, the stranger is untouched.
  const others = await call("POST", "/api/account/sessions/revoke-others", { cookie: a, body: {} });
  assert.equal(others.status, 200);
  assert.deepEqual(others.body, { revoked: 1 });
  assert.equal((await call("GET", "/api/me", { cookie: c })).body.user, null);
  assert.equal((await call("GET", "/api/me", { cookie: a })).body.user?.email, email);
  assert.equal((await call("GET", "/api/me", { cookie: stranger })).body.user?.email, "other@example.invalid");
  const all = auditRows(s, "SESSION_REVOKE_OTHERS");
  assert.equal(all.length, 1);
  assert.deepEqual(all[0].detail, { sessions: 1 });
  assert.equal((await call("GET", "/api/account/sessions", { cookie: a })).body.sessions.length, 1);

  // Revoking the current session signs this browser out and clears the cookie.
  const selfId = (await call("GET", "/api/account/sessions", { cookie: a })).body.sessions[0].id;
  const self = await call("DELETE", "/api/account/sessions/" + selfId, { cookie: a });
  assert.equal(self.status, 200);
  assert.equal(self.body.current, true);
  assert.match(self.setCookie, /astra_session=;.*Max-Age=0/);
  assert.equal((await call("GET", "/api/me", { cookie: a })).body.user, null);

  // Needs the CSRF header like every other write.
  const res = await createAPIHandler(s)(
    new Request(BASE + "/api/account/sessions/revoke-others", {
      method: "POST",
      headers: { Cookie: stranger, "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  assert.equal(res.status, 403);
});

test("staff sessions past the idle limit are not listed; password change still signs out everywhere", async (t) => {
  const { s, call, tick } = shop(t);
  const email = "staff-devices@example.invalid";
  const password = "Staff-devices-Password-123";
  const auth = s.register({ name: "Staff Devices", email, password });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, auth.user.id);
  s.db.prepare("DELETE FROM sessions").run();
  const old = await signIn(call, email, password, { ua: IPHONE_SAFARI });
  tick(STAFF_IDLE_MS - 10 * MIN);
  const fresh = await signIn(call, email, password);
  tick(20 * MIN); // the first one is now idle for longer than 2h
  const list = (await call("GET", "/api/account/sessions", { cookie: fresh })).body.sessions;
  assert.deepEqual(list.map((r) => r.device), ["Chrome · macOS"]);
  assert.equal((await call("GET", "/api/me", { cookie: old })).body.user, null);

  const second = await signIn(call, email, password, { ua: IPHONE_SAFARI });
  const changed = await call("POST", "/api/profile", {
    cookie: fresh,
    body: { name: "Staff Devices", currentPassword: password, newPassword: "Staff-devices-Password-456" },
  });
  assert.equal(changed.status, 200);
  for (const cookie of [fresh, second]) assert.equal((await call("GET", "/api/me", { cookie })).body.user, null);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?").get(auth.user.id).n, 0);
});
