/**
 * Live chat attachments: images (upload / paste), a product card, an order card.
 *
 * - Images are uploaded first (POST /api/chat/images, raw bytes) into chat_uploads and then
 *   attached to one message by id (`imageId`), so a new thread and an open thread share the
 *   same send path. Keys start with "chat-", which the public /api/files route never serves
 *   (it only accepts hex keys): chat images are read through GET /api/chat/files/:key, which
 *   checks the reader owns the thread or is staff.
 * - `productId` links a product (customers: only products on sale). `attachOrderId` links an
 *   order or preorder of the thread's customer (the customer's own, or staff on that
 *   customer's thread). It reuses chat_messages.order_id with report_reason NULL, so the
 *   "แจ้งปัญหาบัญชีนี้" daily limit (report_reason NOT NULL) is unaffected.
 */

import { randomUUID } from "node:crypto";
import { assertAllowedImage } from "./file-store.mjs";

const CHAT_KEY = /^chat-[0-9a-f-]{36}$/;
/** Images a user may upload and not send yet (abandoned pastes) before older ones are dropped. */
const MAX_PENDING_UPLOADS = 20;

/** Idempotent schema (no numbered migration). */
export function ensureChatAttachments(db) {
  const has = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has("chat_messages", "image_key")) db.exec("ALTER TABLE chat_messages ADD COLUMN image_key TEXT");
  if (!has("chat_messages", "product_id")) db.exec("ALTER TABLE chat_messages ADD COLUMN product_id TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS chat_uploads (
    key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_chat_uploads_user ON chat_uploads(user_id, used, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_chat_messages_image ON chat_messages(image_key)");
}

export function createChatAttachments({ one, all, run, fail, clean, isStaff, requireUser, fileStore }) {
  /** Order or preorder with its product (same shape as order-extras' loader). */
  function loadOrderRow(orderId) {
    const select = (table) =>
      one(
        `SELECT o.id,o.user_id,o.status,o.total,p.name AS product,v.label AS option_label
         FROM ${table} o JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id
         WHERE o.id=?`,
        orderId,
      );
    const order = select("orders");
    if (order) return { ...order, preorder: false };
    const reservation = select("reservations");
    return reservation ? { ...reservation, preorder: true } : null;
  }
  const imageUrl = (key) => "/api/chat/files/" + key;

  async function uploadChatImage(user, { bytes, contentType }) {
    requireUser(user);
    if (!bytes || bytes.byteLength === 0) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
    const mime = assertAllowedImage(contentType, bytes, fail);
    const key = "chat-" + randomUUID();
    await fileStore.put(key, bytes, mime);
    run("INSERT INTO chat_uploads(key,user_id) VALUES(?,?)", key, user.id);
    // Abandoned uploads (pasted, never sent): keep only the newest few per user.
    const stale = all(
      "SELECT key FROM chat_uploads WHERE user_id=? AND used=0 ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?",
      user.id,
      MAX_PENDING_UPLOADS,
    );
    for (const row of stale) {
      run("DELETE FROM chat_uploads WHERE key=?", row.key);
      Promise.resolve()
        .then(() => fileStore.delete(row.key))
        .catch(() => {});
    }
    return { imageId: key, imageUrl: imageUrl(key) };
  }

  const hasAttachment = (input) => !!(input?.imageId || input?.productId || input?.attachOrderId);

  /** Validates attachments for a message on `thread` (call inside the send transaction). */
  function resolve(user, thread, input) {
    const out = { imageKey: null, productId: null, orderId: null };
    if (input?.imageId) {
      const key = clean(input.imageId, 1, 80, "รูปภาพ");
      const row = CHAT_KEY.test(key)
        ? one("SELECT key,used FROM chat_uploads WHERE key=? AND user_id=?", key, user.id)
        : null;
      if (!row) fail(404, "ไม่พบรูปที่อัปโหลด กรุณาแนบรูปใหม่");
      if (row.used) fail(409, "รูปนี้ถูกส่งไปแล้ว");
      out.imageKey = key;
    }
    if (input?.productId) {
      const id = clean(input.productId, 1, 80, "สินค้า");
      const product = one("SELECT id,active FROM products WHERE id=?", id);
      if (!product || (!isStaff(user) && !product.active)) fail(404, "ไม่พบสินค้า");
      out.productId = id;
    }
    if (input?.attachOrderId) {
      const id = clean(input.attachOrderId, 1, 80, "คำสั่งซื้อ");
      const order = loadOrderRow(id);
      if (!order || order.user_id !== thread.user_id) fail(404, "ไม่พบคำสั่งซื้อของลูกค้าคนนี้");
      out.orderId = id;
    }
    return out;
  }

  /** Stores validated attachments on the new message. */
  function attach(threadId, messageId, link) {
    if (link.imageKey) {
      run("UPDATE chat_uploads SET used=1 WHERE key=?", link.imageKey);
      run("UPDATE chat_messages SET image_key=? WHERE id=?", link.imageKey, messageId);
    }
    if (link.productId) run("UPDATE chat_messages SET product_id=? WHERE id=?", link.productId, messageId);
    if (link.orderId) {
      run("UPDATE chat_messages SET order_id=? WHERE id=?", link.orderId, messageId);
      run("UPDATE chat_threads SET order_id=? WHERE id=?", link.orderId, threadId);
    }
  }

  /** Short text for notifications when the message has no text of its own. */
  function preview(body, link) {
    if (body) return body.slice(0, 120);
    if (link.imageKey) return "[รูปภาพ]";
    if (link.productId) return "[แนบสินค้า]";
    if (link.orderId) return "[แนบคำสั่งซื้อ]";
    return "";
  }

  /** Adds imageUrl / product / order summary to message rows for the viewer. */
  function decorate(user, rows) {
    const products = new Map();
    const orders = new Map();
    return rows.map((row) => {
      const message = { ...row };
      delete message.image_key;
      message.imageUrl = row.image_key ? imageUrl(row.image_key) : null;
      message.product = null;
      if (row.product_id) {
        if (!products.has(row.product_id)) {
          const p = one("SELECT id,name,active FROM products WHERE id=?", row.product_id);
          const image = p
            ? one(
                "SELECT file_key FROM product_images WHERE product_id=? ORDER BY sort_order ASC, id ASC LIMIT 1",
                p.id,
              )
            : null;
          const price = p
            ? one("SELECT MIN(price) AS p FROM variants WHERE product_id=? AND active=1", p.id)?.p ?? null
            : null;
          products.set(
            row.product_id,
            p
              ? {
                  id: p.id,
                  name: p.name,
                  active: !!p.active,
                  price,
                  imageUrl: image ? "/api/files/" + image.file_key : null,
                }
              : null,
          );
        }
        message.product = products.get(row.product_id);
      }
      message.order = null;
      if (row.order_id) {
        if (!orders.has(row.order_id)) {
          const o = loadOrderRow(row.order_id);
          orders.set(
            row.order_id,
            o
              ? {
                  id: o.id,
                  product: o.product,
                  option: o.option_label,
                  status: o.status,
                  total: o.total,
                  preorder: !!o.preorder,
                }
              : null,
          );
        }
        message.order = orders.get(row.order_id);
      }
      return message;
    });
  }

  /** GET /api/chat/files/:key — only the thread's customer, the uploader, or staff. */
  async function chatFile(user, keyRaw) {
    requireUser(user);
    const key = typeof keyRaw === "string" ? keyRaw : "";
    if (!CHAT_KEY.test(key)) fail(404, "ไม่พบไฟล์");
    const owner = one(
      `SELECT t.user_id FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id WHERE m.image_key=? LIMIT 1`,
      key,
    );
    const uploader = one("SELECT user_id FROM chat_uploads WHERE key=?", key);
    const allowed = isStaff(user) || owner?.user_id === user.id || (!owner && uploader?.user_id === user.id);
    if (!allowed) fail(404, "ไม่พบไฟล์");
    const file = await fileStore.get(key);
    if (!file) fail(404, "ไม่พบไฟล์");
    return file;
  }

  /** PDPA deletion: drop the customer's chat images (rows first, files best-effort after). */
  function eraseUserChatImages(userId) {
    const keys = [
      ...all(
        `SELECT m.image_key AS key FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id
         WHERE t.user_id=? AND m.image_key IS NOT NULL AND m.sender_type='USER'`,
        userId,
      ),
      ...all("SELECT key FROM chat_uploads WHERE user_id=?", userId),
    ].map((r) => r.key);
    run(
      `UPDATE chat_messages SET image_key=NULL
       WHERE sender_type='USER' AND thread_id IN (SELECT id FROM chat_threads WHERE user_id=?)`,
      userId,
    );
    run("DELETE FROM chat_uploads WHERE user_id=?", userId);
    return [...new Set(keys)];
  }

  return { uploadChatImage, hasAttachment, resolve, attach, preview, decorate, chatFile, eraseUserChatImages };
}
