/**
 * Pricing rules: compare-at ("ราคาก่อนลด") + scheduled sale per option, a per-account
 * purchase limit per product / option, and customer tags with per-option tag prices
 * (e.g. tag "ตัวแทน" pays a reseller price).
 *
 * What a customer pays for one unit (server-side only, never the client's number):
 *   lowest of  normal price · active sale price · the cheapest tag price among their tags.
 *   A sale or tag price is only ever lower than the normal price (enforced on save, and
 *   min() keeps it true if the normal price is lowered later). Coupons apply on top of
 *   this unit price × quantity, so orders / receipts / reports keep using total + discount.
 *
 * Sale window: Bangkok wall time from the admin form, stored as UTC "YYYY-MM-DD HH:MM:SS".
 *   Active while  sale_starts_at <= now <= sale_ends_at  (either side may be open).
 *   A minute-only end ("…T23:59") is stored as 23:59:59, so the whole minute counts.
 *
 * Purchase limit: max_per_customer on the product (all its options together) and/or on an
 *   option. Counted inside the order transaction: the buyer's orders + preorder
 *   reservations for that product / option whose status is PENDING_PAYMENT, DELIVERED or
 *   PREORDER (cancelled, failed, out-of-stock never count).
 *
 * Tags: free text (1–24 chars), case-insensitive, one colour from a fixed list. ADMIN
 *   manages tags and prices; STAFF can read them.
 */

export const TAG_COLORS = ["gray", "red", "orange", "green", "blue", "purple"];
export const MAX_TAGS_PER_CUSTOMER = 10;
export const MAX_TAG_PRICES_PER_VARIANT = 20;
/** Order / reservation statuses that use up a customer's purchase limit. */
export const LIMIT_COUNTED_STATUSES = ["PENDING_PAYMENT", "DELIVERED", "PREORDER"];
const BKK_MS = 7 * 3600 * 1000;

/** Idempotent schema (no numbered migration). Called from commerce.mjs and cloud/worker.mjs. */
export function ensurePricing(db) {
  const has = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  const add = (table, column, ddl) => {
    if (!has(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  add("variants", "compare_at", "INTEGER");
  add("variants", "sale_price", "INTEGER");
  add("variants", "sale_starts_at", "TEXT");
  add("variants", "sale_ends_at", "TEXT");
  add("variants", "max_per_customer", "INTEGER");
  add("products", "max_per_customer", "INTEGER");
  // No foreign keys (like stock_watch): demo cleanup / PDPA deletion can remove freely.
  db.exec(`CREATE TABLE IF NOT EXISTS customer_tag_defs (
    tag TEXT PRIMARY KEY COLLATE NOCASE,
    color TEXT NOT NULL DEFAULT 'gray',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS customer_tags (
    user_id TEXT NOT NULL,
    tag TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    PRIMARY KEY (user_id, tag)
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_customer_tags_tag ON customer_tags(tag)");
  db.exec(`CREATE TABLE IF NOT EXISTS variant_tag_prices (
    variant_id TEXT NOT NULL,
    tag TEXT NOT NULL COLLATE NOCASE,
    price INTEGER NOT NULL CHECK (price > 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (variant_id, tag)
  )`);
}

export const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const msOf = (sql) => Date.parse(sql.replace(" ", "T") + "Z");
/** UTC "YYYY-MM-DD HH:MM:SS" → Bangkok wall time "YYYY-MM-DDTHH:MM" (form value). */
export const bangkokLocal = (sql) =>
  sql ? new Date(msOf(sql) + BKK_MS).toISOString().slice(0, 16) : null;

/** Sale window check on a variant row (SQL times compare as text in one format). */
export function saleActive(variant, nowSql) {
  if (variant?.sale_price == null) return false;
  if (variant.sale_starts_at && nowSql < variant.sale_starts_at) return false;
  if (variant.sale_ends_at && nowSql > variant.sale_ends_at) return false;
  return true;
}

/**
 * Unit price for one viewer. `base` is the normal price the shop charges (already 0 for
 * the legacy free preorder option); `tagPrice` the cheapest tag price for this viewer or null.
 */
export function resolvePrice(variant, { base, nowSql, tagPrice = null, tagName = null }) {
  let unitPrice = base;
  let priceKind = "regular";
  let priceTag = null;
  const onSale = saleActive(variant, nowSql);
  if (onSale && variant.sale_price < unitPrice) {
    unitPrice = variant.sale_price;
    priceKind = "sale";
  }
  if (tagPrice != null && tagPrice < unitPrice) {
    unitPrice = tagPrice;
    priceKind = "tag";
    priceTag = tagName;
  }
  // Struck-through "was" price: the compare-at price, or the normal price when this
  // viewer pays less than normal. Only shown when it is above what they pay.
  const was = Math.max(variant.compare_at ?? 0, unitPrice < base ? base : 0);
  const compareAt = was > unitPrice ? was : null;
  const discountPercent = compareAt ? Math.floor(((compareAt - unitPrice) * 100) / compareAt) : null;
  return {
    unitPrice,
    regularPrice: base,
    priceKind,
    priceTag,
    compareAt,
    discountPercent: discountPercent || null,
    saleEndsAt: priceKind === "sale" ? (variant.sale_ends_at ?? null) : null,
  };
}

export function createPricing({ one, all, run, tx, fail, clean, requireAdmin, requireStaff, clock }) {
  const nowSql = () => sqlTime(clock());
  const audit = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      detail ? JSON.stringify(detail) : null,
    );

  // ---------------------------------------------------------------- tags
  function normalizeTag(value) {
    if (typeof value !== "string") fail(400, "ชื่อแท็กไม่ถูกต้อง");
    // eslint-disable-next-line no-control-regex
    const tag = value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
    if (tag.length < 1 || tag.length > 24) fail(400, "ชื่อแท็กต้องยาว 1–24 ตัวอักษร");
    return tag;
  }
  /** Existing spelling of a tag (case-insensitive), creating the definition when new. */
  function canonicalTag(raw, color) {
    const tag = normalizeTag(raw);
    const existing = one("SELECT tag FROM customer_tag_defs WHERE tag=?", tag);
    if (existing) return existing.tag;
    run(
      "INSERT INTO customer_tag_defs(tag,color) VALUES(?,?)",
      tag,
      TAG_COLORS.includes(color) ? color : "gray",
    );
    return tag;
  }
  const tagsOf = (userId) =>
    userId
      ? all(
          "SELECT t.tag,COALESCE(d.color,'gray') AS color FROM customer_tags t LEFT JOIN customer_tag_defs d ON d.tag=t.tag WHERE t.user_id=? ORDER BY t.tag",
          userId,
        ).map((r) => ({ tag: r.tag, color: r.color }))
      : [];
  /** Tags of many customers at once: { userId: [{tag,color}] }. */
  function tagsFor(userIds) {
    const out = {};
    const ids = [...new Set(userIds)].filter(Boolean);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      for (const row of all(
        `SELECT t.user_id,t.tag,COALESCE(d.color,'gray') AS color FROM customer_tags t LEFT JOIN customer_tag_defs d ON d.tag=t.tag WHERE t.user_id IN (${chunk.map(() => "?").join(",")}) ORDER BY t.tag`,
        ...chunk,
      ))
        (out[row.user_id] ??= []).push({ tag: row.tag, color: row.color });
    }
    return out;
  }
  /** GET /api/admin/customer-tags — every tag with how many customers carry it (STAFF+). */
  function adminCustomerTags(user) {
    requireStaff(user);
    return {
      colors: TAG_COLORS,
      tags: all(
        `SELECT d.tag,d.color,
                (SELECT COUNT(*) FROM customer_tags t JOIN users u ON u.id=t.user_id WHERE t.tag=d.tag AND u.role='CUSTOMER') AS customers,
                (SELECT COUNT(*) FROM variant_tag_prices p WHERE p.tag=d.tag) AS prices
         FROM customer_tag_defs d ORDER BY d.tag`,
      ),
    };
  }
  /** POST /api/admin/customer-tags {tag,color} — create a tag or change its colour (ADMIN). */
  function adminSaveCustomerTag(user, input = {}) {
    requireAdmin(user);
    const color = input.color ?? "gray";
    if (!TAG_COLORS.includes(color)) fail(400, "สีแท็กไม่ถูกต้อง");
    return tx(() => {
      const tag = canonicalTag(input.tag, color);
      run("UPDATE customer_tag_defs SET color=? WHERE tag=?", color, tag);
      audit(user, "SAVE_CUSTOMER_TAG", tag, { color });
      return { tag, color };
    });
  }
  /** DELETE /api/admin/customer-tags/:tag — removes it from customers and prices (ADMIN). */
  function adminDeleteCustomerTag(user, rawTag) {
    requireAdmin(user);
    const tag = normalizeTag(rawTag);
    return tx(() => {
      const def = one("SELECT tag FROM customer_tag_defs WHERE tag=?", tag);
      if (!def) fail(404, "ไม่พบแท็กนี้");
      const customers = run("DELETE FROM customer_tags WHERE tag=?", def.tag).changes;
      const prices = run("DELETE FROM variant_tag_prices WHERE tag=?", def.tag).changes;
      run("DELETE FROM customer_tag_defs WHERE tag=?", def.tag);
      audit(user, "DELETE_CUSTOMER_TAG", def.tag, { customers, prices });
      return { ok: true, tag: def.tag, customers, prices };
    });
  }
  /** PATCH /api/admin/customers/:id/tags {tags:[...]} — replace a customer's tags (ADMIN). */
  function adminSetCustomerTags(user, customerIdRaw, input = {}) {
    requireAdmin(user);
    const customerId = clean(customerIdRaw, 1, 80, "ลูกค้า");
    if (!Array.isArray(input.tags)) fail(400, "แท็กไม่ถูกต้อง");
    if (input.tags.length > MAX_TAGS_PER_CUSTOMER)
      fail(400, "ใส่แท็กได้ไม่เกิน " + MAX_TAGS_PER_CUSTOMER + " แท็กต่อลูกค้า");
    return tx(() => {
      const customer = one("SELECT id,role FROM users WHERE id=?", customerId);
      if (!customer || customer.role !== "CUSTOMER") fail(404, "ไม่พบลูกค้า");
      const wanted = [];
      for (const raw of input.tags) {
        const tag = canonicalTag(raw);
        if (!wanted.some((t) => t.toLowerCase() === tag.toLowerCase())) wanted.push(tag);
      }
      const before = tagsOf(customerId).map((t) => t.tag);
      run("DELETE FROM customer_tags WHERE user_id=?", customerId);
      for (const tag of wanted)
        run(
          "INSERT INTO customer_tags(user_id,tag,created_by) VALUES(?,?,?)",
          customerId,
          tag,
          user.id,
        );
      audit(user, "SET_CUSTOMER_TAGS", customerId, { before, after: wanted });
      return { tags: tagsOf(customerId) };
    });
  }

  // ---------------------------------------------------------------- price for a viewer
  /** Cheapest tag price for this customer on one option, or null. */
  function tagPriceFor(variantId, userId) {
    if (!userId) return null;
    const row = one(
      `SELECT p.price,p.tag FROM variant_tag_prices p JOIN customer_tags t ON t.tag=p.tag
       WHERE p.variant_id=? AND t.user_id=? ORDER BY p.price ASC, p.tag ASC LIMIT 1`,
      variantId,
      userId,
    );
    return row ? { price: row.price, tag: row.tag } : null;
  }
  /**
   * Price quote for a variant row (needs v.id, compare_at, sale_* columns) and the base
   * price the shop charges. `user` may be null (signed-out visitor: never a tag price).
   */
  function quote(variant, base, user, at = nowSql()) {
    // Staff accounts see the public price; tag prices are for customers only.
    const tp = user && user.role === "CUSTOMER" ? tagPriceFor(variant.id, user.id) : null;
    return resolvePrice(variant, {
      base,
      nowSql: at,
      tagPrice: tp?.price ?? null,
      tagName: tp?.tag ?? null,
    });
  }

  // ---------------------------------------------------------------- purchase limit
  const countedSql = LIMIT_COUNTED_STATUSES.map((s) => `'${s}'`).join(",");
  function boughtOfVariant(userId, variantId) {
    return one(
      `SELECT
         (SELECT COALESCE(SUM(quantity),0) FROM orders WHERE user_id=? AND variant_id=? AND status IN (${countedSql}))
       + (SELECT COALESCE(SUM(quantity),0) FROM reservations WHERE user_id=? AND variant_id=? AND status IN (${countedSql})) AS n`,
      userId,
      variantId,
      userId,
      variantId,
    ).n;
  }
  function boughtOfProduct(userId, productId) {
    return one(
      `SELECT
         (SELECT COALESCE(SUM(o.quantity),0) FROM orders o JOIN variants v ON v.id=o.variant_id WHERE o.user_id=? AND v.product_id=? AND o.status IN (${countedSql}))
       + (SELECT COALESCE(SUM(r.quantity),0) FROM reservations r JOIN variants v ON v.id=r.variant_id WHERE r.user_id=? AND v.product_id=? AND r.status IN (${countedSql})) AS n`,
      userId,
      productId,
      userId,
      productId,
    ).n;
  }
  /**
   * The limit that applies to one option for one customer: { max, remaining } or null.
   * `remaining` is null for a signed-out visitor. The stricter of product / option wins.
   */
  function limitFor(variant, productLimit, user) {
    const limits = [];
    if (variant.max_per_customer)
      limits.push({
        max: variant.max_per_customer,
        bought: () => boughtOfVariant(user.id, variant.id),
      });
    if (productLimit)
      limits.push({
        max: productLimit,
        bought: () => boughtOfProduct(user.id, variant.product_id),
      });
    if (!limits.length) return null;
    const max = Math.min(...limits.map((l) => l.max));
    if (!user) return { max, remaining: null };
    const remaining = Math.max(0, Math.min(...limits.map((l) => l.max - l.bought())));
    return { max, remaining };
  }
  /** Inside the order transaction: refuse a quantity over the customer's limit. */
  function assertPurchaseLimit(user, variant, quantity) {
    const productLimit =
      one("SELECT max_per_customer FROM products WHERE id=?", variant.product_id)?.max_per_customer ?? null;
    const checks = [];
    if (variant.max_per_customer)
      checks.push([variant.max_per_customer, boughtOfVariant(user.id, variant.id)]);
    if (productLimit) checks.push([productLimit, boughtOfProduct(user.id, variant.product_id)]);
    for (const [max, bought] of checks) {
      if (bought + quantity <= max) continue;
      const left = Math.max(0, max - bought);
      fail(
        409,
        `สินค้านี้จำกัด ${max} ชิ้นต่อบัญชี` +
          (bought > 0 ? ` คุณมีคำสั่งซื้อแล้ว ${bought} ชิ้น` : "") +
          (left > 0 ? ` สั่งเพิ่มได้อีก ${left} ชิ้น` : " ครบจำนวนแล้ว"),
      );
    }
  }

  // ---------------------------------------------------------------- admin: option pricing
  function bangkokInput(value, label, endOfMinute) {
    if (value == null || value === "") return null;
    const text = String(value).trim();
    let ms = NaN;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text))
      ms = Date.parse(text + (endOfMinute ? "T23:59:59" : "T00:00:00") + "+07:00");
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text))
      ms = Date.parse(text + (endOfMinute ? ":59" : ":00") + "+07:00");
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) ms = Date.parse(text + "+07:00");
    if (!Number.isFinite(ms)) fail(400, label + "ไม่ถูกต้อง");
    return sqlTime(ms);
  }
  const money = (value, label, max = 10000000) => {
    if (value == null || value === "") return null;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 100 || n > max) fail(400, label + "ไม่ถูกต้อง");
    return n;
  };
  const limitInput = (value) => {
    if (value == null || value === "" || value === 0) return null;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1 || n > 1000) fail(400, "จำนวนจำกัดต่อบัญชีต้องเป็น 1–1000");
    return n;
  };
  function saleStatus(v, at) {
    if (v.sale_price == null) return "none";
    if (v.sale_ends_at && at > v.sale_ends_at) return "ended";
    if (v.sale_starts_at && at < v.sale_starts_at) return "scheduled";
    return "active";
  }
  function variantPricingRow(v, at) {
    return {
      compareAt: v.compare_at ?? null,
      salePrice: v.sale_price ?? null,
      saleStartsAt: v.sale_starts_at ?? null,
      saleEndsAt: v.sale_ends_at ?? null,
      saleStartsAtLocal: bangkokLocal(v.sale_starts_at),
      saleEndsAtLocal: bangkokLocal(v.sale_ends_at),
      saleStatus: saleStatus(v, at),
      maxPerCustomer: v.max_per_customer ?? null,
      tagPrices: all(
        "SELECT p.tag,p.price,COALESCE(d.color,'gray') AS color FROM variant_tag_prices p LEFT JOIN customer_tag_defs d ON d.tag=p.tag WHERE p.variant_id=? ORDER BY p.price,p.tag",
        v.id,
      ).map((r) => ({ tag: r.tag, price: r.price, color: r.color })),
    };
  }
  /** GET /api/admin/products/:id/pricing — limits, sale, compare-at and tag prices (STAFF+). */
  function adminProductPricing(user, productIdRaw) {
    requireStaff(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    const product = one("SELECT id,max_per_customer FROM products WHERE id=?", productId);
    if (!product) fail(404, "ไม่พบสินค้า");
    const at = nowSql();
    const variants = {};
    for (const v of all("SELECT * FROM variants WHERE product_id=?", productId))
      variants[v.id] = variantPricingRow(v, at);
    return {
      productId,
      maxPerCustomer: product.max_per_customer ?? null,
      variants,
      tags: all("SELECT tag,color FROM customer_tag_defs ORDER BY tag"),
    };
  }
  /**
   * PATCH /api/admin/variants/:id/pricing (ADMIN). Each field given replaces the stored one;
   * null / "" clears it. tagPrices (when given) replaces the whole list.
   */
  function adminSetVariantPricing(user, variantIdRaw, input = {}) {
    requireAdmin(user);
    const variantId = clean(variantIdRaw, 1, 80, "ตัวเลือกสินค้า");
    return tx(() => {
      const v = one("SELECT * FROM variants WHERE id=?", variantId);
      if (!v) fail(404, "ไม่พบตัวเลือกสินค้า");
      const pick = (key, column, parse) => (input[key] === undefined ? v[column] ?? null : parse(input[key]));
      const compareAt = pick("compareAt", "compare_at", (x) => money(x, "ราคาก่อนลด"));
      if (compareAt != null && compareAt <= v.price) fail(400, "ราคาก่อนลดต้องมากกว่าราคาขาย");
      const salePrice = pick("salePrice", "sale_price", (x) => money(x, "ราคาโปร"));
      if (salePrice != null && salePrice >= v.price) fail(400, "ราคาโปรต้องต่ำกว่าราคาปกติ");
      let startsAt = pick("saleStartsAt", "sale_starts_at", (x) => bangkokInput(x, "วันเริ่มโปร", false));
      let endsAt = pick("saleEndsAt", "sale_ends_at", (x) => bangkokInput(x, "วันจบโปร", true));
      if (salePrice == null) {
        startsAt = null;
        endsAt = null;
      }
      if (startsAt && endsAt && endsAt <= startsAt) fail(400, "วันจบโปรต้องหลังวันเริ่ม");
      const maxPerCustomer = pick("maxPerCustomer", "max_per_customer", limitInput);
      let tagPrices = null;
      if (input.tagPrices !== undefined) {
        if (!Array.isArray(input.tagPrices)) fail(400, "ราคาตามแท็กไม่ถูกต้อง");
        if (input.tagPrices.length > MAX_TAG_PRICES_PER_VARIANT)
          fail(400, "ราคาตามแท็กได้ไม่เกิน " + MAX_TAG_PRICES_PER_VARIANT + " แท็กต่อตัวเลือก");
        tagPrices = [];
        for (const row of input.tagPrices) {
          const tag = canonicalTag(row?.tag);
          const price = money(row?.price, "ราคาแท็ก " + tag);
          if (price == null) fail(400, "ใส่ราคาของแท็ก " + tag);
          if (price >= v.price) fail(400, "ราคาแท็ก " + tag + " ต้องต่ำกว่าราคาปกติ");
          if (tagPrices.some((t) => t.tag.toLowerCase() === tag.toLowerCase()))
            fail(400, "แท็ก " + tag + " ซ้ำ");
          tagPrices.push({ tag, price });
        }
      }
      run(
        "UPDATE variants SET compare_at=?,sale_price=?,sale_starts_at=?,sale_ends_at=?,max_per_customer=? WHERE id=?",
        compareAt,
        salePrice,
        startsAt,
        endsAt,
        maxPerCustomer,
        variantId,
      );
      if (tagPrices) {
        run("DELETE FROM variant_tag_prices WHERE variant_id=?", variantId);
        for (const t of tagPrices)
          run(
            "INSERT INTO variant_tag_prices(variant_id,tag,price,updated_at) VALUES(?,?,?,?)",
            variantId,
            t.tag,
            t.price,
            nowSql(),
          );
      }
      audit(user, "UPDATE_VARIANT_PRICING", variantId, {
        compareAt,
        salePrice,
        saleStartsAt: startsAt,
        saleEndsAt: endsAt,
        maxPerCustomer,
        ...(tagPrices ? { tagPrices } : {}),
      });
      const fresh = one("SELECT * FROM variants WHERE id=?", variantId);
      return { variantId, ...variantPricingRow(fresh, nowSql()) };
    });
  }
  /** PATCH /api/admin/products/:id/limit {maxPerCustomer} — all options together (ADMIN). */
  function adminSetProductLimit(user, productIdRaw, input = {}) {
    requireAdmin(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    return tx(() => {
      if (!one("SELECT id FROM products WHERE id=?", productId)) fail(404, "ไม่พบสินค้า");
      const maxPerCustomer = limitInput(input.maxPerCustomer);
      run("UPDATE products SET max_per_customer=? WHERE id=?", maxPerCustomer, productId);
      audit(user, "SET_PRODUCT_LIMIT", productId, { maxPerCustomer });
      return { productId, maxPerCustomer };
    });
  }

  return {
    nowSql,
    quote,
    limitFor,
    assertPurchaseLimit,
    tagsOf,
    tagsFor,
    adminCustomerTags,
    adminSaveCustomerTag,
    adminDeleteCustomerTag,
    adminSetCustomerTags,
    adminProductPricing,
    adminSetVariantPricing,
    adminSetProductLimit,
  };
}
