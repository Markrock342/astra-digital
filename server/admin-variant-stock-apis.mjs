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

/** Baht input pattern: integer or up to 2 decimal places (e.g. 25, 25.5, 25.50). */
const COST_BAHT_RE = /^\d+(\.\d{1,2})?$/;
/** Max cost in satang after conversion (same ceiling as before). */
const COST_SATANG_MAX = 100000000;
const COST_ERR = "ต้นทุนต้องเป็นจำนวนบาท (≥0 ทศนิยมได้ 2 ตำแหน่ง)";

/** Convert a validated baht string ("25", "25.5", "25.50") to integer satang. */
function bahtTextToSatang(text) {
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/**
 * Optional purchase cost from the admin: baht with ≤2 decimals.
 * Stored as integer satang. Empty → null.
 */
export function parseOptionalCost(raw) {
  if (raw === undefined || raw === null) return { cost: null };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return { error: COST_ERR };
    const scaled = raw * 100;
    const satang = Math.round(scaled);
    // Reject values that are not exactly ≤2 decimal places (e.g. 25.555).
    if (Math.abs(scaled - satang) > 1e-6) return { error: COST_ERR };
    if (satang > COST_SATANG_MAX) return { error: COST_ERR };
    return { cost: satang };
  }
  const text = String(raw).trim();
  if (text === "") return { cost: null };
  if (!COST_BAHT_RE.test(text)) return { error: COST_ERR };
  const satang = bahtTextToSatang(text);
  if (!Number.isInteger(satang) || satang < 0 || satang > COST_SATANG_MAX)
    return { error: COST_ERR };
  return { cost: satang };
}

/** Optional expiry as YYYY-MM-DD or YYYY-MM-DD HH:MM:SS (UTC-ish text for SQLite). */
export function parseOptionalExpires(raw) {
  if (raw === undefined || raw === null) return { expiresAt: null };
  const text = String(raw).trim();
  if (text === "") return { expiresAt: null };
  const day = text.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (day) return { expiresAt: day[1] + " 23:59:59" };
  const full = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (full) {
    const time = full[2].length === 5 ? full[2] + ":00" : full[2];
    return { expiresAt: full[1] + " " + time };
  }
  return { error: "วันหมดอายุต้องเป็น YYYY-MM-DD" };
}

function withCostAndExpires(entry, costRaw, expiresRaw) {
  let next = { ...entry, cost: null, expiresAt: null };
  const cost = parseOptionalCost(costRaw);
  if (cost.error) return { ...next, error: entry.error || cost.error };
  next.cost = cost.cost;
  const expires = parseOptionalExpires(expiresRaw);
  if (expires.error) return { ...next, error: entry.error || expires.error };
  next.expiresAt = expires.expiresAt;
  return next;
}

/** Pull trailing YYYY-MM-DD… then optional cost (baht, ≤2 decimals) from CSV/text parts.
 * `keep` columns always stay (code = 1, ID+password = 2), so a numeric or date-like
 * password such as "user@x.com,123456" is never read as a cost or an expiry. */
function takeExpiresAndCost(parts, keep = 1) {
  let head = parts;
  let expiresRaw;
  let costRaw;
  if (
    head.length > keep &&
    /^\d{4}-\d{2}-\d{2}/.test(String(head[head.length - 1]).trim())
  ) {
    expiresRaw = String(head[head.length - 1]).trim();
    head = head.slice(0, -1);
  }
  if (head.length > keep && COST_BAHT_RE.test(String(head[head.length - 1]).trim())) {
    costRaw = String(head[head.length - 1]).trim();
    head = head.slice(0, -1);
  }
  return { head, costRaw, expiresRaw };
}

function pairEntry(line, loginIdRaw, password, costRaw, expiresRaw) {
  const loginId = typeof loginIdRaw === "string" ? loginIdRaw.trim() : "";
  const entry = { line, kind: "pair", loginId, password, cost: null, expiresAt: null };
  if (typeof loginIdRaw !== "string" || typeof password !== "string")
    return { ...entry, password: "", error: "ไอดีและรหัสผ่านต้องเป็นข้อความ" };
  if (!loginId) return { ...entry, error: "ไม่มีไอดี" };
  if (loginId.length > 160) return { ...entry, error: "ไอดียาวเกิน 160 ตัวอักษร" };
  if (!password) return { ...entry, error: "ไม่มีรหัสผ่าน" };
  if (password.length > 500) return { ...entry, error: "รหัสผ่านยาวเกินกำหนด" };
  return withCostAndExpires(entry, costRaw, expiresRaw);
}

function codeEntry(line, raw) {
  const parts = String(raw).split(",");
  const { head, costRaw, expiresRaw } = takeExpiresAndCost(parts);
  const code = head.join(",").trim();
  if (!CODE_PATTERN.test(code))
    return {
      line,
      kind: "code",
      code,
      cost: null,
      expiresAt: null,
      error: "รูปแบบโค้ดไม่ถูกต้อง",
    };
  return withCostAndExpires(
    { line, kind: "code", code, cost: null, expiresAt: null },
    costRaw,
    expiresRaw,
  );
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
      const parts = raw.split(",");
      if (parts.length < 2)
        return {
          line,
          kind: "pair",
          loginId: "",
          password: "",
          cost: null,
          expiresAt: null,
          raw,
          error: "ต้องเป็น ไอดี,รหัสผ่าน",
        };
      const { head, costRaw, expiresRaw } = takeExpiresAndCost(parts, 2);
      if (head.length < 2)
        return {
          line,
          kind: "pair",
          loginId: "",
          password: "",
          cost: null,
          expiresAt: null,
          raw,
          error: "ต้องเป็น ไอดี,รหัสผ่าน",
        };
      const loginId = head[0];
      const password = head.slice(1).join(",");
      if (!loginId.trim())
        return {
          line,
          kind: "pair",
          loginId: "",
          password: "",
          cost: null,
          expiresAt: null,
          raw,
          error: "ต้องเป็น ไอดี,รหัสผ่าน",
        };
      return pairEntry(line, loginId, password, costRaw, expiresRaw);
    });
  }
  if (has("codes") && has("items"))
    fail(400, "ส่งได้แค่ codes หรือ items อย่างใดอย่างหนึ่ง");
  if (has("items")) {
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_IMPORT_LINES)
      fail(400, "รายการคู่ต้องเป็น array 1–100 รายการ");
    return input.items.map((item, index) =>
      item && typeof item === "object"
        ? pairEntry(
            index + 1,
            item.loginId,
            item.password,
            item.cost,
            item.expiresAt ?? item.expires_at,
          )
        : {
            line: index + 1,
            kind: "pair",
            loginId: "",
            password: "",
            cost: null,
            expiresAt: null,
            error: "รายการคู่ไม่ถูกต้อง",
          },
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
  /** For editing an unsold unit (same keys as import: encrypted values, keyed duplicate checks). */
  encrypt,
  inventoryFingerprint,
  inventoryLoginKey,
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
              (SELECT COUNT(*) FROM inventory i WHERE i.variant_id=v.id AND ${inventoryAvailableAliased}) AS stock,
              (SELECT COUNT(*) FROM stock_watch w WHERE w.variant_id=v.id AND w.notified_at IS NULL) AS waiting
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
      // Customers waiting for "แจ้งเตือนเมื่อมีของ" (stock-watch.mjs).
      waiting: v.waiting,
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
    if (
      status &&
      !["available", "sold", "defective", "expiring", "expired"].includes(status)
    )
      fail(400, "สถานะสต็อกไม่ถูกต้อง");
    const cursorParts = decodeCursor(query.cursor, fail);

    const where = ["i.variant_id = ?"];
    const params = [variantId];
    const free =
      "i.order_id IS NULL AND i.reservation_id IS NULL AND COALESCE(i.defective,0)=0";
    if (status === "available") {
      where.push(free);
    } else if (status === "sold") {
      where.push(
        "(i.order_id IS NOT NULL OR i.reservation_id IS NOT NULL) AND COALESCE(i.defective,0)=0",
      );
    } else if (status === "defective") {
      where.push("COALESCE(i.defective,0)=1");
    } else if (status === "expired") {
      where.push(free);
      where.push("i.expires_at IS NOT NULL AND datetime(i.expires_at) <= datetime('now')");
    } else if (status === "expiring") {
      where.push(free);
      where.push(
        "i.expires_at IS NOT NULL AND datetime(i.expires_at) > datetime('now') AND datetime(i.expires_at) <= datetime('now', '+7 days')",
      );
    }
    if (cursorParts) {
      where.push("(i.created_at < ? OR (i.created_at = ? AND i.id < ?))");
      params.push(cursorParts[0], cursorParts[0], cursorParts[1]);
    }
    const sql = `SELECT i.id,i.created_at,i.order_id,i.reservation_id,i.sold_at,
                        i.defective,i.defective_at,i.defective_reason,i.legacy_single_secret,
                        i.login_id_enc,i.password_enc,i.expires_at,i.cost,
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
        expires_at: row.expires_at ?? null,
        cost: row.cost ?? null,
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
    // First page also carries the option and how many accounts it holds per status.
    if (cursorParts) return { inventory: page, nextCursor };
    return { inventory: page, nextCursor, variant: variantSummary(variantId), counts: inventoryCounts(variantId) };
  }

  function variantSummary(variantId) {
    const v = one(
      `SELECT v.id,v.label,v.price,v.active,p.id AS product_id,p.name AS product,p.preorder
       FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?`,
      variantId,
    );
    return {
      id: v.id,
      label: v.label,
      price: v.price,
      active: !!v.active,
      productId: v.product_id,
      product: v.product,
      preorder: !!v.preorder,
      sellable: stockCount(variantId),
    };
  }

  /** Accounts per status for one option (same definitions as the list filters). */
  function inventoryCounts(variantId) {
    const free = "order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0";
    const row = one(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ${free} THEN 1 ELSE 0 END) AS available,
              SUM(CASE WHEN ${free} AND expires_at IS NOT NULL AND datetime(expires_at) > datetime('now')
                        AND datetime(expires_at) <= datetime('now','+7 days') THEN 1 ELSE 0 END) AS expiring,
              SUM(CASE WHEN ${free} AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now') THEN 1 ELSE 0 END) AS expired,
              SUM(CASE WHEN (order_id IS NOT NULL OR reservation_id IS NOT NULL) AND COALESCE(defective,0)=0 THEN 1 ELSE 0 END) AS sold,
              SUM(CASE WHEN COALESCE(defective,0)=1 THEN 1 ELSE 0 END) AS defective
       FROM inventory WHERE variant_id=?`,
      variantId,
    );
    const n = (v) => Number(v ?? 0);
    return {
      total: n(row.total),
      available: n(row.available),
      expiring: n(row.expiring),
      expired: n(row.expired),
      sold: n(row.sold),
      defective: n(row.defective),
    };
  }

  /** ADMIN: the full ID + password (or code) of one stock unit. Every view is audited. */
  function revealInventoryUnit(user, inventoryIdRaw) {
    requireAdmin(user);
    const inventoryId = clean(inventoryIdRaw, 1, 80, "รายการสต็อก");
    const row = one("SELECT id,login_id_enc,password_enc,legacy_single_secret FROM inventory WHERE id=?", inventoryId);
    if (!row) fail(404, "ไม่พบรายการสต็อก");
    let loginId;
    let password;
    try {
      loginId = decrypt(row.login_id_enc);
      password = row.legacy_single_secret ? "" : decrypt(row.password_enc);
    } catch {
      fail(500, "ถอดรหัสรายการนี้ไม่ได้");
    }
    audit(user, "INVENTORY_REVEAL", inventoryId);
    return row.legacy_single_secret ? { id: inventoryId, code: loginId } : { id: inventoryId, loginId, password };
  }

  /**
   * ADMIN: fix an unsold, working unit — ID / password (code), expiry, cost. Sold units are
   * fixed from their order (replace + notify), defective ones stay as evidence.
   */
  function updateInventoryUnit(user, inventoryIdRaw, input = {}) {
    requireAdmin(user);
    const inventoryId = clean(inventoryIdRaw, 1, 80, "รายการสต็อก");
    return tx(() => {
      const row = one("SELECT * FROM inventory WHERE id=?", inventoryId);
      if (!row) fail(404, "ไม่พบรายการสต็อก");
      if (row.order_id != null || row.reservation_id != null)
        fail(409, "บัญชีที่ขายแล้วแก้ที่นี่ไม่ได้ ให้เปลี่ยนบัญชีจากหน้าออเดอร์");
      if (row.defective) fail(409, "รายการที่แจ้งเสียแล้วแก้ไขไม่ได้");
      const legacy = !!row.legacy_single_secret;
      const changed = [];
      const sets = [];
      const params = [];
      const credentialEdit = input.loginId !== undefined || input.password !== undefined || input.code !== undefined;
      if (credentialEdit) {
        const oldLogin = decrypt(row.login_id_enc);
        const oldPassword = legacy ? "" : decrypt(row.password_enc);
        const loginId = legacy
          ? input.code !== undefined
            ? clean(input.code, 1, 500, "โค้ด")
            : oldLogin
          : input.loginId !== undefined
            ? clean(input.loginId, 1, 200, "ID")
            : oldLogin;
        const password = legacy
          ? ""
          : input.password !== undefined
            ? clean(input.password, 1, 200, "รหัสผ่าน")
            : oldPassword;
        if (loginId !== oldLogin || password !== oldPassword) {
          const fingerprint = inventoryFingerprint(loginId, password);
          const loginKey = inventoryLoginKey(legacy, loginId);
          const clash = one(
            "SELECT id FROM inventory WHERE (login_key=? OR fingerprint=?) AND id<>? LIMIT 1",
            loginKey,
            fingerprint,
            inventoryId,
          );
          if (clash) fail(409, legacy ? "โค้ดนี้มีในระบบแล้ว" : "ID นี้มีในระบบแล้ว");
          sets.push("login_id_enc=?", "password_enc=?", "fingerprint=?", "login_key=?");
          params.push(encrypt(loginId), encrypt(password), fingerprint, loginKey);
          if (loginId !== oldLogin) changed.push(legacy ? "code" : "loginId");
          if (password !== oldPassword) changed.push("password");
        }
      }
      if (input.expiresAt !== undefined) {
        const parsed = parseOptionalExpires(input.expiresAt);
        if (parsed.error) fail(400, parsed.error);
        if ((parsed.expiresAt ?? null) !== (row.expires_at ?? null)) {
          sets.push("expires_at=?");
          params.push(parsed.expiresAt);
          changed.push("expiresAt");
        }
      }
      if (input.cost !== undefined) {
        const parsed = parseOptionalCost(input.cost);
        if (parsed.error) fail(400, parsed.error);
        if ((parsed.cost ?? null) !== (row.cost ?? null)) {
          sets.push("cost=?");
          params.push(parsed.cost);
          changed.push("cost");
        }
      }
      if (sets.length) {
        run(
          `UPDATE inventory SET ${sets.join(",")} WHERE id=? AND order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0`,
          ...params,
          inventoryId,
        );
        // Never the values themselves: only which fields changed.
        run(
          "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
          user.id,
          "INVENTORY_EDIT",
          inventoryId,
          JSON.stringify({ fields: changed }),
        );
      }
      const after = one("SELECT login_id_enc,legacy_single_secret,expires_at,cost FROM inventory WHERE id=?", inventoryId);
      const shown = decrypt(after.login_id_enc);
      return {
        id: inventoryId,
        changed,
        expires_at: after.expires_at ?? null,
        cost: after.cost ?? null,
        ...(after.legacy_single_secret ? { codeMasked: maskSecret(shown) } : { loginIdMasked: maskSecret(shown) }),
      };
    });
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
        `DELETE FROM inventory WHERE id=? AND order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0`,
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
    revealInventoryUnit,
    updateInventoryUnit,
  };
}
