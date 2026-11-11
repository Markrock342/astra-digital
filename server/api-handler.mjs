import { ApiError } from "./domain.mjs";
export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
export const authenticationPaths = [
  "/api/login",
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
export function createAPIHandler(service, { rateLimit, d1Catalog } = {}) {
  const attempts = new Map();
  function localLimit(key) {
    const now = Date.now();
    if (attempts.size > 1000)
      for (const [k, v] of attempts) if (v.expires < now) attempts.delete(k);
    let hit = attempts.get(key);
    if (!hit || hit.expires < now) hit = { n: 0, expires: now + 60000 };
    attempts.set(key, hit);
    return ++hit.n <= 20;
  }
  return async function handle(request) {
    const url = new URL(request.url),
      path = url.pathname;
    const send = (status, data, extra = {}) =>
      Response.json(data, {
        status,
        headers: { ...securityHeaders, "Cache-Control": "no-store", ...extra },
      });
    try {
      if (!["GET", "POST"].includes(request.method))
        return send(405, { error: "Method not allowed" });
      if (request.method === "POST") {
        if (request.headers.get("X-Astra-Request") !== "1")
          throw new ApiError(403, "ข้อมูลคำขอไม่ถูกต้อง");
        const origin = request.headers.get("Origin");
        if (origin && !sameLocalOrigin(origin, url.origin))
          throw new ApiError(403, "ไม่อนุญาตคำขอจากเว็บไซต์อื่น");
        if (
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
      if (request.method === "POST") {
        const length = Number(request.headers.get("Content-Length") ?? 0);
        if (length > 32768) throw new ApiError(413, "ข้อมูลมีขนาดใหญ่เกินไป");
        const reader = request.body?.getReader();
        const decoder = new TextDecoder();
        let text = "",
          bytes = 0;
        if (reader)
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 32768) {
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
      if (request.method === "POST" && authenticationPaths.includes(path)) {
        const bucket = request.headers.get("CF-Connecting-IP") ?? "local";
        if (!(rateLimit ? rateLimit(bucket) : localLimit(bucket)))
          throw new ApiError(
            429,
            "มีคำขอมากเกินไป กรุณาลองอีกครั้งในหนึ่งนาที",
          );
        const result =
          path === "/api/login"
            ? service.login(input)
            : path === "/api/register"
              ? service.register(input)
              : path === "/api/demo-merchant"
                ? service.demoMerchant()
                : service.demo();
        return send(
          200,
          { user: result.user },
          {
            "Set-Cookie": `astra_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${url.protocol === "https:" ? "; Secure" : ""}`,
          },
        );
      }
      if (request.method === "GET") {
        if (path === "/api/health")
          return send(200, {
            ok: true,
            mode: service.mode ?? "sandbox",
            storage: service.storageKind ?? "local-sqlite",
          });
        if (path === "/api/me")
          return send(200, { user: service.publicUser(user) });
        if (path === "/api/products")
          return send(200, { products: service.products() });
        if (/^\/api\/products\/[^/]+$/.test(path)) {
          let productId;
          try {
            productId = decodeURIComponent(path.split("/")[3]);
          } catch {
            throw new ApiError(400, "รหัสสินค้าไม่ถูกต้อง");
          }
          return send(200, {
            product: service.productDetail(productId),
          });
        }
        if (path === "/api/overview") return send(200, service.overview());
        if (path === "/api/reviews")
          return send(200, { reviews: service.reviews() });
        if (path === "/api/orders")
          return send(200, { orders: service.orders(user) });
        if (/^\/api\/orders\/[^/]+$/.test(path))
          return send(200, service.orderDetail(user, path.split("/")[3]));
        if (path === "/api/staff/orders")
          return send(200, { orders: service.staffOrders(user) });
        if (path === "/api/ledger")
          return send(200, { entries: service.ledger(user) });
        if (path === "/api/payment-channel")
          return send(200, { channel: service.getPaymentChannel() });
        if (path === "/api/queue")
          return send(200, { queue: service.queueBoard(user) });
        if (path === "/api/queue/me")
          return send(200, { queue: service.myQueue(user) });
        if (path === "/api/chat/threads")
          return send(200, { threads: service.chatThreads(user) });
        if (/^\/api\/chat\/threads\/[^/]+\/messages$/.test(path))
          return send(200, {
            messages: service.chatMessages(user, path.split("/")[4]),
          });
        if (path === "/api/notifications")
          return send(200, {
            notifications: service.notifications(user),
          });
        if (path === "/api/rankings/buyers")
          return send(200, {
            buyers: service.buyerRanking(user, {
              limit: url.searchParams.get("limit"),
              period: url.searchParams.get("period") ?? undefined,
            }),
          });
        if (path === "/api/admin")
          return send(200, service.adminOverview(user));
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
        if (path === "/api/orders")
          return send(201, service.createOrder(user, input));
        if (/^\/api\/orders\/[^/]+\/pay$/.test(path))
          return send(200, service.pay(user, path.split("/")[3], input));
        if (/^\/api\/orders\/[^/]+\/retry$/.test(path))
          return send(200, service.retry(user, path.split("/")[3]));
        if (path === "/api/topup")
          return send(200, { user: service.topup(user, input) });
        if (path === "/api/profile")
          return send(200, { user: service.profile(user, input) });
        if (path === "/api/reviews")
          return send(201, service.addReview(user, input));
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
        if (path === "/api/admin/payment-channel")
          return send(200, {
            channel: service.setPaymentChannel(user, input),
          });
        if (path === "/api/admin/inventory")
          return send(200, service.importCodes(user, input));
        if (path === "/api/admin/settings")
          return send(200, service.saveSettings(user, input));
        if (path === "/api/admin/products")
          return send(200, service.saveProduct(user, input));
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
