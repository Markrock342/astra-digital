/** PDPA FR-C9: customer export / delete request + admin anonymize (keep orders/ledger). */

export function ensurePrivacyRequests(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS privacy_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('DELETE')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    resolved_by TEXT
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS privacy_requests_user_status ON privacy_requests (user_id, status, created_at)",
  );
}

export function createPrivacyApis({
  requireUser,
  requireAdmin,
  one,
  all,
  run,
  tx,
  fail,
  clean,
  audit,
  randomUUID,
  passwordHash,
  deleteFile,
  /** Clears the customer's chat image links; returns the file keys to delete. */
  eraseChatImages,
  confirmPassword,
}) {
  function exportMyData(user) {
    requireUser(user);
    if (user.role !== "CUSTOMER") fail(403, "ใช้ได้เฉพาะบัญชีลูกค้า");
    const profile = one(
      `SELECT id, email, name, username, first_name, last_name, phone, role, status, created_at, avatar_key
       FROM users WHERE id=?`,
      user.id,
    );
    if (!profile) fail(404, "ไม่พบผู้ใช้");
    // Re-read status from DB — session object may be stale after PDPA approve.
    if ((profile.status ?? "ACTIVE") !== "ACTIVE")
      fail(403, "บัญชีนี้ถูกปิดการใช้งาน");
    const orders = all(
      `SELECT id, status, total, quantity, variant_id, created_at, warranty_until
       FROM orders WHERE user_id=? ORDER BY created_at DESC`,
      user.id,
    );
    const reservations = all(
      `SELECT id, status, total, quantity, variant_id, created_at, warranty_until, delivered_at
       FROM reservations WHERE user_id=? ORDER BY created_at DESC`,
      user.id,
    );
    const payments = all(
      `SELECT id, amount, status, provider, created_at, finalized_at, order_id, reservation_id
       FROM payments WHERE user_id=? ORDER BY created_at DESC`,
      user.id,
    );
    const ledger = all(
      `SELECT id, kind, direction, amount, net, label, reference, created_at, order_id
       FROM ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 5000`,
      user.id,
    );
    const reviews = all(
      `SELECT id, order_id, rating, comment, created_at FROM reviews WHERE user_id=?`,
      user.id,
    );
    const threads = all(
      `SELECT id, status, created_at FROM chat_threads WHERE user_id=?`,
      user.id,
    );
    const messages = threads.length
      ? all(
          `SELECT id, thread_id, sender_type, body, created_at FROM chat_messages
           WHERE thread_id IN (${threads.map(() => "?").join(",")})
           ORDER BY created_at ASC`,
          ...threads.map((t) => t.id),
        )
      : [];
    const sessions = all(
      `SELECT created_at, last_seen, device, ip_masked, expires_at FROM sessions WHERE user_id=?`,
      user.id,
    );
    // Buyer details entered for receipts / tax invoices (tax-invoices.mjs) and the issued invoices.
    const taxInvoiceRequests = all(
      `SELECT order_id, buyer_type, buyer_name, buyer_tax_id, buyer_branch, buyer_address, status, reason,
              requested_at, updated_at
       FROM tax_invoice_requests WHERE user_id=? ORDER BY updated_at DESC`,
      user.id,
    );
    const taxInvoices = all(
      `SELECT number, order_id, issued_at, buyer_type, buyer_name, buyer_tax_id, buyer_branch, buyer_address,
              total, vat, net
       FROM tax_invoices WHERE user_id=? ORDER BY issued_at DESC`,
      user.id,
    );
    return {
      exportedAt: new Date().toISOString(),
      subject: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        username: profile.username,
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone: profile.phone,
        role: profile.role,
        status: profile.status,
        created_at: profile.created_at,
        hasAvatar: !!profile.avatar_key,
      },
      orders,
      reservations,
      payments,
      ledger,
      reviews,
      chat: { threads, messages },
      sessions,
      taxInvoiceRequests,
      taxInvoices,
    };
  }

  function requestAccountDeletion(user, input = {}) {
    requireUser(user);
    if (user.role !== "CUSTOMER") fail(403, "ใช้ได้เฉพาะบัญชีลูกค้า");
    const live = one("SELECT status FROM users WHERE id=?", user.id);
    if (!live) fail(404, "ไม่พบผู้ใช้");
    if ((live.status ?? "ACTIVE") !== "ACTIVE")
      fail(409, "บัญชีนี้ปิดการใช้งานแล้ว");
    const reason =
      input.reason == null || String(input.reason).trim() === ""
        ? null
        : clean(input.reason, 1, 500, "เหตุผล");
    return tx(() => {
      const pending = one(
        `SELECT id FROM privacy_requests WHERE user_id=? AND kind='DELETE' AND status='PENDING'`,
        user.id,
      );
      if (pending) fail(409, "มีคำขอลบบัญชีรออนุมัติอยู่แล้ว");
      const id = randomUUID();
      run(
        `INSERT INTO privacy_requests(id,user_id,kind,status,reason) VALUES(?,?, 'DELETE','PENDING',?)`,
        id,
        user.id,
        reason,
      );
      audit(user, "PRIVACY_DELETE_REQUEST", id);
      return { id, status: "PENDING" };
    });
  }

  function adminPrivacyRequests(user, query = {}) {
    requireAdmin(user);
    const status =
      query.status != null && String(query.status).trim() !== ""
        ? clean(query.status, 1, 20, "สถานะคำขอ")
        : null;
    if (status && !["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(status))
      fail(400, "สถานะคำขอไม่ถูกต้อง");
    const where = status ? "WHERE r.status=?" : "";
    const params = status ? [status] : [];
    const rows = all(
      `SELECT r.id, r.user_id, r.kind, r.status, r.reason, r.created_at, r.resolved_at, r.resolved_by,
              u.email, u.name, u.status AS user_status
       FROM privacy_requests r
       JOIN users u ON u.id = r.user_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT 200`,
      ...params,
    );
    return { requests: rows };
  }

  function approvePrivacyDeletion(user, requestIdRaw, input = {}) {
    requireAdmin(user);
    const requestId = clean(requestIdRaw, 1, 80, "รหัสคำขอ");
    // Irreversible: re-confirm the admin's password (outside tx so failed attempts count).
    if (typeof confirmPassword === "function") confirmPassword(user, input.currentPassword);
    return tx(() => {
      const req = one("SELECT * FROM privacy_requests WHERE id=?", requestId);
      if (!req) fail(404, "ไม่พบคำขอ");
      if (req.status !== "PENDING") fail(409, "คำขอนี้ดำเนินการแล้ว");
      const subject = one("SELECT * FROM users WHERE id=?", req.user_id);
      if (!subject) fail(404, "ไม่พบผู้ใช้");
      if (subject.role !== "CUSTOMER") fail(409, "ลบบัญชีทีมงานผ่าน PDPA ไม่ได้");

      const anonEmail = "deleted+" + subject.id.slice(0, 8) + "@anonymized.invalid";
      const anonName = "ผู้ใช้ที่ลบแล้ว";
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const previousAvatar = subject.avatar_key ?? null;

      // Anonymize identity; keep orders / payments / ledger rows (append-only).
      run(
        `UPDATE users SET
           email=?, name=?, username=NULL, first_name=NULL, last_name=NULL, phone=NULL,
           note=NULL, avatar_key=NULL, password_hash=?,
           status='DELETED', status_reason='PDPA deletion approved',
           status_changed_at=?, status_changed_by=?
         WHERE id=? AND role='CUSTOMER'`,
        anonEmail,
        anonName,
        passwordHash(randomUUID() + randomUUID()),
        now,
        user.id,
        subject.id,
      );
      run("DELETE FROM sessions WHERE user_id=?", subject.id);
      run("DELETE FROM password_resets WHERE user_id=?", subject.id);
      run("DELETE FROM stock_watch WHERE user_id=?", subject.id);
      run("DELETE FROM customer_tags WHERE user_id=?", subject.id);
      run(
        `UPDATE chat_messages SET body='[ข้อความถูกลบตามคำขอ PDPA]'
         WHERE thread_id IN (SELECT id FROM chat_threads WHERE user_id=?)`,
        subject.id,
      );
      run(
        `UPDATE reviews SET comment='' WHERE user_id=?`,
        subject.id,
      );
      // Buyer details typed for receipts / tax-invoice requests are cleared; an open request is
      // closed. Issued tax invoices (tax_invoices, tax_invoice_voids) are NOT touched: they are
      // legal tax records the shop must keep (Revenue Code record keeping) and are append-only.
      run(
        `UPDATE tax_invoice_requests SET
           buyer_type=NULL, buyer_name=NULL, buyer_tax_id=NULL, buyer_branch=NULL, buyer_address=NULL,
           status=CASE WHEN status IN ('PENDING','SAVED') THEN 'REJECTED' ELSE status END,
           reason=CASE WHEN status IN ('PENDING','SAVED') THEN 'บัญชีถูกลบตามคำขอ PDPA' ELSE reason END,
           updated_at=?
         WHERE user_id=?`,
        now,
        subject.id,
      );
      if (previousAvatar && typeof deleteFile === "function") {
        // file-store delete is async on R2; fire-and-forget after identity cleared.
        Promise.resolve(deleteFile(previousAvatar)).catch(() => {});
      }
      const chatImageKeys = typeof eraseChatImages === "function" ? eraseChatImages(subject.id) : [];
      if (typeof deleteFile === "function")
        for (const key of chatImageKeys) Promise.resolve().then(() => deleteFile(key)).catch(() => {});
      run(
        `UPDATE privacy_requests SET status='APPROVED', resolved_at=?, resolved_by=? WHERE id=?`,
        now,
        user.id,
        requestId,
      );
      audit(user, "PRIVACY_DELETE_APPROVED", requestId);
      // Prove we did not delete money or audit history for this subject.
      const ledgerLeft = one(
        "SELECT COUNT(*) AS n FROM ledger WHERE user_id=?",
        subject.id,
      ).n;
      return {
        id: requestId,
        status: "APPROVED",
        userId: subject.id,
        ledgerRowsKept: ledgerLeft,
      };
    });
  }

  function rejectPrivacyRequest(user, requestIdRaw) {
    requireAdmin(user);
    const requestId = clean(requestIdRaw, 1, 80, "รหัสคำขอ");
    return tx(() => {
      const req = one("SELECT * FROM privacy_requests WHERE id=?", requestId);
      if (!req) fail(404, "ไม่พบคำขอ");
      if (req.status !== "PENDING") fail(409, "คำขอนี้ดำเนินการแล้ว");
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      run(
        `UPDATE privacy_requests SET status='REJECTED', resolved_at=?, resolved_by=? WHERE id=?`,
        now,
        user.id,
        requestId,
      );
      audit(user, "PRIVACY_DELETE_REJECTED", requestId);
      return { id: requestId, status: "REJECTED" };
    });
  }

  return {
    exportMyData,
    requestAccountDeletion,
    adminPrivacyRequests,
    approvePrivacyDeletion,
    rejectPrivacyRequest,
  };
}
