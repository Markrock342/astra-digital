import { DurableObject } from "cloudflare:workers";
import { createHmac, createHash } from "node:crypto";
import { createCommerceCore } from "../server/domain.mjs";
import { executeSqliteMigration } from "../server/sqlite-migrations.mjs";
import {
  applyMigration005,
  ensureInventoryAvailableIndex,
  MIGRATION_005_NAME,
} from "../server/migrate-005.mjs";
import {
  createAPIHandler,
  securityHeaders,
  authenticationPaths,
} from "../server/api-handler.mjs";
import initial from "../server/migrations/001_initial.sql";
import reviews from "../server/migrations/002_reviews.sql";
import referenceLayout from "../server/migrations/003_reference_layout.sql";
import commerceOps from "../server/migrations/004_commerce_ops.sql";
import credentialPreorder from "../server/migrations/005_credential_preorder_indexes.sql";
export class Commerce extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    const transaction = (fn) => ctx.storage.transactionSync(fn);
    const db = {
      exec: (s) => sql.exec(s),
      prepare: (s) => ({
        all: (...a) => sql.exec(s, ...a).toArray(),
        get: (...a) => sql.exec(s, ...a).toArray()[0],
        run: (...a) => sql.exec(s, ...a),
      }),
    };
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
      ]) {
        if (
          !db
            .prepare("SELECT name FROM schema_migrations WHERE name=?")
            .get(name)
        ) {
          if (name === MIGRATION_005_NAME) {
            applyMigration005(db, key, content);
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
    });
    this.db = db;
    const adminPassword =
      typeof env.ASTRA_ADMIN_PASSWORD === "string"
        ? env.ASTRA_ADMIN_PASSWORD.trim()
        : "";
    this.service = createCommerceCore({
      db,
      key,
      transaction,
      allowDemoAdmin: false,
      allowSandbox: false,
      seed: false,
      adminPassword:
        typeof adminPassword === "string" && adminPassword.length >= 8
          ? adminPassword
          : undefined,
    });
    this.service.storageKind = "cloudflare-durable-sqlite";
    this.presentation = false;
    this.handle = createAPIHandler(this.service, {
      rateLimit: (key) =>
        this.consumeLimit(
          "auth:" + createHash("sha256").update(key).digest("hex"),
          20,
          60000,
        ),
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
    return this.handle(request);
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
          authenticationPaths.includes(url.pathname)
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
        for (const [key, value] of Object.entries(securityHeaders))
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
