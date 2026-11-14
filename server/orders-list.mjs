/**
 * Customer order history: server pagination, status filter, search, and bulk copy.
 * Merges checkout_id lines the same way as src/OrderList.tsx mergeCheckouts.
 */
import { createHmac } from "node:crypto";

export const ORDERS_COPY_MAX = 500;
export const ORDERS_PAGE_DEFAULT = 20;
export const ORDERS_PAGE_MAX = 100;
/** Legacy rows without password_search_key: decrypt at most this many for password q. */
export const PASSWORD_SEARCH_SCAN_MAX = 2000;

export function ensureOrderFulfillmentSearch(db) {
  const cols = new Set(db.prepare("PRAGMA table_info(inventory)").all().map((c) => c.name));
  if (!cols.has("password_search_key")) {
    db.exec("ALTER TABLE inventory ADD COLUMN password_search_key TEXT");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_inventory_password_search ON inventory(password_search_key) WHERE password_search_key IS NOT NULL AND password_search_key != ''",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_inventory_login_key_order ON inventory(login_key, order_id) WHERE order_id IS NOT NULL",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_inventory_login_key_reservation ON inventory(login_key, reservation_id) WHERE reservation_id IS NOT NULL",
  );
}

export function inventoryPasswordSearchKey(key, password) {
  return createHmac("sha256", key)
    .update(JSON.stringify({ v: 1, kind: "password", value: String(password ?? "") }), "utf8")
    .digest("hex");
}

/** Same buckets as statusGroup() in OrderList.tsx / shownStatus in App.tsx (light rows). */
export function lightShownStatus(row) {
  if (row.status === "DELIVERED" && row.fulfilment_state === "waiting") return "WAITING";
  if (row.status === "PREORDER" && row.stage === "called") return "CALLED";
  if (row.stage === "lapsed") return "LAPSED";
  if (row.refund_status) return row.refund_status;
  if (row.status === "CANCELLED" && row.expired_at) return "EXPIRED";
  return row.status;
}

export function lightStatusGroup(row) {
  const s = lightShownStatus(row);
  if (s === "DELIVERED") return "delivered";
  if (s === "FAILED") return "failed";
  if (["CANCELLED", "EXPIRED", "LAPSED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(s)) return "cancelled";
  return "processing";
}

/** Least-done line wins — mirrors Cart.tsx groupStatus on shown statuses. */
export function lightGroupStatus(rows) {
  const shown = rows.map(lightShownStatus);
  for (const s of ["PENDING_PAYMENT", "WAITING", "CALLED", "PREORDER"]) if (shown.includes(s)) return s;
  return shown.every((s) => s === shown[0]) ? shown[0] : shown.includes("DELIVERED") ? "DELIVERED" : shown[0];
}

export function mergeCheckoutLight(rows) {
  const groups = new Map();
  for (const o of rows) if (o.checkout_id) groups.set(o.checkout_id, [...(groups.get(o.checkout_id) ?? []), o]);
  const out = [];
  const done = new Set();
  for (const o of rows) {
    if (!o.checkout_id) {
      out.push({
        ...o,
        entryId: o.id,
        lineIds: [o.id],
        searchBlob: [o.name, o.label].join(" "),
        preorder: !!o.preorder,
      });
      continue;
    }
    if (done.has(o.checkout_id)) continue;
    done.add(o.checkout_id);
    const lines = [...groups.get(o.checkout_id)].sort((a, b) => (a.checkout_line ?? 0) - (b.checkout_line ?? 0));
    const first = lines[0];
    out.push({
      ...first,
      entryId: o.checkout_id,
      lineIds: lines.map((l) => l.id),
      name: lines.length > 1 ? first.name + " + อีก " + (lines.length - 1) + " รายการ" : first.name,
      label: lines.map((l) => l.label).join(", "),
      // All product/option names for q= search (UI haystack includes every line).
      searchBlob: lines.map((l) => [l.name, l.label].join(" ")).join("\n"),
      quantity: lines.reduce((n, l) => n + (l.quantity || 0), 0),
      total: lines.reduce((n, l) => n + (l.total || 0), 0),
      status: lightGroupStatus(lines),
      preorder: lines.some((l) => l.preorder),
    });
  }
  return out;
}

export function createOrdersListApis({
  one,
  all,
  run,
  fail,
  requireUser,
  key,
  orderDetail,
  inventoryLoginKey,
  decrypt,
  inventoryPasswordSearchKey: passwordKeyFn,
}) {
  const passwordKey = passwordKeyFn || ((pw) => inventoryPasswordSearchKey(key, pw));

  function backfillPasswordSearchKeys(limit = 5000) {
    for (const row of all(
      `SELECT id, password_enc FROM inventory
       WHERE (password_search_key IS NULL OR password_search_key='')
         AND COALESCE(legacy_single_secret,0)=0
         AND password_enc IS NOT NULL
       LIMIT ?`,
      limit,
    )) {
      try {
        const pw = decrypt(row.password_enc);
        run("UPDATE inventory SET password_search_key=? WHERE id=?", passwordKey(pw), row.id);
      } catch {
        run("UPDATE inventory SET password_search_key=? WHERE id=?", "", row.id);
      }
    }
  }

  function loadLightRows(userId) {
    const orders = all(
      `SELECT o.id, o.status, o.created_at, o.checkout_id, o.checkout_line, o.expired_at, o.quantity, o.total,
              o.discount, o.variant_id, NULL AS stage,
              p.name, v.label,
              (SELECT state FROM order_fulfilment f WHERE f.order_id=o.id) AS fulfilment_state,
              (SELECT CASE
                 WHEN COALESCE((SELECT SUM(amount) FROM ledger WHERE order_id=o.id AND kind='REFUND'),0) <= 0 THEN NULL
                 WHEN COALESCE((SELECT SUM(amount) FROM ledger WHERE order_id=o.id AND kind='REFUND'),0)
                      >= COALESCE((SELECT SUM(amount) FROM payments WHERE order_id=o.id AND status='SUCCEEDED'),0)
                   THEN 'REFUNDED'
                 ELSE 'PARTIALLY_REFUNDED' END) AS refund_status,
              0 AS preorder
       FROM orders o
       JOIN variants v ON v.id=o.variant_id
       JOIN products p ON p.id=v.product_id
       WHERE o.user_id=?
       ORDER BY o.created_at DESC, o.rowid DESC`,
      userId,
    );
    const reservations = all(
      `SELECT o.id, o.status, o.created_at, o.checkout_id, o.checkout_line, o.expired_at, o.quantity, o.total,
              o.discount, o.variant_id, o.stage,
              p.name, v.label,
              NULL AS fulfilment_state,
              (SELECT CASE
                 WHEN COALESCE((SELECT SUM(amount) FROM ledger WHERE order_id=o.id AND kind='REFUND'),0) <= 0 THEN NULL
                 WHEN COALESCE((SELECT SUM(amount) FROM ledger WHERE order_id=o.id AND kind='REFUND'),0)
                      >= COALESCE((SELECT SUM(amount) FROM payments WHERE reservation_id=o.id AND status='SUCCEEDED'),0)
                   THEN 'REFUNDED'
                 ELSE 'PARTIALLY_REFUNDED' END) AS refund_status,
              1 AS preorder
       FROM reservations o
       JOIN variants v ON v.id=o.variant_id
       JOIN products p ON p.id=v.product_id
       WHERE o.user_id=?
       ORDER BY o.created_at DESC, o.rowid DESC`,
      userId,
    );
    return orders.concat(reservations).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  function secretMatchIds(userId, q) {
    const ids = new Set();
    const trimmed = q.trim();
    if (!trimmed) return ids;
    const keys = [
      inventoryLoginKey(false, trimmed),
      inventoryLoginKey(true, trimmed),
      inventoryLoginKey("link", trimmed),
      inventoryLoginKey("code", trimmed),
    ];
    const uniqKeys = [...new Set(keys)];
    for (const lk of uniqKeys) {
      for (const row of all(
        `SELECT order_id, reservation_id FROM inventory i
         WHERE i.login_key=? AND COALESCE(i.defective,0)=0
           AND (
             (i.order_id IS NOT NULL AND EXISTS(SELECT 1 FROM orders o WHERE o.id=i.order_id AND o.user_id=?))
             OR (i.reservation_id IS NOT NULL AND EXISTS(SELECT 1 FROM reservations r WHERE r.id=i.reservation_id AND r.user_id=?))
           )`,
        lk,
        userId,
        userId,
      )) {
        if (row.order_id) ids.add(row.order_id);
        if (row.reservation_id) ids.add(row.reservation_id);
      }
    }
    const pwk = passwordKey(trimmed);
    for (const row of all(
      `SELECT order_id, reservation_id FROM inventory i
       WHERE i.password_search_key=? AND COALESCE(i.defective,0)=0
         AND (
           (i.order_id IS NOT NULL AND EXISTS(SELECT 1 FROM orders o WHERE o.id=i.order_id AND o.user_id=?))
           OR (i.reservation_id IS NOT NULL AND EXISTS(SELECT 1 FROM reservations r WHERE r.id=i.reservation_id AND r.user_id=?))
         )`,
      pwk,
      userId,
      userId,
    )) {
      if (row.order_id) ids.add(row.order_id);
      if (row.reservation_id) ids.add(row.reservation_id);
    }
    // Legacy rows without password_search_key: bounded decrypt for this user only.
    let scanned = 0;
    for (const row of all(
      `SELECT i.id, i.password_enc, i.order_id, i.reservation_id FROM inventory i
       WHERE (i.password_search_key IS NULL OR i.password_search_key='')
         AND COALESCE(i.legacy_single_secret,0)=0
         AND i.password_enc IS NOT NULL
         AND COALESCE(i.defective,0)=0
         AND (
           (i.order_id IS NOT NULL AND EXISTS(SELECT 1 FROM orders o WHERE o.id=i.order_id AND o.user_id=?))
           OR (i.reservation_id IS NOT NULL AND EXISTS(SELECT 1 FROM reservations r WHERE r.id=i.reservation_id AND r.user_id=?))
         )
       LIMIT ?`,
      userId,
      userId,
      PASSWORD_SEARCH_SCAN_MAX,
    )) {
      scanned++;
      try {
        const pw = decrypt(row.password_enc);
        run("UPDATE inventory SET password_search_key=? WHERE id=?", passwordKey(pw), row.id);
        if (pw === trimmed) {
          if (row.order_id) ids.add(row.order_id);
          if (row.reservation_id) ids.add(row.reservation_id);
        }
      } catch {
        /* skip */
      }
      if (scanned >= PASSWORD_SEARCH_SCAN_MAX) break;
    }
    return ids;
  }

  function entryMatchesQuery(entry, q, secretIds) {
    if (!q) return true;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const bare = needle.replace(/^#/, "");
    for (const id of entry.lineIds) {
      if (id.toLowerCase() === bare || id.toLowerCase().startsWith(bare.slice(0, 8))) return true;
      if (secretIds.has(id)) return true;
    }
    if ((entry.name || "").toLowerCase().includes(needle)) return true;
    if ((entry.label || "").toLowerCase().includes(needle)) return true;
    if ((entry.searchBlob || "").toLowerCase().includes(needle)) return true;
    if (entry.entryId && String(entry.entryId).toLowerCase().includes(bare)) return true;
    return false;
  }

  function listOrders(user, query = {}) {
    requireUser(user);
    backfillPasswordSearchKeys(2000);
    const hasPage = query.page != null && String(query.page).trim() !== "";
    if (!hasPage) {
      // Legacy: full list with decrypt (OrderList / older clients).
      return null; // signal caller to use service.orders(user)
    }
    let page = Number(query.page);
    if (!Number.isInteger(page) || page < 1) fail(400, "หน้าไม่ถูกต้อง");
    let limit = ORDERS_PAGE_DEFAULT;
    if (query.limit != null && String(query.limit).trim() !== "") {
      const parsed = Number(query.limit);
      if (!Number.isInteger(parsed) || parsed < 1) fail(400, "จำนวนรายการไม่ถูกต้อง");
      limit = Math.min(ORDERS_PAGE_MAX, parsed);
    }
    const status = (query.status || "all").trim() || "all";
    if (!["all", "processing", "delivered", "failed", "cancelled"].includes(status))
      fail(400, "สถานะไม่ถูกต้อง");
    const q = query.q != null ? String(query.q) : "";
    const light = loadLightRows(user.id);
    const merged = mergeCheckoutLight(light);
    const secretIds = q.trim() ? secretMatchIds(user.id, q) : new Set();
    const filtered = merged.filter((e) => {
      if (status !== "all") {
        // For merged checkout, use lightStatusGroup on synthetic status already set to groupStatus result.
        const g = e.checkout_id && e.lineIds.length > 1 ? lightStatusGroup({ ...e, status: e.status }) : lightStatusGroup(e);
        // e.status for multi may already be groupStatus string (PENDING_PAYMENT etc.) — map via lightStatusGroup
        const bucket =
          e.lineIds.length > 1
            ? (() => {
                const s = e.status;
                if (s === "DELIVERED") return "delivered";
                if (s === "FAILED") return "failed";
                if (["CANCELLED", "EXPIRED", "LAPSED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(s)) return "cancelled";
                return "processing";
              })()
            : g;
        if (bucket !== status) return false;
      }
      return entryMatchesQuery(e, q, secretIds);
    });
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / limit) || 1);
    if (page > pages && total > 0) fail(400, "หน้าไม่ถูกต้อง");
    const slice = filtered.slice((page - 1) * limit, page * limit);
    const orders = slice.map((entry) => {
      if (entry.lineIds.length === 1) return orderDetail(user, entry.lineIds[0]);
      const lines = entry.lineIds.map((id) => orderDetail(user, id));
      const first = lines[0];
      return {
        ...first,
        id: entry.entryId,
        name: entry.name,
        label: entry.label,
        quantity: entry.quantity,
        total: entry.total,
        status: entry.status,
        checkout_id: entry.checkout_id,
        codes: lines.flatMap((l) => l.codes ?? []),
        credentials: lines.flatMap((l) => l.credentials ?? []),
        links: lines.flatMap((l) => l.links ?? []),
        href: "/checkouts/" + entry.checkout_id,
        lines,
        refundStatus: null,
        stage: null,
        expired_at: null,
        fulfilment: null,
      };
    });
    return { orders, total, page, pages };
  }

  function copyOrderLines(user, ids) {
    requireUser(user);
    if (!Array.isArray(ids) || ids.length === 0) fail(400, "เลือกคำสั่งซื้อก่อน");
    if (ids.length > ORDERS_COPY_MAX) fail(400, "เลือกได้ไม่เกิน " + ORDERS_COPY_MAX + " รายการ");
    const lines = [];
    for (const raw of ids) {
      const id = String(raw || "").trim();
      if (!id) continue;
      // Checkout id: expand to line orders owned by user.
      const checkoutLines = all(
        `SELECT id, checkout_line AS line_no FROM orders WHERE user_id=? AND checkout_id=?
         UNION ALL
         SELECT id, checkout_line AS line_no FROM reservations WHERE user_id=? AND checkout_id=?`,
        user.id,
        id,
        user.id,
        id,
      ).sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0));
      const orderIds =
        checkoutLines.length > 0
          ? checkoutLines.map((r) => r.id)
          : (() => {
              const own =
                one("SELECT id FROM orders WHERE id=? AND user_id=?", id, user.id) ||
                one("SELECT id FROM reservations WHERE id=? AND user_id=?", id, user.id);
              if (!own) fail(404, "ไม่พบคำสั่งซื้อ");
              return [id];
            })();
      for (const oid of orderIds) {
        const detail = orderDetail(user, oid);
        for (const c of detail.credentials ?? []) {
          const parts = [c.loginId, c.password];
          if (c.profile) parts.push("โปรไฟล์ " + c.profile);
          if (c.pin) parts.push("PIN " + c.pin);
          lines.push(parts.join(" | "));
        }
        for (const code of detail.codes ?? []) lines.push(code);
        for (const link of detail.links ?? []) lines.push(link);
      }
    }
    return { lines };
  }

  return { listOrders, copyOrderLines, backfillPasswordSearchKeys, loadLightRows };
}
