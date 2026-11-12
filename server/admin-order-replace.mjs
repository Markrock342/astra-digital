/** Admin FR Work 5 — FR-O5 replace delivered credential with a fresh stock unit. */

export function createAdminOrderReplaceApis({
  requireAdmin,
  one,
  all,
  run,
  tx,
  fail,
  clean,
  audit,
  inventoryAvailableSql,
  notify,
  maybeNotifyStockLow,
}) {
  function loadOrderOrReservation(orderId) {
    return (
      one(
        `SELECT o.id,o.user_id,o.variant_id,o.status,o.quantity,
                0 AS preorder, CAST(NULL AS INTEGER) AS queue_number
         FROM orders o WHERE o.id=?`,
        orderId,
      ) ??
      one(
        `SELECT o.id,o.user_id,o.variant_id,o.status,o.quantity,
                1 AS preorder, o.queue_number
         FROM reservations o WHERE o.id=?`,
        orderId,
      )
    );
  }

  function replaceOrderCredential(user, orderIdRaw, input = {}) {
    requireAdmin(user);
    const orderId = clean(orderIdRaw, 1, 80, "คำสั่งซื้อ");
    const inventoryId = clean(input.inventoryId, 1, 80, "รายการสต็อก");
    const reason = clean(input.reason, 2, 500, "เหตุผล");
    return tx(() => {
      const row = loadOrderOrReservation(orderId);
      if (!row) fail(404, "ไม่พบคำสั่งซื้อ");
      if (row.status !== "DELIVERED")
        fail(409, "เปลี่ยนบัญชีได้เฉพาะออเดอร์ที่ส่งของแล้ว");

      const bindCol = row.preorder ? "reservation_id" : "order_id";
      const oldUnit = one("SELECT * FROM inventory WHERE id=?", inventoryId);
      if (!oldUnit) fail(404, "ไม่พบรายการสต็อก");
      if (oldUnit[bindCol] !== orderId)
        fail(409, "รายการสต็อกนี้ไม่ได้ผูกกับคำสั่งซื้อนี้");
      if (oldUnit.variant_id !== row.variant_id)
        fail(409, "ตัวเลือกสินค้าไม่ตรงกับคำสั่งซื้อ");
      if (oldUnit.defective)
        fail(409, "รายการนี้ถูกทำเครื่องหมายเสียแล้ว");

      const replacement = one(
        `SELECT id FROM inventory WHERE variant_id=? AND ${inventoryAvailableSql} ORDER BY rowid LIMIT 1`,
        row.variant_id,
      );
      if (!replacement) fail(409, "สต็อกไม่พอสำหรับเปลี่ยนบัญชี");

      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const cleared = run(
        `UPDATE inventory SET
           defective=1, defective_at=?, defective_by=?, defective_reason=?,
           order_id=NULL, reservation_id=NULL, sold_at=NULL
         WHERE id=? AND ${bindCol}=? AND COALESCE(defective,0)=0`,
        now,
        user.id,
        reason,
        inventoryId,
        orderId,
      );
      if (!cleared.changes) fail(409, "ทำเครื่องหมายบัญชีเก่าไม่สำเร็จ");

      const bound = run(
        `UPDATE inventory SET ${bindCol}=?, sold_at=? WHERE id=? AND ${inventoryAvailableSql}`,
        orderId,
        now,
        replacement.id,
      );
      if (!bound.changes) fail(409, "ผูกบัญชีใหม่ไม่สำเร็จ");

      notify(
        row.user_id,
        "order",
        "บัญชีถูกเปลี่ยนแล้ว",
        "ร้านส่งบัญชีใหม่แทนบัญชีที่มีปัญหา กดดูคำสั่งซื้อเพื่อรับบัญชีใหม่",
      );
      maybeNotifyStockLow(row.variant_id);
      audit(user, "REPLACE_ORDER_CREDENTIAL", orderId);
      return {
        id: orderId,
        replacedInventoryId: inventoryId,
        newInventoryId: replacement.id,
        status: "DELIVERED",
        replaced_at: now,
      };
    });
  }

  return { replaceOrderCredential };
}
