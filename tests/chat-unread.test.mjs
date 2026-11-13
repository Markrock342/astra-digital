// Admin inbox unread: a team member's own storefront thread never counts as unread for them,
// and reading a thread clears that person's bell alerts for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { ROLES } from "../server/auth-policy.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const admin = s.session(s.demoMerchant().token);
  const staffAuth = s.register({ name: "Unread Staff", email: "unread-staff@example.invalid", password: "Staff-only-Password-123" });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const buyer = s.session(s.register({ name: "Unread Buyer", email: "unread-buyer@example.invalid", password: "Buyer-only-Password-123" }).token);
  return { s, admin, staff: s.session(staffAuth.token), buyer };
}
const unreadOf = (s, viewer, threadId) => s.chatThreads(viewer).find((x) => x.id === threadId).unreadCount;
const openAlerts = (s, viewer) =>
  s.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND kind='chat' AND read_at IS NULL").get(viewer.id).n;

test("own storefront thread is never unread for its author, even unopened", (t) => {
  const { s, admin, staff } = fixture(t);
  const own = s.openChatThread(admin, { body: "ทดสอบแชทจากหน้าร้าน" });
  assert.equal(unreadOf(s, admin, own.thread.id), 0);
  // Another team member still sees it as a customer message.
  assert.equal(unreadOf(s, staff, own.thread.id), 1);
  s.chatMessages(staff, own.thread.id);
  assert.equal(unreadOf(s, staff, own.thread.id), 0);
});

test("reading a thread clears the reader's bell alerts for it, not other people's", (t) => {
  const { s, admin, staff, buyer } = fixture(t);
  const thread = s.openChatThread(buyer, { body: "สอบถามหน่อยครับ" });
  assert.equal(unreadOf(s, admin, thread.thread.id), 1);
  assert.equal(openAlerts(s, admin), 1);
  assert.equal(openAlerts(s, staff), 1);
  s.chatMessages(admin, thread.thread.id);
  assert.equal(unreadOf(s, admin, thread.thread.id), 0);
  assert.equal(openAlerts(s, admin), 0);
  assert.equal(openAlerts(s, staff), 1, "staff has not read it yet");
  // The buyer's own view never touches team alerts.
  s.chatMessages(buyer, thread.thread.id);
  assert.equal(openAlerts(s, staff), 1);
});
