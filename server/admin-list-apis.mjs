/** Admin FR Work 2 — cursor-paginated list/detail/reveal APIs (FR-O2–O4, C1–C2, P1). */

function parseLimit(limit, fail, { fallback = 25, max = 100 } = {}) {
  if (limit == null || String(limit).trim() === "") return fallback;
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1) fail(400, "จำนวนรายการไม่ถูกต้อง");
  return Math.min(max, parsed);
}

function encodeCursor(parts) {
  return Buffer.from(parts.join("\n"), "utf8").toString("base64url");
}

function decodeCursor(cursor, fail, expectedParts = 2) {
  if (cursor == null || String(cursor).trim() === "") return null;
  try {
    const raw = Buffer.from(String(cursor), "base64url").toString("utf8");
    const parts = raw.split("\n");
    if (parts.length !== expectedParts || parts.some((p) => p === ""))
      fail(400, "cursor ไม่ถูกต้อง");
    return parts;
  } catch {
    fail(400, "cursor ไม่ถูกต้อง");
  }
}

function maskSecret(value) {
  const s = String(value ?? "");
  if (!s) return "";
  if (s.length <= 2) return "*".repeat(s.length);
  return s.slice(0, 2) + "***";
}

function maskCredential(item) {
  if (typeof item === "string") return maskSecret(item);
  return {
    loginId: maskSecret(item.loginId),
    password: "••••••••",
  };
}

/** Escape LIKE wildcards; pair with `ESCAPE '\\'` in SQL. */
function likeContains(value) {
  return (
    "%" +
    String(value)
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_") +
    "%"
  );
}

// Status tabs on the orders page (Polaris resource-index idea, shadcn/ui tabs).
// "todo" is the STAFF default: paid preorders waiting to be sent. Chat threads
// are not linked to orders, so "unread issues" cannot be counted cheaply yet.
export const ORDER_STATUS_GROUPS = {
  pending: ["PENDING_PAYMENT"],
  preorder: ["PREORDER"],
  delivered: ["DELIVERED"],
  failed: ["FAILED", "OUT_OF_STOCK", "CANCELLED"],
  todo: ["PREORDER"],
};

const ORDER_UNION = `
  SELECT o.id,o.status,o.total,o.quantity,o.created_at,o.variant_id,
         u.id AS customer_id,u.name AS customer,u.email AS customer_email,
         p.id AS product_id,p.name AS product,v.label AS variant_label,
         0 AS preorder,CAST(NULL AS INTEGER) AS queue_number
  FROM orders o
  JOIN users u ON u.id=o.user_id
  JOIN variants v ON v.id=o.variant_id
  JOIN products p ON p.id=v.product_id
  UNION ALL
  SELECT o.id,o.status,o.total,o.quantity,o.created_at,o.variant_id,
         u.id AS customer_id,u.name AS customer,u.email AS customer_email,
         p.id AS product_id,p.name AS product,v.label AS variant_label,
         1 AS preorder,o.queue_number
  FROM reservations o
  JOIN users u ON u.id=o.user_id
  JOIN variants v ON v.id=o.variant_id
  JOIN products p ON p.id=v.product_id
`;

export function createAdminListApis({
  requireStaff,
  one,
  all,
  tx,
  fail,
  clean,
  audit,
  run,
  notify,
  readDeliveredItems,
  inventoryAvailableAliased,
  getLowStockAt,
  bangkokDayRange,
  isAdmin,
  paymentSummaryFor,
  history,
}) {
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );
  function dayBounds(fromRaw, toRaw) {
    const hasFrom = fromRaw != null && String(fromRaw).trim() !== "";
    const hasTo = toRaw != null && String(toRaw).trim() !== "";
    if (hasFrom !== hasTo) fail(400, "ต้องส่ง from และ to คู่กัน");
    if (!hasFrom) return null;
    return bangkokDayRange(
      clean(String(fromRaw).trim(), 10, 10, "วันเริ่ม"),
      clean(String(toRaw).trim(), 10, 10, "วันสิ้นสุด"),
    );
  }

  function adminOrders(user, query = {}) {
    requireStaff(user);
    const lim = parseLimit(query.limit, fail);
    const status =
      query.status != null && String(query.status).trim() !== ""
        ? clean(query.status, 1, 40, "สถานะ")
        : null;
    const range = dayBounds(query.from, query.to);
    const product =
      query.product != null && String(query.product).trim() !== ""
        ? clean(query.product, 1, 120, "สินค้า")
        : null;
    const customer =
      query.customer != null && String(query.customer).trim() !== ""
        ? clean(query.customer, 1, 120, "ลูกค้า")
        : null;
    const typeRaw =
      query.type != null && String(query.type).trim() !== ""
        ? clean(query.type, 1, 20, "ประเภท")
        : null;
    if (typeRaw && !["ready", "preorder"].includes(typeRaw))
      fail(400, "ประเภทไม่ถูกต้อง");
    const q =
      query.q != null && String(query.q).trim() !== ""
        ? clean(query.q, 1, 120, "คำค้น")
        : null;
    const groupRaw =
      query.group != null && String(query.group).trim() !== ""
        ? clean(query.group, 1, 20, "แท็บสถานะ")
        : null;
    if (groupRaw && groupRaw !== "all" && !ORDER_STATUS_GROUPS[groupRaw])
      fail(400, "แท็บสถานะไม่ถูกต้อง");
    const group = groupRaw && groupRaw !== "all" ? ORDER_STATUS_GROUPS[groupRaw] : null;
    const cursorParts = decodeCursor(query.cursor, fail, 2);

    // Filters other than status: shared by the page and the tab counts.
    const where = [];
    const params = [];
    if (range) {
      where.push("created_at >= ?");
      params.push(range.fromUtc);
      where.push("created_at <= ?");
      params.push(range.toUtc);
    }
    if (product) {
      where.push("(product_id = ? OR product LIKE ? ESCAPE '\\')");
      params.push(product, likeContains(product));
    }
    if (customer) {
      where.push(
        "(customer_id = ? OR customer LIKE ? ESCAPE '\\' OR customer_email LIKE ? ESCAPE '\\')",
      );
      params.push(customer, likeContains(customer), likeContains(customer));
    }
    if (typeRaw === "ready") where.push("preorder = 0");
    if (typeRaw === "preorder") where.push("preorder = 1");
    if (q) {
      where.push(
        "(id LIKE ? ESCAPE '\\' OR product LIKE ? ESCAPE '\\' OR customer LIKE ? ESCAPE '\\' OR customer_email LIKE ? ESCAPE '\\')",
      );
      const like = likeContains(q);
      params.push(like, like, like, like);
    }
    const baseWhere = [...where];
    const baseParams = [...params];
    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    if (group) {
      where.push(`status IN (${group.map(() => "?").join(",")})`);
      params.push(...group);
    }
    if (cursorParts) {
      const [created, id] = cursorParts;
      where.push("(created_at < ? OR (created_at = ? AND id < ?))");
      params.push(created, created, id);
    }
    const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
    const rows = all(
      `SELECT * FROM (${ORDER_UNION})
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      ...params,
      lim + 1,
    );
    // Tab counts for the current filters except status; first page only.
    let counts;
    if (!cursorParts) {
      const inList = (key) => ORDER_STATUS_GROUPS[key].map((s) => `'${s}'`).join(",");
      const c = one(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(status IN (${inList("pending")})),0) AS pending,
                COALESCE(SUM(status IN (${inList("preorder")})),0) AS preorder,
                COALESCE(SUM(status IN (${inList("delivered")})),0) AS delivered,
                COALESCE(SUM(status IN (${inList("failed")})),0) AS failed,
                COALESCE(SUM(status IN (${inList("todo")})),0) AS todo
         FROM (${ORDER_UNION})
         ${baseWhere.length ? " WHERE " + baseWhere.join(" AND ") : ""}`,
        ...baseParams,
      );
      counts = {
        all: c.total,
        pending: c.pending,
        preorder: c.preorder,
        delivered: c.delivered,
        failed: c.failed,
        todo: c.todo,
      };
    }
    const page = rows.slice(0, lim).map((row) => ({
      id: row.id,
      status: row.status,
      total: row.total,
      quantity: row.quantity,
      created_at: row.created_at,
      customer_id: row.customer_id,
      customer: row.customer,
      customer_email: row.customer_email,
      product_id: row.product_id,
      product: row.product,
      variant_id: row.variant_id,
      variant_label: row.variant_label,
      preorder: !!row.preorder,
      queue_number: row.queue_number,
      type: row.preorder ? "preorder" : "ready",
    }));
    const nextCursor =
      rows.length > lim
        ? encodeCursor([
            page[page.length - 1].created_at,
            page[page.length - 1].id,
          ])
        : null;
    return counts ? { orders: page, nextCursor, counts } : { orders: page, nextCursor };
  }

  function loadAdminOrderRow(orderId) {
    return (
      one(
        `SELECT o.*,p.name AS product,p.art,p.id AS product_id,v.label AS variant_label,v.id AS variant_id,
                u.id AS customer_id,u.name AS customer,u.email AS customer_email,
                0 AS preorder,CAST(NULL AS INTEGER) AS queue_number
         FROM orders o
         JOIN users u ON u.id=o.user_id
         JOIN variants v ON v.id=o.variant_id
         JOIN products p ON p.id=v.product_id
         WHERE o.id=?`,
        orderId,
      ) ??
      one(
        `SELECT o.*,p.name AS product,p.art,p.id AS product_id,v.label AS variant_label,v.id AS variant_id,
                u.id AS customer_id,u.name AS customer,u.email AS customer_email,
                1 AS preorder,o.queue_number
         FROM reservations o
         JOIN users u ON u.id=o.user_id
         JOIN variants v ON v.id=o.variant_id
         JOIN products p ON p.id=v.product_id
         WHERE o.id=?`,
        orderId,
      )
    );
  }

  function paymentsForOrder(row) {
    if (row.preorder)
      return all(
        "SELECT id,amount,currency,status,provider,provider_ref,created_at,finalized_at FROM payments WHERE reservation_id=? ORDER BY created_at ASC,rowid ASC",
        row.id,
      );
    return all(
      "SELECT id,amount,currency,status,provider,provider_ref,created_at,finalized_at FROM payments WHERE order_id=? ORDER BY created_at ASC,rowid ASC",
      row.id,
    );
  }

  function buildTimeline(row, payments) {
    const events = [{ at: row.created_at, event: "created" }];
    for (const p of payments) {
      if (p.status === "SUCCEEDED")
        events.push({ at: p.finalized_at ?? p.created_at, event: "paid" });
      if (p.status === "FAILED")
        events.push({
          at: p.finalized_at ?? p.created_at,
          event: "payment_failed",
        });
    }
    if (row.status === "DELIVERED") {
      const deliveredAt =
        row.delivered_at ??
        one(
          // MIN: a later replacement must not move the first delivery time.
          `SELECT MIN(sold_at) AS t FROM inventory WHERE ${
            row.preorder ? "reservation_id" : "order_id"
          }=?`,
          row.id,
        )?.t ??
        row.created_at;
      events.push({ at: deliveredAt, event: "delivered" });
    }
    if (row.status === "FAILED" || row.status === "OUT_OF_STOCK")
      events.push({ at: row.created_at, event: row.status.toLowerCase() });
    // Replaced by the CANCEL_ORDER audit entry (with time, actor and reason) when there is one.
    if (row.status === "CANCELLED") events.push({ at: row.created_at, event: "cancelled" });
    return events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  function adminOrderDetail(user, id) {
    requireStaff(user);
    const orderId = clean(id, 1, 80, "คำสั่งซื้อ");
    const row = loadAdminOrderRow(orderId);
    if (!row) fail(404, "ไม่พบคำสั่งซื้อ");
    const payments = paymentsForOrder(row);
    const notes = history.notesFor(orderId);
    const bind = row.preorder ? "reservation_id" : "order_id";
    const delivered =
      row.status === "DELIVERED"
        ? readDeliveredItems(bind, orderId)
        : { codes: [], credentials: [] };
    // Inventory ids in rowid order — UI replace button + FR-O5 POST body.
    const units =
      row.status === "DELIVERED"
        ? all(
            `SELECT id, legacy_single_secret FROM inventory
             WHERE ${bind}=? AND COALESCE(defective,0)=0
             ORDER BY rowid`,
            orderId,
          ).map((u) => ({ id: u.id, kind: u.legacy_single_secret ? "code" : "pair" }))
        : [];
    return {
      id: row.id,
      status: row.status,
      total: row.total,
      quantity: row.quantity,
      created_at: row.created_at,
      preorder: !!row.preorder,
      type: row.preorder ? "preorder" : "ready",
      queue_number: row.queue_number ?? null,
      delivered_at: row.delivered_at ?? null,
      delivered_by: row.delivered_by ?? null,
      // Snapshot set at delivery; later variant edits never move it.
      warranty_until: row.warranty_until ?? null,
      product: {
        id: row.product_id,
        name: row.product,
        art: row.art,
        variant_id: row.variant_id,
        variant_label: row.variant_label,
      },
      customer: {
        id: row.customer_id,
        name: row.customer,
        email: row.customer_email,
      },
      payments,
      // Paid / refunded / outstanding / fee — money, so ADMIN only (NFR-3).
      ...(paymentSummaryFor && isAdmin(user)
        ? { paymentSummary: paymentSummaryFor(row) }
        : {}),
      timeline: history.activityFor(row, buildTimeline(row, payments), notes),
      notes,
      replacements: history.replacementsFor(orderId),
      units,
      codes: delivered.codes.map(maskCredential),
      credentials: delivered.credentials.map(maskCredential),
      credentialsMasked: true,
    };
  }

  // Every reveal needs a reason, and each person gets an hourly budget. Hitting it
  // blocks further reveals and tells the admins once, so a leaving team member
  // cannot quietly pull every sold account.
  const REVEAL_LIMIT = { STAFF: 20, ADMIN: 60 };
  function adminRevealOrderCredentials(user, id, input = {}) {
    requireStaff(user);
    const orderId = clean(id, 1, 80, "คำสั่งซื้อ");
    const reason = clean(input.reason, 3, 200, "เหตุผลที่เปิดดู");
    // The over-limit warning is written in its own transaction so the refusal
    // (which throws) does not roll the alert back.
    const limit = REVEAL_LIMIT[user.role] ?? REVEAL_LIMIT.STAFF;
    const overLimit = tx(() => {
      const recent = one(
        "SELECT COUNT(*) AS n FROM audit WHERE user_id=? AND action='REVEAL_ORDER_CREDENTIALS' AND created_at >= datetime('now','-1 hour')",
        user.id,
      ).n;
      if (recent < limit) return false;
      const warned = one(
        "SELECT 1 AS y FROM audit WHERE user_id=? AND action='REVEAL_LIMIT' AND created_at >= datetime('now','-1 hour')",
        user.id,
      );
      if (!warned) {
        auditDetail(user, "REVEAL_LIMIT", orderId, { limit });
        for (const admin of all(
          "SELECT id FROM users WHERE role='ADMIN' AND COALESCE(status,'ACTIVE')='ACTIVE' AND id<>?",
          user.id,
        ))
          notify(
            admin.id,
            "security",
            "มีการเปิดดูรหัสบ่อยผิดปกติ",
            user.name + " เปิดดูรหัสครบ " + limit + " ครั้งในชั่วโมงเดียว ระบบระงับการเปิดดูของบัญชีนี้ชั่วคราว",
          );
      }
      return true;
    });
    if (overLimit)
      fail(429, "เปิดดูรหัสครบ " + limit + " ครั้งในชั่วโมงนี้แล้ว ระบบแจ้งแอดมินแล้ว ลองใหม่ภายหลัง");
    return tx(() => {
      const row = loadAdminOrderRow(orderId);
      if (!row) fail(404, "ไม่พบคำสั่งซื้อ");
      if (row.status !== "DELIVERED")
        fail(409, "ยังไม่มีบัญชีที่ส่งให้ดู");
      const bind = row.preorder ? "reservation_id" : "order_id";
      const delivered = readDeliveredItems(bind, orderId);
      auditDetail(user, "REVEAL_ORDER_CREDENTIALS", orderId, { reason });
      return {
        id: orderId,
        codes: delivered.codes,
        credentials: delivered.credentials,
        credentialsMasked: false,
      };
    });
  }

  function adminCustomers(user, query = {}) {
    requireStaff(user);
    const lim = parseLimit(query.limit, fail);
    const q =
      query.q != null && String(query.q).trim() !== ""
        ? clean(query.q, 1, 120, "คำค้น")
        : null;
    const status =
      query.status != null && String(query.status).trim() !== ""
        ? clean(query.status, 1, 40, "สถานะ")
        : null;
    if (status && !["ACTIVE", "SUSPENDED", "BANNED"].includes(status))
      fail(400, "สถานะไม่ถูกต้อง");
    const range = dayBounds(query.from, query.to);
    const adminViewer = isAdmin(user);
    const minSpent =
      query.minSpent != null && String(query.minSpent).trim() !== ""
        ? Number(query.minSpent)
        : null;
    const maxSpent =
      query.maxSpent != null && String(query.maxSpent).trim() !== ""
        ? Number(query.maxSpent)
        : null;
    if (minSpent != null && (!Number.isInteger(minSpent) || minSpent < 0))
      fail(400, "ยอดขั้นต่ำไม่ถูกต้อง");
    if (maxSpent != null && (!Number.isInteger(maxSpent) || maxSpent < 0))
      fail(400, "ยอดสูงสุดไม่ถูกต้อง");
    if (!adminViewer && (minSpent != null || maxSpent != null))
      fail(403, "เฉพาะผู้ดูแลร้านเท่านั้นที่กรองยอดใช้จ่ายได้");
    let hasOrders = null;
    if (query.hasOrders != null && String(query.hasOrders).trim() !== "") {
      const v = String(query.hasOrders).toLowerCase();
      if (!["true", "false", "1", "0"].includes(v))
        fail(400, "hasOrders ไม่ถูกต้อง");
      hasOrders = v === "true" || v === "1";
    }
    const sortRaw =
      query.sort != null && String(query.sort).trim() !== ""
        ? clean(query.sort, 1, 40, "การเรียง")
        : "created_at";
    if (!["created_at", "spent", "orders", "name"].includes(sortRaw))
      fail(400, "การเรียงไม่ถูกต้อง");
    // NFR-3: STAFF cannot probe money through spend filters either.
    if (!adminViewer && (minSpent != null || maxSpent != null))
      fail(403, "เฉพาะแอดมินดูยอดเงินได้");
    if (!adminViewer && sortRaw === "spent")
      fail(403, "เฉพาะผู้ดูแลร้านเท่านั้นที่เรียงตามยอดใช้จ่ายได้");
    const cursorParts = decodeCursor(query.cursor, fail, 2);

    const spentExpr = `COALESCE((SELECT SUM(amount) FROM payments pay WHERE pay.user_id=u.id AND pay.status='SUCCEEDED'),0)`;
    const orderCountExpr = `(SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) + (SELECT COUNT(*) FROM reservations r WHERE r.user_id=u.id)`;

    const where = ["u.role = 'CUSTOMER'"];
    const params = [];
    if (status) {
      where.push("COALESCE(u.status,'ACTIVE') = ?");
      params.push(status);
    }
    if (q) {
      where.push(
        "(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR IFNULL(u.username,'') LIKE ? ESCAPE '\\')",
      );
      const like = likeContains(q);
      params.push(like, like, like);
    }
    if (range) {
      where.push("u.created_at >= ?");
      params.push(range.fromUtc);
      where.push("u.created_at <= ?");
      params.push(range.toUtc);
    }
    if (minSpent != null) {
      where.push(`(${spentExpr}) >= ?`);
      params.push(minSpent);
    }
    if (maxSpent != null) {
      where.push(`(${spentExpr}) <= ?`);
      params.push(maxSpent);
    }
    if (hasOrders === true) where.push(`(${orderCountExpr}) > 0`);
    if (hasOrders === false) where.push(`(${orderCountExpr}) = 0`);

    if (cursorParts) {
      const [cursorVal, cursorId] = cursorParts;
      if (sortRaw === "name") {
        where.push("(u.name > ? OR (u.name = ? AND u.id > ?))");
        params.push(cursorVal, cursorVal, cursorId);
      } else if (sortRaw === "created_at") {
        where.push("(u.created_at < ? OR (u.created_at = ? AND u.id < ?))");
        params.push(cursorVal, cursorVal, cursorId);
      } else if (sortRaw === "spent") {
        where.push(
          `((${spentExpr}) < ? OR ((${spentExpr}) = ? AND u.id < ?))`,
        );
        params.push(Number(cursorVal), Number(cursorVal), cursorId);
      } else {
        where.push(
          `((${orderCountExpr}) < ? OR ((${orderCountExpr}) = ? AND u.id < ?))`,
        );
        params.push(Number(cursorVal), Number(cursorVal), cursorId);
      }
    }

    const orderSql =
      sortRaw === "name"
        ? "u.name ASC, u.id ASC"
        : sortRaw === "created_at"
          ? "u.created_at DESC, u.id DESC"
          : sortRaw === "spent"
            ? "spentSatang DESC, u.id DESC"
            : "orderCount DESC, u.id DESC";

    const rows = all(
      `SELECT u.id,u.name,u.email,u.username,u.role,u.created_at,COALESCE(u.status,'ACTIVE') AS status,u.phone,u.avatar_key,
              (${spentExpr}) AS spentSatang,
              (${orderCountExpr}) AS orderCount
       FROM users u
       WHERE ${where.join(" AND ")}
       ORDER BY ${orderSql}
       LIMIT ?`,
      ...params,
      lim + 1,
    );
    const page = rows.slice(0, lim).map((row) => {
      const base = {
        id: row.id,
        name: row.name,
        email: row.email,
        username: row.username,
        role: row.role,
        status: row.status,
        phone: row.phone ?? null,
        created_at: row.created_at,
        orderCount: row.orderCount,
        avatarUrl: row.avatar_key ? "/api/files/" + row.avatar_key : null,
      };
      if (adminViewer) base.spentSatang = row.spentSatang;
      return base;
    });
    const nextCursor =
      rows.length > lim
        ? encodeCursor([
            String(
              sortRaw === "name"
                ? page[page.length - 1].name
                : sortRaw === "created_at"
                  ? page[page.length - 1].created_at
                  : sortRaw === "spent"
                    ? rows[lim - 1].spentSatang
                    : page[page.length - 1].orderCount,
            ),
            page[page.length - 1].id,
          ])
        : null;
    return { customers: page, nextCursor };
  }

  function adminProducts(user, query = {}) {
    requireStaff(user);
    const lim = parseLimit(query.limit, fail);
    const q =
      query.q != null && String(query.q).trim() !== ""
        ? clean(query.q, 1, 120, "คำค้น")
        : null;
    const category =
      query.category != null && String(query.category).trim() !== ""
        ? clean(query.category, 1, 40, "หมวด")
        : null;
    const status =
      query.status != null && String(query.status).trim() !== ""
        ? clean(query.status, 1, 20, "สถานะ")
        : null;
    if (status && !["active", "inactive"].includes(status))
      fail(400, "สถานะสินค้าไม่ถูกต้อง");
    const typeRaw =
      query.type != null && String(query.type).trim() !== ""
        ? clean(query.type, 1, 20, "ประเภท")
        : null;
    if (typeRaw && !["ready", "preorder"].includes(typeRaw))
      fail(400, "ประเภทไม่ถูกต้อง");
    const stock =
      query.stock != null && String(query.stock).trim() !== ""
        ? clean(query.stock, 1, 20, "สต็อก")
        : null;
    if (stock && !["out", "low", "in"].includes(stock))
      fail(400, "ตัวกรองสต็อกไม่ถูกต้อง");
    const sortRaw =
      query.sort != null && String(query.sort).trim() !== ""
        ? clean(query.sort, 1, 20, "การเรียง")
        : "name";
    if (!["name", "stock", "sold", "id"].includes(sortRaw))
      fail(400, "การเรียงไม่ถูกต้อง");
    const cursorParts = decodeCursor(query.cursor, fail, 2);

    const stockExpr = `CASE WHEN p.preorder=1 THEN 0 ELSE (
      SELECT COUNT(*) FROM inventory i
      JOIN variants v ON v.id=i.variant_id
      WHERE v.product_id=p.id AND ${inventoryAvailableAliased}
    ) END`;
    const soldExpr = `(
      COALESCE((SELECT SUM(o.quantity) FROM orders o JOIN variants v ON v.id=o.variant_id WHERE v.product_id=p.id AND o.status='DELIVERED'),0)
      + COALESCE((SELECT SUM(r.quantity) FROM reservations r JOIN variants v ON v.id=r.variant_id WHERE v.product_id=p.id AND r.status IN ('PREORDER','DELIVERED')),0)
    )`;
    const lowAt = getLowStockAt();
    const stockStatusExpr = `CASE
      WHEN (${stockExpr}) <= 0 THEN 'out'
      WHEN (${stockExpr}) <= ${lowAt} THEN 'low'
      ELSE 'in' END`;

    const where = ["p.hidden_seed = 0"];
    const params = [];
    if (q) {
      where.push("p.name LIKE ? ESCAPE '\\'");
      params.push(likeContains(q));
    }
    if (category) {
      where.push("p.category = ?");
      params.push(category);
    }
    if (status === "active") where.push("p.active = 1");
    if (status === "inactive") where.push("p.active = 0");
    if (typeRaw === "ready") where.push("p.preorder = 0");
    if (typeRaw === "preorder") where.push("p.preorder = 1");
    if (stock) {
      where.push(`(${stockStatusExpr}) = ?`);
      params.push(stock);
    }
    if (cursorParts) {
      const [cursorVal, cursorId] = cursorParts;
      if (sortRaw === "name") {
        where.push("(p.name > ? OR (p.name = ? AND p.id > ?))");
        params.push(cursorVal, cursorVal, cursorId);
      } else if (sortRaw === "id") {
        where.push("p.id > ?");
        params.push(cursorId);
      } else if (sortRaw === "stock") {
        where.push(
          `((${stockExpr}) < ? OR ((${stockExpr}) = ? AND p.id < ?))`,
        );
        params.push(Number(cursorVal), Number(cursorVal), cursorId);
      } else {
        where.push(
          `((${soldExpr}) < ? OR ((${soldExpr}) = ? AND p.id < ?))`,
        );
        params.push(Number(cursorVal), Number(cursorVal), cursorId);
      }
    }

    const orderSql =
      sortRaw === "name"
        ? "p.name ASC, p.id ASC"
        : sortRaw === "stock"
          ? "stock DESC, p.id DESC"
          : sortRaw === "sold"
            ? "sold DESC, p.id DESC"
            : "p.id ASC";

    const rows = all(
      `SELECT p.*,
              (${stockExpr}) AS stock,
              (${soldExpr}) AS sold,
              (${stockStatusExpr}) AS stockStatus
       FROM products p
       WHERE ${where.join(" AND ")}
       ORDER BY ${orderSql}
       LIMIT ?`,
      ...params,
      lim + 1,
    );
    const page = rows.slice(0, lim).map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      art: row.art,
      active: !!row.active,
      featured: !!row.featured,
      preorder: !!row.preorder,
      stock: row.stock,
      stockStatus: row.stockStatus,
      sold: row.sold,
      type: row.preorder ? "preorder" : "ready",
      status: row.active ? "active" : "inactive",
      variants: [],
    }));
    // Stock per variant, so one empty option is not hidden inside the product total.
    if (page.length) {
      const byProduct = new Map(page.map((p) => [p.id, p]));
      for (const v of all(
        `SELECT v.id,v.product_id,v.label,v.price,COALESCE(v.active,1) AS active,v.warranty_days,
                (SELECT COUNT(*) FROM inventory i WHERE i.variant_id=v.id AND ${inventoryAvailableAliased}) AS stock
         FROM variants v
         WHERE v.product_id IN (${page.map(() => "?").join(",")})
         ORDER BY v.sort_order ASC, v.id ASC`,
        ...page.map((p) => p.id),
      )) {
        const product = byProduct.get(v.product_id);
        product.variants.push({
          id: v.id,
          label: v.label,
          price: v.price,
          active: !!v.active,
          warranty_days: v.warranty_days ?? 0,
          stock: product.preorder ? 0 : v.stock,
          stockStatus: product.preorder
            ? null
            : v.stock <= 0
              ? "out"
              : v.stock <= lowAt
                ? "low"
                : "in",
        });
      }
    }
    const nextCursor =
      rows.length > lim
        ? encodeCursor([
            String(
              sortRaw === "name"
                ? page[page.length - 1].name
                : sortRaw === "stock"
                  ? page[page.length - 1].stock
                  : sortRaw === "sold"
                    ? page[page.length - 1].sold
                    : page[page.length - 1].id,
            ),
            page[page.length - 1].id,
          ])
        : null;
    return { products: page, nextCursor };
  }

  return {
    adminOrders,
    adminOrderDetail,
    adminRevealOrderCredentials,
    adminCustomers,
    adminProducts,
  };
}
