/** Admin system health / invariants (credit vs ledger, stock integrity, migrations). */
import { TRACK_A_MIGRATION_FILES } from "./migrate-005.mjs";
import { walletRowSql } from "./money.mjs";

export function createAdminHealthApis({ requireAdmin, one, all, db }) {
  function adminSystemHealth(user) {
    requireAdmin(user);

    const applied = all(
      "SELECT name, applied_at FROM schema_migrations ORDER BY name",
    ).map((r) => r.name);
    const missingMigrations = TRACK_A_MIGRATION_FILES.filter(
      (name) => !applied.includes(name),
    );
    const extraMigrations = applied.filter(
      (name) => !TRACK_A_MIGRATION_FILES.includes(name),
    );

    const triggers = all(
      `SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (
         'ledger_append_only_update','ledger_append_only_delete',
         'audit_append_only_update','audit_append_only_delete'
       )`,
    ).map((r) => r.name);
    const expectedTriggers = [
      "ledger_append_only_update",
      "ledger_append_only_delete",
      "audit_append_only_update",
      "audit_append_only_delete",
    ];
    const missingTriggers = expectedTriggers.filter((n) => !triggers.includes(n));

    // Customers whose wallet net is negative (should not happen in normal flows).
    const negativeBalances = all(
      `SELECT u.id AS userId, u.email,
              (SELECT COALESCE(SUM(net),0) FROM ledger l WHERE l.user_id=u.id AND ${walletRowSql("l.")}) AS balance
       FROM users u
       WHERE u.role='CUSTOMER'
         AND (SELECT COALESCE(SUM(net),0) FROM ledger l WHERE l.user_id=u.id AND ${walletRowSql("l.")}) < 0
       LIMIT 50`,
    );

    // Orphan sold inventory (points at missing order/reservation).
    const orphanInventory = one(
      `SELECT COUNT(*) AS n FROM inventory i
       WHERE (i.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id=i.order_id))
          OR (i.reservation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.id=i.reservation_id))`,
    ).n;

    // Units claimed sold but parent still PENDING_PAYMENT (stuck allocation).
    const stuckPendingStock = one(
      `SELECT COUNT(*) AS n FROM inventory i
       JOIN orders o ON o.id=i.order_id
       WHERE o.status='PENDING_PAYMENT'`,
    ).n;

    const inventoryCols = db
      .prepare("PRAGMA table_info(inventory)")
      .all()
      .map((c) => c.name);
    const requiredCols = ["cost", "expires_at", "login_key", "defective"];
    const missingColumns = requiredCols.filter((c) => !inventoryCols.includes(c));

    // Succeeded payments should have a PAYMENT_IN ledger row (finance invariant).
    const paymentsMissingLedger = one(
      `SELECT COUNT(*) AS n FROM payments p
       WHERE p.status='SUCCEEDED'
         AND NOT EXISTS (
           SELECT 1 FROM ledger l WHERE l.payment_id=p.id AND l.kind='PAYMENT_IN'
         )`,
    ).n;

    const checks = [
      {
        id: "migrations",
        ok: missingMigrations.length === 0,
        label: "Schema migrations ครบ",
        detail:
          missingMigrations.length === 0
            ? "ครบ " + TRACK_A_MIGRATION_FILES.length + " ไฟล์"
            : "ขาด: " + missingMigrations.join(", "),
      },
      {
        id: "append_only",
        ok: missingTriggers.length === 0,
        label: "Append-only triggers (ledger/audit)",
        detail:
          missingTriggers.length === 0
            ? "ครบ 4 triggers"
            : "ขาด: " + missingTriggers.join(", "),
      },
      {
        id: "balances",
        ok: negativeBalances.length === 0,
        label: "ยอดเครดิตลูกค้า (ledger wallet) ไม่ติดลบ",
        detail:
          negativeBalances.length === 0
            ? "ไม่มีบัญชีติดลบ"
            : "พบ " + negativeBalances.length + " บัญชี",
        samples: negativeBalances,
      },
      {
        id: "payment_ledger",
        ok: paymentsMissingLedger === 0,
        label: "ชำระสำเร็จมีแถว PAYMENT_IN ใน ledger",
        detail:
          paymentsMissingLedger === 0
            ? "ครบ"
            : "ขาด " + paymentsMissingLedger + " รายการ",
      },
      {
        id: "orphan_inventory",
        ok: orphanInventory === 0,
        label: "สต็อกที่ขายแล้วชี้ไปออเดอร์ที่มีอยู่",
        detail: orphanInventory === 0 ? "ไม่พบแถวกำพร้า" : "พบ " + orphanInventory + " แถว",
      },
      {
        id: "stuck_stock",
        ok: stuckPendingStock === 0,
        label: "ไม่มีสต็อกค้างกับออเดอร์รอชำระ",
        detail:
          stuckPendingStock === 0
            ? "ไม่พบ"
            : "พบ " + stuckPendingStock + " แถว (ควรคืนสต็อก)",
      },
      {
        id: "inventory_columns",
        ok: missingColumns.length === 0,
        label: "คอลัมน์ inventory ที่จำเป็น",
        detail:
          missingColumns.length === 0
            ? "มี cost / expires_at / login_key / defective"
            : "ขาด: " + missingColumns.join(", "),
      },
    ];

    const ok = checks.every((c) => c.ok);
    return {
      ok,
      checkedAt: new Date().toISOString(),
      migrations: {
        expected: TRACK_A_MIGRATION_FILES,
        applied,
        missing: missingMigrations,
        extra: extraMigrations,
      },
      checks,
    };
  }

  return { adminSystemHealth };
}
