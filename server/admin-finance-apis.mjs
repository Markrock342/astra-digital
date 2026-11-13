/** Admin FR Work 3 — transactions list/summary/CSV/detail (FR-F2–F5, F9). ADMIN only. */
import { csvLine, maskRef } from "./money.mjs";

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
export const CSV_MAX_ROWS = 10000;
/**
 * Shop view of a row for the in/out totals: payments and top-ups are money in; refunds
 * (to credit or outside), fees and withdrawals are money out. Wallet-only moves
 * (PURCHASE, ADJUSTMENT, DEMO_CREDIT) are not shop cash, so they count only when the
 * admin filters on that kind.
 */
const flowSql = (kindFiltered) =>
  `CASE WHEN l.kind IN ('PAYMENT_IN','TOPUP') THEN 'in' WHEN l.kind IN ('REFUND','FEE','WITHDRAWAL') THEN 'out' ${
    kindFiltered ? "ELSE l.direction" : "ELSE 'credit'"
  } END`;

export function createAdminFinanceApis({
  requireAdmin,
  one,
  all,
  fail,
  clean,
  bangkokDayRange,
  moneyScope,
  outstandingCredit,
  depositsHeld = null,
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
    // S2: live mode leaves test money (sandbox payments, DEMO_CREDIT) out of every number and CSV.
    if (moneyScope) where.push(moneyScope.ledger("l."));
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
         COALESCE(SUM(CASE WHEN ${flowSql(!!kind)}='in' AND l.status='SUCCEEDED' THEN ABS(l.net) ELSE 0 END),0) AS inflow,
         COALESCE(SUM(CASE WHEN ${flowSql(!!kind)}='out' AND l.status='SUCCEEDED' THEN ABS(l.net) ELSE 0 END),0) AS outflow,
         COALESCE(SUM(CASE WHEN l.kind='REFUND' AND l.status='SUCCEEDED' THEN l.amount ELSE 0 END),0) AS refunds,
         COALESCE(SUM(CASE WHEN l.status='PENDING' THEN 1 ELSE 0 END),0) AS pending,
         COUNT(*) AS count
       FROM ledger l
       JOIN users u ON u.id = l.user_id
       ${sumSql}`,
      ...sumParams,
    );
    const daily = all(
      `SELECT ${BANGKOK_DAY_SQL} AS day,
              COALESCE(SUM(CASE WHEN ${flowSql(!!kind)}='in' AND l.status='SUCCEEDED' THEN ABS(l.net) ELSE 0 END),0) AS inflow,
              COALESCE(SUM(CASE WHEN ${flowSql(!!kind)}='out' AND l.status='SUCCEEDED' THEN ABS(l.net) ELSE 0 END),0) AS outflow,
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
      flow: row.kind === "REFUND" ? "out" : row.direction,
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
      refunds: agg.refunds,
      pending: agg.pending,
      count: agg.count,
      csvMaxRows: CSV_MAX_ROWS,
      // Customer credit still owed (liability): all time, never mixed into revenue.
      customerCredit: outstandingCredit ? outstandingCredit() : null,
      // มัดจำค้าง: preorder deposits paid for reservations not delivered yet (liability).
      depositsHeld: depositsHeld ? depositsHeld().amount : null,
      depositsHeldCount: depositsHeld ? depositsHeld().reservations : null,
      mode: moneyScope?.mode ?? "sandbox",
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
      // S5: server-side escaping, same rule as downloadCsv in the admin UI.
      const lines = [csvLine(header)];
      for (const row of page) {
        lines.push(
          csvLine([
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
          ]),
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

  /** FR-F5: one ledger row with its event timeline, order, customer and actor. */
  function adminTransactionDetail(user, id) {
    requireAdmin(user);
    const txnId = clean(id, 1, 80, "รายการ");
    const row = one(
      `SELECT l.*, u.name AS customer_name, u.email AS customer_email, a.name AS actor_name
       FROM ledger l JOIN users u ON u.id=l.user_id LEFT JOIN users a ON a.id=l.actor_id
       WHERE l.id=?${moneyScope ? " AND " + moneyScope.ledger("l.") : ""}`,
      txnId,
    );
    if (!row) fail(404, "ไม่พบรายการ");
    const payment = row.payment_id
      ? one(
          "SELECT id,amount,currency,status,provider,provider_ref,idempotency_key,created_at,finalized_at FROM payments WHERE id=?",
          row.payment_id,
        )
      : null;
    const order = row.order_id
      ? (one(
          "SELECT id,status,total,quantity,created_at,0 AS preorder FROM orders WHERE id=?",
          row.order_id,
        ) ??
        one(
          "SELECT id,status,total,quantity,created_at,1 AS preorder FROM reservations WHERE id=?",
          row.order_id,
        ))
      : null;
    // Every money row for the same order (or this row alone), oldest first.
    const related = row.order_id
      ? all(
          `SELECT l.id,l.kind,l.direction,l.amount,l.net,l.status,l.label,l.created_at,a.name AS actor
           FROM ledger l LEFT JOIN users a ON a.id=l.actor_id
           WHERE l.order_id=?${moneyScope ? " AND " + moneyScope.ledger("l.") : ""}
           ORDER BY l.created_at ASC, l.rowid ASC`,
          row.order_id,
        )
      : [];
    const audits = all(
      `SELECT au.action,au.created_at,au.detail,us.name AS actor FROM audit au LEFT JOIN users us ON us.id=au.user_id
       WHERE au.entity_id=? AND au.action IN
         ('PAYMENT_AND_DELIVERY','PREORDER_PAID','DELIVER_RESERVATION','ORDER_REFUND','CANCEL_ORDER','REPLACE_ORDER_CREDENTIAL')
       ORDER BY au.id ASC`,
      row.order_id ?? "",
    );
    const events = [{ at: row.created_at, event: "created", text: row.label }];
    if (payment) {
      events.push({ at: payment.created_at, event: "payment_created", text: payment.provider });
      if (payment.finalized_at)
        events.push({ at: payment.finalized_at, event: "payment_" + payment.status.toLowerCase(), text: payment.provider });
    }
    if (row.finalized_at && row.finalized_at !== row.created_at)
      events.push({ at: row.finalized_at, event: "finalized", text: "" });
    for (const a of audits) {
      let detail = null;
      try {
        detail = a.detail ? JSON.parse(a.detail) : null;
      } catch {
        detail = null;
      }
      events.push({
        at: a.created_at,
        event: "audit",
        action: a.action,
        actor: a.actor ?? null,
        text: detail?.reason ?? "",
      });
    }
    events.sort((x, y) => String(x.at).localeCompare(String(y.at)));
    return {
      transaction: {
        id: row.id,
        kind: row.kind,
        direction: row.direction,
        flow: row.kind === "REFUND" ? "out" : row.direction,
        amount: row.amount,
        fee: row.fee,
        net: row.net,
        status: row.status,
        label: row.label,
        reason: row.reason,
        reference: maskRef(row.reference),
        provider_ref: maskRef(row.provider_ref),
        created_at: row.created_at,
        finalized_at: row.finalized_at,
        test:
          row.kind === "DEMO_CREDIT" ||
          String(row.provider_ref ?? "").startsWith("sandbox:") ||
          payment?.provider === "sandbox",
      },
      customer: { id: row.user_id, name: row.customer_name, email: row.customer_email },
      actor: row.actor_id ? { id: row.actor_id, name: row.actor_name } : null,
      order: order ? { ...order, preorder: !!order.preorder } : null,
      payment: payment
        ? {
            id: payment.id,
            amount: payment.amount,
            currency: payment.currency,
            status: payment.status,
            provider: payment.provider,
            provider_ref: maskRef(payment.provider_ref),
            idempotency_key: maskRef(payment.idempotency_key),
            created_at: payment.created_at,
            finalized_at: payment.finalized_at,
          }
        : null,
      related: related.map((r) => ({
        ...r,
        flow: r.kind === "REFUND" ? "out" : r.direction,
        current: r.id === row.id,
      })),
      events,
    };
  }

  return { adminTransactions, adminTransactionDetail };
}
