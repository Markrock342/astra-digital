/**
 * Products list bulk actions + duplicate product (ADMIN only).
 * Bulk pattern follows Bagisto's mass-update (MIT): one request, a list of ids, one action.
 */

const BULK_ACTIONS = {
  activate: { column: "active", value: 1 },
  deactivate: { column: "active", value: 0 },
  feature: { column: "featured", value: 1 },
  unfeature: { column: "featured", value: 0 },
};
const COPY_SUFFIX = " (สำเนา)";

export function createAdminProductBulkApis({
  requireAdmin,
  one,
  all,
  run,
  tx,
  fail,
  clean,
  randomUUID,
}) {
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      action,
      entity,
      JSON.stringify(detail),
    );

  function bulkUpdateProducts(user, input = {}) {
    requireAdmin(user);
    const action = typeof input.action === "string" ? input.action : "";
    const change = BULK_ACTIONS[action];
    if (!change) fail(400, "คำสั่งไม่ถูกต้อง");
    if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 100)
      fail(400, "เลือกสินค้า 1–100 รายการ");
    const ids = [...new Set(input.ids.map((id) => clean(id, 1, 80, "รหัสสินค้า")))];
    return tx(() => {
      const found = all(
        `SELECT id,${change.column} AS current FROM products
         WHERE hidden_seed=0 AND id IN (${ids.map(() => "?").join(",")})`,
        ...ids,
      );
      if (found.length !== ids.length) fail(404, "ไม่พบสินค้าบางรายการ");
      const changed = found.filter((p) => Number(p.current) !== change.value).map((p) => p.id);
      if (changed.length)
        run(
          `UPDATE products SET ${change.column}=? WHERE id IN (${changed.map(() => "?").join(",")})`,
          change.value,
          ...changed,
        );
      for (const id of ids)
        auditDetail(user, "PRODUCT_BULK_" + action.toUpperCase(), id, {
          batch: ids.length,
          updated: changed.includes(id),
        });
      return { action, ids, updated: changed.length, unchanged: ids.length - changed.length };
    });
  }

  /**
   * Draft copy: name + " (สำเนา)", details, variants (price, warranty, order) and image rows.
   * Image files are shared by key (delete keeps a file another row still uses).
   * Stock, orders and reviews are never copied; the copy starts hidden and not featured.
   */
  function duplicateProduct(user, productIdRaw) {
    requireAdmin(user);
    const sourceId = clean(productIdRaw, 1, 80, "สินค้า");
    return tx(() => {
      const source = one("SELECT * FROM products WHERE id=? AND hidden_seed=0", sourceId);
      if (!source) fail(404, "ไม่พบสินค้า");
      const id = randomUUID();
      const name = source.name.slice(0, 80 - COPY_SUFFIX.length).trimEnd() + COPY_SUFFIX;
      run(
        "INSERT INTO products(id,name,category,description,art,active,featured,preorder) VALUES(?,?,?,?,?,0,0,?)",
        id,
        name,
        source.category,
        source.description,
        source.art,
        source.preorder ? 1 : 0,
      );
      if (source.usage_instructions)
        run("UPDATE products SET usage_instructions=? WHERE id=?", source.usage_instructions, id);
      const variants = all(
        "SELECT * FROM variants WHERE product_id=? ORDER BY sort_order ASC, id ASC",
        sourceId,
      );
      for (const v of variants)
        run(
          "INSERT INTO variants(id,product_id,label,price,active,sort_order,warranty_days) VALUES(?,?,?,?,?,?,?)",
          id + "-" + randomUUID().slice(0, 8),
          id,
          v.label,
          v.price,
          v.active == null ? 1 : v.active ? 1 : 0,
          v.sort_order ?? 0,
          v.warranty_days ?? 0,
        );
      const images = all(
        "SELECT file_key,sort_order FROM product_images WHERE product_id=? ORDER BY sort_order ASC, id ASC",
        sourceId,
      );
      for (const image of images)
        run(
          "INSERT INTO product_images(id,product_id,file_key,sort_order) VALUES(?,?,?,?)",
          randomUUID(),
          id,
          image.file_key,
          image.sort_order,
        );
      auditDetail(user, "DUPLICATE_PRODUCT", id, {
        from: sourceId,
        variants: variants.length,
        images: images.length,
      });
      return { id, name, active: false, variants: variants.length, images: images.length };
    });
  }

  return { bulkUpdateProducts, duplicateProduct };
}
