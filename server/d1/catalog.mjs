import { ApiError } from "../domain.mjs";

const fail = (status, message) => {
  throw new ApiError(status, message);
};

function mapProduct(db, product) {
  const variants = db
    .prepare(
      `SELECT v.id, v.label, v.price,
        CASE WHEN ? = 1 THEN 0 ELSE (
          SELECT COUNT(*) FROM inventory_units u
          LEFT JOIN allocations a ON a.inventory_unit_id = u.id
          WHERE u.variant_id = v.id AND a.id IS NULL
        ) END AS stock
       FROM variants v
       WHERE v.product_id = ?
       ORDER BY v.price ASC, v.id ASC`,
    )
    .all(product.preorder, product.id)
    .map((v) => ({
      id: v.id,
      label: v.label,
      price: v.price,
      stock: v.stock,
    }));

  const rating = db
    .prepare(
      `SELECT AVG(r.rating) AS average, COUNT(*) AS count
       FROM reviews r
       JOIN orders o ON o.id = r.order_id
       JOIN variants v ON v.id = o.variant_id
       WHERE v.product_id = ?`,
    )
    .get(product.id);

  const sold = db
    .prepare(
      `SELECT COALESCE(SUM(o.quantity), 0) AS count
       FROM orders o
       JOIN variants v ON v.id = o.variant_id
       WHERE v.product_id = ? AND o.status = 'DELIVERED'`,
    )
    .get(product.id).count;

  return {
    id: product.id,
    name: product.name,
    category: product.category,
    description: product.description,
    art: product.art,
    featured: !!product.featured,
    preorder: !!product.preorder,
    variants,
    rating: {
      average: rating.average == null ? null : Number(rating.average),
      count: rating.count,
    },
    sold,
  };
}

/** Public catalog reads against D1 target schema — never returns secrets. */
export function createD1Catalog(db) {
  function listProducts() {
    const rows = db
      .prepare(
        `SELECT id, name, category, description, art, featured, preorder
         FROM products
         WHERE active = 1 AND hidden_seed = 0
         ORDER BY featured DESC, name ASC`,
      )
      .all();
    return rows.map((row) => mapProduct(db, row));
  }

  function getProduct(id) {
    if (typeof id !== "string" || !id.trim()) fail(400, "รหัสสินค้าไม่ถูกต้อง");
    const row = db
      .prepare(
        `SELECT id, name, category, description, art, featured, preorder
         FROM products
         WHERE id = ? AND active = 1 AND hidden_seed = 0`,
      )
      .get(id.trim());
    if (!row) fail(404, "ไม่พบสินค้า");
    return mapProduct(db, row);
  }

  return { listProducts, getProduct, storageKind: "d1-schema-sqlite" };
}
