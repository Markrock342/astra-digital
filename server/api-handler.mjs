import { createHash } from "node:crypto";
import { ApiError } from "./domain.mjs";
/**
 * Coupon guessing guard: every coupon check and every order placed with a code counts,
 * per signed-in account and per client IP, in a 10-minute window.
 */
export const COUPON_RATE_LIMIT = { perUser: 15, perIp: 40, windowMs: 600000 };
import { TURNSTILE_ORIGIN, TURNSTILE_REJECTED, turnstileTokenFrom } from "./turnstile.mjs";
import { STOCK_WATCH_RATE_LIMIT } from "./stock-watch.mjs";
import { routeFraudAndTemplates } from "./fraud-template-routes.mjs";
import { routeTaxInvoices } from "./tax-invoices.mjs";
import { routeOrderReceipts } from "./order-receipts.mjs";
export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
};
/** Storefront pages when Turnstile is on: only its script + iframe origin is added. */
export const turnstileSecurityHeaders = {
  ...securityHeaders,
  "Content-Security-Policy": `default-src 'self'; script-src 'self' ${TURNSTILE_ORIGIN}; frame-src 'self' ${TURNSTILE_ORIGIN}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'`,
};
/** Headers for an HTML page / static asset. The back office (/admin) never gets the wider CSP. */
export function pageSecurityHeaders(pathname, turnstileOn) {
  const admin = pathname === "/admin" || String(pathname).startsWith("/admin/");
  return turnstileOn && !admin ? turnstileSecurityHeaders : securityHeaders;
}
/** Public, no-session POSTs (Origin check + global per-IP limit on the Worker). The
 *  email-verification link (/api/verify-email) is opened without a session too. */
export const accountRecoveryPaths = ["/api/password/forgot", "/api/password/reset", "/api/verify-email"];
export const authenticationPaths = [
  "/api/login",
  "/api/login/totp",
  "/api/register",
  "/api/demo",
  "/api/demo-merchant",
];
function sameLocalOrigin(origin, pageOrigin) {
  if (origin === pageOrigin) return true;
  try {
    const left = new URL(origin);
    const right = new URL(pageOrigin);
    const local = new Set(["127.0.0.1", "localhost"]);
    return local.has(left.hostname) && local.has(right.hostname);
  } catch {
    return false;
  }
}
const MAX_JSON_BYTES = 32768;
// Shop settings carry the legal pages text (Thai is 3 bytes per character in UTF-8).
const MAX_SETTINGS_BYTES = 262144;
// Storefront appearance: every part at its longest Thai + English text stays well under this.
const MAX_APPEARANCE_BYTES = 131072;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
// การเงิน › กระทบยอด: a CSV of up to 2 MB sent as a JSON string (escaping can double it).
const MAX_RECON_JSON_BYTES = 4.5 * 1024 * 1024;
const reconUploadPaths = ["/api/admin/finance/reconciliations", "/api/admin/finance/reconciliations/preview"];
/** Admin finance CSV download response. */
const financeCsv = (csv, name) =>
  new Response(csv, {
    status: 200,
    headers: {
      ...securityHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="' + name + '"',
    },
  });
function isImageUploadPath(method, path) {
  if (method !== "POST") return false;
  return (
    /^\/api\/admin\/products\/[^/]+\/images$/.test(path) ||
    path === "/api/admin/finance/withdrawals/proof" ||
    path === "/api/profile/avatar" ||
    path === "/api/chat/images" ||
    path === "/api/admin/categories/image" ||
    path === "/api/admin/settings/logo" ||
    path === "/api/admin/appearance/og-image" ||
    path === "/api/admin/appearance/favicon" ||
    /^\/api\/admin\/banners\/[^/]+\/(?:image|mobile-image)$/.test(path) ||
    /^\/api\/admin\/news\/[^/]+\/cover$/.test(path) ||
    path === "/api/admin/about/cover" ||
    /^\/api\/admin\/orders\/[^/]+\/slip$/.test(path)
  );
}
export function createAPIHandler(service, { rateLimit, d1Catalog } = {}) {
  const attempts = new Map();
  const uploadAttempts = new Map();
  function localLimit(key) {
    const now = Date.now();
    if (attempts.size > 1000)
      for (const [k, v] of attempts) if (v.expires < now) attempts.delete(k);
    let hit = attempts.get(key);
    if (!hit || hit.expires < now) hit = { n: 0, expires: now + 60000 };
    attempts.set(key, hit);
    return ++hit.n <= 20;
  }
  const generic = new Map();
  /** Named limit: Durable Object storage on Cloudflare, memory locally. */
  function limit(key, max, windowMs) {
    if (rateLimit) return rateLimit(key, max, windowMs);
    const now = Date.now();
    if (generic.size > 1000)
      for (const [k, v] of generic) if (v.expires < now) generic.delete(k);
    let hit = generic.get(key);
    if (!hit || hit.expires < now) hit = { n: 0, expires: now + windowMs };
    generic.set(key, hit);
    return ++hit.n <= max;
  }
  /** Turnstile gate (no-op while Turnstile is not configured). */
  async function requireHuman(input, request, env) {
    const turnstile = service.turnstile;
    if (!turnstile?.enabled) return;
    const ok = await turnstile.verify(turnstileTokenFrom(input), clientIp(request, env));
    if (!ok) throw new ApiError(403, TURNSTILE_REJECTED);
  }
  function localUploadLimit(key) {
    const now = Date.now();
    if (uploadAttempts.size > 1000)
      for (const [k, v] of uploadAttempts)
        if (v.expires < now) uploadAttempts.delete(k);
    let hit = uploadAttempts.get(key);
    if (!hit || hit.expires < now) hit = { n: 0, expires: now + 600000 };
    uploadAttempts.set(key, hit);
    return ++hit.n <= 30;
  }
  const windowAttempts = new Map();
  function localWindowLimit(key, max, windowMs) {
    const now = Date.now();
    if (windowAttempts.size > 5000)
      for (const [k, v] of windowAttempts) if (v.expires < now) windowAttempts.delete(k);
    let hit = windowAttempts.get(key);
    if (!hit || hit.expires < now) hit = { n: 0, expires: now + windowMs };
    windowAttempts.set(key, hit);
    return ++hit.n <= max;
  }
  function assertCouponRate(request, env, user) {
    const ip = createHash("sha256")
      .update(clientIp(request, env) ?? "local")
      .digest("hex")
      .slice(0, 32);
    const { perUser, perIp, windowMs } = COUPON_RATE_LIMIT;
    for (const [key, max] of [
      ["coupon:user:" + user.id, perUser],
      ["coupon:ip:" + ip, perIp],
    ]) {
      const allowed = rateLimit
        ? rateLimit(key, max, windowMs)
        : localWindowLimit(key, max, windowMs);
      if (!allowed)
        throw new ApiError(
          429,
          "ลองโค้ดส่วนลดบ่อยเกินไป กรุณารอ 10 นาทีแล้วลองใหม่",
        );
    }
  }
  /** "แจ้งเตือนเมื่อมีของ": subscribe + cancel share one budget per signed-in customer. */
  function assertStockWatchRate(user) {
    if (!user) throw new ApiError(401, "กรุณาเข้าสู่ระบบก่อนดำเนินการ");
    const { perUser, windowMs } = STOCK_WATCH_RATE_LIMIT;
    const key = "stock-watch:user:" + user.id;
    const allowed = rateLimit
      ? rateLimit(key, perUser, windowMs)
      : localWindowLimit(key, perUser, windowMs);
    if (!allowed)
      throw new ApiError(429, "กดแจ้งเตือนบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่");
  }
  /** Client IP for the audit trail: Cloudflare header, then proxy header, then the socket. */
  function clientIp(request, env) {
    const value =
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For")?.split(",")[0] ??
      env?.ip ??
      null;
    return value ? String(value).trim().slice(0, 64) || null : null;
  }
  return async function handle(request, env = {}) {
    const url = new URL(request.url),
      path = url.pathname;
    const send = (status, data, extra = {}) =>
      Response.json(data, {
        status,
        headers: { ...securityHeaders, "Cache-Control": "no-store", ...extra },
      });
    try {
      // Daily alert summary, triggered lazily (at most once a minute, once a day after 21:00
      // Bangkok). The Durable Object also has an alarm for quiet evenings.
      try {
        service.alertsTick?.();
      } catch {
        // never block a request on the summary
      }
      if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method))
        return send(405, { error: "Method not allowed" });
      const mutating = ["POST", "PATCH", "DELETE"].includes(request.method);
      const imageUpload = isImageUploadPath(request.method, path);
      if (mutating) {
        if (request.headers.get("X-Astra-Request") !== "1")
          throw new ApiError(403, "ข้อมูลคำขอไม่ถูกต้อง");
        const origin = request.headers.get("Origin");
        if (origin && !sameLocalOrigin(origin, url.origin))
          throw new ApiError(403, "ไม่อนุญาตคำขอจากเว็บไซต์อื่น");
        if (
          request.method !== "DELETE" &&
          !imageUpload &&
          !request.headers.get("Content-Type")?.startsWith("application/json")
        )
          throw new ApiError(415, "ต้องส่งข้อมูลแบบ JSON");
      }
      if (request.method === "GET" && d1Catalog) {
        if (path === "/api/d1/products")
          return send(200, {
            products: d1Catalog.listProducts(),
            storage: d1Catalog.storageKind,
          });
        if (/^\/api\/d1\/products\/[^/]+$/.test(path)) {
          let d1ProductId;
          try {
            d1ProductId = decodeURIComponent(path.split("/")[4]);
          } catch {
            throw new ApiError(400, "รหัสสินค้าไม่ถูกต้อง");
          }
          return send(200, {
            product: d1Catalog.getProduct(d1ProductId),
            storage: d1Catalog.storageKind,
          });
        }
        if (path === "/api/d1/inventory/secrets")
          return send(403, { error: "ไม่อนุญาตให้อ่านรหัสสินค้า" });
      }
      const token = /(?:^|;\s*)astra_session=([a-f0-9]+)/.exec(
        request.headers.get("Cookie") ?? "",
      )?.[1];
      const user = service.session(token);
      let input = {};
      let uploadBytes = null;
      const jsonLimit =
        path === "/api/admin/settings" && user?.role === "ADMIN"
          ? MAX_SETTINGS_BYTES
          : (path === "/api/admin/appearance" || path === "/api/admin/about" || /^\/api\/admin\/news(?:\/[^/]+)?$/.test(path)) &&
              user?.role === "ADMIN"
            ? MAX_APPEARANCE_BYTES
          : reconUploadPaths.includes(path) && user?.role === "ADMIN"
            ? MAX_RECON_JSON_BYTES
            : MAX_JSON_BYTES;
      if (mutating) {
        const length = Number(request.headers.get("Content-Length") ?? 0);
        const maxBytes = imageUpload ? MAX_UPLOAD_BYTES : jsonLimit;
        if (Number.isFinite(length) && length > maxBytes)
          throw new ApiError(413, "ข้อมูลมีขนาดใหญ่เกินไป");
        if (imageUpload) {
          if (!user) throw new ApiError(401, "กรุณาเข้าสู่ระบบ");
          const uploadKey = "upload:" + user.id;
          const allowed = rateLimit
            ? rateLimit(uploadKey, 30, 600000)
            : localUploadLimit(uploadKey);
          if (!allowed)
            throw new ApiError(
              429,
              "อัปโหลดบ่อยเกินไป กรุณาลองอีกครั้งในอีกสักครู่",
            );
          const chunks = [];
          let bytes = 0;
          const reader = request.body?.getReader();
          if (reader)
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > MAX_UPLOAD_BYTES) {
                await reader.cancel();
                throw new ApiError(413, "ข้อมูลมีขนาดใหญ่เกินไป");
              }
              chunks.push(value);
            }
          uploadBytes = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) {
            uploadBytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          input = {
            bytes: uploadBytes,
            contentType: request.headers.get("Content-Type") ?? "",
          };
        } else if (request.method === "DELETE" && length === 0) {
          input = {};
        } else {
          const reader = request.body?.getReader();
          const decoder = new TextDecoder();
          let text = "",
            bytes = 0;
          if (reader)
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > jsonLimit) {
                await reader.cancel();
                throw new ApiError(413, "ข้อมูลมีขนาดใหญ่เกินไป");
              }
              text += decoder.decode(value, { stream: true });
            }
          text += decoder.decode();
          try {
            input = JSON.parse(text || "{}");
            if (!input || typeof input !== "object" || Array.isArray(input))
              throw Error();
          } catch {
            throw new ApiError(400, "ข้อมูล JSON ไม่ถูกต้อง");
          }
        }
      }
      if (request.method === "POST" && authenticationPaths.includes(path)) {
        const bucket = request.headers.get("CF-Connecting-IP") ?? "local";
        if (!(rateLimit ? rateLimit(bucket) : localLimit(bucket)))
          throw new ApiError(
            429,
            "มีคำขอมากเกินไป กรุณาลองอีกครั้งในหนึ่งนาที",
          );
        // ip: login audit + "my devices" (stored masked); userAgent: coarse device label only.
        const ctx = {
          ip: clientIp(request, env),
          userAgent: request.headers.get("User-Agent") ?? "",
          // Verification link base when PUBLIC_BASE_URL is not set.
          origin: url.origin,
        };
        // Turnstile: register and every password login (not the 2FA step, not demo).
        if (path === "/api/login" || path === "/api/register")
          await requireHuman(input, request, env);
        const result =
          path === "/api/login"
            ? service.login(input, ctx)
            : path === "/api/login/totp"
              ? service.loginTotp(input, ctx)
              : path === "/api/register"
                ? service.register(input, ctx)
                : path === "/api/demo-merchant"
                  ? service.demoMerchant(ctx)
                  : service.demo(ctx);
        // Password OK but the account has 2FA: no cookie until /api/login/totp succeeds.
        if (result.needsTotp)
          return send(200, { needsTotp: true, challenge: result.challenge });
        return send(
          200,
          { user: result.user },
          {
            "Set-Cookie": `astra_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${result.maxAge ?? 604800}${url.protocol === "https:" ? "; Secure" : ""}`,
          },
        );
      }
      if (request.method === "POST" && accountRecoveryPaths.includes(path)) {
        const ip = clientIp(request, env);
        const ctx = { ip, origin: url.origin };
        const bucket = createHash("sha256")
          .update(String(request.headers.get("CF-Connecting-IP") ?? env?.ip ?? "local"))
          .digest("hex")
          .slice(0, 32);
        if (path === "/api/verify-email") {
          if (!limit("verify-email:" + bucket, 20, 900000))
            throw new ApiError(429, "มีคำขอมากเกินไป กรุณาลองอีกครั้งในอีก 15 นาที");
          return send(200, service.verifyEmail(input, ctx));
        }
        if (path === "/api/password/forgot") {
          if (!limit("pw-forgot:" + bucket, 5, 900000))
            throw new ApiError(429, "ขอลิงก์บ่อยเกินไป กรุณาลองอีกครั้งในอีก 15 นาที");
          if (!service.features?.passwordReset)
            throw new ApiError(404, "ระบบตั้งรหัสผ่านใหม่ทางอีเมลยังไม่เปิดใช้งาน กรุณาติดต่อร้าน");
          await requireHuman(input, request, env);
          return send(200, service.requestPasswordReset(input, ctx));
        }
        if (!limit("pw-reset:" + bucket, 10, 900000))
          throw new ApiError(429, "มีคำขอมากเกินไป กรุณาลองอีกครั้งในอีก 15 นาที");
        return send(200, service.resetPassword(input, ctx));
      }
      // Admin › สัญญาณผิดปกติ and › ข้อความอีเมล (server/fraud-template-routes.mjs).
      const fraudOrTemplate = routeFraudAndTemplates(service, { method: request.method, path, user, input, url });
      if (fraudOrTemplate) return send(...fraudOrTemplate);
      // Receipt settings + full tax invoices (server/tax-invoices.mjs).
      const taxInvoice = routeTaxInvoices(service, { method: request.method, path, user, input, url });
      if (taxInvoice) return send(...taxInvoice);
      // ใบเสร็จคำสั่งซื้อ request + account profiles (server/order-receipts.mjs).
      const orderReceipt = routeOrderReceipts(service, { method: request.method, path, user, input, url });
      if (orderReceipt) return send(...orderReceipt);
      if (request.method === "GET") {
        if (/^\/api\/files\/[^/]+$/.test(path)) {
          const file = await service.getFile(path.split("/")[3]);
          return new Response(file.bytes, {
            status: 200,
            headers: {
              ...securityHeaders,
              "Content-Type": file.mime,
              "X-Content-Type-Options": "nosniff",
              "Content-Disposition": "inline",
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        }
        if (path === "/api/health")
          return send(200, {
            ok: true,
            mode: service.mode ?? "sandbox",
            storage: service.storageKind ?? "local-sqlite",
            features: service.features ?? {},
            // Public by design (it is embedded in the page); null while Turnstile is off.
            turnstileSiteKey: service.turnstile?.siteKey ?? null,
          });
        if (path === "/api/live" && service.liveVersions)
          return send(200, { versions: service.liveVersions() });
        if (path === "/api/me")
          return send(200, {
            user: service.publicUser(user),
            features: service.features ?? {},
          });
        // Prices are per viewer (sale window, tag price, purchase limit left): pricing.mjs.
        if (path === "/api/products")
          return send(200, { products: service.products(user) });
        if (/^\/api\/products\/[^/]+$/.test(path)) {
          let productId;
          try {
            productId = decodeURIComponent(path.split("/")[3]);
          } catch {
            throw new ApiError(400, "รหัสสินค้าไม่ถูกต้อง");
          }
          return send(200, {
            product: service.productDetail(productId, user),
          });
        }
        if (path === "/api/overview") return send(200, service.overview());
        if (path === "/api/legal") return send(200, service.legal());
        if (path === "/api/faq") return send(200, service.faq());
        // ข่าวสารและกิจกรรม + เกี่ยวกับเรา (news.mjs, about.mjs): public, no session needed.
        if (path === "/api/news") return send(200, service.publicNews());
        if (/^\/api\/news\/[^/]+$/.test(path)) return send(200, service.publicNewsPost(path.split("/")[3]));
        if (path === "/api/about") return send(200, service.publicAbout());
        if (path === "/api/reviews")
          return send(200, { reviews: service.reviews() });
        if (path === "/api/stock-watch")
          return send(200, { watches: service.myStockWatches(user) });
        if (path === "/api/admin/reviews")
          return send(200, service.adminReviews(user, {
            rating: url.searchParams.get("rating") ?? undefined,
            product: url.searchParams.get("product") ?? undefined,
            reply: url.searchParams.get("reply") ?? undefined,
            hidden: url.searchParams.get("hidden") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
            limit: url.searchParams.get("limit") ?? undefined,
          }));
        if (path === "/api/orders")
          return send(200, { orders: service.orders(user) });
        if (/^\/api\/checkouts\/[^/]+$/.test(path))
          return send(200, service.checkout(user, path.split("/")[3]));
        if (/^\/api\/orders\/[^/]+$/.test(path))
          return send(200, service.orderDetail(user, path.split("/")[3]));
        if (/^\/api\/orders\/[^/]+\/receipt$/.test(path))
          return send(200, { receipt: service.orderReceipt(user, path.split("/")[3]) });
        if (path === "/api/staff/orders") {
          const page = service.staffOrders(user, {
            limit: url.searchParams.get("limit"),
            cursor: url.searchParams.get("cursor"),
          });
          return send(200, page);
        }
        if (path === "/api/ledger")
          return send(200, { entries: service.ledger(user) });
        if (path === "/api/payment-channel")
          return send(200, { channel: service.getPaymentChannel() });
        if (path === "/api/queue")
          return send(200, { queue: service.queueBoard(user) });
        if (path === "/api/queue/me")
          return send(200, { queue: service.myQueue(user) });
        if (path === "/api/chat/threads")
          return send(200, { threads: service.chatThreads(user, { q: url.searchParams.get("q") }) });
        if (/^\/api\/chat\/threads\/[^/]+\/messages$/.test(path))
          return send(200, {
            messages: service.chatMessages(user, path.split("/")[4]),
          });
        if (path === "/api/notifications")
          return send(200, {
            notifications: service.notifications(user),
          });
        if (path === "/api/admin/canned-replies")
          return send(200, service.cannedReplies(user, {
            threadId: url.searchParams.get("thread") ?? undefined,
          }));
        if (path === "/api/rankings/buyers")
          return send(200, {
            buyers: service.buyerRanking(user, {
              limit: url.searchParams.get("limit"),
              period: url.searchParams.get("period") ?? undefined,
            }),
          });
        if (path === "/api/admin")
          return send(200, service.adminOverview(user));
        if (path === "/api/admin/summary")
          return send(200, service.adminSummary(user, {
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
          }));
        if (path === "/api/admin/transactions") {
          const page = service.adminTransactions(user, {
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
            kind: url.searchParams.get("kind") ?? undefined,
            direction: url.searchParams.get("direction") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
            customer: url.searchParams.get("customer") ?? undefined,
            min: url.searchParams.get("min") ?? undefined,
            max: url.searchParams.get("max") ?? undefined,
            q: url.searchParams.get("q") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
            limit: url.searchParams.get("limit") ?? undefined,
            format: url.searchParams.get("format") ?? undefined,
          });
          if (page.csv != null)
            return new Response(page.csv, {
              status: 200,
              headers: {
                ...securityHeaders,
                "Content-Type": "text/csv; charset=utf-8",
                "Cache-Control": "no-store",
                "Content-Disposition":
                  'attachment; filename="transactions.csv"',
              },
            });
          return send(200, page);
        }
        if (/^\/api\/admin\/transactions\/[^/]+$/.test(path))
          return send(200, service.adminTransactionDetail(user, path.split("/")[4]));
        if (path === "/api/admin/team") return send(200, { team: service.team(user) });
        if (path === "/api/admin/alerts") return send(200, service.alertSettings(user));
        if (path === "/api/admin/backup") return send(200, service.backupStatus(user));
        if (path === "/api/admin/integrations")
          return send(200, service.adminIntegrations(user));
        if (path === "/api/account/totp") return send(200, service.totpStatus(user));
        if (path === "/api/account/sessions")
          return send(200, service.listSessions(user, token));
        if (path === "/api/account/privacy/export")
          return send(200, service.exportMyData(user));
        if (path === "/api/admin/privacy/requests")
          return send(
            200,
            service.adminPrivacyRequests(user, {
              status: url.searchParams.get("status") ?? undefined,
            }),
          );
        if (path === "/api/admin/health")
          return send(200, service.adminSystemHealth(user));
        // การเงิน › ปิดยอดรายวัน / ถอนเงิน / กระทบยอด (finance-close.mjs, finance-recon.mjs).
        if (path === "/api/admin/finance/days") {
          const result = service.adminFinanceDays(user, Object.fromEntries(url.searchParams));
          return result.csv != null ? financeCsv(result.csv, "daily-close.csv") : send(200, result);
        }
        if (path === "/api/admin/finance/withdrawals") {
          const result = service.adminWithdrawals(user, Object.fromEntries(url.searchParams));
          return result.csv != null ? financeCsv(result.csv, "withdrawals.csv") : send(200, result);
        }
        if (/^\/api\/admin\/finance\/withdrawals\/[^/]+\/proof$/.test(path)) {
          const file = await service.withdrawalProof(user, path.split("/")[5]);
          return new Response(file.bytes, {
            status: 200,
            headers: {
              ...securityHeaders,
              "Content-Type": file.mime,
              "Content-Disposition": "inline",
              "Cache-Control": "private, no-store",
            },
          });
        }
        if (path === "/api/admin/finance/reconciliations")
          return send(200, service.adminReconciliations(user));
        if (/^\/api\/admin\/finance\/reconciliations\/[^/]+$/.test(path)) {
          const result = service.reconciliationDetail(user, path.split("/")[5], Object.fromEntries(url.searchParams));
          return result.csv != null ? financeCsv(result.csv, "reconciliation.csv") : send(200, result);
        }
        if (path === "/api/admin/reports/sales") {
          const report = service.salesReport(user, {
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
            format: url.searchParams.get("format") ?? undefined,
          });
          if (report.csv != null)
            return new Response(report.csv, {
              status: 200,
              headers: {
                ...securityHeaders,
                "Content-Type": "text/csv; charset=utf-8",
                "Cache-Control": "no-store",
                "Content-Disposition": 'attachment; filename="sales-report.csv"',
              },
            });
          return send(200, report);
        }
        if (path === "/api/admin/broadcasts") return send(200, service.broadcastStatus(user));
        if (path === "/api/admin/broadcasts/preview")
          return send(
            200,
            service.broadcastPreview(user, Object.fromEntries(url.searchParams)),
          );
        if (path === "/api/categories")
          return send(200, { categories: service.publicCategories() });
        if (path === "/api/admin/categories")
          return send(200, service.adminCategories(user));
        if (path === "/api/admin/banners") return send(200, service.adminBanners(user));
        if (path === "/api/admin/appearance") return send(200, service.adminAppearance(user));
        if (path === "/api/admin/news") return send(200, service.adminNews(user));
        if (path === "/api/admin/about") return send(200, service.adminAbout(user));
        if (path === "/api/admin/reports/profit") {
          const report = service.profitReport(user, {
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
            format: url.searchParams.get("format") ?? undefined,
          });
          if (report.csv != null)
            return new Response(report.csv, {
              status: 200,
              headers: {
                ...securityHeaders,
                "Content-Type": "text/csv; charset=utf-8",
                "Cache-Control": "no-store",
                "Content-Disposition": 'attachment; filename="profit-report.csv"',
              },
            });
          return send(200, report);
        }
        if (path === "/api/admin/coupons")
          return send(200, service.adminCoupons(user, {
            q: url.searchParams.get("q") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
          }));
        if (/^\/api\/admin\/coupons\/[^/]+\/redemptions$/.test(path))
          return send(200, service.adminCouponRedemptions(user, path.split("/")[4]));
        if (/^\/api\/admin\/coupons\/[^/]+$/.test(path))
          return send(200, service.adminCoupon(user, path.split("/")[4]));
        if (/^\/api\/admin\/orders\/[^/]+\/payment-summary$/.test(path))
          return send(200, service.adminOrderPaymentSummary(user, path.split("/")[4]));
        if (path === "/api/admin/audit")
          return send(200, service.adminAuditLog(user, {
            action: url.searchParams.get("action") ?? undefined,
            scope: url.searchParams.get("scope") ?? undefined,
            actor: url.searchParams.get("actor") ?? undefined,
            entity: url.searchParams.get("entity") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
            limit: url.searchParams.get("limit") ?? undefined,
          }));
        if (path === "/api/admin/orders")
          return send(200, service.adminOrders(user, {
            status: url.searchParams.get("status") ?? undefined,
            group: url.searchParams.get("group") ?? undefined,
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
            product: url.searchParams.get("product") ?? undefined,
            customer: url.searchParams.get("customer") ?? undefined,
            type: url.searchParams.get("type") ?? undefined,
            q: url.searchParams.get("q") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
            limit: url.searchParams.get("limit") ?? undefined,
          }));
        if (/^\/api\/admin\/orders\/[^/]+$/.test(path))
          return send(200, service.adminOrderDetail(user, path.split("/")[4]));
        if (/^\/api\/admin\/orders\/[^/]+\/receipt$/.test(path))
          return send(200, { receipt: service.adminOrderReceipt(user, path.split("/")[4]) });
        // Live chat image: only the thread's customer or the team (chat-attachments.mjs).
        if (/^\/api\/chat\/files\/[^/]+$/.test(path)) {
          const file = await service.chatFile(user, path.split("/")[4]);
          return new Response(file.bytes, {
            status: 200,
            headers: {
              ...securityHeaders,
              "Content-Type": file.mime,
              "X-Content-Type-Options": "nosniff",
              "Content-Disposition": "inline",
              "Cache-Control": "private, max-age=86400",
            },
          });
        }
        // Transfer slip of an admin-created order: ADMIN only, never cached or public.
        if (/^\/api\/admin\/orders\/[^/]+\/slip$/.test(path)) {
          const file = await service.adminManualOrderSlip(user, path.split("/")[4]);
          return new Response(file.bytes, {
            status: 200,
            headers: {
              ...securityHeaders,
              "Content-Type": file.mime,
              "Content-Disposition": "inline",
              "Cache-Control": "private, no-store",
            },
          });
        }
        if (/^\/api\/admin\/customers\/[^/]+$/.test(path))
          return send(200, service.adminCustomerDetail(user, path.split("/")[4]));
        if (path === "/api/admin/customers")
          return send(200, service.adminCustomers(user, {
            q: url.searchParams.get("q") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
            minSpent: url.searchParams.get("minSpent") ?? undefined,
            maxSpent: url.searchParams.get("maxSpent") ?? undefined,
            hasOrders: url.searchParams.get("hasOrders") ?? undefined,
            tag: url.searchParams.get("tag") ?? undefined,
            sort: url.searchParams.get("sort") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
            limit: url.searchParams.get("limit") ?? undefined,
          }));
        if (path === "/api/admin/products")
          return send(200, service.adminProducts(user, {
            q: url.searchParams.get("q") ?? undefined,
            category: url.searchParams.get("category") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
            type: url.searchParams.get("type") ?? undefined,
            stock: url.searchParams.get("stock") ?? undefined,
            sort: url.searchParams.get("sort") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
            limit: url.searchParams.get("limit") ?? undefined,
          }));
        if (/^\/api\/admin\/products\/[^/]+\/variants$/.test(path))
          return send(
            200,
            service.adminProductVariants(user, path.split("/")[4]),
          );
        // Pricing rules + customer tags (pricing.mjs).
        if (/^\/api\/admin\/products\/[^/]+\/pricing$/.test(path))
          return send(200, service.adminProductPricing(user, path.split("/")[4]));
        // Preorder mode of one product: full / deposit / free (preorder.mjs).
        if (/^\/api\/admin\/products\/[^/]+\/preorder$/.test(path))
          return send(200, service.adminPreorderSettings(user, path.split("/")[4]));
        // Delivery type + checkout fields of one product (delivery.mjs).
        if (/^\/api\/admin\/products\/[^/]+\/delivery$/.test(path))
          return send(200, service.adminDelivery(user, path.split("/")[4]));
        // Option groups + variant mapping (option-groups.mjs).
        if (/^\/api\/admin\/products\/[^/]+\/options$/.test(path))
          return send(200, service.adminOptionGroups(user, path.split("/")[4]));
        // One shared account / invite link with its seats (masked).
        if (/^\/api\/admin\/seat-groups\/[^/]+$/.test(path))
          return send(200, service.adminSeatGroup(user, path.split("/")[4]));
        // Paid orders of shop-fulfilled products waiting to be sent.
        if (path === "/api/admin/fulfilment")
          return send(200, service.fulfilmentQueue(user));
        if (path === "/api/admin/customer-tags")
          return send(200, service.adminCustomerTags(user));
        if (/^\/api\/admin\/variants\/[^/]+\/inventory$/.test(path))
          return send(
            200,
            service.adminVariantInventory(user, path.split("/")[4], {
              status: url.searchParams.get("status") ?? undefined,
              cursor: url.searchParams.get("cursor") ?? undefined,
              limit: url.searchParams.get("limit") ?? undefined,
            }),
          );
        if (path === "/api/admin/inventory/expiring")
          return send(
            200,
            service.adminExpiringInventory(user, {
              limit: url.searchParams.get("limit") ?? undefined,
            }),
          );
      } else if (request.method === "PATCH") {
        if (/^\/api\/admin\/inventory\/[^/]+$/.test(path))
          return send(200, service.updateInventoryUnit(user, path.split("/")[4], input));
        if (/^\/api\/admin\/canned-replies\/[^/]+$/.test(path))
          return send(200, service.adminUpdateCannedReply(user, path.split("/")[4], input));
        if (/^\/api\/admin\/categories\/[^/]+$/.test(path))
          return send(200, service.adminUpdateCategory(user, path.split("/")[4], input));
        if (/^\/api\/admin\/banners\/[^/]+$/.test(path))
          return send(200, service.adminUpdateBanner(user, path.split("/")[4], input));
        if (/^\/api\/admin\/news\/[^/]+$/.test(path))
          return send(200, service.adminUpdateNews(user, path.split("/")[4], input));
        if (/^\/api\/admin\/coupons\/[^/]+$/.test(path))
          return send(200, service.adminUpdateCoupon(user, path.split("/")[4], input));
        if (/^\/api\/admin\/products\/[^/]+\/images$/.test(path))
          return send(
            200,
            service.reorderProductImages(user, path.split("/")[4], input),
          );
        if (/^\/api\/admin\/variants\/[^/]+$/.test(path))
          return send(
            200,
            service.updateVariant(user, path.split("/")[4], input, { origin: url.origin }),
          );
        if (/^\/api\/admin\/variants\/[^/]+\/pricing$/.test(path))
          return send(200, service.adminSetVariantPricing(user, path.split("/")[4], input));
        if (/^\/api\/admin\/products\/[^/]+\/limit$/.test(path))
          return send(200, service.adminSetProductLimit(user, path.split("/")[4], input));
        if (/^\/api\/admin\/products\/[^/]+\/preorder$/.test(path))
          return send(200, service.adminSavePreorderSettings(user, path.split("/")[4], input));
        if (/^\/api\/admin\/products\/[^/]+\/delivery$/.test(path))
          return send(200, service.adminSetDelivery(user, path.split("/")[4], input));
        if (/^\/api\/admin\/products\/[^/]+\/options$/.test(path))
          return send(200, service.adminSaveOptionGroups(user, path.split("/")[4], input));
        if (/^\/api\/admin\/products\/[^/]+\/variants\/bulk$/.test(path))
          return send(200, service.adminBulkVariants(user, path.split("/")[4], input));
        if (/^\/api\/admin\/seat-groups\/[^/]+$/.test(path))
          return send(200, service.adminSetSeatCount(user, path.split("/")[4], input));
        if (/^\/api\/admin\/seat-groups\/[^/]+\/login$/.test(path))
          return send(200, service.adminUpdateGroupLogin(user, path.split("/")[4], input));
        if (/^\/api\/admin\/seats\/[^/]+$/.test(path))
          return send(200, service.adminUpdateSeat(user, path.split("/")[4], input));
        if (/^\/api\/admin\/customers\/[^/]+\/tags$/.test(path))
          return send(200, service.adminSetCustomerTags(user, path.split("/")[4], input));
        return send(404, { error: "ไม่พบหน้าที่ร้องขอ" });
      } else if (request.method === "DELETE") {
        if (/^\/api\/account\/sessions\/[^/]+$/.test(path)) {
          const result = service.revokeSession(user, token, path.split("/")[4]);
          // Signing out the device making the request also clears its cookie.
          return send(
            200,
            result,
            result.current
              ? {
                  "Set-Cookie": `astra_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${url.protocol === "https:" ? "; Secure" : ""}`,
                }
              : {},
          );
        }
        if (/^\/api\/admin\/canned-replies\/[^/]+$/.test(path))
          return send(200, service.adminDeleteCannedReply(user, path.split("/")[4]));
        // ?moveTo=<id>: move the category's products there, then delete (one transaction).
        if (/^\/api\/admin\/categories\/[^/]+$/.test(path))
          return send(
            200,
            service.adminDeleteCategory(user, path.split("/")[4], {
              moveTo: url.searchParams.get("moveTo") ?? undefined,
            }),
          );
        if (/^\/api\/admin\/product-images\/[^/]+$/.test(path))
          return send(
            200,
            await service.deleteProductImage(user, path.split("/")[4]),
          );
        if (/^\/api\/admin\/banners\/[^/]+\/mobile-image$/.test(path))
          return send(200, await service.adminRemoveBannerMobileImage(user, path.split("/")[4]));
        if (/^\/api\/admin\/banners\/[^/]+$/.test(path))
          return send(200, await service.adminDeleteBanner(user, path.split("/")[4]));
        if (/^\/api\/admin\/news\/[^/]+\/cover$/.test(path))
          return send(200, await service.adminRemoveNewsCover(user, path.split("/")[4]));
        if (/^\/api\/admin\/news\/[^/]+$/.test(path))
          return send(200, await service.adminDeleteNews(user, path.split("/")[4]));
        if (path === "/api/admin/about/cover") return send(200, await service.removeAboutCover(user));
        if (path === "/api/profile/avatar")
          return send(200, await service.removeAvatar(user));
        if (path === "/api/admin/settings/logo")
          return send(200, await service.removeLogo(user));
        if (path === "/api/admin/appearance/og-image")
          return send(200, await service.removeAppearanceImage(user, "og"));
        if (path === "/api/admin/appearance/favicon")
          return send(200, await service.removeAppearanceImage(user, "favicon"));
        if (/^\/api\/stock-watch\/[^/]+$/.test(path)) {
          assertStockWatchRate(user);
          let variantId;
          try {
            variantId = decodeURIComponent(path.split("/")[3]);
          } catch {
            throw new ApiError(400, "ตัวเลือกสินค้าไม่ถูกต้อง");
          }
          return send(200, service.removeStockWatch(user, variantId));
        }
        if (/^\/api\/admin\/variants\/[^/]+$/.test(path))
          return send(200, service.deleteVariant(user, path.split("/")[4]));
        if (/^\/api\/admin\/customer-tags\/[^/]+$/.test(path)) {
          let tag;
          try {
            tag = decodeURIComponent(path.split("/")[4]);
          } catch {
            throw new ApiError(400, "ชื่อแท็กไม่ถูกต้อง");
          }
          return send(200, service.adminDeleteCustomerTag(user, tag));
        }
        if (/^\/api\/admin\/inventory\/[^/]+$/.test(path))
          return send(
            200,
            service.deleteInventoryUnit(user, path.split("/")[4]),
          );
        return send(404, { error: "ไม่พบหน้าที่ร้องขอ" });
      } else {
        if (path === "/api/logout") {
          service.logout(token);
          return send(
            200,
            { ok: true },
            {
              "Set-Cookie": `astra_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${url.protocol === "https:" ? "; Secure" : ""}`,
            },
          );
        }
        if (path === "/api/coupons/check") {
          if (!user) throw new ApiError(401, "กรุณาเข้าสู่ระบบเพื่อใช้โค้ดส่วนลด");
          assertCouponRate(request, env, user);
          return send(200, service.checkCoupon(user, input));
        }
        if (path === "/api/orders") {
          // A code sent with the order is a guess too: same budget as /coupons/check.
          if (user && typeof input.couponCode === "string" && input.couponCode.trim())
            assertCouponRate(request, env, user);
          return send(201, service.createOrder(user, input));
        }
        if (path === "/api/admin/broadcasts")
          return send(201, service.sendBroadcast(user, input, { origin: url.origin }));
        if (path === "/api/admin/categories")
          return send(201, service.adminCreateCategory(user, input));
        if (path === "/api/admin/categories/reorder")
          return send(200, service.adminReorderCategories(user, input));
        if (path === "/api/admin/banners")
          return send(201, service.adminCreateBanner(user, input));
        if (path === "/api/admin/news") return send(201, service.adminCreateNews(user, input));
        if (/^\/api\/admin\/news\/[^/]+\/cover$/.test(path))
          return send(200, await service.adminSetNewsCover(user, path.split("/")[4], input));
        if (path === "/api/admin/about") return send(200, service.saveAbout(user, input));
        if (path === "/api/admin/about/reset") return send(200, await service.resetAbout(user));
        if (path === "/api/admin/about/cover") return send(200, await service.setAboutCover(user, input));
        if (path === "/api/admin/banners/reorder")
          return send(200, service.adminReorderBanners(user, input));
        if (/^\/api\/admin\/banners\/[^/]+\/(?:image|mobile-image)$/.test(path)) {
          const [, , , , bannerId, slot] = path.split("/");
          return send(
            200,
            await service.adminSetBannerImage(user, bannerId, input, slot === "mobile-image" ? "mobile" : "main"),
          );
        }
        if (path === "/api/admin/coupons")
          return send(201, service.adminCreateCoupon(user, input));
        if (/^\/api\/admin\/coupons\/[^/]+\/disable$/.test(path))
          return send(200, service.adminDisableCoupon(user, path.split("/")[4]));
        if (/^\/api\/admin\/coupons\/[^/]+\/duplicate$/.test(path))
          return send(201, service.adminDuplicateCoupon(user, path.split("/")[4]));
        if (path === "/api/checkouts") {
          if (user && typeof input.couponCode === "string" && input.couponCode.trim())
            assertCouponRate(request, env, user);
          return send(201, service.createCheckout(user, input, { origin: url.origin }));
        }
        if (path === "/api/checkouts/coupon") {
          if (!user) throw new ApiError(401, "กรุณาเข้าสู่ระบบเพื่อใช้โค้ดส่วนลด");
          assertCouponRate(request, env, user);
          return send(200, service.checkoutCoupon(user, input));
        }
        if (/^\/api\/checkouts\/[^/]+\/pay$/.test(path))
          return send(200, service.payCheckout(user, path.split("/")[3], input, { origin: url.origin }));
        if (/^\/api\/orders\/[^/]+\/pay$/.test(path))
          return send(
            200,
            service.pay(user, path.split("/")[3], input, { origin: url.origin }),
          );
        if (/^\/api\/orders\/[^/]+\/retry$/.test(path))
          return send(200, service.retry(user, path.split("/")[3]));
        // Preorder queue (preorder.mjs): customer leaves the queue; staff call; admin cancel.
        if (/^\/api\/orders\/[^/]+\/cancel$/.test(path))
          return send(200, service.cancelMyPreorder(user, path.split("/")[3], input));
        if (path === "/api/admin/preorders/call")
          return send(200, service.adminCallPreorders(user, input));
        if (/^\/api\/admin\/preorders\/[^/]+\/cancel$/.test(path))
          return send(200, service.adminCancelPreorder(user, path.split("/")[4], input));
        if (path === "/api/topup")
          return send(200, { user: service.topup(user, input) });
        if (path === "/api/profile")
          return send(200, { user: service.profile(user, input) });
        // Email verification: new link / change the address (email-verification.mjs).
        if (path === "/api/verify-email/resend")
          return send(200, service.resendEmailVerification(user, { origin: url.origin }));
        if (path === "/api/verify-email/change")
          return send(200, service.changeEmail(user, input, { origin: url.origin }));
        if (path === "/api/account/privacy/delete")
          return send(201, service.requestAccountDeletion(user, input));
        if (/^\/api\/admin\/privacy\/requests\/[^/]+\/approve$/.test(path))
          return send(
            200,
            service.approvePrivacyDeletion(user, path.split("/")[5], input),
          );
        if (/^\/api\/admin\/privacy\/requests\/[^/]+\/reject$/.test(path))
          return send(200, service.rejectPrivacyRequest(user, path.split("/")[5]));
        // Wipe test-mode customers / orders before go-live (launch-cleanup.mjs). Default dryRun.
        if (path === "/api/admin/launch/cleanup")
          return send(200, service.adminLaunchCleanup(user, input));
        if (path === "/api/reviews")
          return send(201, service.addReview(user, input));
        if (path === "/api/stock-watch") {
          assertStockWatchRate(user);
          return send(201, service.addStockWatch(user, input));
        }
        if (/^\/api\/admin\/reviews\/[^/]+\/reply$/.test(path))
          return send(200, { review: service.replyToReview(user, path.split("/")[4], input) });
        if (/^\/api\/admin\/reviews\/[^/]+\/hide$/.test(path))
          return send(200, { review: service.hideReview(user, path.split("/")[4], input) });
        if (/^\/api\/admin\/reviews\/[^/]+\/unhide$/.test(path))
          return send(200, { review: service.unhideReview(user, path.split("/")[4]) });
        if (path === "/api/chat/threads")
          return send(201, service.openChatThread(user, input));
        if (/^\/api\/chat\/threads\/[^/]+\/messages$/.test(path))
          return send(201, {
            messages: service.postChatMessage(
              user,
              path.split("/")[4],
              input,
            ),
          });
        if (/^\/api\/chat\/threads\/[^/]+\/close$/.test(path))
          return send(200, {
            thread: service.closeChatThread(user, path.split("/")[4]),
          });
        if (/^\/api\/notifications\/[^/]+\/read$/.test(path))
          return send(200, service.markNotificationRead(user, path.split("/")[3]));
        if (path === "/api/admin/team") return send(200, service.saveStaff(user, input));
        if (/^\/api\/admin\/team\/[^/]+\/role$/.test(path))
          return send(200, service.setMemberRole(user, path.split("/")[4], input));
        if (/^\/api\/admin\/team\/[^/]+\/active$/.test(path))
          return send(200, service.setStaffActive(user, path.split("/")[4], input));
        if (/^\/api\/chat\/threads\/[^/]+\/assign$/.test(path))
          return send(200, { thread: service.assignChatThread(user, path.split("/")[4], input) });
        if (/^\/api\/chat\/threads\/[^/]+\/pin$/.test(path))
          return send(200, { thread: service.pinChatThread(user, path.split("/")[4], input) });
        // Append-only internal notes; /note kept for older clients (also appends).
        if (/^\/api\/admin\/orders\/[^/]+\/notes?$/.test(path))
          return send(200, service.adminAddOrderNote(user, path.split("/")[4], input));
        // Order for a customer who paid outside the site (manual-orders.mjs).
        if (path === "/api/admin/manual-orders/quote")
          return send(200, service.adminManualOrderQuote(user, input));
        if (path === "/api/admin/manual-orders")
          return send(201, service.adminCreateManualOrder(user, input, { origin: url.origin }));
        if (/^\/api\/admin\/orders\/[^/]+\/slip$/.test(path))
          return send(200, await service.adminSetManualOrderSlip(user, path.split("/")[4], input));
        if (/^\/api\/admin\/orders\/[^/]+\/refund$/.test(path))
          return send(200, service.refundOrder(user, path.split("/")[4], input));
        if (/^\/api\/admin\/customers\/[^/]+\/credit$/.test(path))
          return send(200, service.adjustCustomerCredit(user, path.split("/")[4], input));
        if (/^\/api\/admin\/orders\/[^/]+\/cancel$/.test(path))
          return send(200, service.adminCancelOrder(user, path.split("/")[4], input));
        // Bulk: dry run / export only read; cancel / resend run per order (admin-order-bulk.mjs).
        if (path === "/api/admin/orders/bulk")
          return send(
            200,
            input.dryRun === true || input.action === "export"
              ? service.adminBulkOrderCheck(user, input)
              : service.adminBulkOrderAction(user, input),
          );
        if (path === "/api/admin/canned-replies")
          return send(201, service.adminCreateCannedReply(user, input));
        if (path === "/api/admin/canned-replies/reorder")
          return send(200, service.adminReorderCannedReplies(user, input));
        if (/^\/api\/admin\/orders\/[^/]+\/replace$/.test(path))
          return send(
            200,
            service.replaceOrderCredential(user, path.split("/")[4], input),
          );
        if (/^\/api\/admin\/products\/[^/]+\/options\/enable$/.test(path))
          return send(200, service.adminEnableOptionGroups(user, path.split("/")[4], input));
        if (/^\/api\/admin\/products\/[^/]+\/options\/disable$/.test(path))
          return send(200, service.adminDisableOptionGroups(user, path.split("/")[4]));
        if (/^\/api\/admin\/orders\/[^/]+\/fulfil$/.test(path))
          return send(200, service.fulfilOrder(user, path.split("/")[4], input));
        if (/^\/api\/admin\/orders\/[^/]+\/resend-credentials$/.test(path))
          return send(200, service.resendOrderCredentials(user, path.split("/")[4]));
        if (/^\/api\/admin\/orders\/[^/]+\/reveal$/.test(path))
          return send(
            200,
            service.adminRevealOrderCredentials(user, path.split("/")[4], input),
          );
        if (/^\/api\/admin\/customers\/[^/]+$/.test(path))
          return send(200, service.adminUpdateCustomer(user, path.split("/")[4], input));
        if (/^\/api\/admin\/customers\/[^/]+\/status$/.test(path))
          return send(200, service.adminSetCustomerStatus(user, path.split("/")[4], input));
        if (/^\/api\/admin\/customers\/[^/]+\/reset-password$/.test(path))
          return send(200, service.adminResetCustomerPassword(user, path.split("/")[4]));
        if (/^\/api\/admin\/customers\/[^/]+\/sign-out$/.test(path))
          return send(200, service.adminSignOutCustomer(user, path.split("/")[4]));
        if (/^\/api\/admin\/customers\/[^/]+\/verify-email$/.test(path))
          return send(200, service.adminVerifyCustomerEmail(user, path.split("/")[4]));
        if (path === "/api/admin/customer-tags")
          return send(200, service.adminSaveCustomerTag(user, input));
        if (path === "/api/admin/payment-channel") {
          // Sensitive: the admin re-enters their password (input.currentPassword).
          service.reauthAdmin(user, input);
          return send(200, {
            channel: service.setPaymentChannel(user, input),
          });
        }
        if (path === "/api/account/sessions/revoke-others")
          return send(200, service.revokeOtherSessions(user, token));
        // Alert secrets: password again; links in messages use this request's origin.
        if (path === "/api/admin/alerts")
          return send(200, service.saveAlertSettings(user, input, { origin: url.origin }));
        if (path === "/api/admin/alerts/test")
          return send(200, await service.testAlert(user, input));
        if (path === "/api/admin/backup/run")
          return send(200, await service.runBackupNow(user, input));
        if (path === "/api/admin/backup/export") {
          // Password again + BACKUP_EXPORT audit row, then a gzip stream (backup.mjs).
          const backup = service.exportBackup(user, input);
          return new Response(backup.stream, {
            status: 200,
            headers: {
              ...securityHeaders,
              "Content-Type": "application/gzip",
              "Cache-Control": "no-store",
              "Content-Disposition": `attachment; filename="${backup.filename}"`,
            },
          });
        }
        if (path === "/api/account/totp/setup")
          return send(200, service.totpSetup(user, input));
        if (path === "/api/account/totp/enable")
          return send(200, service.totpEnable(user, input));
        if (path === "/api/account/totp/disable")
          return send(200, service.totpDisable(user, input));
        if (path === "/api/admin/inventory")
          // dryRun only reads, so it skips the live "catalog changed" signal.
          return send(
            200,
            input?.dryRun === true
              ? service.previewImportCodes(user, input)
              : service.importCodes(user, input, { origin: url.origin }),
          );
        if (path === "/api/admin/products/bulk")
          return send(200, service.bulkUpdateProducts(user, input, { origin: url.origin }));
        if (/^\/api\/admin\/products\/[^/]+\/duplicate$/.test(path))
          return send(201, service.duplicateProduct(user, path.split("/")[4]));
        // Full ID + password of one stock unit (ADMIN, audited). POST so it is never cached.
        if (/^\/api\/admin\/inventory\/[^/]+\/reveal$/.test(path))
          return send(200, service.revealInventoryUnit(user, path.split("/")[4]));
        if (/^\/api\/admin\/inventory\/[^/]+\/defect$/.test(path))
          return send(
            200,
            service.markInventoryDefect(user, path.split("/")[4], input),
          );
        if (/^\/api\/admin\/products\/[^/]+\/variants$/.test(path))
          return send(
            201,
            service.createVariant(user, path.split("/")[4], input),
          );
        if (/^\/api\/admin\/reservations\/[^/]+\/deliver$/.test(path))
          return send(
            200,
            service.deliverReservation(user, path.split("/")[4], {
              origin: url.origin,
            }),
          );
        if (path === "/api/admin/settings")
          return send(200, service.saveSettings(user, input));
        if (path === "/api/admin/appearance")
          return send(200, service.saveAppearance(user, input));
        if (path === "/api/admin/appearance/reset")
          return send(200, await service.resetAppearance(user, input));
        if (path === "/api/admin/finance/days/close")
          return send(200, service.closeFinanceDay(user, input));
        if (path === "/api/admin/finance/days/adjust")
          return send(200, service.adjustFinanceDay(user, input));
        if (path === "/api/admin/finance/withdrawals/proof")
          return send(200, await service.uploadWithdrawalProof(user, input));
        if (path === "/api/admin/finance/withdrawals")
          return send(200, service.recordWithdrawal(user, input));
        if (/^\/api\/admin\/finance\/withdrawals\/[^/]+\/reverse$/.test(path))
          return send(200, service.reverseWithdrawal(user, path.split("/")[5], input));
        if (path === "/api/admin/finance/reconciliations/preview")
          return send(200, service.previewReconciliation(user, input));
        if (path === "/api/admin/finance/reconciliations")
          return send(200, service.createReconciliation(user, input));
        if (/^\/api\/admin\/finance\/reconciliations\/[^/]+\/(match|unmatch|complete)$/.test(path)) {
          const [, , , , , runId, action] = path.split("/");
          const call =
            action === "match"
              ? service.matchReconRow
              : action === "unmatch"
                ? service.unmatchReconRow
                : service.completeReconciliation;
          return send(200, call(user, runId, input));
        }
        if (path === "/api/admin/settings/logo")
          return send(200, await service.setLogo(user, input));
        if (path === "/api/admin/appearance/og-image")
          return send(200, await service.setAppearanceImage(user, "og", input));
        if (path === "/api/admin/appearance/favicon")
          return send(200, await service.setAppearanceImage(user, "favicon", input));
        if (path === "/api/profile/avatar")
          return send(200, await service.setAvatar(user, input));
        if (path === "/api/chat/images")
          return send(201, await service.uploadChatImage(user, input));
        if (path === "/api/admin/categories/image")
          return send(201, await service.adminUploadCategoryImage(user, input));
        if (path === "/api/admin/products")
          return send(200, service.saveProduct(user, input, { origin: url.origin }));
        if (/^\/api\/admin\/products\/[^/]+\/images$/.test(path))
          return send(
            200,
            await service.addProductImage(user, path.split("/")[4], input),
          );
      }
      return send(404, { error: "ไม่พบหน้าที่ร้องขอ" });
    } catch (error) {
      if (!(error instanceof ApiError))
        console.error("Request failed:", error.message);
      return send(error instanceof ApiError ? error.status : 500, {
        error:
          error instanceof ApiError
            ? error.message
            : "ระบบไม่สามารถทำรายการได้ กรุณาลองอีกครั้ง",
      });
    }
  };
}
