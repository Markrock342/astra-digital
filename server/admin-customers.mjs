/** FR-C3 detail, FR-C4 edit, FR-C5 suspend/ban, FR-C6 force sign-out. */

const STATUSES = ["ACTIVE", "SUSPENDED", "BANNED"];

import { randomBytes } from "node:crypto";
// Customer credit uses the same formula as the customer's own wallet (S4).
import { walletBalanceSql, walletHistory } from "./money.mjs";

export function createAdminCustomerApis({
  passwordHash,
  requireStaff,
  requireAdmin,
  one,
  all,
  run,
  tx,
  fail,
  clean,
  moneyScope,
  releaseCouponForOrder = () => ({ released: false }),
}) {
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );
  const optional = (value, max, label) => {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (text.length > max) fail(400, label + "ยาวเกินไป");
    return text;
  };
  const loadCustomer = (id) => {
    const row = one("SELECT * FROM users WHERE id=?", clean(id, 1, 80, "ลูกค้า"));
    if (!row || row.role !== "CUSTOMER") fail(404, "ไม่พบลูกค้า");
    return row;
  };
  const splitName = (row) => {
    if (row.first_name || row.last_name)
      return { firstName: row.first_name ?? "", lastName: row.last_name ?? "" };
    const [first, ...rest] = String(row.name ?? "").split(/\s+/);
    return { firstName: first ?? "", lastName: rest.join(" ") };
  };
  const publicCustomer = (row) => ({
    id: row.id,
    name: row.name,
    ...splitName(row),
    email: row.email,
    username: row.username ?? null,
    phone: row.phone ?? null,
    note: row.note ?? null,
    status: row.status ?? "ACTIVE",
    statusReason: row.status_reason ?? null,
    statusChangedAt: row.status_changed_at ?? null,
    created_at: row.created_at,
  });

  function adminCustomerDetail(user, id) {
    requireStaff(user);
    const row = loadCustomer(id);
    const seesMoney = user.role === "ADMIN";
    const orders = all(
      `SELECT id,status,total,quantity,created_at,product,preorder,queue_number FROM (
         SELECT o.id,o.status,o.total,o.quantity,o.created_at,p.name AS product,0 AS preorder,NULL AS queue_number
         FROM orders o JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id WHERE o.user_id=?
         UNION ALL
         SELECT r.id,r.status,r.total,r.quantity,r.created_at,p.name,1,r.queue_number
         FROM reservations r JOIN variants v ON v.id=r.variant_id JOIN products p ON p.id=v.product_id WHERE r.user_id=?
       ) ORDER BY created_at DESC, id DESC LIMIT 50`,
      row.id,
      row.id,
    ).map((o) => ({ ...o, preorder: !!o.preorder }));
    const orderCount =
      one("SELECT COUNT(*) AS n FROM orders WHERE user_id=?", row.id).n +
      one("SELECT COUNT(*) AS n FROM reservations WHERE user_id=?", row.id).n;
    const sessions = one(
      "SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND expires_at>?",
      row.id,
      Date.now(),
    ).n;
    const history = all(
      `SELECT a.id,a.action,a.detail,a.created_at,u.name AS actor
       FROM audit a LEFT JOIN users u ON u.id=a.user_id
       WHERE a.entity_id=? AND (a.action LIKE 'CUSTOMER_%' OR (? AND a.action='CREDIT_ADJUST'))
       ORDER BY a.id DESC LIMIT 50`,
      row.id,
      seesMoney ? 1 : 0,
    ).map((a) => ({ ...a, detail: a.detail ? JSON.parse(a.detail) : null }));
    const money = seesMoney
      ? {
          spentSatang: one(
            `SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE user_id=? AND status='SUCCEEDED' AND ${moneyScope ? moneyScope.payment() : "1=1"}`,
            row.id,
          ).n,
          creditSatang: one(walletBalanceSql, row.id).value,
          ledger: walletHistory(all, row.id, 50),
        }
      : {};
    return {
      customer: publicCustomer(row),
      orderCount,
      activeSessions: sessions,
      orders,
      history,
      ...money,
    };
  }

  function adminUpdateCustomer(user, id, input = {}) {
    requireAdmin(user);
    return tx(() => {
      const row = loadCustomer(id);
      const firstName = clean(input.firstName, 1, 40, "ชื่อ");
      const lastName = optional(input.lastName, 40, "นามสกุล") ?? "";
      const email = clean(input.email, 5, 160, "อีเมล").toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "อีเมลไม่ถูกต้อง");
      if (one("SELECT id FROM users WHERE email=? AND id<>?", email, row.id))
        fail(409, "อีเมลนี้มีบัญชีอื่นใช้แล้ว");
      const phone = optional(input.phone, 20, "เบอร์โทร");
      if (phone && !/^[0-9+\-\s]{6,20}$/.test(phone)) fail(400, "เบอร์โทรไม่ถูกต้อง");
      const note = optional(input.note, 1000, "หมายเหตุ");
      const name = (firstName + " " + lastName).trim();
      if (name.length < 2) fail(400, "ชื่อไม่ถูกต้อง");
      const before = publicCustomer(row);
      run(
        "UPDATE users SET name=?,first_name=?,last_name=?,email=?,phone=?,note=? WHERE id=?",
        name,
        firstName,
        lastName,
        email,
        phone,
        note,
        row.id,
      );
      const after = publicCustomer(one("SELECT * FROM users WHERE id=?", row.id));
      const changed = {};
      for (const key of ["firstName", "lastName", "email", "phone", "note"])
        if (before[key] !== after[key]) changed[key] = { from: before[key], to: after[key] };
      if (Object.keys(changed).length)
        auditDetail(user, "CUSTOMER_UPDATE", row.id, changed);
      return { customer: after };
    });
  }

  function adminSetCustomerStatus(user, id, input = {}) {
    requireAdmin(user);
    const status = String(input.status ?? "").toUpperCase();
    if (!STATUSES.includes(status)) fail(400, "สถานะไม่ถูกต้อง");
    const reason =
      status === "ACTIVE"
        ? optional(input.reason, 300, "เหตุผล")
        : clean(input.reason, 3, 300, "เหตุผล");
    return tx(() => {
      const row = loadCustomer(id);
      const from = row.status ?? "ACTIVE";
      if (from === status) fail(409, "บัญชีอยู่ในสถานะนี้แล้ว");
      run(
        "UPDATE users SET status=?,status_reason=?,status_changed_at=CURRENT_TIMESTAMP,status_changed_by=? WHERE id=?",
        status,
        status === "ACTIVE" ? null : reason,
        user.id,
        row.id,
      );
      // Suspended or banned accounts lose every session at once.
      if (status !== "ACTIVE") run("DELETE FROM sessions WHERE user_id=?", row.id);
      auditDetail(user, "CUSTOMER_STATUS", row.id, { from, to: status, reason });
      return { customer: publicCustomer(one("SELECT * FROM users WHERE id=?", row.id)) };
    });
  }

  function adminSignOutCustomer(user, id) {
    requireAdmin(user);
    return tx(() => {
      const row = loadCustomer(id);
      const removed = one("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", row.id).n;
      run("DELETE FROM sessions WHERE user_id=?", row.id);
      auditDetail(user, "CUSTOMER_SIGN_OUT", row.id, { sessions: removed });
      return { removed };
    });
  }

  /** FR-C6: no email reset yet, so the admin issues a one-time temporary password. */
  function adminResetCustomerPassword(user, id) {
    requireAdmin(user);
    return tx(() => {
      const row = loadCustomer(id);
      const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      const bytes = randomBytes(12);
      const temporary = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
      run("UPDATE users SET password_hash=? WHERE id=?", passwordHash(temporary), row.id);
      run("DELETE FROM sessions WHERE user_id=?", row.id);
      auditDetail(user, "CUSTOMER_PASSWORD_RESET", row.id, null);
      return { temporaryPassword: temporary };
    });
  }

  /** FR-S5: who did what, newest first. Cursor = audit id. */
  function adminAuditLog(user, query = {}) {
    requireAdmin(user);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const where = ["a.action <> 'LOGIN'"];
    const params = [];
    const action = optional(query.action, 60, "การกระทำ");
    if (action) {
      if (!/^[A-Z_]+$/.test(action)) fail(400, "การกระทำไม่ถูกต้อง");
      where.push("a.action LIKE ?");
      params.push(action + "%");
    }
    if (query.scope === "staff") where.push("u.role IN ('ADMIN','STAFF')");
    const actor = optional(query.actor, 80, "ผู้ทำ");
    if (actor) {
      where.push("a.user_id = ?");
      params.push(actor);
    }
    const entity = optional(query.entity, 80, "รายการ");
    if (entity) {
      where.push("a.entity_id = ?");
      params.push(entity);
    }
    if (query.cursor) {
      const before = Number(query.cursor);
      if (!Number.isInteger(before)) fail(400, "cursor ไม่ถูกต้อง");
      where.push("a.id < ?");
      params.push(before);
    }
    const rows = all(
      `SELECT a.id,a.action,a.entity_id,a.detail,a.created_at,a.user_id,u.name AS actor,u.role AS actor_role
       FROM audit a LEFT JOIN users u ON u.id=a.user_id
       WHERE ${where.join(" AND ")}
       ORDER BY a.id DESC LIMIT ?`,
      ...params,
      limit + 1,
    );
    const page = rows.slice(0, limit).map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
    return { entries: page, nextCursor: rows.length > limit ? String(page[page.length - 1].id) : null };
  }

  /** FR-O6 (unpaid only): paid orders need a refund flow, which is not built yet. */
  function adminCancelOrder(user, id, input = {}) {
    requireAdmin(user);
    const orderId = clean(id, 1, 80, "คำสั่งซื้อ");
    const reason = clean(input.reason, 3, 300, "เหตุผล");
    return tx(() => {
      const table = one("SELECT id FROM orders WHERE id=?", orderId)
        ? "orders"
        : one("SELECT id FROM reservations WHERE id=?", orderId)
          ? "reservations"
          : null;
      if (!table) fail(404, "ไม่พบคำสั่งซื้อ");
      const row = one(`SELECT status FROM ${table} WHERE id=?`, orderId);
      if (row.status !== "PENDING_PAYMENT")
        fail(409, "ยกเลิกได้เฉพาะออเดอร์ที่ยังไม่ชำระ ออเดอร์ที่ชำระแล้วต้องใช้การคืนเงิน");
      run(`UPDATE ${table} SET status='CANCELLED' WHERE id=? AND status='PENDING_PAYMENT'`, orderId);
      // An unpaid order gives its coupon use back (same transaction as the cancel).
      const coupon = releaseCouponForOrder(orderId, "CANCELLED");
      auditDetail(user, "CANCEL_ORDER", orderId, coupon.released ? { reason, couponReleased: coupon.code } : { reason });
      return { id: orderId, status: "CANCELLED" };
    });
  }

  // Internal order notes moved to admin-order-history.mjs (append-only order_notes).

  return {
    adminCancelOrder,
    adminAuditLog,
    adminResetCustomerPassword,
    adminCustomerDetail,
    adminUpdateCustomer,
    adminSetCustomerStatus,
    adminSignOutCustomer,
  };
}
