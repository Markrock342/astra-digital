import { DurableObject } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { createCommerceCore } from "../server/domain.mjs";
import {
  createAPIHandler,
  securityHeaders,
  authenticationPaths,
} from "../server/api-handler.mjs";
import initial from "../server/migrations/001_initial.sql";
import reviews from "../server/migrations/002_reviews.sql";
import referenceLayout from "../server/migrations/003_reference_layout.sql";
const cookieName = "astra_space";
function signingKey(env) {
  if (!env.SPACE_SIGNING_KEY || !env.INVENTORY_KEY)
    throw Error("Demo runtime secrets are missing");
  return env.SPACE_SIGNING_KEY;
}
function signature(id, env) {
  return createHmac("sha256", signingKey(env))
    .update("space-v1:" + id)
    .digest("hex");
}
function readSpace(request, env) {
  const value =
    /(?:^|;\s*)astra_space=([a-f0-9]{32})\.([a-f0-9]{64})(?:;|$)/.exec(
      request.headers.get("Cookie") ?? "",
    );
  if (!value) return null;
  const expected = Buffer.from(signature(value[1], env), "hex");
  return timingSafeEqual(expected, Buffer.from(value[2], "hex"))
    ? value[1]
    : null;
}
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
    transaction(() => {
      db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
      );
      for (const [name, content] of [
        ["001_initial.sql", initial],
        ["002_reviews.sql", reviews],
        ["003_reference_layout.sql", referenceLayout],
      ]) {
        if (
          !db
            .prepare("SELECT name FROM schema_migrations WHERE name=?")
            .get(name)
        ) {
          db.exec(content.replace(/PRAGMA foreign_keys = ON;/g, ""));
          db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(name);
        }
      }
      db.exec(
        "CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)",
      );
    });
    const presentation =
      ctx.id.toString() === env.COMMERCE.idFromName("presentation").toString();
    const key = createHmac("sha256", env.INVENTORY_KEY)
      .update(ctx.id.toString())
      .digest();
    this.db = db;
    this.service = createCommerceCore({
      db,
      key,
      transaction,
      allowDemoAdmin: !presentation,
    });
    this.service.storageKind = "cloudflare-durable-sqlite";
    this.presentation = presentation;
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
    if (this.presentation && request.method !== "GET")
      return Response.json(
        { error: "กรุณาเริ่มพื้นที่ทดลองของคุณก่อน" },
        { status: 403, headers: securityHeaders },
      );
    return this.handle(request);
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response;
    try {
      if (url.pathname.startsWith("/api/")) {
        let space = readSpace(request, env),
          created = false;
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
          if (
            !(await env.COMMERCE.getByName("presentation").consumeLimit(
              "global-auth:" + ip,
              60,
              600000,
            ))
          )
            return Response.json(
              { error: "มีการเริ่มทดลองมากเกินไป กรุณาลองอีกครั้งภายหลัง" },
              { status: 429, headers: securityHeaders },
            );
          if (!space) {
            space = randomBytes(16).toString("hex");
            created = true;
          }
        }
        if (!space && request.method !== "GET")
          return Response.json(
            { error: "กรุณาเริ่มทดลองหรือเข้าสู่ระบบก่อน" },
            { status: 401, headers: securityHeaders },
          );
        response = await env.COMMERCE.getByName(
          space ? "client:" + space : "presentation",
        ).fetch(request);
        if (created) {
          response = new Response(response.body, response);
          response.headers.append(
            "Set-Cookie",
            `${cookieName}=${space}.${signature(space, env)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${url.protocol === "https:" ? "; Secure" : ""}`,
          );
        }
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
      response.headers.set("X-Astra-Mode", "sandbox");
      return response;
    } catch (error) {
      console.error("Worker request failed", error.message);
      return Response.json(
        { error: "ระบบทดลองไม่พร้อมใช้งาน กรุณาลองอีกครั้ง" },
        {
          status: 503,
          headers: { ...securityHeaders, "Cache-Control": "no-store" },
        },
      );
    }
  },
};
