// Chat ข้อความสำเร็จรูป (canned replies) and bulk actions on the admin orders list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ApiError } from "../server/domain.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { ensureCannedReplies } from "../server/ensure-admin-fr.mjs";
import {
  CANNED_REPLY_LIMIT,
  DEFAULT_CANNED_REPLIES,
  fillPlaceholders,
} from "../server/canned-replies.mjs";
import { BULK_ORDER_CAP, createAdminOrderBulkApis } from "../server/admin-order-bulk.mjs";

const READY = "stream-plus-30";
let keySeq = 0;
const key = () => "bulk-test-" + String(++keySeq).padStart(6, "0");

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const customer = (name) => {
    const auth = s.register({
      name,
      email: name.toLowerCase().replace(/\s+/g, "-") + "@example.invalid",
      password: "Test-only-Password-123",
    });
    return { user: s.session(auth.token), token: auth.token };
  };
  const buyer = customer("Somchai Buyer");
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  const staffAuth = customer("Team Staff");
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  return {
    s,
    admin,
    staff,
    user: buyer.user,
    customer,
    tokens: { admin: adminAuth.token, staff: staffAuth.token, user: buyer.token },
  };
}

const status = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.status;
  }
  return 200;
};
const auditRows = (s, action) =>
  s.db.prepare("SELECT * FROM audit WHERE action=? ORDER BY rowid").all(action);

function http(s) {
  const handle = createAPIHandler(s);
  return async (method, path, token, body) => {
    const res = await handle(
      new Request("http://127.0.0.1:4331" + path, {
        method,
        headers: {
          Cookie: token ? "astra_session=" + token : "",
          ...(method !== "GET" ? { "X-Astra-Request": "1" } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, body: await res.json() };
  };
}

// ---------------------------------------------------------------- canned replies

test("ensureCannedReplies is idempotent and seeds the defaults only once", () => {
  const db = new DatabaseSync(":memory:");
  ensureCannedReplies(db);
  ensureCannedReplies(db);
  const rows = db.prepare("SELECT * FROM canned_replies ORDER BY sort_order").all();
  assert.equal(rows.length, DEFAULT_CANNED_REPLIES.length);
  assert.ok(rows.length >= 4 && rows.length <= 5);
  assert.ok(rows.every((r) => r.body.length <= 1000 && r.title.length <= 60));
  assert.ok(rows.some((r) => r.body.includes("{ชื่อลูกค้า}") && r.body.includes("{เลขออเดอร์}")));
  // A default the admin deleted does not come back on the next start.
  db.prepare("DELETE FROM canned_replies WHERE id=?").run(rows[0].id);
  ensureCannedReplies(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM canned_replies").get().n, rows.length - 1);
  db.close();
});

test("fillPlaceholders fills known tokens, keeps unknown ones and reports missing values", () => {
  const filled = fillPlaceholders("เรียน คุณ{ชื่อลูกค้า} ออเดอร์ {เลขออเดอร์} / {ชื่อลูกค้า} {อื่นๆ}", {
    customerName: "สมชาย",
    orderNumber: "#ABCD1234",
  });
  assert.equal(filled.text, "เรียน คุณสมชาย ออเดอร์ #ABCD1234 / สมชาย {อื่นๆ}");
  assert.deepEqual(filled.missing, []);
  const partial = fillPlaceholders("คุณ{ชื่อลูกค้า} {เลขออเดอร์}", { customerName: "  ", orderNumber: null });
  assert.equal(partial.text, "คุณ{ชื่อลูกค้า} {เลขออเดอร์}");
  assert.deepEqual(partial.missing.sort(), ["{ชื่อลูกค้า}", "{เลขออเดอร์}"].sort());
  assert.deepEqual(fillPlaceholders("ไม่มีตัวแทน", {}), { text: "ไม่มีตัวแทน", missing: [] });
});

test("canned replies: ADMIN manages, STAFF only reads, customers get nothing", (t) => {
  const { s, admin, staff, user } = fixture(t);
  assert.equal(s.cannedReplies(staff).replies.length, DEFAULT_CANNED_REPLIES.length);
  assert.equal(s.cannedReplies(admin).replies.length, DEFAULT_CANNED_REPLIES.length);
  assert.equal(status(() => s.cannedReplies(user)), 403);
  assert.equal(status(() => s.cannedReplies(null)), 401);
  const input = { title: "ทดสอบ", body: "ข้อความทดสอบ" };
  for (const who of [staff, user]) {
    assert.equal(status(() => s.adminCreateCannedReply(who, input)), 403);
    assert.equal(status(() => s.adminUpdateCannedReply(who, "default-1", input)), 403);
    assert.equal(status(() => s.adminDeleteCannedReply(who, "default-1")), 403);
    assert.equal(status(() => s.adminReorderCannedReplies(who, { ids: [] })), 403);
  }
  const created = s.adminCreateCannedReply(admin, { title: "  ใหม่  ", body: "บรรทัด 1\r\nบรรทัด 2\n" }).reply;
  assert.equal(created.title, "ใหม่");
  assert.equal(created.body, "บรรทัด 1\nบรรทัด 2");
  const list = s.cannedReplies(staff).replies;
  assert.equal(list.at(-1).id, created.id, "new reply goes last");
  s.adminUpdateCannedReply(admin, created.id, { title: "แก้แล้ว", body: "ข้อความใหม่" });
  assert.equal(s.cannedReplies(admin).replies.at(-1).title, "แก้แล้ว");
  const reversed = list.map((r) => r.id).reverse();
  assert.deepEqual(
    s.adminReorderCannedReplies(admin, { ids: reversed }).replies.map((r) => r.id),
    reversed,
  );
  s.adminDeleteCannedReply(admin, created.id);
  assert.equal(status(() => s.adminDeleteCannedReply(admin, created.id)), 404);
  for (const action of ["CANNED_REPLY_CREATE", "CANNED_REPLY_UPDATE", "CANNED_REPLY_DELETE", "CANNED_REPLY_REORDER"]) {
    const rows = auditRows(s, action);
    assert.equal(rows.length, 1, action);
    assert.equal(rows[0].user_id, admin.id);
  }
});

test("canned replies validate length, the 50 limit and a stale reorder", (t) => {
  const { s, admin } = fixture(t);
  assert.equal(status(() => s.adminCreateCannedReply(admin, { title: "ยาว", body: "ก".repeat(1001) })), 400);
  assert.equal(status(() => s.adminCreateCannedReply(admin, { title: "ว่าง", body: "   " })), 400);
  assert.equal(status(() => s.adminCreateCannedReply(admin, { title: "", body: "ข้อความ" })), 400);
  assert.equal(status(() => s.adminCreateCannedReply(admin, { title: "x".repeat(61), body: "ข้อความ" })), 400);
  assert.equal(s.adminCreateCannedReply(admin, { title: "พอดี", body: "ก".repeat(1000) }).reply.body.length, 1000);
  const have = s.cannedReplies(admin).replies.length;
  for (let i = have; i < CANNED_REPLY_LIMIT; i++)
    s.adminCreateCannedReply(admin, { title: "ข้อความ " + i, body: "เนื้อหา " + i });
  assert.equal(s.cannedReplies(admin).replies.length, CANNED_REPLY_LIMIT);
  assert.equal(status(() => s.adminCreateCannedReply(admin, { title: "เกิน", body: "เกิน" })), 409);
  const ids = s.cannedReplies(admin).replies.map((r) => r.id);
  assert.equal(status(() => s.adminReorderCannedReplies(admin, { ids: ids.slice(1) })), 409);
  assert.equal(status(() => s.adminReorderCannedReplies(admin, { ids: [ids[0], ...ids.slice(0, -1)] })), 409);
  assert.equal(status(() => s.adminReorderCannedReplies(admin, { ids: "x" })), 400);
});

test("placeholders come from the thread: reported order first, else the latest order", (t) => {
  const { s, staff, user, customer } = fixture(t);
  s.db.prepare("UPDATE users SET first_name=? WHERE id=?").run("สมชาย", user.id);
  const first = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
  const latest = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
  s.db.prepare("UPDATE orders SET created_at='2026-01-01 00:00:00' WHERE id=?").run(first.id);
  const thread = s.openChatThread(user, { body: "สอบถาม" }).thread;
  let view = s.cannedReplies(staff, { threadId: thread.id });
  assert.equal(view.context.customerName, "สมชาย");
  assert.equal(view.context.orderNumber, "#" + latest.id.slice(0, 8).toUpperCase());
  const login = view.replies.find((r) => r.id === "default-1");
  assert.ok(login.text.startsWith("เรียน คุณสมชาย"));
  assert.ok(login.text.includes("#" + latest.id.slice(0, 8).toUpperCase()));
  assert.deepEqual(login.missing, []);
  assert.ok(login.body.includes("{เลขออเดอร์}"), "the stored body keeps the placeholder");

  // The order reported in the thread wins over the newest one.
  s.db.prepare("UPDATE chat_threads SET order_id=? WHERE id=?").run(first.id, thread.id);
  view = s.cannedReplies(staff, { threadId: thread.id });
  assert.equal(view.context.orderId, first.id);

  // No order at all: the token stays and is reported.
  const fresh = customer("Nobody Orders");
  const empty = s.openChatThread(fresh.user, { body: "สวัสดี" }).thread;
  const none = s.cannedReplies(staff, { threadId: empty.id }).replies.find((r) => r.id === "default-1");
  assert.ok(none.text.includes("{เลขออเดอร์}"));
  assert.deepEqual(none.missing, ["{เลขออเดอร์}"]);
  assert.equal(status(() => s.cannedReplies(staff, { threadId: "no-such-thread" })), 404);
});

test("canned replies over HTTP: list with thread, create, edit, delete", async (t) => {
  const { s, user, tokens } = fixture(t);
  const call = http(s);
  const thread = s.openChatThread(user, { body: "hi" }).thread;
  const listed = await call("GET", "/api/admin/canned-replies?thread=" + thread.id, tokens.staff);
  assert.equal(listed.status, 200);
  assert.ok(listed.body.replies[0].text.includes("Somchai Buyer"));
  assert.equal((await call("GET", "/api/admin/canned-replies", tokens.user)).status, 403);
  assert.equal((await call("POST", "/api/admin/canned-replies", tokens.staff, { title: "a", body: "b" })).status, 403);
  const made = await call("POST", "/api/admin/canned-replies", tokens.admin, { title: "ใหม่", body: "สวัสดี {ชื่อลูกค้า}" });
  assert.equal(made.status, 201);
  const id = made.body.reply.id;
  assert.equal((await call("PATCH", "/api/admin/canned-replies/" + id, tokens.admin, { title: "แก้", body: "ข้อความ" })).status, 200);
  const ids = s.cannedReplies(s.session(tokens.admin)).replies.map((r) => r.id);
  assert.equal((await call("POST", "/api/admin/canned-replies/reorder", tokens.admin, { ids: ids.reverse() })).status, 200);
  assert.equal((await call("DELETE", "/api/admin/canned-replies/" + id, tokens.staff)).status, 403);
  assert.equal((await call("DELETE", "/api/admin/canned-replies/" + id, tokens.admin)).status, 200);
  // Using a canned reply never posts anything by itself.
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id=?").get(thread.id).n, 1);
});

// ---------------------------------------------------------------- bulk orders

/** A paid (DELIVERED) ready order and two unpaid ones. */
function orders(s, user) {
  const paidOrder = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
  const paid = s.pay(user, paidOrder.id, { paymentToken: paidOrder.paymentToken, outcome: "success" });
  const unpaidA = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
  const unpaidB = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
  return { paid, unpaidA, unpaidB };
}

/** Copies an order row `n` times (fresh ids) to get past the bulk cap quickly. */
function cloneOrders(s, sourceId, n) {
  const cols = s.db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  const select = cols.map((c) => (c === "id" ? "?" : c === "request_key" ? "?" : c)).join(",");
  const insert = s.db.prepare(`INSERT INTO orders(${cols.join(",")}) SELECT ${select} FROM orders WHERE id=?`);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = randomUUID();
    const args = cols.flatMap((c) => (c === "id" ? [id] : c === "request_key" ? ["clone-" + id] : []));
    insert.run(...args, sourceId);
    ids.push(id);
  }
  return ids;
}

test("bulk permissions: cancel is ADMIN only; resend and export are ADMIN + STAFF", (t) => {
  const { s, admin, staff, user } = fixture(t);
  const { unpaidA } = orders(s, user);
  const ids = [unpaidA.id];
  assert.equal(status(() => s.adminBulkOrderAction(staff, { action: "cancel", ids })), 403);
  assert.equal(status(() => s.adminBulkOrderCheck(staff, { action: "cancel", ids, dryRun: true })), 403);
  assert.equal(status(() => s.adminBulkOrderCheck(staff, { action: "resend", ids, dryRun: true })), 200);
  assert.equal(status(() => s.adminBulkOrderCheck(staff, { action: "export", ids })), 200);
  for (const action of ["cancel", "resend", "export"]) {
    assert.equal(status(() => s.adminBulkOrderAction(user, { action, ids })), 403, action);
    assert.equal(status(() => s.adminBulkOrderAction(null, { action, ids })), 401, action);
  }
  assert.equal(status(() => s.adminBulkOrderAction(admin, { action: "delete", ids })), 400);
  assert.equal(s.orderDetail(user, unpaidA.id).status, "PENDING_PAYMENT", "nothing changed");
});

test("bulk cancel: per-order results, unpaid only, one audit row per cancelled order", (t) => {
  const { s, admin, user } = fixture(t);
  const { paid, unpaidA, unpaidB } = orders(s, user);
  const ids = [unpaidA.id, paid.id, "no-such-order", unpaidB.id, unpaidA.id];

  const plan = s.adminBulkOrderCheck(admin, { action: "cancel", ids, dryRun: true });
  assert.equal(plan.dryRun, true);
  assert.deepEqual([plan.total, plan.ok, plan.skipped, plan.failed], [4, 2, 1, 1], "duplicates count once");
  assert.equal(s.orderDetail(user, unpaidA.id).status, "PENDING_PAYMENT", "dry run changes nothing");
  assert.equal(auditRows(s, "CANCEL_ORDER").length, 0);

  const done = s.adminBulkOrderAction(admin, { action: "cancel", ids, reason: "ลูกค้าไม่ได้ชำระ" });
  assert.deepEqual([done.total, done.ok, done.skipped, done.failed], [4, 2, 1, 1]);
  const byId = Object.fromEntries(done.results.map((r) => [r.id, r]));
  assert.equal(byId[unpaidA.id].result, "ok");
  assert.equal(byId[unpaidA.id].status, "CANCELLED");
  assert.equal(byId[paid.id].result, "skipped");
  assert.match(byId[paid.id].message, /ยังไม่ชำระ/);
  assert.equal(byId["no-such-order"].result, "failed");
  assert.equal(s.orderDetail(user, unpaidA.id).status, "CANCELLED");
  assert.equal(s.orderDetail(user, unpaidB.id).status, "CANCELLED");
  assert.equal(s.orderDetail(user, paid.id).status, "DELIVERED", "paid order untouched");
  const audits = auditRows(s, "CANCEL_ORDER");
  assert.deepEqual(audits.map((a) => a.entity_id).sort(), [unpaidA.id, unpaidB.id].sort());
  for (const a of audits) {
    assert.equal(a.user_id, admin.id);
    assert.deepEqual(JSON.parse(a.detail), { reason: "ลูกค้าไม่ได้ชำระ", bulk: true });
  }
  // Run again: everything is skipped now, nothing new in the audit log.
  const again = s.adminBulkOrderAction(admin, { action: "cancel", ids: [unpaidA.id, unpaidB.id] });
  assert.deepEqual([again.ok, again.skipped], [0, 2]);
  assert.equal(auditRows(s, "CANCEL_ORDER").length, 2);
  assert.equal(status(() => s.adminBulkOrderAction(admin, { action: "cancel", ids, reason: "x" })), 400);
});

test("bulk cancel gives each order's coupon use back", (t) => {
  const { s, admin, user, customer } = fixture(t);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  s.adminCreateCoupon(admin, { code: "BULK-ONCE", type: "FIXED", value: 1000, usageLimit: 2 });
  const other = customer("Other Buyer").user;
  const a = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "BULK-ONCE" });
  const b = s.createOrder(other, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "BULK-ONCE" });
  assert.equal(s.checkCoupon(customer("Third").user, { code: "BULK-ONCE", variantId: READY, quantity: 1 }).valid, false);
  const done = s.adminBulkOrderAction(admin, { action: "cancel", ids: [a.id, b.id] });
  assert.equal(done.ok, 2);
  const rows = s.db.prepare("SELECT * FROM coupon_redemptions WHERE code='BULK-ONCE'").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.released_at && r.released_reason === "CANCELLED"));
  for (const id of [a.id, b.id]) {
    const audit = auditRows(s, "CANCEL_ORDER").find((r) => r.entity_id === id);
    assert.equal(JSON.parse(audit.detail).couponReleased, "BULK-ONCE");
  }
  assert.equal(s.checkCoupon(customer("Fourth").user, { code: "BULK-ONCE", variantId: READY, quantity: 1 }).valid, true);
});

test("bulk cap: more than 100 ids is refused; a bigger filter uses the newest 100", (t) => {
  const { s, admin, user } = fixture(t);
  const { unpaidA } = orders(s, user);
  const clones = cloneOrders(s, unpaidA.id, BULK_ORDER_CAP + 5);
  assert.equal(BULK_ORDER_CAP, 100);
  assert.equal(status(() => s.adminBulkOrderCheck(admin, { action: "cancel", ids: clones, dryRun: true })), 400);
  assert.equal(status(() => s.adminBulkOrderCheck(admin, { action: "cancel", ids: [], dryRun: true })), 400);
  assert.equal(status(() => s.adminBulkOrderCheck(admin, { action: "cancel", ids: [42], dryRun: true })), 400);
  assert.equal(status(() => s.adminBulkOrderCheck(admin, { action: "cancel", filter: { group: 7 }, dryRun: true })), 400);
  // Exactly 100 ids is fine.
  assert.equal(s.adminBulkOrderCheck(admin, { action: "cancel", ids: clones.slice(0, 100), dryRun: true }).ok, 100);

  const plan = s.adminBulkOrderCheck(admin, { action: "cancel", filter: { group: "pending" }, dryRun: true });
  assert.equal(plan.total, BULK_ORDER_CAP);
  assert.equal(plan.capped, true);
  const done = s.adminBulkOrderAction(admin, { action: "cancel", filter: { group: "pending" } });
  assert.equal(done.ok, BULK_ORDER_CAP);
  assert.equal(done.capped, true);
  const left = s.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='PENDING_PAYMENT'").get().n;
  assert.equal(left, BULK_ORDER_CAP + 7 - BULK_ORDER_CAP, "the rest stay unpaid");
  // A filter only touches what it matches (paid orders are not in "pending").
  const small = s.adminBulkOrderAction(admin, { action: "cancel", filter: { group: "pending" } });
  assert.deepEqual([small.total, small.ok, small.capped], [left, left, false]);
});

test("bulk resend: delivered only, hourly limit respected, audited per order", (t) => {
  const { s, staff, user } = fixture(t);
  const { paid, unpaidA } = orders(s, user);
  const done = s.adminBulkOrderAction(staff, { action: "resend", ids: [paid.id, unpaidA.id] });
  assert.deepEqual([done.ok, done.skipped, done.failed], [1, 1, 0]);
  assert.equal(done.results.find((r) => r.id === unpaidA.id).result, "skipped");
  const resends = auditRows(s, "RESEND_CREDENTIALS");
  assert.equal(resends.length, 1);
  assert.equal(resends[0].entity_id, paid.id);
  assert.equal(resends[0].user_id, staff.id);
  const chat = s.db
    .prepare("SELECT m.body FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id WHERE t.user_id=? ORDER BY m.rowid DESC LIMIT 1")
    .get(user.id).body;
  assert.ok(chat.includes("/orders/" + paid.id));
  // Two more resends reach the hourly limit; the next bulk run skips the order.
  s.adminBulkOrderAction(staff, { action: "resend", ids: [paid.id] });
  s.adminBulkOrderAction(staff, { action: "resend", ids: [paid.id] });
  const limited = s.adminBulkOrderAction(staff, { action: "resend", ids: [paid.id] });
  assert.deepEqual([limited.ok, limited.skipped], [0, 1]);
  assert.match(limited.results[0].message, /ครบ 3 ครั้ง/);
  assert.equal(auditRows(s, "RESEND_CREDENTIALS").length, 3);
});

test("bulk export returns the picked rows and writes one audit row", (t) => {
  const { s, staff, user } = fixture(t);
  const { paid, unpaidA, unpaidB } = orders(s, user);
  const result = s.adminBulkOrderCheck(staff, { action: "export", ids: [paid.id, unpaidB.id, "missing-id"] });
  assert.deepEqual(result.rows.map((r) => r.id).sort(), [paid.id, unpaidB.id].sort());
  assert.ok(!result.rows.some((r) => r.id === unpaidA.id));
  const row = result.rows.find((r) => r.id === paid.id);
  assert.equal(row.customer, "Somchai Buyer");
  assert.equal(row.status, "DELIVERED");
  assert.equal(typeof row.total, "number");
  assert.equal(result.failed, 1);
  const audits = auditRows(s, "ORDER_BULK_EXPORT");
  assert.equal(audits.length, 1);
  assert.deepEqual(JSON.parse(audits[0].detail), { total: 2 });
  assert.equal(s.orderDetail(user, unpaidB.id).status, "PENDING_PAYMENT");
});

test("a failure on one order is reported and does not undo the others", (t) => {
  const { s, admin, user } = fixture(t);
  const { unpaidA, unpaidB } = orders(s, user);
  const third = s.createOrder(user, { variantId: READY, quantity: 1, requestKey: key() });
  const one = (sql, ...p) => s.db.prepare(sql).get(...p);
  const all = (sql, ...p) => s.db.prepare(sql).all(...p);
  const run = (sql, ...p) => s.db.prepare(sql).run(...p);
  const fail = (code, message) => {
    throw new ApiError(code, message);
  };
  const tx = (fn) => {
    s.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      s.db.exec("COMMIT");
      return out;
    } catch (e) {
      s.db.exec("ROLLBACK");
      throw e;
    }
  };
  const realCancel = ({ table, orderId, actor, action, detail }) => {
    if (orderId === unpaidB.id) {
      // Writes, then fails: the transaction for this one order must roll back.
      run(`UPDATE ${table} SET status='CANCELLED' WHERE id=?`, orderId);
      throw new Error("disk full");
    }
    const changed = run(`UPDATE ${table} SET status='CANCELLED' WHERE id=? AND status='PENDING_PAYMENT'`, orderId).changes;
    if (changed) run("INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)", actor.id, action, orderId, JSON.stringify(detail));
    return !!changed;
  };
  const bulk = createAdminOrderBulkApis({
    requireStaff: () => {},
    requireAdmin: () => {},
    one,
    all,
    run,
    tx,
    fail,
    clean: (v, min, max, label) => {
      if (typeof v !== "string" || v.trim().length < min || v.trim().length > max) fail(400, label);
      return v.trim();
    },
    ApiError,
    adminOrders: () => ({ orders: [], nextCursor: null }),
    cancelUnpaidOrder: realCancel,
    resendOrderCredentials: () => {},
    resendLimit: 3,
  });
  const origError = console.error;
  console.error = () => {};
  t.after(() => (console.error = origError));
  const done = bulk.adminBulkOrderAction(admin, { action: "cancel", ids: [unpaidA.id, unpaidB.id, third.id] });
  assert.deepEqual([done.ok, done.failed], [2, 1]);
  assert.equal(done.results[1].result, "failed");
  assert.match(done.results[1].message, /ไม่สำเร็จ/);
  assert.equal(s.orderDetail(user, unpaidA.id).status, "CANCELLED");
  assert.equal(s.orderDetail(user, unpaidB.id).status, "PENDING_PAYMENT", "rolled back");
  assert.equal(s.orderDetail(user, third.id).status, "CANCELLED", "later orders still ran");
});

test("bulk over HTTP: dry run reads, the real call changes orders and bumps live topics", async (t) => {
  const { s, user, tokens } = fixture(t);
  const call = http(s);
  const { unpaidA, paid } = orders(s, user);
  const before = s.liveVersions().orders;
  const dry = await call("POST", "/api/admin/orders/bulk", tokens.admin, {
    action: "cancel",
    dryRun: true,
    ids: [unpaidA.id, paid.id],
  });
  assert.equal(dry.status, 200);
  assert.deepEqual([dry.body.ok, dry.body.skipped], [1, 1]);
  assert.equal(s.liveVersions().orders, before, "dry run is read-only");
  assert.equal(
    (await call("POST", "/api/admin/orders/bulk", tokens.staff, { action: "cancel", ids: [unpaidA.id] })).status,
    403,
  );
  const real = await call("POST", "/api/admin/orders/bulk", tokens.admin, { action: "cancel", ids: [unpaidA.id] });
  assert.equal(real.status, 200);
  assert.equal(real.body.ok, 1);
  assert.ok(s.liveVersions().orders > before);
  const exported = await call("POST", "/api/admin/orders/bulk", tokens.staff, { action: "export", filter: { group: "delivered" } });
  assert.equal(exported.status, 200);
  assert.ok(exported.body.rows.some((r) => r.id === paid.id));
  assert.ok(exported.body.rows.every((r) => r.status === "DELIVERED"));
});
