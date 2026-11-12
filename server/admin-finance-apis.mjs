/** Admin FR Work 3 — transactions list/summary/CSV (FR-F2–F4, F9). ADMIN only. */

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

const MONEY_KINDS = new Set([
  "PAYMENT_IN",
  "TOPUP",
  "PURCHASE",
  "REFUND",
  "ADJUSTMENT",
  "WITHDRAWAL",
  "FEE",
]);

/** created_at is stored as UTC wall-clock; +7h yields Asia/Bangkok calendar day. */
const BANGKOK_DAY_SQL = "substr(datetime(l.created_at, '+7 hours'), 1, 10)";
const CSV_MAX_ROWS = 10000;

export function createAdminFinanceApis({
  requireAdmin,
  one,
  all,
  fail,
  clean,
  bangkokDayRange,
}) {
  function adminTransactions(user, query = {}) {
    requireAdmin(user);
    const lim = parseLimit(query.limit, fail);
    const range = (() => {
      const hasFrom = query.from != null && String(query.from).trim() !== "";
      const hasTo = query.to != null && String(query.to).trim() !== "";
      if (hasFrom !== hasTo) fail(400, "ต้องส่ง from และ to คู่กัน");
      if (!hasFrom) return null;
      return bangkokDayRange(
        clean(String(query.from).trim(), 10, 10, "วันเริ่ม"),
        clean(String(query.to).trim(), 10, 10, "วันสิ้นสุด"),
      );
    })();

    const kind =
      query.kind != null && String(query.kind).trim() !== ""
        ? clean(query.kind, 1, 40, "ประเภท")
        : null;
    if (kind && kind !== "DEMO_CREDIT" && !MONEY_KINDS.has(kind))
      fail(400, "ประเภทไม่ถูกต้อง");

    const direction =
      query.direction != null && String(query.direction).trim() !== ""
        ? clean(query.direction, 1, 10, "ทิศทาง")
        : null;
    if (direction && !["in", "out"].includes(direction))
      fail(400, "ทิศทางไม่ถูกต้อง");

    const status =
      query.status != null && String(query.status).trim() !== ""
        ? clean(query.status, 1, 20, "สถานะ")
        : null;
    if (
      status &&
      !["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"].includes(status)
    )
      fail(400, "สถานะไม่ถูกต้อง");

    const customer =
      query.customer != null && String(query.customer).trim() !== ""
        ? clean(query.customer, 1, 120, "ลูกค้า")
        : null;
    const min =
      query.min != null && String(query.min).trim() !== ""
        ? Number(query.min)
        : null;
    const max =
      query.max != null && String(query.max).trim() !== ""
        ? Number(query.max)
        : null;
    if (min != null && !Number.isInteger(min)) fail(400, "ยอดขั้นต่ำไม่ถูกต้อง");
    if (max != null && !Number.isInteger(max)) fail(400, "ยอดสูงสุดไม่ถูกต้อง");
    const q =
      query.q != null && String(query.q).trim() !== ""
        ? clean(query.q, 1, 120, "คำค้น")
        : null;
    const cursorParts = decodeCursor(query.cursor, fail);
    const includeDemo = kind === "DEMO_CREDIT";

    const where = [];
    const params = [];
    if (includeDemo) {
      where.push("l.kind = 'DEMO_CREDIT'");
    } else if (kind) {
      where.push("l.kind = ?");
      params.push(kind);
    } else {
      where.push("l.kind != 'DEMO_CREDIT'");
    }
    if (range) {
      where.push("l.created_at >= ?");
      params.push(range.fromUtc);
      where.push("l.created_at <= ?");
      params.push(range.toUtc);
    }
    if (direction) {
      where.push("l.direction = ?");
      params.push(direction);
    }
    if (status) {
      where.push("l.status = ?");
      params.push(status);
    }
    if (customer) {
      where.push(
        "(l.user_id = ? OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')",
      );
      params.push(customer, likeContains(customer), likeContains(customer));
    }
    if (min != null) {
      where.push("ABS(l.amount) >= ?");
      params.push(min);
    }
    if (max != null) {
      where.push("ABS(l.amount) <= ?");
      params.push(max);
    }
    if (q) {
      where.push(
        "(l.id LIKE ? ESCAPE '\\' OR IFNULL(l.order_id,'') LIKE ? ESCAPE '\\' OR IFNULL(l.provider_ref,'') LIKE ? ESCAPE '\\' OR l.reference LIKE ? ESCAPE '\\')",
      );
      const like = likeContains(q);
      params.push(like, like, like, like);
    }
    // Summary covers the whole filtered range, so build it before the cursor clause.
    const sumSql = where.length ? " WHERE " + where.join(" AND ") : "";
    const sumParams = [...params];
    if (cursorParts) {
      const [created, id] = cursorParts;
      where.push("(l.created_at < ? OR (l.created_at = ? AND l.id < ?))");
      params.push(created, created, id);
    }

    const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
    const rows = all(
      `SELECT l.*, u.name AS customer_name, u.email AS customer_email
       FROM ledger l
       JOIN users u ON u.id = l.user_id
       ${whereSql}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ?`,
      ...params,
      lim + 1,
    );


    const agg = one(
      `SELECT
         COALESCE(SUM(CASE WHEN l.direction='in' AND l.status='SUCCEEDED' THEN l.net ELSE 0 END),0) AS inflow,
         COALESCE(SUM(CASE WHEN l.direction='out' AND l.status='SUCCEEDED' THEN ABS(l.net) ELSE 0 END),0) AS outflow,
         COALESCE(SUM(CASE WHEN l.status='PENDING' THEN 1 ELSE 0 END),0) AS pending,
         COUNT(*) AS count
       FROM ledger l
       JOIN users u ON u.id = l.user_id
       ${sumSql}`,
      ...sumParams,
    );
    const daily = all(
      `SELECT ${BANGKOK_DAY_SQL} AS day,
              COALESCE(SUM(CASE WHEN l.direction='in' AND l.status='SUCCEEDED' THEN l.net ELSE 0 END),0) AS inflow,
              COALESCE(SUM(CASE WHEN l.direction='out' AND l.status='SUCCEEDED' THEN ABS(l.net) ELSE 0 END),0) AS outflow,
              COUNT(*) AS count
       FROM ledger l
       JOIN users u ON u.id = l.user_id
       ${sumSql}
       GROUP BY ${BANGKOK_DAY_SQL}
       ORDER BY day ASC`,
      ...sumParams,
    );

    const mapRow = (row) => ({
      id: row.id,
      user_id: row.user_id,
      customer: row.customer_name,
      customer_email: row.customer_email,
      amount: row.amount,
      label: row.label,
      kind: row.kind,
      direction: row.direction,
      fee: row.fee,
      net: row.net,
      status: row.status,
      order_id: row.order_id,
      payment_id: row.payment_id,
      provider_ref: row.provider_ref,
      actor_id: row.actor_id,
      reason: row.reason,
      reference: row.reference,
      created_at: row.created_at,
      finalized_at: row.finalized_at,
    });

    const summary = {
      in: agg.inflow,
      out: agg.outflow,
      net: agg.inflow - agg.outflow,
      pending: agg.pending,
      count: agg.count,
      daily: daily.map((d) => ({
        day: d.day,
        in: d.inflow,
        out: d.outflow,
        net: d.inflow - d.outflow,
        count: d.count,
      })),
    };

    if (String(query.format || "").toLowerCase() === "csv") {
      const csvRows = all(
        `SELECT l.*, u.name AS customer_name, u.email AS customer_email
         FROM ledger l
         JOIN users u ON u.id = l.user_id
         ${sumSql}
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT ?`,
        ...sumParams,
        CSV_MAX_ROWS + 1,
      );
      if (csvRows.length > CSV_MAX_ROWS)
        fail(
          400,
          "รายการเกิน " + CSV_MAX_ROWS + " แถว กรุณาแคบตัวกรองก่อนดาวน์โหลด",
        );
      const page = csvRows.map(mapRow);
      const header = [
        "id",
        "kind",
        "direction",
        "status",
        "amount",
        "fee",
        "net",
        "customer",
        "customer_email",
        "order_id",
        "payment_id",
        "provider_ref",
        "reference",
        "created_at",
        "finalized_at",
        "label",
      ];
      const escape = (v) => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [header.join(",")];
      for (const row of page) {
        lines.push(
          [
            row.id,
            row.kind,
            row.direction,
            row.status,
            row.amount,
            row.fee,
            row.net,
            row.customer,
            row.customer_email,
            row.order_id,
            row.payment_id,
            row.provider_ref,
            row.reference,
            row.created_at,
            row.finalized_at,
            row.label,
          ]
            .map(escape)
            .join(","),
        );
      }
      return { csv: lines.join("\n") + "\n", summary, nextCursor: null };
    }

    const page = rows.slice(0, lim).map(mapRow);
    const nextCursor =
      rows.length > lim
        ? encodeCursor([
            page[page.length - 1].created_at,
            page[page.length - 1].id,
          ])
        : null;

    return { transactions: page, summary, nextCursor };
  }

  return { adminTransactions };
}
