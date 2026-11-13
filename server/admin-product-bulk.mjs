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
  categoryExists = () => true,
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
    if (action === "move") return bulkMoveProducts(user, input);
    const change = BULK_ACTIONS[action];
    if (!change) fail(400, "คำสั่งไม่ถูกต้อง");
    const ids = pickedIds(input);
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

  function pickedIds(input) {
    if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 100)
      fail(400, "เลือกสินค้า 1–100 รายการ");
    return [...new Set(input.ids.map((id) => clean(id, 1, 80, "รหัสสินค้า")))];
  }

  /** "ย้ายหมวด…": the picked products go to one category in one transaction. */
  function bulkMoveProducts(user, input) {
    const category = typeof input.category === "string" ? input.category.trim() : "";
    if (!category) fail(400, "เลือกหมวดปลายทาง");
    const ids = pickedIds(input);
    return tx(() => {
      if (!categoryExists(category)) fail(404, "ไม่พบหมวดปลายทาง");
      const found = all(
        `SELECT id,category FROM products
         WHERE hidden_seed=0 AND id IN (${ids.map(() => "?").join(",")})`,
        ...ids,
      );
      if (found.length !== ids.length) fail(404, "ไม่พบสินค้าบางรายการ");
      const changed = found.filter((p) => p.category !== category);
      if (changed.length)
        run(
          `UPDATE products SET category=? WHERE id IN (${changed.map(() => "?").join(",")})`,
          category,
          ...changed.map((p) => p.id),
        );
      for (const p of found)
        auditDetail(user, "PRODUCT_BULK_MOVE", p.id, {
          batch: ids.length,
          from: p.category,
          to: category,
          updated: p.category !== category,
        });
      if (changed.length)
        auditDetail(user, "CATEGORY_MOVE_PRODUCTS", category, {
          to: category,
          count: changed.length,
          from: [...new Set(changed.map((p) => p.category))],
          ids: changed.map((p) => p.id),
        });
      return {
        action: "move",
        category,
        ids,
        updated: changed.length,
        unchanged: ids.length - changed.length,
      };
    });
  }

  /**
   * Draft copy: name + " (สำเนา)", details, variants (price, warranty, order, pricing rules)
   * and image rows. Image files are shared by key (delete keeps a file another row still uses).
   * Stock, orders and reviews are never copied; the copy starts hidden and not featured.
   * Pricing (compare_at / sale_* / max_per_customer / variant_tag_prices) follows the source
   * via an old→new variant id map inside the same transaction.
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
      if (source.max_per_customer != null)
        run("UPDATE products SET max_per_customer=? WHERE id=?", source.max_per_customer, id);
      // Delivery type + checkout fields (delivery.mjs) follow the copy; stock never does.
      if (source.delivery_type != null)
        run(
          "UPDATE products SET delivery_type=?, delivery_fields=? WHERE id=?",
          source.delivery_type,
          source.delivery_fields ?? null,
          id,
        );
      const variants = all(
        "SELECT * FROM variants WHERE product_id=? ORDER BY sort_order ASC, id ASC",
        sourceId,
      );
      const variantMap = new Map();
      for (const v of variants) {
        const newVariantId = id + "-" + randomUUID().slice(0, 8);
        variantMap.set(v.id, newVariantId);
        run(
          `INSERT INTO variants(
             id,product_id,label,price,active,sort_order,warranty_days,
             compare_at,sale_price,sale_starts_at,sale_ends_at,max_per_customer
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          newVariantId,
          id,
          v.label,
          v.price,
          v.active == null ? 1 : v.active ? 1 : 0,
          v.sort_order ?? 0,
          v.warranty_days ?? 0,
          v.compare_at ?? null,
          v.sale_price ?? null,
          v.sale_starts_at ?? null,
          v.sale_ends_at ?? null,
          v.max_per_customer ?? null,
        );
      }
      let tagPrices = 0;
      for (const [oldId, newId] of variantMap) {
        const rows = all(
          "SELECT tag,price FROM variant_tag_prices WHERE variant_id=? ORDER BY tag",
          oldId,
        );
        for (const row of rows) {
          run(
            "INSERT INTO variant_tag_prices(variant_id,tag,price,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)",
            newId,
            row.tag,
            row.price,
          );
          tagPrices += 1;
        }
      }
      // Preorder "วิธีจอง" (deposit / free, preorder.mjs) follows the copy too.
      if (one("SELECT name FROM sqlite_master WHERE type='table' AND name='preorder_settings'"))
        run(
          `INSERT INTO preorder_settings(product_id,mode,deposit_type,deposit_value,pay_window_hours,lapse_policy,max_per_customer,queue_limit,updated_by)
           SELECT ?,mode,deposit_type,deposit_value,pay_window_hours,lapse_policy,max_per_customer,queue_limit,? FROM preorder_settings WHERE product_id=?`,
          id,
          user.id,
          sourceId,
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
        tagPrices,
        productMaxPerCustomer: source.max_per_customer ?? null,
      });
      return { id, name, active: false, variants: variants.length, images: images.length };
    });
  }

  return { bulkUpdateProducts, duplicateProduct };
}
