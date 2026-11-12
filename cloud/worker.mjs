import { DurableObject } from "cloudflare:workers";
import { createHmac, createHash } from "node:crypto";
import { createCommerceCore } from "../server/domain.mjs";
import { createDoSqliteAdapter } from "../server/do-sqlite-adapter.mjs";
import { executeSqliteMigration } from "../server/sqlite-migrations.mjs";
import {
  applyMigration005,
  ensureInventoryAvailableIndex,
  MIGRATION_005_NAME,
} from "../server/migrate-005.mjs";
import {
  applyMigration006,
  MIGRATION_006_NAME,
} from "../server/migrate-006.mjs";
import { ensureLiveVersions } from "../server/live.mjs";
import {
  applyMigration007,
  MIGRATION_007_NAME,
} from "../server/migrate-007.mjs";
import {
  applyMigration008,
  MIGRATION_008_NAME,
} from "../server/migrate-008.mjs";
import {
  applyMigration009,
  MIGRATION_009_NAME,
} from "../server/migrate-009.mjs";
import {
  applyMigration010,
  MIGRATION_010_NAME,
} from "../server/migrate-010.mjs";
import {
  applyMigration011,
  MIGRATION_011_NAME,
} from "../server/migrate-011.mjs";
import {
  ensureAppendOnlyMoney,
  ensureChatThreadReads,
  ensureCoupons,
  ensureCustomerAdmin,
  ensureOrderExtras,
  ensureOrderHistory,
  ensureProductsStock,
  ensureNotificationLinks,
  ensureSmallUxB,
  ensureAlertsBackup,
  ensureEmailAndReset,
  ensurePrivacyRequests,
} from "../server/ensure-admin-fr.mjs";
import { ensureAuthHardening } from "../server/auth-hardening.mjs";
import {
  createAPIHandler,
  securityHeaders,
  authenticationPaths,
  accountRecoveryPaths,
  pageSecurityHeaders,
} from "../server/api-handler.mjs";
import { createEmailSender } from "../server/email.mjs";
import { createTurnstile } from "../server/turnstile.mjs";
import initial from "../server/migrations/001_initial.sql";
import reviews from "../server/migrations/002_reviews.sql";
import referenceLayout from "../server/migrations/003_reference_layout.sql";
import commerceOps from "../server/migrations/004_commerce_ops.sql";
import credentialPreorder from "../server/migrations/005_credential_preorder_indexes.sql";
import ledgerMoney from "../server/migrations/006_ledger_money.sql";
import variantStock from "../server/migrations/007_variant_stock.sql";
import uploadsSchema from "../server/migrations/008_uploads.sql";
import inventoryCost from "../server/migrations/009_inventory_cost.sql";
import inventoryExpires from "../server/migrations/010_inventory_expires.sql";
import perfIndexes from "../server/migrations/011_perf_indexes.sql";
export class Commerce extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    const transaction = (fn) => ctx.storage.transactionSync(fn);
    // Map DO cursor.rowsWritten → { changes } so domain if (!x.changes) works on Cloudflare.
    const db = createDoSqliteAdapter(sql);
    if (!env.INVENTORY_KEY) throw Error("Inventory key is missing");
    const key = createHmac("sha256", env.INVENTORY_KEY)
      .update(ctx.id.toString())
      .digest();
    transaction(() => {
      db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
      );
      for (const [name, content] of [
        ["001_initial.sql", initial],
        ["002_reviews.sql", reviews],
        ["003_reference_layout.sql", referenceLayout],
        ["004_commerce_ops.sql", commerceOps],
        [MIGRATION_005_NAME, credentialPreorder],
        [MIGRATION_006_NAME, ledgerMoney],
        [MIGRATION_007_NAME, variantStock],
        [MIGRATION_008_NAME, uploadsSchema],
        [MIGRATION_009_NAME, inventoryCost],
        [MIGRATION_010_NAME, inventoryExpires],
        [MIGRATION_011_NAME, perfIndexes],
      ]) {
        if (
          !db
            .prepare("SELECT name FROM schema_migrations WHERE name=?")
            .get(name)
        ) {
          if (name === MIGRATION_005_NAME) {
            applyMigration005(db, key, content);
          } else if (name === MIGRATION_006_NAME) {
            applyMigration006(db, content);
          } else if (name === MIGRATION_007_NAME) {
            applyMigration007(db, content);
          } else if (name === MIGRATION_008_NAME) {
            applyMigration008(db, content);
          } else if (name === MIGRATION_009_NAME) {
            applyMigration009(db, content);
          } else if (name === MIGRATION_010_NAME) {
            applyMigration010(db, content);
          } else if (name === MIGRATION_011_NAME) {
            applyMigration011(db, content);
          } else {
            executeSqliteMigration(db, content);
            db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
              name,
            );
          }
        }
      }
      db.exec(
        "CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)",
      );
      ensureInventoryAvailableIndex(db);
      ensureChatThreadReads(db);
      ensureCustomerAdmin(db);
      ensureAuthHardening(db);
      ensureOrderHistory(db);
      ensureProductsStock(db);
      ensureNotificationLinks(db);
      ensureSmallUxB(db);
      ensureOrderExtras(db);
      ensureCoupons(db);
      ensureEmailAndReset(db);
      ensureLiveVersions(db);
      ensureAppendOnlyMoney(db);
      ensureAlertsBackup(db);
      ensurePrivacyRequests(db);
    });
    this.db = db;
    const adminPassword =
      typeof env.ASTRA_ADMIN_PASSWORD === "string"
        ? env.ASTRA_ADMIN_PASSWORD.trim()
        : "";
    // Client acceptance testing on the demo URL: test credit + test payments.
    // Remove ASTRA_TEST_PAYMENTS from wrangler.jsonc before the real launch.
    const testPayments = env.ASTRA_TEST_PAYMENTS === "on";
    this.service = createCommerceCore({
      db,
      key,
      transaction,
      allowDemoAdmin: false,
      allowSandbox: testPayments,
      seed: false,
      // R2 binding UPLOADS when Mark creates the bucket; otherwise SQLite files BLOB.
      uploads: env.UPLOADS,
      // Automatic daily backup only when Mark binds the BACKUPS bucket (wrangler.jsonc).
      backups: env.BACKUPS,
      // Outbound alerts: fire-and-forget fetch, kept alive with waitUntil.
      alertFetch: (url, init) => fetch(url, init),
      waitUntil: (promise) => ctx.waitUntil?.(promise),
      // Local wrangler tests only: loopback URL that replaces the provider host.
      alertRedirect: env.ASTRA_ALERT_REDIRECT,
      adminPassword:
        typeof adminPassword === "string" && adminPassword.length >= 8
          ? adminPassword
          : undefined,
      // Email: `send_email` binding EMAIL (or RESEND_API_KEY) + EMAIL_FROM. Turnstile:
      // TURNSTILE_SITE_KEY + TURNSTILE_SECRET. Each stays off until its config is present.
      email: createEmailSender(env),
      turnstile: createTurnstile(env),
      publicBaseUrl: env.PUBLIC_BASE_URL,
    });
    this.service.storageKind = "cloudflare-durable-sqlite";
    this.service.onLive((topics) => {
      const message = JSON.stringify({ topics });
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(message);
        } catch {
          // client went away; the runtime cleans it up
        }
      }
    });
    this.presentation = false;
    this.handle = createAPIHandler(this.service, {
      rateLimit: (key, max, windowMs) => {
        if (max == null)
          return this.consumeLimit(
            "auth:" + createHash("sha256").update(key).digest("hex"),
            20,
            60000,
          );
        return this.consumeLimit(key, max, windowMs);
      },
    });
  }
  consumeLimit(key, max = 60, windowMs = 600000) {
    return this.ctx.storage.transactionSync(() => {
      const now = Date.now();
      this.db.prepare("DELETE FROM rate_limits WHERE expires<?").run(now);
      this.db
        .prepare(
          "INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
        )
        .run(key, now + windowMs);
      return (
        this.db.prepare("SELECT count FROM rate_limits WHERE key=?").get(key)
          .count <= max
      );
    });
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/live" && request.headers.get("Upgrade") === "websocket") {
      // Signals only ("chat changed"), never data, so anonymous storefront tabs may listen too.
      if (this.ctx.getWebSockets().length >= 500)
        return new Response("Too many live connections", { status: 503 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    const response = await this.handle(request);
    // Saving alert settings can switch the daily summary on/off: re-check the alarm now.
    await this.ensureAlarm(
      request.method === "POST" && url.pathname === "/api/admin/alerts" && response.ok,
    );
    return response;
  }
  /**
   * One Durable Object alarm drives the scheduled work (daily summary at 21:00 Bangkok,
   * R2 backup from 04:00 Bangkok when BACKUPS is bound). No alarm when neither is on.
   * Checked at most every 5 minutes on requests, and again after each alarm.
   */
  async ensureAlarm(force = false) {
    const now = Date.now();
    if (!force && now - (this.alarmCheckedAt ?? 0) < 300000) return;
    this.alarmCheckedAt = now;
    try {
      const next = this.service.nextScheduledRun(now);
      const current = await this.ctx.storage.getAlarm();
      if (next == null) {
        if (current != null) await this.ctx.storage.deleteAlarm();
      } else if (current == null || current > next || current <= now) {
        await this.ctx.storage.setAlarm(next);
      }
    } catch (error) {
      console.error("Alarm check failed", error?.message);
    }
  }
  async alarm() {
    try {
      const result = await this.service.runScheduledJobs(Date.now());
      if (result?.backup && !result.backup.ok)
        console.error("Scheduled backup failed", result.backup.error);
    } catch (error) {
      console.error("Scheduled jobs failed", error?.message);
    } finally {
      await this.ensureAlarm(true);
    }
  }
  webSocketMessage(ws, message) {
    if (message === "ping") ws.send("pong");
  }
  webSocketClose(ws, code) {
    try {
      ws.close(code, "bye");
    } catch {
      // already closed
    }
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response;
    try {
      if (url.pathname.startsWith("/api/")) {
        const shop = env.COMMERCE.getByName("shop");
        if (
          request.method === "POST" &&
          (authenticationPaths.includes(url.pathname) ||
            accountRecoveryPaths.includes(url.pathname))
        ) {
          const origin = request.headers.get("Origin");
          if (
            request.headers.get("X-Astra-Request") !== "1" ||
            (origin && origin !== url.origin)
          )
            return Response.json(
              { error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" },
              { status: 403, headers: securityHeaders },
            );
          const ip = createHash("sha256")
            .update(request.headers.get("CF-Connecting-IP") ?? "local")
            .digest("hex");
          if (!(await shop.consumeLimit("global-auth:" + ip, 60, 600000)))
            return Response.json(
              { error: "มีการเข้าสู่ระบบมากเกินไป กรุณาลองอีกครั้งภายหลัง" },
              { status: 429, headers: securityHeaders },
            );
        }
        response = await shop.fetch(request);
        if (response.status === 101) return response;
      } else {
        if (
          /\/(?:\.data|\.env|server|cloud|node_modules)(?:\/|$)/.test(
            url.pathname,
          )
        )
          return new Response("Not found", {
            status: 404,
            headers: securityHeaders,
          });
        response = await env.ASSETS.fetch(request);
        response = new Response(response.body, response);
        // Storefront pages allow the Turnstile script/frame only when Turnstile is configured.
        for (const [key, value] of Object.entries(
          pageSecurityHeaders(
            url.pathname,
            !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET),
          ),
        ))
          response.headers.set(key, value);
      }
      response = new Response(response.body, response);
      response.headers.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
      response.headers.set("X-Astra-Mode", "live");
      return response;
    } catch (error) {
      console.error("Worker request failed", error.message);
      return Response.json(
        { error: "ระบบไม่พร้อมใช้งาน กรุณาลองอีกครั้ง" },
        {
          status: 503,
          headers: { ...securityHeaders, "Cache-Control": "no-store" },
        },
      );
    }
  },
};
