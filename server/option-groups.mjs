/**
 * Option groups (ตัวเลือกหลายชั้น): up to 4 named groups per product (แพ็กเกจ / ประเภทบัญชี /
 * ระยะเวลา / ประกัน), each with values. Every combination is a normal variant, so price, stock,
 * orders, pricing rules, limits, preorder and receipts keep working on variants unchanged;
 * variant_options only names a variant (one value per group) and its label is the joined values.
 *
 * Schema: ensureDeliveryOptions (ensure-admin-fr.mjs).
 */

export const MAX_GROUPS = 4;
const MAX_VALUES = 30;
const MAX_COMBOS = 200;
export const LABEL_JOIN = " / ";

/** Every combination of value ids, first group outermost (sort order of the grid). */
export function combinations(groups) {
  let out = [[]];
  for (const g of groups) {
    const next = [];
    for (const combo of out) for (const v of g.values) next.push([...combo, v]);
    out = next;
  }
  return groups.length ? out : [];
}

export function createOptionGroupApis({
  one,
  all,
  run,
  tx,
  fail,
  clean,
  integer,
  requireAdmin,
  requireStaff,
  randomUUID,
}) {
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      JSON.stringify(detail ?? {}),
    );

  /** Groups of one product with their values, in display order. */
  function groupsFor(productId) {
    const groups = all(
      "SELECT id,name,sort_order FROM product_option_groups WHERE product_id=? ORDER BY sort_order ASC, id ASC",
      productId,
    );
    if (!groups.length) return [];
    const values = all(
      "SELECT id,group_id,label,sort_order FROM product_option_values WHERE product_id=? ORDER BY sort_order ASC, id ASC",
      productId,
    );
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      values: values.filter((v) => v.group_id === g.id).map((v) => ({ id: v.id, label: v.label })),
    }));
  }
  /** variantId → { groupId: valueId } for one product. */
  function mappingFor(productId) {
    const map = new Map();
    for (const row of all(
      `SELECT o.variant_id,o.group_id,o.value_id FROM variant_options o
       JOIN variants v ON v.id=o.variant_id WHERE v.product_id=?`,
      productId,
    )) {
      if (!map.has(row.variant_id)) map.set(row.variant_id, {});
      map.get(row.variant_id)[row.group_id] = row.value_id;
    }
    return map;
  }
  const hasGroups = (productId) =>
    !!one("SELECT 1 AS y FROM product_option_groups WHERE product_id=? LIMIT 1", productId);

  /**
   * Storefront: groups + each variant's options. Variants that do not name a full combination
   * are left out of the picker (the caller drops them) so the customer only meets real combos.
   */
  function publicOptions(productId) {
    const groups = groupsFor(productId);
    if (!groups.length) return { optionGroups: [], options: new Map() };
    const map = mappingFor(productId);
    const complete = new Map();
    for (const [variantId, opts] of map)
      if (groups.every((g) => opts[g.id])) complete.set(variantId, opts);
    return { optionGroups: groups, options: complete };
  }

  /** Admin grid data: groups + mapping (prices / stock come from the variants API). */
  function adminOptionGroups(user, productIdRaw) {
    requireStaff(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    if (!one("SELECT id FROM products WHERE id=?", productId)) fail(404, "ไม่พบสินค้า");
    const groups = groupsFor(productId);
    const map = mappingFor(productId);
    return {
      productId,
      groups,
      options: Object.fromEntries([...map].filter(([, o]) => groups.every((g) => o[g.id]))),
    };
  }

  const variantUsed = (variantId) =>
    one("SELECT COUNT(*) AS n FROM orders WHERE variant_id=?", variantId).n +
      one("SELECT COUNT(*) AS n FROM reservations WHERE variant_id=?", variantId).n +
      one("SELECT COUNT(*) AS n FROM inventory WHERE variant_id=?", variantId).n +
      one("SELECT COUNT(*) AS n FROM stock_watch WHERE variant_id=?", variantId).n >
    0;
  /** A variant that no longer names a combination: deleted when unused, else closed. */
  function retire(variantId) {
    run("DELETE FROM variant_options WHERE variant_id=?", variantId);
    if (variantUsed(variantId)) run("UPDATE variants SET active=0 WHERE id=?", variantId);
    else {
      run("DELETE FROM variant_tag_prices WHERE variant_id=?", variantId);
      run("DELETE FROM variants WHERE id=?", variantId);
    }
  }

  /**
   * Switch a product to groups: its current variants become the values of one group, so
   * nothing is lost (same ids, prices, stock, orders).
   */
  function adminEnableOptionGroups(user, productIdRaw, input = {}) {
    requireAdmin(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    const name =
      input.name == null || String(input.name).trim() === "" ? "ตัวเลือก" : clean(input.name, 1, 40, "ชื่อกลุ่ม");
    return tx(() => {
      if (!one("SELECT id FROM products WHERE id=?", productId)) fail(404, "ไม่พบสินค้า");
      if (hasGroups(productId)) return adminOptionGroups(user, productId);
      const variants = all(
        "SELECT id,label FROM variants WHERE product_id=? ORDER BY sort_order ASC, id ASC",
        productId,
      );
      if (variants.length > MAX_VALUES) fail(409, "ตัวเลือกเกิน " + MAX_VALUES + " รายการ แยกกลุ่มเองก่อน");
      const groupId = randomUUID();
      run("INSERT INTO product_option_groups(id,product_id,name,sort_order) VALUES(?,?,?,0)", groupId, productId, name);
      const seen = new Map();
      variants.forEach((v, i) => {
        // Two variants with the same label: the second one gets a numbered value.
        let label = v.label.slice(0, 40);
        let n = 2;
        while (seen.has(label.toLowerCase())) label = (v.label.slice(0, 36) + " " + n++).slice(0, 40);
        seen.set(label.toLowerCase(), true);
        const valueId = randomUUID();
        run(
          "INSERT INTO product_option_values(id,group_id,product_id,label,sort_order) VALUES(?,?,?,?,?)",
          valueId,
          groupId,
          productId,
          label,
          i,
        );
        run("INSERT INTO variant_options(variant_id,group_id,value_id) VALUES(?,?,?)", v.id, groupId, valueId);
        if (label !== v.label) run("UPDATE variants SET label=? WHERE id=?", label, v.id);
      });
      auditDetail(user, "OPTION_GROUPS_ENABLE", productId, { variants: variants.length });
      return adminOptionGroups(user, productId);
    });
  }

  /** Back to the simple list: groups go, every variant stays as it is. */
  function adminDisableOptionGroups(user, productIdRaw) {
    requireAdmin(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    return tx(() => {
      run(
        "DELETE FROM variant_options WHERE variant_id IN (SELECT id FROM variants WHERE product_id=?)",
        productId,
      );
      run("DELETE FROM product_option_values WHERE product_id=?", productId);
      run("DELETE FROM product_option_groups WHERE product_id=?", productId);
      auditDetail(user, "OPTION_GROUPS_DISABLE", productId, {});
      return { productId, groups: [], options: {} };
    });
  }

  function normalizeGroups(raw) {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_GROUPS)
      fail(400, "กลุ่มตัวเลือก 1–" + MAX_GROUPS + " กลุ่ม");
    const names = new Set();
    return raw.map((g) => {
      if (!g || typeof g !== "object") fail(400, "กลุ่มตัวเลือกไม่ถูกต้อง");
      const name = clean(g.name, 1, 40, "ชื่อกลุ่ม");
      if (names.has(name.toLowerCase())) fail(400, "ชื่อกลุ่มซ้ำ: " + name);
      names.add(name.toLowerCase());
      if (!Array.isArray(g.values) || g.values.length < 1 || g.values.length > MAX_VALUES)
        fail(400, name + ": ค่าตัวเลือก 1–" + MAX_VALUES + " ค่า");
      const labels = new Set();
      const values = g.values.map((v) => {
        const label = clean(typeof v === "string" ? v : v?.label, 1, 40, "ค่าตัวเลือก");
        if (labels.has(label.toLowerCase())) fail(400, name + ": ค่าซ้ำ " + label);
        labels.add(label.toLowerCase());
        return { id: typeof v === "object" && typeof v.id === "string" ? v.id : null, label };
      });
      return { id: typeof g.id === "string" ? g.id : null, name, values };
    });
  }

  /**
   * Save groups + values (add / rename / reorder / remove), then make sure every combination
   * has a variant. New combinations start closed (active=0) at the closest sibling's price
   * (or `price` when there is none) so nothing goes on sale before the admin checks it.
   */
  function adminSaveOptionGroups(user, productIdRaw, input = {}) {
    requireAdmin(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    const wanted = normalizeGroups(input.groups);
    const comboCount = wanted.reduce((n, g) => n * g.values.length, 1);
    if (comboCount > MAX_COMBOS) fail(400, "รวมได้ไม่เกิน " + MAX_COMBOS + " แบบ (ตอนนี้ " + comboCount + ")");
    const fallbackPrice =
      input.price == null || input.price === "" ? null : integer(input.price, 100, 10000000, "ราคา");
    return tx(() => {
      if (!one("SELECT id FROM products WHERE id=?", productId)) fail(404, "ไม่พบสินค้า");
      const before = groupsFor(productId);
      const beforeGroupIds = new Set(before.map((g) => g.id));
      const beforeValueIds = new Set(before.flatMap((g) => g.values.map((v) => v.id)));
      const map = mappingFor(productId);
      // 1) groups: keep known ids, create new ones.
      const groups = wanted.map((g, gi) => {
        const id = g.id && beforeGroupIds.has(g.id) ? g.id : randomUUID();
        if (beforeGroupIds.has(id))
          run("UPDATE product_option_groups SET name=?, sort_order=? WHERE id=?", g.name, gi, id);
        else
          run(
            "INSERT INTO product_option_groups(id,product_id,name,sort_order) VALUES(?,?,?,?)",
            id,
            productId,
            g.name,
            gi,
          );
        const values = g.values.map((v, vi) => {
          const vid = v.id && beforeValueIds.has(v.id) ? v.id : randomUUID();
          if (beforeValueIds.has(vid))
            run(
              "UPDATE product_option_values SET label=?, sort_order=?, group_id=? WHERE id=?",
              v.label,
              vi,
              id,
              vid,
            );
          else
            run(
              "INSERT INTO product_option_values(id,group_id,product_id,label,sort_order) VALUES(?,?,?,?,?)",
              vid,
              id,
              productId,
              v.label,
              vi,
            );
          return { id: vid, label: v.label };
        });
        return { id, name: g.name, values, isNew: !beforeGroupIds.has(id) };
      });
      const keepGroups = new Set(groups.map((g) => g.id));
      const keepValues = new Set(groups.flatMap((g) => g.values.map((v) => v.id)));
      // 2) removed values / groups.
      for (const g of before) {
        for (const v of g.values)
          if (!keepValues.has(v.id)) {
            for (const [variantId, opts] of map) if (opts[g.id] === v.id) retire(variantId), map.delete(variantId);
            run("DELETE FROM product_option_values WHERE id=?", v.id);
          }
        if (!keepGroups.has(g.id)) {
          run("DELETE FROM variant_options WHERE group_id=?", g.id);
          run("DELETE FROM product_option_groups WHERE id=?", g.id);
          for (const opts of map.values()) delete opts[g.id];
        }
      }
      // 3) existing variants meet a new group: they take its first value.
      for (const g of groups.filter((x) => x.isNew)) {
        for (const [variantId, opts] of map) {
          opts[g.id] = g.values[0].id;
          run(
            "INSERT OR REPLACE INTO variant_options(variant_id,group_id,value_id) VALUES(?,?,?)",
            variantId,
            g.id,
            g.values[0].id,
          );
        }
      }
      // 4) one variant per combination; extra variants on the same combination retire.
      const keyOf = (opts) => groups.map((g) => opts[g.id] ?? "").join("|");
      const byKey = new Map();
      const variantRows = new Map(
        all("SELECT * FROM variants WHERE product_id=? ORDER BY sort_order ASC, id ASC", productId).map((v) => [v.id, v]),
      );
      for (const [variantId] of [...map].sort(
        (a, b) => (variantRows.get(a[0])?.sort_order ?? 0) - (variantRows.get(b[0])?.sort_order ?? 0),
      )) {
        const opts = map.get(variantId);
        const key = keyOf(opts);
        if (key.split("|").some((x) => !x) || byKey.has(key)) {
          retire(variantId);
          map.delete(variantId);
        } else byKey.set(key, variantId);
      }
      const siblingPrice = (combo) => {
        let best = null;
        let bestScore = -1;
        for (const [key, variantId] of byKey) {
          const parts = key.split("|");
          const score = parts.filter((p, i) => p === combo[i].id).length;
          const row = variantRows.get(variantId);
          if (row && score > bestScore) {
            best = row;
            bestScore = score;
          }
        }
        return best;
      };
      let created = 0;
      combinations(groups.map((g) => ({ values: g.values }))).forEach((combo, index) => {
        const key = combo.map((v) => v.id).join("|");
        const label = combo.map((v) => v.label).join(LABEL_JOIN).slice(0, 80);
        let variantId = byKey.get(key);
        if (!variantId) {
          const sibling = siblingPrice(combo);
          const price = sibling?.price ?? fallbackPrice ?? null;
          if (price == null) fail(400, "ใส่ราคาเริ่มต้นสำหรับตัวเลือกใหม่");
          variantId = productId + "-" + randomUUID().slice(0, 8);
          run(
            "INSERT INTO variants(id,product_id,label,price,active,sort_order,warranty_days) VALUES(?,?,?,?,0,?,?)",
            variantId,
            productId,
            label,
            price,
            index,
            sibling?.warranty_days ?? 0,
          );
          combo.forEach((v, gi) =>
            run(
              "INSERT INTO variant_options(variant_id,group_id,value_id) VALUES(?,?,?)",
              variantId,
              groups[gi].id,
              v.id,
            ),
          );
          byKey.set(key, variantId);
          created++;
        } else {
          run("UPDATE variants SET label=?, sort_order=? WHERE id=?", label, index, variantId);
        }
      });
      auditDetail(user, "OPTION_GROUPS_SAVE", productId, {
        groups: groups.length,
        combinations: comboCount,
        created,
      });
      return { ...adminOptionGroups(user, productId), created };
    });
  }

  /** Bulk edit one column for many variants of a product (price / warranty / on-off). */
  function adminBulkVariants(user, productIdRaw, input = {}) {
    requireAdmin(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    if (!Array.isArray(input.variantIds) || input.variantIds.length < 1 || input.variantIds.length > MAX_COMBOS)
      fail(400, "เลือกตัวเลือก 1–" + MAX_COMBOS + " รายการ");
    const sets = [];
    const params = [];
    if (input.price !== undefined) {
      sets.push("price=?");
      params.push(integer(input.price, 100, 10000000, "ราคา"));
    }
    if (input.warranty_days !== undefined) {
      sets.push("warranty_days=?");
      params.push(integer(input.warranty_days, 0, 365, "วันรับประกัน"));
    }
    if (input.active !== undefined) {
      if (typeof input.active !== "boolean") fail(400, "สถานะไม่ถูกต้อง");
      sets.push("active=?");
      params.push(input.active ? 1 : 0);
    }
    if (!sets.length) fail(400, "ไม่มีอะไรให้แก้");
    return tx(() => {
      let changed = 0;
      for (const raw of input.variantIds) {
        const id = clean(raw, 1, 80, "ตัวเลือก");
        const res = run(`UPDATE variants SET ${sets.join(",")} WHERE id=? AND product_id=?`, ...params, id, productId);
        changed += res.changes ? 1 : 0;
      }
      auditDetail(user, "VARIANTS_BULK", productId, {
        count: changed,
        fields: sets.map((s) => s.split("=")[0]),
      });
      return { changed };
    });
  }

  /** Duplicate product: copy groups, values and the variant mapping through the id map. */
  function copyGroups(sourceId, targetId, variantMap) {
    const groupMap = new Map();
    const valueMap = new Map();
    for (const g of all("SELECT * FROM product_option_groups WHERE product_id=?", sourceId)) {
      const id = randomUUID();
      groupMap.set(g.id, id);
      run(
        "INSERT INTO product_option_groups(id,product_id,name,sort_order) VALUES(?,?,?,?)",
        id,
        targetId,
        g.name,
        g.sort_order,
      );
    }
    for (const v of all("SELECT * FROM product_option_values WHERE product_id=?", sourceId)) {
      const id = randomUUID();
      valueMap.set(v.id, id);
      run(
        "INSERT INTO product_option_values(id,group_id,product_id,label,sort_order) VALUES(?,?,?,?,?)",
        id,
        groupMap.get(v.group_id),
        targetId,
        v.label,
        v.sort_order,
      );
    }
    let mapped = 0;
    for (const [oldId, newId] of variantMap)
      for (const o of all("SELECT group_id,value_id FROM variant_options WHERE variant_id=?", oldId)) {
        if (!groupMap.has(o.group_id) || !valueMap.has(o.value_id)) continue;
        run(
          "INSERT INTO variant_options(variant_id,group_id,value_id) VALUES(?,?,?)",
          newId,
          groupMap.get(o.group_id),
          valueMap.get(o.value_id),
        );
        mapped++;
      }
    return { groups: groupMap.size, values: valueMap.size, mapped };
  }

  return {
    groupsFor,
    hasGroups,
    publicOptions,
    adminOptionGroups,
    adminEnableOptionGroups,
    adminDisableOptionGroups,
    adminSaveOptionGroups,
    adminBulkVariants,
    copyGroups,
  };
}
