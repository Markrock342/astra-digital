/**
 * One-shot wipe of test-mode customer commerce before going live.
 * POST /api/admin/launch/cleanup — ADMIN + currentPassword; only while allowSandbox.
 * dryRun (default true) returns per-table counts; execute deletes then audits LAUNCH_CLEANUP.
 *
 * Append-only: temporarily drop delete triggers for ledger + tax invoice docs (+ finance
 * sandbox books), never for audit. Triggers are restored in the same transaction.
 */
import {
  ensureAppendOnlyMoney,
  TAX_INVOICE_APPEND_ONLY_TABLES,
  ensureTaxInvoices,
} from "./ensure-admin-fr.mjs";
import { ensureFinanceBooks, FINANCE_APPEND_ONLY_TRIGGERS } from "./finance-close.mjs";

export const LAUNCH_CLEANUP_AUDIT = "LAUNCH_CLEANUP";

function tableExists(one, name) {
  return !!one("SELECT name FROM sqlite_master WHERE type='table' AND name=?", name);
}

function dropLedgerTriggers(db) {
  db.exec("DROP TRIGGER IF EXISTS ledger_append_only_update");
  db.exec("DROP TRIGGER IF EXISTS ledger_append_only_delete");
}

function dropTaxTriggers(db) {
  for (const table of TAX_INVOICE_APPEND_ONLY_TABLES) {
    db.exec(`DROP TRIGGER IF EXISTS ${table}_append_only_update`);
    db.exec(`DROP TRIGGER IF EXISTS ${table}_append_only_delete`);
  }
}

function dropFinanceTriggers(db) {
  for (const name of FINANCE_APPEND_ONLY_TRIGGERS) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
}

export function createLaunchCleanupApis({
  one,
  all,
  run,
  tx,
  fail,
  requireAdmin,
  confirmPassword,
  allowSandbox,
  db,
  fileStore,
  eraseUserChatImages,
}) {
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      JSON.stringify(detail),
    );

  const n = (sql, ...params) => Number(one(sql, ...params)?.n ?? 0);

  /** Snapshot of what will be removed / kept (no writes). */
  function planCounts() {
    const customers = all("SELECT id FROM users WHERE role='CUSTOMER'").map((r) => r.id);
    const customerSet = customers.length
      ? `IN (${customers.map(() => "?").join(",")})`
      : "IN (NULL)"; // never matches
    const cparams = customers;

    const orderIds = customers.length
      ? all(`SELECT id FROM orders WHERE user_id ${customerSet}`, ...cparams).map((r) => r.id)
      : [];
    const reservationIds = customers.length
      ? all(`SELECT id FROM reservations WHERE user_id ${customerSet}`, ...cparams).map((r) => r.id)
      : [];

    let soldInventory = 0;
    if (orderIds.length)
      soldInventory += n(
        `SELECT COUNT(*) AS n FROM inventory WHERE order_id IN (${orderIds.map(() => "?").join(",")})`,
        ...orderIds,
      );
    if (reservationIds.length)
      soldInventory += n(
        `SELECT COUNT(*) AS n FROM inventory WHERE reservation_id IN (${reservationIds.map(() => "?").join(",")})`,
        ...reservationIds,
      );

    const chatUploadKeys = customers.length
      ? all(`SELECT key FROM chat_uploads WHERE user_id ${customerSet}`, ...cparams).map((r) => r.key)
      : [];
    const chatMessageKeys = customers.length
      ? all(
          `SELECT m.image_key AS key FROM chat_messages m
           JOIN chat_threads t ON t.id=m.thread_id
           WHERE t.user_id ${customerSet} AND m.image_key IS NOT NULL`,
          ...cparams,
        ).map((r) => r.key)
      : [];

    const remove = {
      customers: customers.length,
      sessions: customers.length
        ? n(`SELECT COUNT(*) AS n FROM sessions WHERE user_id ${customerSet}`, ...cparams)
        : 0,
      passwordResets: customers.length
        ? n(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id ${customerSet}`, ...cparams)
        : 0,
      orders: orderIds.length,
      reservations: reservationIds.length,
      payments: customers.length
        ? n(
            `SELECT COUNT(*) AS n FROM payments WHERE
               provider='sandbox' OR IFNULL(provider_ref,'') LIKE 'sandbox:%'
               OR user_id ${customerSet}`,
            ...cparams,
          )
        : n(
            `SELECT COUNT(*) AS n FROM payments WHERE provider='sandbox' OR IFNULL(provider_ref,'') LIKE 'sandbox:%'`,
          ),
      ledgerTest: customers.length
        ? n(
            `SELECT COUNT(*) AS n FROM ledger WHERE
               kind='DEMO_CREDIT' OR IFNULL(provider_ref,'') LIKE 'sandbox:%'
               OR user_id ${customerSet}`,
            ...cparams,
          )
        : n(
            `SELECT COUNT(*) AS n FROM ledger WHERE kind='DEMO_CREDIT' OR IFNULL(provider_ref,'') LIKE 'sandbox:%'`,
          ),
      notifications: customers.length
        ? n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id ${customerSet}`, ...cparams)
        : 0,
      reviews: customers.length
        ? n(`SELECT COUNT(*) AS n FROM reviews WHERE user_id ${customerSet}`, ...cparams)
        : 0,
      stockWatch: customers.length
        ? n(`SELECT COUNT(*) AS n FROM stock_watch WHERE user_id ${customerSet}`, ...cparams)
        : 0,
      customerTags: customers.length
        ? n(`SELECT COUNT(*) AS n FROM customer_tags WHERE user_id ${customerSet}`, ...cparams)
        : 0,
      chatThreads: customers.length
        ? n(`SELECT COUNT(*) AS n FROM chat_threads WHERE user_id ${customerSet}`, ...cparams)
        : 0,
      chatUploads: chatUploadKeys.length,
      chatImageFiles: [...new Set([...chatUploadKeys, ...chatMessageKeys])].length,
      manualOrders: customers.length
        ? n(`SELECT COUNT(*) AS n FROM manual_orders WHERE user_id ${customerSet}`, ...cparams)
        : 0,
      couponRedemptions: customers.length
        ? n(
            `SELECT COUNT(*) AS n FROM coupon_redemptions WHERE user_id ${customerSet}
             OR (order_id IS NOT NULL AND order_id IN (SELECT id FROM orders WHERE user_id ${customerSet}))
             OR (reservation_id IS NOT NULL AND reservation_id IN (SELECT id FROM reservations WHERE user_id ${customerSet}))`,
            ...cparams,
            ...cparams,
            ...cparams,
          )
        : n(`SELECT COUNT(*) AS n FROM coupon_redemptions WHERE 0`),
      privacyRequests: customers.length
        ? n(`SELECT COUNT(*) AS n FROM privacy_requests WHERE user_id ${customerSet}`, ...cparams)
        : 0,
      taxInvoiceRequests: customers.length
        ? n(`SELECT COUNT(*) AS n FROM tax_invoice_requests WHERE user_id ${customerSet}`, ...cparams)
        : 0,
      taxInvoicesTest: tableExists(one, "tax_invoices")
        ? n(`SELECT COUNT(*) AS n FROM tax_invoices WHERE scope='sandbox' OR number LIKE 'TEST-%'`)
        : 0,
      taxInvoiceVoidsTest: tableExists(one, "tax_invoice_voids")
        ? n(
            `SELECT COUNT(*) AS n FROM tax_invoice_voids WHERE invoice_id IN
             (SELECT id FROM tax_invoices WHERE scope='sandbox' OR number LIKE 'TEST-%')`,
          )
        : 0,
      soldInventory,
      financeSandbox: tableExists(one, "finance_day_closes")
        ? n(`SELECT COUNT(*) AS n FROM finance_day_closes WHERE scope='sandbox'`) +
          n(`SELECT COUNT(*) AS n FROM finance_withdrawals WHERE scope='sandbox'`) +
          (tableExists(one, "recon_runs")
            ? n(`SELECT COUNT(*) AS n FROM recon_runs WHERE scope='sandbox'`)
            : 0)
        : 0,
    };

    const keep = {
      products: n("SELECT COUNT(*) AS n FROM products WHERE hidden_seed=0"),
      variants: n("SELECT COUNT(*) AS n FROM variants"),
      unsoldInventory: n(
        `SELECT COUNT(*) AS n FROM inventory WHERE order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0`,
      ),
      adminStaff: n(`SELECT COUNT(*) AS n FROM users WHERE role IN ('ADMIN','STAFF')`),
      coupons: tableExists(one, "coupons") ? n("SELECT COUNT(*) AS n FROM coupons") : 0,
      audit: n("SELECT COUNT(*) AS n FROM audit"),
      categories: tableExists(one, "categories") ? n("SELECT COUNT(*) AS n FROM categories") : 0,
      banners: tableExists(one, "banners") ? n("SELECT COUNT(*) AS n FROM banners") : 0,
    };

    return { remove, keep, customerIds: customers, orderIds, reservationIds };
  }

  /**
   * POST /api/admin/launch/cleanup
   * body: { dryRun?: boolean (default true), currentPassword }
   */
  function adminLaunchCleanup(user, input = {}) {
    requireAdmin(user);
    if (!allowSandbox)
      fail(403, "ล้างข้อมูลทดสอบได้เฉพาะตอนโหมดทดสอบ (ASTRA_TEST_PAYMENTS) เท่านั้น");
    if (typeof confirmPassword === "function") confirmPassword(user, input.currentPassword);
    const dryRun = input.dryRun !== false;

    const snapshot = planCounts();
    if (dryRun) {
      return {
        dryRun: true,
        mode: "sandbox",
        remove: snapshot.remove,
        keep: snapshot.keep,
      };
    }

    const fileKeys = [];
    const result = tx(() => {
      const before = planCounts();
      const { customerIds, orderIds, reservationIds } = before;
      const marks = customerIds.length ? customerIds.map(() => "?").join(",") : null;

      // Collect chat file keys before rows go away.
      if (marks && typeof eraseUserChatImages === "function") {
        for (const id of customerIds) fileKeys.push(...eraseUserChatImages(id));
      } else if (marks) {
        fileKeys.push(
          ...all(`SELECT key FROM chat_uploads WHERE user_id IN (${marks})`, ...customerIds).map(
            (r) => r.key,
          ),
        );
      }

      dropLedgerTriggers(db);
      dropTaxTriggers(db);
      dropFinanceTriggers(db);
      try {
        if (marks) {
          run(`DELETE FROM sessions WHERE user_id IN (${marks})`, ...customerIds);
          run(`DELETE FROM password_resets WHERE user_id IN (${marks})`, ...customerIds);
          run(`DELETE FROM notifications WHERE user_id IN (${marks})`, ...customerIds);
          run(`DELETE FROM stock_watch WHERE user_id IN (${marks})`, ...customerIds);
          run(`DELETE FROM customer_tags WHERE user_id IN (${marks})`, ...customerIds);
          run(`DELETE FROM reviews WHERE user_id IN (${marks})`, ...customerIds);
          if (tableExists(one, "privacy_requests"))
            run(`DELETE FROM privacy_requests WHERE user_id IN (${marks})`, ...customerIds);
          if (tableExists(one, "manual_orders"))
            run(`DELETE FROM manual_orders WHERE user_id IN (${marks})`, ...customerIds);

          run(
            `DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE user_id IN (${marks}))`,
            ...customerIds,
          );
          if (tableExists(one, "chat_thread_reads"))
            run(
              `DELETE FROM chat_thread_reads WHERE thread_id IN (SELECT id FROM chat_threads WHERE user_id IN (${marks}))`,
              ...customerIds,
            );
          run(`DELETE FROM chat_threads WHERE user_id IN (${marks})`, ...customerIds);
          if (tableExists(one, "chat_uploads"))
            run(`DELETE FROM chat_uploads WHERE user_id IN (${marks})`, ...customerIds);

          if (orderIds.length) {
            const om = orderIds.map(() => "?").join(",");
            if (tableExists(one, "order_notes"))
              run(`DELETE FROM order_notes WHERE order_id IN (${om})`, ...orderIds);
            if (tableExists(one, "order_replacements"))
              run(`DELETE FROM order_replacements WHERE order_id IN (${om})`, ...orderIds);
          }

          run(
            `DELETE FROM inventory WHERE
               (order_id IS NOT NULL AND order_id IN (SELECT id FROM orders WHERE user_id IN (${marks})))
               OR (reservation_id IS NOT NULL AND reservation_id IN (SELECT id FROM reservations WHERE user_id IN (${marks})))`,
            ...customerIds,
            ...customerIds,
          );

          if (tableExists(one, "coupon_redemptions"))
            run(
              `DELETE FROM coupon_redemptions WHERE user_id IN (${marks})
               OR order_id IN (SELECT id FROM orders WHERE user_id IN (${marks}))
               OR reservation_id IN (SELECT id FROM reservations WHERE user_id IN (${marks}))`,
              ...customerIds,
              ...customerIds,
              ...customerIds,
            );

          if (tableExists(one, "tax_invoice_requests"))
            run(`DELETE FROM tax_invoice_requests WHERE user_id IN (${marks})`, ...customerIds);

          run(`DELETE FROM payments WHERE user_id IN (${marks})`, ...customerIds);
          run(
            `DELETE FROM payments WHERE provider='sandbox' OR IFNULL(provider_ref,'') LIKE 'sandbox:%'`,
          );
          run(
            `DELETE FROM ledger WHERE kind='DEMO_CREDIT' OR IFNULL(provider_ref,'') LIKE 'sandbox:%'
             OR user_id IN (${marks})`,
            ...customerIds,
          );

          run(`DELETE FROM reservations WHERE user_id IN (${marks})`, ...customerIds);
          run(`DELETE FROM orders WHERE user_id IN (${marks})`, ...customerIds);
          run(`DELETE FROM users WHERE role='CUSTOMER' AND id IN (${marks})`, ...customerIds);
        } else {
          run(
            `DELETE FROM payments WHERE provider='sandbox' OR IFNULL(provider_ref,'') LIKE 'sandbox:%'`,
          );
          run(
            `DELETE FROM ledger WHERE kind='DEMO_CREDIT' OR IFNULL(provider_ref,'') LIKE 'sandbox:%'`,
          );
        }

        if (tableExists(one, "tax_invoice_voids"))
          run(
            `DELETE FROM tax_invoice_voids WHERE invoice_id IN
             (SELECT id FROM tax_invoices WHERE scope='sandbox' OR number LIKE 'TEST-%')`,
          );
        if (tableExists(one, "tax_invoices"))
          run(`DELETE FROM tax_invoices WHERE scope='sandbox' OR number LIKE 'TEST-%'`);

        if (tableExists(one, "finance_day_closes")) {
          run(`DELETE FROM finance_day_closes WHERE scope='sandbox'`);
          run(`DELETE FROM finance_withdrawals WHERE scope='sandbox'`);
          if (tableExists(one, "recon_decisions"))
            run(
              `DELETE FROM recon_decisions WHERE run_id IN (SELECT id FROM recon_runs WHERE scope='sandbox')`,
            );
          if (tableExists(one, "recon_rows"))
            run(
              `DELETE FROM recon_rows WHERE run_id IN (SELECT id FROM recon_runs WHERE scope='sandbox')`,
            );
          if (tableExists(one, "recon_runs")) run(`DELETE FROM recon_runs WHERE scope='sandbox'`);
        }

        // Orphan redemptions after order wipe.
        if (tableExists(one, "coupon_redemptions"))
          run(
            `DELETE FROM coupon_redemptions
             WHERE (order_id IS NOT NULL AND order_id NOT IN (SELECT id FROM orders))
                OR (reservation_id IS NOT NULL AND reservation_id NOT IN (SELECT id FROM reservations))`,
          );
      } finally {
        ensureAppendOnlyMoney(db);
        ensureTaxInvoices(db);
        ensureFinanceBooks(db);
      }

      const after = planCounts();
      auditDetail(user, LAUNCH_CLEANUP_AUDIT, "shop", {
        removed: before.remove,
        kept: after.keep,
      });
      return {
        dryRun: false,
        mode: "sandbox",
        remove: before.remove,
        keep: after.keep,
      };
    });

    if (fileStore?.delete) {
      for (const key of [...new Set(fileKeys)]) {
        Promise.resolve(fileStore.delete(key)).catch(() => {});
      }
    }
    return result;
  }

  return { adminLaunchCleanup, planCounts };
}
