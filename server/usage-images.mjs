/**
 * Pictures for "วิธีใช้งานหลังซื้อ" (client, 21 Nov: usage instructions take text AND images).
 * Same rules as product images (assertAllowedImage, fileStore, unguessable uuid keys served by
 * /api/files/:key); at most USAGE_IMAGES_MAX per product, shown under the text in order.
 *
 *   POST   /api/admin/products/:id/usage-images   (raw image body) → { images }
 *   DELETE /api/admin/usage-images/:imageId                        → { images }
 *   customer order extras: usageImages [{ id, url }]
 */
import { randomUUID } from "node:crypto";
import { assertAllowedImage } from "./file-store.mjs";

export const USAGE_IMAGES_MAX = 6;

export function ensureUsageImages(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS product_usage_images (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    file_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_usage_images_product ON product_usage_images(product_id, sort_order)");
}

export function createUsageImageApis({ requireAdmin, one, all, run, tx, fail, clean, audit, fileStore }) {
  const list = (productId) =>
    all(
      "SELECT id, file_key FROM product_usage_images WHERE product_id=? ORDER BY sort_order, created_at, id",
      productId,
    ).map((r) => ({ id: r.id, url: "/api/files/" + r.file_key }));

  async function addUsageImage(user, productIdRaw, { bytes, contentType }) {
    requireAdmin(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    if (!one("SELECT id FROM products WHERE id=?", productId)) fail(404, "ไม่พบสินค้า");
    if (!bytes || bytes.byteLength === 0) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
    const mime = assertAllowedImage(contentType, bytes, fail);
    const key = randomUUID();
    const id = randomUUID();
    await fileStore.put(key, bytes, mime);
    try {
      tx(() => {
        const n = one("SELECT COUNT(*) AS n FROM product_usage_images WHERE product_id=?", productId).n;
        if (n >= USAGE_IMAGES_MAX) fail(409, `ใส่รูปวิธีใช้งานได้สูงสุด ${USAGE_IMAGES_MAX} รูป`);
        run(
          "INSERT INTO product_usage_images(id,product_id,file_key,sort_order) VALUES(?,?,?,?)",
          id,
          productId,
          key,
          n,
        );
        audit(user, "USAGE_IMAGE_ADD", productId);
      });
    } catch (error) {
      try {
        await fileStore.delete(key);
      } catch {
        /* best effort */
      }
      throw error;
    }
    return { images: list(productId) };
  }

  async function removeUsageImage(user, imageIdRaw) {
    requireAdmin(user);
    const imageId = clean(imageIdRaw, 1, 80, "รูป");
    const row = one("SELECT id, product_id, file_key FROM product_usage_images WHERE id=?", imageId);
    if (!row) fail(404, "ไม่พบรูป");
    tx(() => {
      run("DELETE FROM product_usage_images WHERE id=?", imageId);
      audit(user, "USAGE_IMAGE_REMOVE", row.product_id);
    });
    try {
      await fileStore.delete(row.file_key);
    } catch {
      /* best effort: the row is gone, the file is unreachable from the shop */
    }
    return { images: list(row.product_id) };
  }

  return { usageImages: list, addUsageImage, removeUsageImage };
}
