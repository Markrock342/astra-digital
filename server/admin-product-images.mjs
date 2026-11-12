/** Admin FR W5 UP-1 — product image upload / reorder / delete. */

import { randomUUID } from "node:crypto";
import { assertAllowedImage } from "./file-store.mjs";

export function createAdminProductImageApis({
  requireAdmin,
  one,
  all,
  run,
  tx,
  fail,
  clean,
  audit,
  fileStore,
}) {
  function fileUrl(key) {
    return "/api/files/" + key;
  }

  function listProductImages(productId) {
    return all(
      `SELECT id, file_key, sort_order FROM product_images
       WHERE product_id=? ORDER BY sort_order ASC, id ASC`,
      productId,
    ).map((row) => ({
      id: row.id,
      url: fileUrl(row.file_key),
      sort_order: row.sort_order,
    }));
  }

  function productImageFields(productId) {
    const images = listProductImages(productId).map(({ id, url }) => ({
      id,
      url,
    }));
    return {
      images,
      imageUrl: images[0]?.url ?? null,
    };
  }

  async function addProductImage(user, productIdRaw, { bytes, contentType }) {
    requireAdmin(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    if (!one("SELECT id FROM products WHERE id=?", productId))
      fail(404, "ไม่พบสินค้า");
    if (!bytes || bytes.byteLength === 0) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
    const mime = assertAllowedImage(contentType, bytes, fail);

    const key = randomUUID();
    const id = randomUUID();
    // Store bytes first; count+insert inside tx so concurrent uploads cannot exceed 8.
    await fileStore.put(key, bytes, mime);
    let sortOrder;
    try {
      tx(() => {
        const count = one(
          "SELECT COUNT(*) AS n FROM product_images WHERE product_id=?",
          productId,
        ).n;
        if (count >= 8) fail(409, "อัปโหลดรูปสินค้าได้สูงสุด 8 รูป");
        sortOrder = count;
        run(
          "INSERT INTO product_images(id,product_id,file_key,sort_order) VALUES(?,?,?,?)",
          id,
          productId,
          key,
          sortOrder,
        );
        audit(user, "PRODUCT_IMAGE_ADD", id);
      });
    } catch (error) {
      try {
        await fileStore.delete(key);
      } catch {
        /* best-effort rollback of orphan file */
      }
      throw error;
    }
    return {
      image: { id, url: fileUrl(key), sort_order: sortOrder },
    };
  }

  function reorderProductImages(user, productIdRaw, input = {}) {
    requireAdmin(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    if (!one("SELECT id FROM products WHERE id=?", productId))
      fail(404, "ไม่พบสินค้า");
    const order = input.order;
    if (!Array.isArray(order) || order.length === 0)
      fail(400, "ลำดับรูปไม่ถูกต้อง");
    const existing = all(
      "SELECT id FROM product_images WHERE product_id=? ORDER BY sort_order ASC, id ASC",
      productId,
    ).map((r) => r.id);
    if (order.length !== existing.length)
      fail(400, "ต้องส่งรหัสรูปครบทุกชิ้น");
    const seen = new Set();
    for (const raw of order) {
      const id = clean(raw, 1, 80, "รหัสรูป");
      if (seen.has(id)) fail(400, "ลำดับรูปซ้ำ");
      seen.add(id);
      if (!existing.includes(id)) fail(400, "มีรหัสรูปที่ไม่ใช่ของสินค้านี้");
    }
    tx(() => {
      order.forEach((id, index) => {
        run(
          "UPDATE product_images SET sort_order=? WHERE id=? AND product_id=?",
          index,
          id,
          productId,
        );
      });
      audit(user, "PRODUCT_IMAGE_REORDER", productId);
    });
    return { images: listProductImages(productId).map(({ id, url }) => ({ id, url })) };
  }

  async function deleteProductImage(user, imageIdRaw) {
    requireAdmin(user);
    const imageId = clean(imageIdRaw, 1, 80, "รหัสรูป");
    const row = one("SELECT * FROM product_images WHERE id=?", imageId);
    if (!row) fail(404, "ไม่พบรูปสินค้า");
    tx(() => {
      run("DELETE FROM product_images WHERE id=?", imageId);
      const rest = all(
        "SELECT id FROM product_images WHERE product_id=? ORDER BY sort_order ASC, id ASC",
        row.product_id,
      );
      rest.forEach((r, index) => {
        run("UPDATE product_images SET sort_order=? WHERE id=?", index, r.id);
      });
      audit(user, "PRODUCT_IMAGE_REMOVE", imageId);
    });
    try {
      await fileStore.delete(row.file_key);
    } catch (error) {
      console.error("Failed to delete product image file", row.file_key, error.message);
    }
    return { id: imageId, deleted: true };
  }

  async function getFile(keyRaw) {
    const key = clean(keyRaw, 1, 80, "ไฟล์");
    // UUID shape (loose) — reject path tricks
    if (!/^[0-9a-fA-F-]{8,80}$/.test(key)) fail(404, "ไม่พบไฟล์");
    const file = await fileStore.get(key);
    if (!file) fail(404, "ไม่พบไฟล์");
    return file;
  }

  return {
    listProductImages,
    productImageFields,
    addProductImage,
    reorderProductImages,
    deleteProductImage,
    getFile,
    fileUrl,
  };
}
