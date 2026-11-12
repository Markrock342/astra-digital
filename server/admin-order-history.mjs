/**
 * Order history for the back office: account replacement history (B2), the
 * activity timeline (system events + audit + notes, like Medusa's order
 * Activity) and append-only internal notes. Tables come from
 * ensureOrderHistory in ensure-admin-fr.mjs.
 *
 * Everything here is internal. Customer payloads (orderDetail, orders) never
 * read these tables.
 */

const NOTE_MAX = 1000;

function maskLogin(value) {
  const s = String(value ?? "");
  if (!s) return "–";
  if (s.length <= 2) return "*".repeat(s.length);
  return s.slice(0, 2) + "***";
}

// Audit actions that belong on an order's timeline. Anything else (refunds,
// fees, rate-limit alerts, notes, which come from order_notes) stays off it.
const AUDIT_EVENTS = {
  DELIVER_RESERVATION: "delivered",
  CANCEL_ORDER: "cancelled",
  REVEAL_ORDER_CREDENTIALS: "revealed",
  REPLACE_ORDER_CREDENTIAL: "replaced",
  RESEND_CREDENTIALS: "resent",
  ADD_REVIEW: "reviewed",
};
// Same-second events keep their natural order.
const EVENT_RANK = { created: 0, paid: 1, payment_failed: 1, delivered: 2 };

export function createOrderHistoryApis({ requireStaff, one, all, run, tx, fail, clean, decrypt, randomUUID }) {
  const orderTable = (orderId) =>
    one("SELECT id FROM orders WHERE id=?", orderId)
      ? "orders"
      : one("SELECT id FROM reservations WHERE id=?", orderId)
        ? "reservations"
        : null;

  const loginOf = (inventoryId) => {
    const unit = one("SELECT login_id_enc FROM inventory WHERE id=?", inventoryId);
    if (!unit) return "–";
    try {
      return maskLogin(decrypt(unit.login_id_enc));
    } catch {
      return "–";
    }
  };

  /** Called inside the replace transaction, so the row and the swap commit together. */
  function recordReplacement({ orderId, oldInventoryId, newInventoryId, reason, actorId, at }) {
    const id = randomUUID();
    run(
      `INSERT INTO order_replacements(id,order_id,old_inventory_id,new_inventory_id,reason,actor_id,created_at)
       VALUES(?,?,?,?,?,?,?)`,
      id,
      orderId,
      oldInventoryId,
      newInventoryId,
      reason,
      actorId ?? null,
      at,
    );
    return id;
  }

  /** Masked old → new login per replacement, oldest first. Safe for staff. */
  function replacementsFor(orderId) {
    return all(
      `SELECT r.id,r.old_inventory_id,r.new_inventory_id,r.reason,r.created_at,
              u.name AS actor,u.role AS actor_role
       FROM order_replacements r LEFT JOIN users u ON u.id=r.actor_id
       WHERE r.order_id=? ORDER BY r.created_at ASC, r.rowid ASC`,
      orderId,
    ).map((r) => ({
      id: r.id,
      at: r.created_at,
      actor: r.actor ?? null,
      actorRole: r.actor_role ?? null,
      reason: r.reason,
      oldLogin: loginOf(r.old_inventory_id),
      newLogin: loginOf(r.new_inventory_id),
    }));
  }

  function notesFor(orderId) {
    return all(
      `SELECT n.id,n.body,n.legacy,n.created_at,u.name AS author,u.role AS author_role
       FROM order_notes n LEFT JOIN users u ON u.id=n.author_id
       WHERE n.order_id=? ORDER BY n.created_at ASC, n.rowid ASC`,
      orderId,
    ).map((n) => ({
      id: n.id,
      at: n.created_at,
      author: n.author ?? null,
      authorRole: n.author_role ?? null,
      body: n.body,
      legacy: !!n.legacy,
    }));
  }

  /**
   * One timeline in time order. `system` holds events derived from the order
   * and its payments ({at, event}). Audit rows add who did it and why; a
   * reservation's DELIVER_RESERVATION fills in the actor of the "delivered"
   * system event instead of adding a second entry.
   */
  function activityFor(row, system, notes) {
    const events = system.map((e) => ({
      at: e.at,
      event: e.event,
      actor: e.event === "created" ? row.customer ?? null : null,
      actorRole: e.event === "created" ? "CUSTOMER" : null,
    }));
    const audits = all(
      `SELECT a.id,a.action,a.detail,a.created_at,u.name AS actor,u.role AS actor_role
       FROM audit a LEFT JOIN users u ON u.id=a.user_id
       WHERE a.entity_id=? AND a.action IN (${Object.keys(AUDIT_EVENTS)
         .map(() => "?")
         .join(",")})
       ORDER BY a.id ASC`,
      row.id,
      ...Object.keys(AUDIT_EVENTS),
    );
    for (const a of audits) {
      const event = AUDIT_EVENTS[a.action];
      let detail = null;
      try {
        detail = a.detail ? JSON.parse(a.detail) : null;
      } catch {
        detail = null;
      }
      const reason = typeof detail?.reason === "string" ? detail.reason : null;
      if (event === "delivered") {
        const target = events.find((e) => e.event === "delivered" && !e.actor);
        if (target) {
          target.actor = a.actor ?? null;
          target.actorRole = a.actor_role ?? null;
          continue;
        }
      }
      if (event === "cancelled") {
        // The cancel audit is the cancel event; drop the bare system one.
        const i = events.findIndex((e) => e.event === "cancelled" && !e.actor);
        if (i >= 0) events.splice(i, 1);
      }
      events.push({
        at: a.created_at,
        event,
        actor: a.actor ?? null,
        actorRole: a.actor_role ?? null,
        ...(reason ? { reason } : {}),
      });
    }
    for (const n of notes)
      events.push({
        at: n.at,
        event: "note",
        actor: n.author,
        actorRole: n.authorRole,
        body: n.body,
        ...(n.legacy ? { legacy: true } : {}),
      });
    return events
      .map((e, i) => ({ e, i }))
      .sort(
        (x, y) =>
          String(x.e.at).localeCompare(String(y.e.at)) ||
          (EVENT_RANK[x.e.event] ?? 3) - (EVENT_RANK[y.e.event] ?? 3) ||
          x.i - y.i,
      )
      .map(({ e }) => e);
  }

  /** Append-only: notes are never edited or deleted, each keeps its author and time. */
  function adminAddOrderNote(user, id, input = {}) {
    requireStaff(user);
    const orderId = clean(id, 1, 80, "คำสั่งซื้อ");
    const raw = input.body ?? input.note;
    if (typeof raw !== "string" || !raw.trim()) fail(400, "พิมพ์หมายเหตุก่อนบันทึก");
    if (raw.trim().length > NOTE_MAX) fail(400, "หมายเหตุยาวเกิน " + NOTE_MAX + " ตัวอักษร");
    const body = clean(raw, 1, NOTE_MAX, "หมายเหตุ");
    return tx(() => {
      if (!orderTable(orderId)) fail(404, "ไม่พบคำสั่งซื้อ");
      const noteId = randomUUID();
      const at = new Date().toISOString().slice(0, 19).replace("T", " ");
      run(
        "INSERT INTO order_notes(id,order_id,author_id,body,created_at) VALUES(?,?,?,?,?)",
        noteId,
        orderId,
        user.id,
        body,
        at,
      );
      run(
        "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
        user.id,
        "ORDER_NOTE",
        orderId,
        JSON.stringify({ noteId, length: body.length }),
      );
      return { id: orderId, notes: notesFor(orderId) };
    });
  }

  return { recordReplacement, replacementsFor, notesFor, activityFor, adminAddOrderNote };
}
