// Live chat attachments: image upload (private file), product card, order card, PDPA erase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ensureChatAttachments } from "../server/chat-attachments.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { randomBytes, scryptSync } from "node:crypto";

function png() {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const reg = (name, email) => s.register({ name, email, password: "Chat-attach-Pass-123" });
  const userAuth = reg("Chat Buyer", "chat-buyer@example.invalid");
  const otherAuth = reg("Chat Other", "chat-other@example.invalid");
  const staffAuth = reg("Chat Staff", "chat-staff@example.invalid");
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const product = s.saveProduct(admin, {
    name: "Chat Stream",
    description: "สินค้าทดสอบแชท",
    category: "streaming",
    price: 9900,
    active: true,
    firstLabel: "1 เดือน",
  });
  const hidden = s.saveProduct(admin, {
    name: "Hidden Draft",
    description: "ฉบับร่าง",
    category: "streaming",
    price: 9900,
    active: false,
    firstLabel: "1 เดือน",
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  s.importCodes(admin, { variantId, items: [{ loginId: "chat-acc", password: "pw" }] });
  const user = s.session(userAuth.token);
  const order = s.createOrder(user, { variantId, quantity: 1, requestKey: "chat-order-1" });
  return {
    s,
    user,
    other: s.session(otherAuth.token),
    staff: s.session(staffAuth.token),
    admin,
    product,
    hidden,
    order,
    tokens: { user: userAuth.token, other: otherAuth.token, staff: staffAuth.token, admin: adminAuth.token },
  };
}

const handlerCall = async (s, method, path, token, body, raw) => {
  const handle = createAPIHandler(s);
  const response = await handle(
    new Request("http://127.0.0.1" + path, {
      method,
      headers: {
        ...(token ? { Cookie: "astra_session=" + token } : {}),
        "Content-Type": raw ? "image/png" : "application/json",
        "X-Astra-Request": "1",
      },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
  );
  const type = response.headers.get("Content-Type") ?? "";
  return {
    status: response.status,
    headers: response.headers,
    data: type.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer()),
  };
};

test("ensureChatAttachments is idempotent", (t) => {
  const { s } = fixture(t);
  ensureChatAttachments(s.db);
  ensureChatAttachments(s.db);
  const cols = s.db.prepare("PRAGMA table_info(chat_messages)").all().map((c) => c.name);
  assert.ok(cols.includes("image_key") && cols.includes("product_id"));
});

test("image: upload, send without text, private file readable by owner + staff only", async (t) => {
  const { s, user, tokens } = fixture(t);
  const up = await handlerCall(s, "POST", "/api/chat/images", tokens.user, undefined, png());
  assert.equal(up.status, 201);
  assert.match(up.data.imageId, /^chat-/);
  // A new thread can start with just an image.
  const opened = s.openChatThread(user, { imageId: up.data.imageId });
  const message = opened.messages.at(-1);
  assert.equal(message.body, "");
  assert.equal(message.imageUrl, "/api/chat/files/" + up.data.imageId);
  assert.equal(message.image_key, undefined, "raw key column is not exposed");
  // Same upload cannot be sent twice.
  assert.throws(() => s.postChatMessage(user, opened.thread.id, { imageId: up.data.imageId }), /ส่งไปแล้ว/);

  const path = "/api/chat/files/" + up.data.imageId;
  const mine = await handlerCall(s, "GET", path, tokens.user);
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get("Cache-Control"), "private, max-age=86400");
  assert.equal((await handlerCall(s, "GET", path, tokens.staff)).status, 200);
  assert.equal((await handlerCall(s, "GET", path, tokens.other)).status, 404);
  assert.equal((await handlerCall(s, "GET", path)).status, 401);
  // Never served by the public product-image route.
  assert.equal((await handlerCall(s, "GET", "/api/files/" + up.data.imageId)).status, 404);
});

test("image: someone else's upload id cannot be attached", async (t) => {
  const { s, other, user, tokens } = fixture(t);
  const up = await handlerCall(s, "POST", "/api/chat/images", tokens.other, undefined, png());
  assert.throws(() => s.openChatThread(user, { imageId: up.data.imageId }), /ไม่พบรูป/);
  assert.ok(s.openChatThread(other, { imageId: up.data.imageId }).messages.at(-1).imageUrl);
});

test("product card: customers attach on-sale products only; staff may attach drafts", (t) => {
  const { s, user, staff, product, hidden } = fixture(t);
  const opened = s.openChatThread(user, { body: "สนใจตัวนี้", productId: product.id });
  const card = opened.messages.at(-1).product;
  assert.equal(card.id, product.id);
  assert.equal(card.name, "Chat Stream");
  assert.equal(card.price, 9900);
  assert.throws(() => s.postChatMessage(user, opened.thread.id, { productId: hidden.id }), /ไม่พบสินค้า/);
  const staffSees = s.postChatMessage(staff, opened.thread.id, { productId: hidden.id });
  assert.equal(staffSees.at(-1).product.id, hidden.id);
  assert.equal(staffSees.at(-1).sender_type, "STAFF");
});

test("order card: own order only; staff only the thread customer's orders; no report limit used", (t) => {
  const { s, user, other, staff, order } = fixture(t);
  const opened = s.openChatThread(user, { attachOrderId: order.id });
  const last = opened.messages.at(-1);
  assert.equal(last.order_id, order.id);
  assert.equal(last.report_reason, null);
  assert.equal(last.order.product, "Chat Stream");
  assert.equal(last.order.option, "1 เดือน");
  assert.equal(s.db.prepare("SELECT order_id FROM chat_threads WHERE id=?").get(opened.thread.id).order_id, order.id);
  assert.throws(() => s.openChatThread(other, { attachOrderId: order.id }), /ไม่พบคำสั่งซื้อ/);
  const otherThread = s.openChatThread(other, { body: "สวัสดี" });
  assert.throws(() => s.postChatMessage(staff, otherThread.thread.id, { attachOrderId: order.id }), /ไม่พบคำสั่งซื้อ/);
  assert.equal(s.postChatMessage(staff, opened.thread.id, { body: "ดูให้แล้ว", attachOrderId: order.id }).at(-1).order.id, order.id);
});

test("empty message without attachments is still rejected; notifications get a preview", (t) => {
  const { s, user, staff, product } = fixture(t);
  const opened = s.openChatThread(user, { body: "สวัสดี" });
  assert.throws(() => s.postChatMessage(user, opened.thread.id, { body: "" }), /ข้อความไม่ถูกต้อง/);
  s.postChatMessage(staff, opened.thread.id, { productId: product.id });
  const note = s.db
    .prepare("SELECT body FROM notifications WHERE user_id=? AND title='มีข้อความใหม่จากทีมงาน' ORDER BY rowid DESC LIMIT 1")
    .get(user.id);
  assert.equal(note.body, "[แนบสินค้า]");
});

test("PDPA deletion removes the customer's chat images", async (t) => {
  const { s, user, admin, tokens } = fixture(t);
  const pw = "Boss-Chat-Pass-123";
  const salt = randomBytes(16).toString("hex");
  s.db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(salt + ":" + scryptSync(pw, salt, 64).toString("hex"), admin.id);
  const up = await handlerCall(s, "POST", "/api/chat/images", tokens.user, undefined, png());
  const unsent = await handlerCall(s, "POST", "/api/chat/images", tokens.user, undefined, png());
  s.openChatThread(user, { imageId: up.data.imageId });
  const req = s.requestAccountDeletion(user, { reason: "ลบบัญชี" });
  s.approvePrivacyDeletion(s.session(tokens.admin), req.id, { currentPassword: pw });
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE image_key IS NOT NULL").get().n, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM chat_uploads").get().n, 0);
  await new Promise((r) => setTimeout(r, 10));
  for (const key of [up.data.imageId, unsent.data.imageId])
    assert.equal((await handlerCall(s, "GET", "/api/chat/files/" + key, tokens.staff)).status, 404, "file deleted");
});
