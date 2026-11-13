// Team inbox pins are shared, capped at 20, and search matches name, email, message, and order id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { ensureChatPins } from "../server/ensure-admin-fr.mjs";
import { ROLES } from "../server/auth-policy.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const admin = s.session(s.demoMerchant().token);
  const staffAuth = s.register({ name: "Pin Staff", email: "pin-staff@example.invalid", password: "Staff-only-Password-123" });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  return { s, admin, staff: s.session(staffAuth.token) };
}
function buyer(s, name, email) {
  return s.session(s.register({ name, email, password: "Buyer-only-Password-123" }).token);
}
const ids = (rows) => rows.map((row) => row.id);

test("pin and unpin reorder newest pin first and stay on a closed thread", async (t) => {
  const { s, admin, staff } = fixture(t);
  const older = s.openChatThread(buyer(s, "คนเก่า", "pin-old@example.invalid"), { body: "แชทเก่า" });
  const newer = s.openChatThread(buyer(s, "คนใหม่", "pin-new@example.invalid"), { body: "แชทใหม่" });
  s.db.prepare("UPDATE chat_messages SET created_at=datetime('now','+5 seconds') WHERE thread_id=?").run(newer.thread.id);
  assert.equal(ids(s.chatThreads(admin))[0], newer.thread.id);
  const pinned = s.pinChatThread(staff, older.thread.id, { pinned: true });
  assert.equal(pinned.pinned_at != null, true);
  assert.equal(ids(s.chatThreads(admin))[0], older.thread.id);
  await new Promise((r) => setTimeout(r, 1100));
  s.pinChatThread(admin, newer.thread.id, { pinned: true });
  const both = s.chatThreads(staff);
  assert.deepEqual(ids(both).slice(0, 2), [newer.thread.id, older.thread.id]);
  s.closeChatThread(admin, older.thread.id);
  assert.equal(s.chatThreads(admin).find((row) => row.id === older.thread.id).pinned_at != null, true);
  s.pinChatThread(staff, older.thread.id, { pinned: false });
  const after = s.chatThreads(admin);
  assert.equal(after.find((row) => row.id === older.thread.id).pinned_at, null);
  assert.equal(ids(after)[0], newer.thread.id);
  const audit = s.db.prepare("SELECT action FROM audit WHERE entity_id=? AND action IN ('CHAT_PIN','CHAT_UNPIN') ORDER BY rowid").all(older.thread.id);
  assert.deepEqual(audit.map((row) => row.action), ["CHAT_PIN", "CHAT_UNPIN"]);
});

test("the 21st pin is refused and a customer cannot pin or see pin fields", (t) => {
  const { s, admin, staff } = fixture(t);
  const threads = [];
  for (let i = 0; i < 21; i++) {
    threads.push(s.openChatThread(buyer(s, "ปัก " + i, `pin-cap-${i}@example.invalid`), { body: "ปัก " + i }).thread.id);
  }
  for (let i = 0; i < 20; i++) s.pinChatThread(staff, threads[i], { pinned: true });
  assert.throws(() => s.pinChatThread(admin, threads[20], { pinned: true }), (e) => e.status === 400 && /20/.test(e.message));
  const customer = buyer(s, "ลูกค้าปัก", "pin-customer@example.invalid");
  const own = s.openChatThread(customer, { body: "ของฉัน" });
  assert.throws(() => s.pinChatThread(customer, own.thread.id, { pinned: true }), (e) => e.status === 403);
  const mine = s.chatThreads(customer, { q: "ปัก" });
  assert.equal(mine.some((row) => row.id === own.thread.id), true);
  assert.equal(mine.some((row) => "pinned_at" in row || "pinned_by" in row), false);
  assert.equal(s.chatThreads(customer).some((row) => row.id === threads[0]), false);
});

test("search matches name, email, both message sides, and an order id with or without #", (t) => {
  const { s, admin, staff } = fixture(t);
  const person = buyer(s, "สมชายค้นหา", "pin-mail@example.invalid");
  const thread = s.openChatThread(person, { body: "ข้อความลูกค้าสีฟ้า" });
  s.postChatMessage(staff, thread.thread.id, { body: "ข้อความทีมสีเขียว" });
  const orderId = "66af8b46-1111-4222-8333-444444444444";
  s.db.prepare("UPDATE chat_threads SET order_id=? WHERE id=?").run(orderId, thread.thread.id);
  s.db.prepare("UPDATE chat_messages SET order_id=? WHERE thread_id=? AND sender_type='USER'").run(orderId, thread.thread.id);
  const other = s.openChatThread(buyer(s, "คนอื่น", "pin-other@example.invalid"), { body: "ไม่เกี่ยวกับ" });
  const hit = (q) => s.chatThreads(admin, { q }).map((row) => row.id);
  for (const q of ["สมชายค้นหา", "pin-mail", "ข้อความลูกค้าสีฟ้า", "ข้อความทีมสีเขียว", "#66AF8B46", "66af8b46"]) {
    assert.deepEqual(hit(q), [thread.thread.id], q);
  }
  const fromMessage = s.chatThreads(staff, { q: "สีเขียว" })[0];
  assert.match(fromMessage.matchText, /สีเขียว/);
  assert.equal(fromMessage.matchText.length <= 62, true);
  assert.equal(s.chatThreads(admin, { q: "สมชายค้นหา" })[0].matchText, null);
  assert.equal(hit("ไม่มีคำนี้").includes(other.thread.id), false);
});

test("search escapes % and _ and rejects an empty or oversized query the same as the normal list", (t) => {
  const { s, admin } = fixture(t);
  const marked = s.openChatThread(buyer(s, "มีเปอร์เซ็นต์", "pin-pct@example.invalid"), { body: "ลด 100% วันนี้" });
  s.openChatThread(buyer(s, "ab", "pin-wild@example.invalid"), { body: "ตัวอักษรสองตัว" });
  assert.deepEqual(ids(s.chatThreads(admin, { q: "%" })), [marked.thread.id]);
  assert.deepEqual(ids(s.chatThreads(admin, { q: "_" })), []);
  assert.doesNotThrow(() => s.chatThreads(admin, { q: "'" }));
  assert.deepEqual(ids(s.chatThreads(admin, { q: "   " })), ids(s.chatThreads(admin)));
  assert.throws(() => s.chatThreads(admin, { q: "ก".repeat(81) }), (e) => e.status === 400);
  ensureChatPins(s.db);
  const columns = s.db.prepare("PRAGMA table_info(chat_threads)").all().map((col) => col.name);
  assert.equal(columns.includes("pinned_at") && columns.includes("pinned_by"), true);
});
