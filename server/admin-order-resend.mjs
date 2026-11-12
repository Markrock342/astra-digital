/**
 * "ส่งรหัสให้ลูกค้าอีกครั้ง" from the admin order detail.
 *
 * Tells the customer where their account details are: an in-app notification
 * and a chat message from the shop, both pointing at the order page. Neither
 * ever carries the ID or the password; the customer opens them on their own
 * order page, behind their login.
 *
 * ADMIN and STAFF may resend. Every resend writes a RESEND_CREDENTIALS audit row
 * (it also shows on the order's activity timeline), and each order allows at
 * most RESEND_LIMIT resends per hour so a customer is never spammed.
 */
export const RESEND_LIMIT = 3;

export function createAdminOrderResendApis({ requireStaff, one, run, tx, fail, clean, notify, randomUUID }) {
  function resendOrderCredentials(user, id) {
    requireStaff(user);
    const orderId = clean(id, 1, 80, "คำสั่งซื้อ");
    return tx(() => {
      const order =
        one("SELECT id,user_id,status FROM orders WHERE id=?", orderId) ??
        one("SELECT id,user_id,status FROM reservations WHERE id=?", orderId);
      if (!order) fail(404, "ไม่พบคำสั่งซื้อ");
      if (order.status !== "DELIVERED") fail(409, "ออเดอร์นี้ยังไม่ได้ส่งของ จึงยังไม่มีรหัสให้ส่งซ้ำ");
      const recent = one(
        "SELECT COUNT(*) AS n FROM audit WHERE action='RESEND_CREDENTIALS' AND entity_id=? AND created_at >= datetime('now','-1 hour')",
        orderId,
      ).n;
      if (recent >= RESEND_LIMIT)
        fail(429, "ส่งรหัสซ้ำครบ " + RESEND_LIMIT + " ครั้งในชั่วโมงนี้แล้ว ลองใหม่ภายหลัง");

      const link = "/orders/" + orderId;
      const shortId = orderId.slice(0, 8).toUpperCase();
      // Post into the customer's open chat (or start one) so they can reply.
      let thread = one(
        "SELECT id FROM chat_threads WHERE user_id=? AND status='OPEN' ORDER BY created_at DESC LIMIT 1",
        order.user_id,
      );
      if (!thread) {
        thread = { id: randomUUID() };
        run("INSERT INTO chat_threads(id,user_id,status) VALUES(?,?,'OPEN')", thread.id, order.user_id);
      }
      run(
        "INSERT INTO chat_messages(id,thread_id,sender_type,body) VALUES(?,?,?,?)",
        randomUUID(),
        thread.id,
        user.role === "ADMIN" ? "ADMIN" : "STAFF",
        "ร้านส่งข้อมูลบัญชีของคำสั่งซื้อ " +
          shortId +
          " ให้อีกครั้ง ID และรหัสผ่านอยู่ในหน้าคำสั่งซื้อของคุณ เปิดดูได้ที่ " +
          link,
      );
      notify(
        order.user_id,
        "order",
        "ร้านส่งข้อมูลบัญชีให้อีกครั้ง",
        "ข้อมูลบัญชีอยู่ในหน้าคำสั่งซื้อ กดเพื่อเปิดดู",
        link,
      );
      run(
        "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
        user.id,
        "RESEND_CREDENTIALS",
        orderId,
        JSON.stringify({ threadId: thread.id }),
      );
      return {
        id: orderId,
        threadId: thread.id,
        link,
        remaining: RESEND_LIMIT - recent - 1,
      };
    });
  }
  return { resendOrderCredentials };
}
