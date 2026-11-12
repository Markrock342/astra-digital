/**
 * Back-in-stock notices ("แจ้งเตือนเมื่อสินค้าเข้า").
 *
 * - A signed-in customer can wait for an option that is out of stock (ready-stock products
 *   only; a preorder can always be ordered). One row per customer and option.
 * - One-shot: when the option can be bought again, the waiting customers get one in-site
 *   notice (and an email when email is configured and the address is real), and their row is
 *   marked notified. They are not told again on the next restock unless they ask again.
 *   Reason: a standing subscription would ping the same people on every small top-up of a
 *   fast-selling option, and most of them already bought (or lost interest) the first time.
 * - "Can be bought again" = product open for sale, not preorder, option open, and at least
 *   one ready unit. Checked before and after the calls that can bring an option back
 *   (stock import, product / option re-activation, bulk open), so one call = one restock
 *   event, whatever path it took.
 * - Fairness: at most RESTOCK_NOTIFY_LIMIT customers per restock, in the order they asked.
 *   The rest keep their place for the next restock. Stock counts are never revealed.
 * Schema: ensureStockWatch() in ensure-admin-fr.mjs.
 */
import { isRealEmail } from "./email.mjs";

export const RESTOCK_NOTIFY_LIMIT = 200;
/** Subscribe + cancel calls per customer (enforced in api-handler.mjs, like the coupon guard). */
export const STOCK_WATCH_RATE_LIMIT = { perUser: 30, windowMs: 3600000 };
/** Options one customer may wait for at once. */
export const STOCK_WATCH_MAX_PER_USER = 50;
export const BACK_IN_STOCK_TITLE = "สินค้าที่คุณรอกลับมามีของแล้ว";

export function createStockWatch({
  one,
  all,
  run,
  tx,
  fail,
  clean,
  requireUser,
  notify,
  randomUUID,
  clock = () => Date.now(),
  inventoryAvailableAliased,
  // accountEmail-like { enabled, queue({kind,to,ref,message}) } + templates + base URL helpers.
  email = null,
  emailTemplate = null,
  shopName = () => "ASIA EXTRA",
  publicBaseUrl = "",
}) {
  const now = () => new Date(clock()).toISOString().slice(0, 19).replace("T", " ");
  const productLink = (productId, variantId) =>
    "/products/" + encodeURIComponent(productId) + "?variant=" + encodeURIComponent(variantId);
  const buyableSql = `(p.active=1 AND COALESCE(p.hidden_seed,0)=0 AND COALESCE(p.preorder,0)=0
      AND COALESCE(v.active,1)=1
      AND EXISTS (SELECT 1 FROM inventory i WHERE i.variant_id=v.id AND ${inventoryAvailableAliased}))`;

  function variantFor(variantIdRaw) {
    const variantId = clean(variantIdRaw, 1, 80, "ตัวเลือกสินค้า");
    const row = one(
      `SELECT v.id, v.label, p.id AS product_id, p.name, p.preorder, p.active, COALESCE(p.hidden_seed,0) AS hidden_seed,
              COALESCE(v.active,1) AS variant_active, ${buyableSql} AS buyable
       FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?`,
      variantId,
    );
    if (!row || !row.active || row.hidden_seed || !row.variant_active) fail(404, "ไม่พบตัวเลือกสินค้า");
    return row;
  }

  /** GET /api/stock-watch — options this customer is still waiting for. */
  function myStockWatches(user) {
    requireUser(user);
    return all(
      `SELECT w.variant_id, w.created_at, v.label, p.id AS product_id, p.name AS product,
              ${buyableSql} AS buyable
       FROM stock_watch w JOIN variants v ON v.id=w.variant_id JOIN products p ON p.id=v.product_id
       WHERE w.user_id=? AND w.notified_at IS NULL AND p.active=1 AND COALESCE(p.hidden_seed,0)=0
       ORDER BY w.created_at DESC, w.rowid DESC`,
      user.id,
    ).map((row) => ({
      variantId: row.variant_id,
      productId: row.product_id,
      product: row.product,
      label: row.label,
      created_at: row.created_at,
      // Back in stock but not notified yet (more than the per-restock limit were waiting).
      available: !!row.buyable,
    }));
  }

  /** POST /api/stock-watch {variantId} — wait for an out-of-stock, ready-stock option. */
  function addStockWatch(user, input = {}) {
    requireUser(user);
    const variant = variantFor(input.variantId);
    if (variant.preorder) fail(409, "สินค้าพรีออเดอร์สั่งจองได้เลย ไม่ต้องรอแจ้งเตือน");
    return tx(() => {
      const existing = one(
        "SELECT id, notified_at FROM stock_watch WHERE user_id=? AND variant_id=?",
        user.id,
        variant.id,
      );
      if (existing && existing.notified_at == null) return { watching: true, variantId: variant.id };
      if (variant.buyable) fail(409, "ตัวเลือกนี้มีสินค้าแล้ว สั่งซื้อได้เลย");
      const count = one(
        "SELECT COUNT(*) AS n FROM stock_watch WHERE user_id=? AND notified_at IS NULL",
        user.id,
      ).n;
      if (count >= STOCK_WATCH_MAX_PER_USER)
        fail(409, `รอแจ้งเตือนได้สูงสุด ${STOCK_WATCH_MAX_PER_USER} รายการ ยกเลิกรายการเก่าในหน้าบัญชีก่อน`);
      // One-shot: an old, already-notified row is replaced, so the customer joins the end
      // of the line for the next restock.
      if (existing) run("DELETE FROM stock_watch WHERE id=?", existing.id);
      run(
        "INSERT INTO stock_watch(id,user_id,variant_id,created_at) VALUES(?,?,?,?)",
        randomUUID(),
        user.id,
        variant.id,
        now(),
      );
      return { watching: true, variantId: variant.id };
    });
  }

  /** DELETE /api/stock-watch/:variantId — stop waiting (no error when not waiting). */
  function removeStockWatch(user, variantIdRaw) {
    requireUser(user);
    const variantId = clean(variantIdRaw, 1, 80, "ตัวเลือกสินค้า");
    run("DELETE FROM stock_watch WHERE user_id=? AND variant_id=? AND notified_at IS NULL", user.id, variantId);
    return { watching: false, variantId };
  }

  /** Waiting customers per option (admin product list / product page / alerts). */
  function waitingCounts(variantIds) {
    const ids = [...new Set(variantIds)].filter(Boolean);
    const counts = new Map();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      for (const row of all(
        `SELECT variant_id, COUNT(*) AS n FROM stock_watch
         WHERE notified_at IS NULL AND variant_id IN (${chunk.map(() => "?").join(",")})
         GROUP BY variant_id`,
        ...chunk,
      ))
        counts.set(row.variant_id, row.n);
    }
    return counts;
  }
  const waitingFor = (variantId) => waitingCounts([variantId]).get(variantId) ?? 0;

  /** Buyable state of every option somebody is waiting for. */
  function snapshot() {
    const state = new Map();
    for (const row of all(
      `SELECT v.id, ${buyableSql} AS buyable
       FROM variants v JOIN products p ON p.id=v.product_id
       WHERE v.id IN (SELECT DISTINCT variant_id FROM stock_watch WHERE notified_at IS NULL)`,
    ))
      state.set(row.id, !!row.buyable);
    return state;
  }

  function baseUrl(ctx = {}) {
    for (const candidate of [publicBaseUrl, ctx?.origin]) {
      if (typeof candidate !== "string" || !candidate) continue;
      try {
        const url = new URL(candidate);
        if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
      } catch {
        // next
      }
    }
    return "";
  }

  /**
   * Restock event for one option: notify the first RESTOCK_NOTIFY_LIMIT waiting customers
   * (in the order they asked), mark them notified. Returns how many were told.
   */
  function notifyRestock(variantId, ctx = {}) {
    const sent = tx(() => {
      const info = one(
        `SELECT v.id, v.label, p.id AS product_id, p.name, ${buyableSql} AS buyable
         FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?`,
        variantId,
      );
      if (!info?.buyable) return [];
      const waiting = all(
        `SELECT w.id, w.user_id, u.email FROM stock_watch w JOIN users u ON u.id=w.user_id
         WHERE w.variant_id=? AND w.notified_at IS NULL
         ORDER BY w.created_at ASC, w.rowid ASC LIMIT ?`,
        variantId,
        RESTOCK_NOTIFY_LIMIT,
      );
      const at = now();
      for (const w of waiting) {
        const marked = run(
          "UPDATE stock_watch SET notified_at=? WHERE id=? AND notified_at IS NULL",
          at,
          w.id,
        );
        if (!marked.changes) continue;
        notify(
          w.user_id,
          "back_in_stock",
          BACK_IN_STOCK_TITLE,
          info.name + " · " + info.label,
          productLink(info.product_id, info.id),
        );
      }
      return waiting.map((w) => ({ ...w, info }));
    });
    // Email after the commit; queue() never throws and skips placeholder (.local) addresses.
    if (sent.length && email?.enabled && emailTemplate) {
      const base = baseUrl(ctx);
      for (const w of sent) {
        if (!isRealEmail(w.email)) continue;
        email.queue({
          kind: "back_in_stock",
          to: w.email,
          ref: "back-in-stock:" + w.id,
          message: emailTemplate({
            shopName: shopName(),
            product: w.info.name + " · " + w.info.label,
            link: base + productLink(w.info.product_id, w.info.id),
          }),
        });
      }
    }
    return sent.length;
  }

  /**
   * Run a call that may bring options back (import, re-activate). Options that were not
   * buyable before and are buyable after count as one restock event each.
   */
  function track(fn, ctx) {
    let before;
    try {
      before = snapshot();
    } catch {
      return fn();
    }
    const result = fn();
    if (!before.size) return result;
    try {
      const after = snapshot();
      for (const [variantId, buyable] of after)
        if (buyable && before.get(variantId) === false) notifyRestock(variantId, ctx);
    } catch (error) {
      // The import itself succeeded; a failed notice must not turn it into an error.
      console.error("Back-in-stock notice failed:", error?.message);
    }
    return result;
  }

  /** Wrap the service calls that can make an option buyable again (ctx = { origin }). */
  function hook(service) {
    const wrap = (name, ctxIndex) => {
      const fn = service[name];
      if (typeof fn !== "function") return;
      service[name] = (...args) => track(() => fn(...args), args[ctxIndex]);
    };
    wrap("importCodes", 2);
    wrap("saveProduct", 2);
    wrap("bulkUpdateProducts", 2);
    wrap("updateVariant", 3);
  }

  return {
    myStockWatches,
    addStockWatch,
    removeStockWatch,
    waitingCounts,
    waitingFor,
    notifyRestock,
    track,
    hook,
  };
}
