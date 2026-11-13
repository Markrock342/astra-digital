/**
 * Seed ~10k delivered orders and measure admin API p95 (Node local SQLite).
 *
 * Usage:
 *   node scripts/perf-10k-orders.mjs
 *   PERF_ORDERS=10000 PERF_ROUNDS=21 node scripts/perf-10k-orders.mjs
 *
 * Exit 0 when every listed endpoint has p95 < 500ms after indexes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { applyPerfIndexes, PERF_INDEX_SQL } from "../server/migrate-011.mjs";

const TARGET_P95_MS = 500;
const ORDER_COUNT = Math.max(100, Number(process.env.PERF_ORDERS || 10000));
const ROUNDS = Math.max(5, Number(process.env.PERF_ROUNDS || 21));

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function dropPerfIndexes(db) {
  for (const sql of PERF_INDEX_SQL) {
    const name = /INDEX IF NOT EXISTS (\w+)/.exec(sql)?.[1];
    if (name) db.exec("DROP INDEX IF EXISTS " + name);
  }
}

function seedOrders(s, { admin, buyerId, variantId, count }) {
  const price =
    s.db.prepare("SELECT price FROM variants WHERE id=?").get(variantId)?.price ?? 9900;
  const insertOrder = s.db.prepare(
    `INSERT INTO orders(id,user_id,variant_id,quantity,total,status,request_key,payment_hash,warranty_days,discount,coupon_code,created_at)
     VALUES(?,?,?,?,?,'DELIVERED',?,?,0,0,NULL,?)`,
  );
  const insertPay = s.db.prepare(
    `INSERT INTO payments(id, order_id, reservation_id, user_id, amount, currency, status, provider, provider_ref, idempotency_key, created_at, finalized_at)
     VALUES(?,?,NULL,?,?,'THB','SUCCEEDED','sandbox',?,?,?,?)`,
  );

  s.db.exec("BEGIN");
  try {
    for (let i = 0; i < count; i++) {
      const id = "perf-ord-" + String(i).padStart(6, "0");
      const created = new Date(Date.UTC(2024, 0, 1) + i * 60000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      insertOrder.run(
        id,
        buyerId,
        variantId,
        1,
        price,
        "perf-key-" + i,
        "hash-" + i,
        created,
      );
      insertPay.run(
        "perf-pay-" + String(i).padStart(6, "0"),
        id,
        buyerId,
        price,
        "sandbox:order:" + id,
        "pay:order:" + id,
        created,
        created,
      );
    }
    s.db.exec("COMMIT");
  } catch (e) {
    s.db.exec("ROLLBACK");
    throw e;
  }
  return { price };
}

async function timeEndpoint(handle, token, path, rounds) {
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    const res = await handle(
      new Request("http://127.0.0.1" + path, {
        headers: {
          Cookie: "astra_session=" + token,
          "X-Astra-Request": "1",
        },
      }),
    );
    await res.arrayBuffer();
    samples.push(performance.now() - t0);
    if (res.status >= 400) throw new Error(path + " → " + res.status);
  }
  samples.sort((a, b) => a - b);
  return {
    path,
    n: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: samples[samples.length - 1],
  };
}

function printReport(label, rows) {
  console.log("\n=== " + label + " ===");
  console.log(
    "orders=" + ORDER_COUNT + " rounds=" + ROUNDS + " target_p95_ms=" + TARGET_P95_MS,
  );
  for (const r of rows) {
    console.log(
      [
        r.path.padEnd(42),
        "p50=" + r.p50.toFixed(1).padStart(7) + "ms",
        "p95=" + r.p95.toFixed(1).padStart(7) + "ms",
        "max=" + r.max.toFixed(1).padStart(7) + "ms",
        r.p95 < TARGET_P95_MS ? "OK" : "FAIL",
      ].join("  "),
    );
  }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "astra-perf-"));
  const path = join(dir, "perf.sqlite");
  let s;
  try {
    s = createCommerce({
      path,
      allowDemoAdmin: true,
      seed: true,
    });
    const adminAuth = s.demoMerchant();
    const admin = s.session(adminAuth.token);
    const buyerAuth = s.register({
      name: "Perf Buyer",
      email: "perf-buyer@example.invalid",
      password: "Buyer-only-Password-123",
    });
    const product = s.saveProduct(admin, {
      name: "Perf Product",
      description: "สินค้าทดสอบความเร็ว",
      category: "streaming",
      price: 9900,
      active: true,
    });
    const variantId = s.adminProductVariants(admin, product.id).variants[0].id;

    console.log("Seeding " + ORDER_COUNT + " orders…");
    const tSeed = performance.now();
    seedOrders(s, {
      admin,
      buyerId: buyerAuth.user.id,
      variantId,
      count: ORDER_COUNT,
    });
    console.log("Seed done in " + (performance.now() - tSeed).toFixed(0) + "ms");

    const endpoints = [
      "/api/admin/orders?limit=50",
      "/api/admin/customers?limit=50",
      "/api/admin/transactions?limit=50",
      "/api/admin/reports/sales",
      "/api/admin/reports/profit",
      "/api/admin/products?limit=50",
      "/api/admin/summary",
    ];

    dropPerfIndexes(s.db);
    const handle = createAPIHandler(s);

    const before = [];
    for (const ep of endpoints)
      before.push(await timeEndpoint(handle, adminAuth.token, ep, ROUNDS));
    printReport("BEFORE indexes", before);

    applyPerfIndexes(s.db);
    s.db.exec("ANALYZE");

    const after = [];
    for (const ep of endpoints)
      after.push(await timeEndpoint(handle, adminAuth.token, ep, ROUNDS));
    printReport("AFTER indexes (MIG-011)", after);

    const failed = after.filter((r) => r.p95 >= TARGET_P95_MS);
    if (failed.length) {
      console.error("\nFAIL: p95 >= " + TARGET_P95_MS + "ms for:");
      for (const f of failed) console.error(" - " + f.path + " p95=" + f.p95.toFixed(1));
      process.exitCode = 1;
    } else {
      console.log("\nPASS: all endpoints p95 < " + TARGET_P95_MS + "ms");
    }
  } finally {
    try {
      s?.db?.close();
    } catch {
      /* ignore */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows locks */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
