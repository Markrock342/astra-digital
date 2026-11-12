/**
 * Product categories (table from ensureCategories in ensure-admin-fr.mjs).
 *
 * Public: visible categories that have at least one product on sale, with that count.
 * Admin (ADMIN only, every change audited):
 *   create · rename TH/EN · change icon · hide/show · reorder · change slug · delete.
 *
 * Slug change: the product rows move with it in the same transaction (one UPDATE). Nothing
 * else stores the category id (coupons scope by product, orders by variant), there is no
 * foreign key to fight, and the admin does not have to empty the category first. Old
 * /products?category=<old> links fall back to "all products" on the storefront.
 *
 * Delete: only an empty category. With `moveTo`, its products move to that category and
 * the category is deleted in one transaction (CATEGORY_MOVE_PRODUCTS + CATEGORY_DELETE).
 * "Empty" = no product the admin can see; old demo rows (hidden_seed=1, invisible
 * everywhere) are re-pointed to moveTo or the first remaining category.
 */

export const CATEGORY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ICON = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_CATEGORIES = 60;

export function createCategoryApis({ requireAdmin, one, all, run, tx, fail }) {
  const audit = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      action,
      entity,
      detail ? JSON.stringify(detail) : null,
    );
  const slug = (value, label = "รหัสหมวด") => {
    const id = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!id || id.length > 40 || !CATEGORY_ID.test(id))
      fail(400, label + "ใช้ได้เฉพาะ a-z 0-9 และขีด (-) ยาวไม่เกิน 40 ตัว");
    return id;
  };
  const text = (value, label, { optional = false, max = 40 } = {}) => {
    if (optional && (value === undefined || value === null || String(value).trim() === ""))
      return null;
    if (typeof value !== "string" || !value.trim() || value.trim().length > max)
      fail(400, label + "ต้องยาว 1–" + max + " ตัวอักษร");
    return value.trim().replace(/\s+/g, " ");
  };
  const icon = (value) => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > 60 || !ICON.test(value))
      fail(400, "ไอคอนต้องเป็นรูปจากคลังรูป");
    return value;
  };
  const exists = (id) => !!one("SELECT id FROM categories WHERE id=?", id);
  const shape = (row) => ({
    id: row.id,
    name: row.name_th,
    name_th: row.name_th,
    name_en: row.name_en ?? null,
    icon: row.icon ?? null,
    sort_order: row.sort_order,
    hidden: !!row.hidden,
    created_at: row.created_at,
    count: row.count ?? 0,
    active: row.active ?? 0,
  });
  const countsSql = `SELECT c.*,
      (SELECT COUNT(*) FROM products p WHERE p.category=c.id AND p.hidden_seed=0) AS count,
      (SELECT COUNT(*) FROM products p WHERE p.category=c.id AND p.hidden_seed=0 AND p.active=1) AS active
    FROM categories c`;
  const ordered = " ORDER BY c.sort_order ASC, c.created_at ASC, c.id ASC";
  const get = (id) => {
    const row = one(countsSql + " WHERE c.id=?", id);
    if (!row) fail(404, "ไม่พบหมวดหมู่");
    return shape(row);
  };

  /** Storefront list: not hidden and at least one product on sale. */
  function publicCategories() {
    return all(
      `SELECT c.id,c.name_th,c.name_en,c.icon,COUNT(p.id) AS count
       FROM categories c JOIN products p ON p.category=c.id AND p.active=1 AND p.hidden_seed=0
       WHERE c.hidden=0
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.created_at ASC, c.id ASC`,
    ).map((c) => ({
      id: c.id,
      name: c.name_th,
      name_en: c.name_en ?? null,
      icon: c.icon ?? null,
      count: c.count,
    }));
  }
  /** Every category with product counts (count = all products, active = on sale). */
  function listCategories() {
    return all(countsSql + ordered).map(shape);
  }
  function adminCategories(user) {
    requireAdmin(user);
    return { categories: listCategories() };
  }
  function adminCreateCategory(user, input = {}) {
    requireAdmin(user);
    const id = slug(input.id);
    const nameTh = text(input.name_th ?? input.name, "ชื่อหมวด (ไทย) ");
    const nameEn = text(input.name_en, "ชื่อหมวด (อังกฤษ) ", { optional: true });
    const iconSlug = icon(input.icon);
    const hidden = input.hidden === true ? 1 : 0;
    return tx(() => {
      if (exists(id)) fail(409, "มีหมวดรหัส " + id + " อยู่แล้ว");
      if (one("SELECT COUNT(*) AS n FROM categories").n >= MAX_CATEGORIES)
        fail(400, "มีหมวดหมู่ได้ไม่เกิน " + MAX_CATEGORIES + " หมวด");
      const last = one("SELECT COALESCE(MAX(sort_order),0) AS n FROM categories").n;
      run(
        "INSERT INTO categories(id,name_th,name_en,icon,sort_order,hidden) VALUES(?,?,?,?,?,?)",
        id,
        nameTh,
        nameEn,
        iconSlug,
        last + 10,
        hidden,
      );
      audit(user, "CATEGORY_CREATE", id, { name_th: nameTh, name_en: nameEn, icon: iconSlug, hidden: !!hidden });
      return { category: get(id) };
    });
  }
  /** Patch: name_th, name_en, icon, hidden, id (new slug; products move along). */
  function adminUpdateCategory(user, rawId, input = {}) {
    requireAdmin(user);
    const id = slug(rawId);
    const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
    const patch = {};
    if (has("name_th") || has("name")) patch.name_th = text(input.name_th ?? input.name, "ชื่อหมวด (ไทย) ");
    if (has("name_en")) patch.name_en = text(input.name_en, "ชื่อหมวด (อังกฤษ) ", { optional: true });
    if (has("icon")) patch.icon = icon(input.icon);
    if (has("hidden")) {
      if (typeof input.hidden !== "boolean") fail(400, "สถานะการแสดงไม่ถูกต้อง");
      patch.hidden = input.hidden ? 1 : 0;
    }
    const newId = has("id") ? slug(input.id, "รหัสหมวดใหม่ ") : id;
    return tx(() => {
      const before = one("SELECT * FROM categories WHERE id=?", id);
      if (!before) fail(404, "ไม่พบหมวดหมู่");
      const changed = {};
      for (const [key, value] of Object.entries(patch)) {
        if ((before[key] ?? null) === value) continue;
        changed[key] = { from: before[key] ?? null, to: key === "hidden" ? !!value : value };
        if (key === "hidden") changed[key].from = !!before.hidden;
        run(`UPDATE categories SET ${key}=? WHERE id=?`, value, id);
      }
      let moved = 0;
      if (newId !== id) {
        if (exists(newId)) fail(409, "มีหมวดรหัส " + newId + " อยู่แล้ว");
        run("UPDATE categories SET id=? WHERE id=?", newId, id);
        // Count first: on Durable Objects `changes` is rowsWritten, which includes index rows.
        moved = one("SELECT COUNT(*) AS n FROM products WHERE category=? AND hidden_seed=0", id).n;
        run("UPDATE products SET category=? WHERE category=?", newId, id);
        changed.id = { from: id, to: newId, products: moved };
      }
      if (Object.keys(changed).length) audit(user, "CATEGORY_UPDATE", newId, { changed });
      return { category: get(newId), changed: Object.keys(changed), moved };
    });
  }
  /** Full order of ids (up/down buttons send the list after the swap). */
  function adminReorderCategories(user, input = {}) {
    requireAdmin(user);
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > MAX_CATEGORIES)
      fail(400, "ลำดับหมวดหมู่ไม่ถูกต้อง");
    const ids = input.ids.map((value) => slug(value));
    if (new Set(ids).size !== ids.length) fail(400, "ลำดับหมวดหมู่ซ้ำกัน");
    return tx(() => {
      const current = all("SELECT id FROM categories ORDER BY sort_order ASC, created_at ASC, id ASC").map(
        (r) => r.id,
      );
      if (current.length !== ids.length || !ids.every((x) => current.includes(x)))
        fail(409, "รายการหมวดหมู่เปลี่ยนไปแล้ว กรุณาโหลดใหม่");
      const changed = ids.some((x, i) => current[i] !== x);
      if (changed) {
        ids.forEach((x, i) => run("UPDATE categories SET sort_order=? WHERE id=?", (i + 1) * 10, x));
        audit(user, "CATEGORY_UPDATE", "order", { changed: { order: { from: current, to: ids } } });
      }
      return { categories: listCategories(), changed };
    });
  }
  /** Move every product of `from` to `to` (inside the caller's transaction). */
  const moveAll = (user, from, to, where = "1=1") => {
    const ids = all(`SELECT id FROM products WHERE category=? AND ${where} ORDER BY id`, from).map((r) => r.id);
    if (!ids.length) return 0;
    run(`UPDATE products SET category=? WHERE category=? AND ${where}`, to, from);
    audit(user, "CATEGORY_MOVE_PRODUCTS", to, { from, to, count: ids.length, ids: ids.slice(0, 100) });
    return ids.length;
  };
  /** Delete an empty category; with moveTo, move its products there first (one transaction). */
  function adminDeleteCategory(user, rawId, input = {}) {
    requireAdmin(user);
    const id = slug(rawId);
    const moveTo =
      input.moveTo === undefined || input.moveTo === null || input.moveTo === ""
        ? null
        : slug(input.moveTo, "หมวดปลายทาง ");
    if (moveTo === id) fail(400, "เลือกหมวดปลายทางอื่น");
    return tx(() => {
      const row = one("SELECT * FROM categories WHERE id=?", id);
      if (!row) fail(404, "ไม่พบหมวดหมู่");
      // Products the admin can see (same count as the list). Old demo rows (hidden_seed)
      // are invisible everywhere; they follow along so no product points at a missing id.
      const used = one("SELECT COUNT(*) AS n FROM products WHERE category=? AND hidden_seed=0", id).n;
      let moved = 0;
      if (used && !moveTo) fail(409, `หมวดนี้มีสินค้า ${used} ชิ้น ย้ายสินค้าไปหมวดอื่นก่อนลบ`);
      if (moveTo) {
        if (!exists(moveTo)) fail(404, "ไม่พบหมวดปลายทาง");
        moved = moveAll(user, id, moveTo, "hidden_seed=0");
      }
      const leftovers = one("SELECT COUNT(*) AS n FROM products WHERE category=?", id).n;
      if (leftovers) {
        const to =
          moveTo ??
          one("SELECT id FROM categories WHERE id<>? ORDER BY sort_order ASC, created_at ASC, id ASC LIMIT 1", id)?.id;
        if (!to) fail(409, "ลบหมวดสุดท้ายไม่ได้");
        run("UPDATE products SET category=? WHERE category=?", to, id);
      }
      run("DELETE FROM categories WHERE id=?", id);
      audit(user, "CATEGORY_DELETE", id, {
        name_th: row.name_th,
        ...(moved ? { movedTo: moveTo, moved } : {}),
      });
      return { id, deleted: true, moved, moveTo: moved ? moveTo : null };
    });
  }

  return {
    exists,
    slug,
    publicCategories,
    listCategories,
    adminCategories,
    adminCreateCategory,
    adminUpdateCategory,
    adminReorderCategories,
    adminDeleteCategory,
  };
}
