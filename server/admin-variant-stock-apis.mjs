/** Admin FR Work 4 — variant CRUD (FR-P2) + per-variant stock (FR-P7). */

function parseLimit(limit, fail, { fallback = 25, max = 100 } = {}) {
  if (limit == null || String(limit).trim() === "") return fallback;
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1) fail(400, "จำนวนรายการไม่ถูกต้อง");
  return Math.min(max, parsed);
}

function encodeCursor(parts) {
  return Buffer.from(parts.join("\n"), "utf8").toString("base64url");
}

function decodeCursor(cursor, fail) {
  if (cursor == null || String(cursor).trim() === "") return null;
  try {
    const raw = Buffer.from(String(cursor), "base64url").toString("utf8");
    const parts = raw.split("\n");
    if (parts.length !== 2 || parts.some((p) => p === ""))
      fail(400, "cursor ไม่ถูกต้อง");
    return parts;
  } catch {
    fail(400, "cursor ไม่ถูกต้อง");
  }
}

export function maskSecret(value) {
  const s = String(value ?? "");
  if (!s) return "";
  if (s.length <= 2) return "*".repeat(s.length);
  return s.slice(0, 2) + "***";
}

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+/=-]{3,159}$/;
const MAX_IMPORT_LINES = 100;

/** Code text is the secret itself: keep a few characters so the admin can tell lines apart. */
export function maskCode(value) {
  const s = String(value ?? "");
  if (s.length >= 8) return s.slice(0, 3) + "••••" + s.slice(-2);
  return s.slice(0, 1) + "••••";
}

function textLines(text) {
  // Keep the pasted line numbers (blank lines count) so the preview can point at them.
  return String(text)
    .split(/\r?\n/)
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter((entry) => entry.raw);
}

function pairEntry(line, loginIdRaw, password) {
  const loginId = typeof loginIdRaw === "string" ? loginIdRaw.trim() : "";
  const entry = { line, kind: "pair", loginId, password };
  if (typeof loginIdRaw !== "string" || typeof password !== "string")
    return { ...entry, password: "", error: "ไอดีและรหัสผ่านต้องเป็นข้อความ" };
  if (!loginId) return { ...entry, error: "ไม่มีไอดี" };
  if (loginId.length > 160) return { ...entry, error: "ไอดียาวเกิน 160 ตัวอักษร" };
  if (!password) return { ...entry, error: "ไม่มีรหัสผ่าน" };
  if (password.length > 500) return { ...entry, error: "รหัสผ่านยาวเกินกำหนด" };
  return entry;
}

function codeEntry(line, code) {
  if (!CODE_PATTERN.test(code))
    return { line, kind: "code", code, error: "รูปแบบโค้ดไม่ถูกต้อง" };
  return { line, kind: "code", code };
}

/**
 * Turns an import request (items[], codes text or csv text) into one entry per line.
 * Request-shape problems (wrong type, 0 or >100 lines) fail the whole request;
 * a bad line only marks that entry with `error` so the preview can show it.
 */
export function parseImportEntries(input, fail) {
  const has = (key) => input[key] !== undefined && input[key] !== null;
  const csv = has("csv") && String(input.csv).trim() !== "";
  if (csv) {
    const lines = textLines(input.csv);
    if (lines.length < 1 || lines.length > MAX_IMPORT_LINES)
      fail(400, "CSV ต้องมี 1–100 บรรทัด");
    if (!lines.some(({ raw }) => raw.includes(",")))
      return lines.map(({ raw, line }) => codeEntry(line, raw));
    return lines.map(({ raw, line }) => {
      const comma = raw.indexOf(",");
      if (comma < 1) return { line, kind: "pair", loginId: "", password: "", raw, error: "ต้องเป็น ไอดี,รหัสผ่าน" };
      return pairEntry(line, raw.slice(0, comma), raw.slice(comma + 1));
    });
  }
  if (has("codes") && has("items"))
    fail(400, "ส่งได้แค่ codes หรือ items อย่างใดอย่างหนึ่ง");
  if (has("items")) {
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_IMPORT_LINES)
      fail(400, "รายการคู่ต้องเป็น array 1–100 รายการ");
    return input.items.map((item, index) =>
      item && typeof item === "object"
        ? pairEntry(index + 1, item.loginId, item.password)
        : { line: index + 1, kind: "pair", loginId: "", password: "", error: "รายการคู่ไม่ถูกต้อง" },
    );
  }
  if (typeof input.codes !== "string" || !input.codes.trim() || input.codes.length > 20000)
    fail(400, "รายการโค้ดไม่ถูกต้อง");
  const lines = textLines(input.codes);
  if (lines.length > MAX_IMPORT_LINES)
    fail(400, "รหัสสินค้าใช้ตัวอักษร ตัวเลข และเครื่องหมายที่กำหนดได้ ไม่เกิน 100 รายการต่อครั้ง");
  return lines.map(({ raw, line }) => codeEntry(line, raw));
}

export function createAdminVariantStockApis({
  requireStaff,
  requireAdmin,
  one,
  all,
  run,
  tx,
  fail,
  clean,
  audit,
  integer,
  inventoryAvailableSql,
  inventoryAvailableAliased,
  decrypt,
  getLowStockAt,
  randomUUID,
}) {
  /** Warranty in whole days, 0 (none) to 365. */
  function warrantyInput(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === "") return fallback;
    return integer(value, 0, 365, "วันรับประกัน");
  }

  function stockCount(variantId) {
    return one(
      `SELECT COUNT(*) AS n FROM inventory i WHERE i.variant_id=? AND ${inventoryAvailableAliased}`,
      variantId,
    ).n;
  }

  function inventoryStatusSql(alias = "i") {
    return `CASE
      WHEN ${alias}.defective=1 THEN 'defective'
      WHEN ${alias}.order_id IS NOT NULL OR ${alias}.reservation_id IS NOT NULL THEN 'sold'
      ELSE 'available'
    END`;
  }

  function adminProductVariants(user, productIdRaw) {
    requireStaff(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    if (!one("SELECT id FROM products WHERE id=?", productId))
      fail(404, "ไม่พบสินค้า");
    const lowAt = getLowStockAt();
    const variants = all(
      `SELECT v.id,v.product_id,v.label,v.price,v.active,v.sort_order,v.warranty_days,
              (SELECT COUNT(*) FROM inventory i WHERE i.variant_id=v.id AND ${inventoryAvailableAliased}) AS stock
       FROM variants v WHERE v.product_id=?
       ORDER BY v.sort_order ASC, v.id ASC`,
      productId,
    ).map((v) => ({
      id: v.id,
      product_id: v.product_id,
      label: v.label,
      price: v.price,
      active: !!v.active,
      sort_order: v.sort_order,
      warranty_days: v.warranty_days ?? 0,
      stock: v.stock,
      stockStatus:
        v.stock <= 0 ? "out" : v.stock <= lowAt ? "low" : "in",
    }));
    return { variants };
  }

  function createVariant(user, productIdRaw, input = {}) {
    requireAdmin(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    if (!one("SELECT id FROM products WHERE id=?", productId))
      fail(404, "ไม่พบสินค้า");
    const label = clean(input.label, 1, 80, "ชื่อตัวเลือก");
    const price = integer(input.price, 100, 10000000, "ราคา");
    const warrantyDays = warrantyInput(input.warranty_days, 0);
    const sortOrder =
      input.sort_order == null || String(input.sort_order).trim() === ""
        ? (one(
            "SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM variants WHERE product_id=?",
            productId,
          ).n ?? 0)
        : integer(input.sort_order, 0, 100000, "ลำดับ");
    const id =
      input.id != null && String(input.id).trim() !== ""
        ? clean(input.id, 1, 80, "รหัสตัวเลือก")
        : productId + "-" + randomUUID().slice(0, 8);
    return tx(() => {
      if (one("SELECT id FROM variants WHERE id=?", id))
        fail(409, "รหัสตัวเลือกซ้ำ");
      run(
        "INSERT INTO variants(id,product_id,label,price,active,sort_order,warranty_days) VALUES(?,?,?,?,1,?,?)",
        id,
        productId,
        label,
        price,
        sortOrder,
        warrantyDays,
      );
      audit(user, "CREATE_VARIANT", id);
      return {
        id,
        product_id: productId,
        label,
        price,
        active: true,
        sort_order: sortOrder,
        warranty_days: warrantyDays,
        stock: 0,
      };
    });
  }

  function updateVariant(user, variantIdRaw, input = {}) {
    requireAdmin(user);
    const variantId = clean(variantIdRaw, 1, 80, "ตัวเลือกสินค้า");
    return tx(() => {
      const existing = one("SELECT * FROM variants WHERE id=?", variantId);
      if (!existing) fail(404, "ไม่พบตัวเลือกสินค้า");
      const label =
        input.label !== undefined
          ? clean(input.label, 1, 80, "ชื่อตัวเลือก")
          : existing.label;
      const price =
        input.price !== undefined
          ? integer(input.price, 100, 10000000, "ราคา")
          : existing.price;
      let active = existing.active ? 1 : 0;
      if (input.active !== undefined) {
        if (typeof input.active === "boolean") active = input.active ? 1 : 0;
        else if (input.active === "on" || input.active === 1 || input.active === "1")
          active = 1;
        else if (
          input.active === false ||
          input.active === 0 ||
          input.active === "0" ||
          input.active === "off"
        )
          active = 0;
        else fail(400, "สถานะตัวเลือกไม่ถูกต้อง");
      }
      const sortOrder =
        input.sort_order !== undefined
          ? integer(input.sort_order, 0, 100000, "ลำดับ")
          : existing.sort_order;
      // Sold orders keep their own snapshot (orders.warranty_until), so this only affects new sales.
      const warrantyDays = warrantyInput(input.warranty_days, existing.warranty_days ?? 0);
      run(
        "UPDATE variants SET label=?,price=?,active=?,sort_order=?,warranty_days=? WHERE id=?",
        label,
        price,
        active,
        sortOrder,
        warrantyDays,
        variantId,
      );
      audit(user, "UPDATE_VARIANT", variantId);
      return {
        id: variantId,
        product_id: existing.product_id,
        label,
        price,
        active: !!active,
        sort_order: sortOrder,
        warranty_days: warrantyDays,
        stock: stockCount(variantId),
      };
    });
  }

  function deleteVariant(user, variantIdRaw) {
    requireAdmin(user);
    const variantId = clean(variantIdRaw, 1, 80, "ตัวเลือกสินค้า");
    return tx(() => {
      const existing = one("SELECT * FROM variants WHERE id=?", variantId);
      if (!existing) fail(404, "ไม่พบตัวเลือกสินค้า");
      const orders = one(
        "SELECT COUNT(*) AS n FROM orders WHERE variant_id=?",
        variantId,
      ).n;
      const reservations = one(
        "SELECT COUNT(*) AS n FROM reservations WHERE variant_id=?",
        variantId,
      ).n;
      const inventory = one(
        "SELECT COUNT(*) AS n FROM inventory WHERE variant_id=?",
        variantId,
      ).n;
      if (orders + reservations + inventory > 0)
        fail(
          409,
          "มีออเดอร์หรือสต็อกผูกกับตัวเลือกนี้แล้ว ให้ปิดการใช้งานแทนการลบ",
        );
      run("DELETE FROM variants WHERE id=?", variantId);
      audit(user, "DELETE_VARIANT", variantId);
      return { id: variantId, deleted: true };
    });
  }

  function adminVariantInventory(user, variantIdRaw, query = {}) {
    requireStaff(user);
    const variantId = clean(variantIdRaw, 1, 80, "ตัวเลือกสินค้า");
    if (!one("SELECT id FROM variants WHERE id=?", variantId))
      fail(404, "ไม่พบตัวเลือกสินค้า");
    const lim = parseLimit(query.limit, fail);
    const status =
      query.status != null && String(query.status).trim() !== ""
        ? clean(query.status, 1, 20, "สถานะสต็อก")
        : null;
    if (status && !["available", "sold", "defective"].includes(status))
      fail(400, "สถานะสต็อกไม่ถูกต้อง");
    const cursorParts = decodeCursor(query.cursor, fail);

    const where = ["i.variant_id = ?"];
    const params = [variantId];
    if (status === "available") {
      where.push(
        "i.order_id IS NULL AND i.reservation_id IS NULL AND COALESCE(i.defective,0)=0",
      );
    } else if (status === "sold") {
      where.push(
        "(i.order_id IS NOT NULL OR i.reservation_id IS NOT NULL) AND COALESCE(i.defective,0)=0",
      );
    } else if (status === "defective") {
      where.push("COALESCE(i.defective,0)=1");
    }
    if (cursorParts) {
      where.push("(i.created_at < ? OR (i.created_at = ? AND i.id < ?))");
      params.push(cursorParts[0], cursorParts[0], cursorParts[1]);
    }
    const sql = `SELECT i.id,i.created_at,i.order_id,i.reservation_id,i.sold_at,
                        i.defective,i.defective_at,i.defective_reason,i.legacy_single_secret,
                        i.login_id_enc,i.password_enc,
                        ${inventoryStatusSql("i")} AS status
                 FROM inventory i
                 WHERE ${where.join(" AND ")}
                 ORDER BY i.created_at DESC, i.id DESC
                 LIMIT ?`;
    const rows = all(sql, ...params, lim + 1);
    const page = rows.slice(0, lim).map((row) => {
      const loginId = decrypt(row.login_id_enc);
      const base = {
        id: row.id,
        status: row.status,
        created_at: row.created_at,
        order_id: row.order_id,
        reservation_id: row.reservation_id,
        sold_at: row.sold_at,
        defective_at: row.defective_at,
        defective_reason: row.defective_reason,
        credentialsMasked: true,
      };
      if (row.legacy_single_secret)
        return { ...base, codeMasked: maskSecret(loginId) };
      return {
        ...base,
        loginIdMasked: maskSecret(loginId),
        passwordMasked: "••••••••",
      };
    });
    const nextCursor =
      rows.length > lim
        ? encodeCursor([page[page.length - 1].created_at, page[page.length - 1].id])
        : null;
    return { inventory: page, nextCursor };
  }

  function markInventoryDefect(user, inventoryIdRaw, input = {}) {
    requireAdmin(user);
    const inventoryId = clean(inventoryIdRaw, 1, 80, "รายการสต็อก");
    const reason = clean(input.reason, 2, 500, "เหตุผล");
    return tx(() => {
      const row = one("SELECT * FROM inventory WHERE id=?", inventoryId);
      if (!row) fail(404, "ไม่พบรายการสต็อก");
      if (row.defective) fail(409, "รายการนี้ถูกทำเครื่องหมายเสียแล้ว");
      if (row.order_id != null || row.reservation_id != null)
        fail(409, "บัญชีที่ขายแล้วทำเครื่องหมายเสียไม่ได้");
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      run(
        "UPDATE inventory SET defective=1, defective_at=?, defective_by=?, defective_reason=? WHERE id=? AND order_id IS NULL AND reservation_id IS NULL AND defective=0",
        now,
        user.id,
        reason,
        inventoryId,
      );
      if (
        !one(
          "SELECT id FROM inventory WHERE id=? AND defective=1",
          inventoryId,
        )
      )
        fail(409, "ทำเครื่องหมายเสียไม่สำเร็จ");
      audit(user, "INVENTORY_DEFECT", inventoryId);
      return {
        id: inventoryId,
        status: "defective",
        defective_at: now,
        defective_reason: reason,
      };
    });
  }

  function deleteInventoryUnit(user, inventoryIdRaw) {
    requireAdmin(user);
    const inventoryId = clean(inventoryIdRaw, 1, 80, "รายการสต็อก");
    return tx(() => {
      const row = one("SELECT * FROM inventory WHERE id=?", inventoryId);
      if (!row) fail(404, "ไม่พบรายการสต็อก");
      if (row.defective) fail(409, "รายการที่เสียลบไม่ได้");
      if (row.order_id != null || row.reservation_id != null)
        fail(409, "บัญชีที่ขายแล้วลบไม่ได้");
      run(
        `DELETE FROM inventory WHERE id=? AND ${inventoryAvailableSql}`,
        inventoryId,
      );
      if (one("SELECT id FROM inventory WHERE id=?", inventoryId))
        fail(409, "ลบรายการสต็อกไม่สำเร็จ");
      audit(user, "DELETE_INVENTORY", inventoryId);
      return { id: inventoryId, deleted: true };
    });
  }

  return {
    adminProductVariants,
    createVariant,
    updateVariant,
    deleteVariant,
    adminVariantInventory,
    markInventoryDefect,
    deleteInventoryUnit,
  };
}
