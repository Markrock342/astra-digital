import { ApiError } from "./domain.mjs";
export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
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
const MAX_JSON_BYTES = 32768;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
function isImageUploadPath(method, path) {
  if (method !== "POST") return false;
  return (
    /^\/api\/admin\/products\/[^/]+\/images$/.test(path) ||
    path === "/api/profile/avatar" ||
    path === "/api/admin/settings/logo"
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
  return async function handle(request) {
    const url = new URL(request.url),
      path = url.pathname;
    const send = (status, data, extra = {}) =>
      Response.json(data, {
        status,
        headers: { ...securityHeaders, "Cache-Control": "no-store", ...extra },
      });
    try {
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
      if (mutating) {
        const length = Number(request.headers.get("Content-Length") ?? 0);
        const maxBytes = imageUpload ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES;
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
              if (bytes > MAX_JSON_BYTES) {
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
          });
        if (path === "/api/live" && service.liveVersions)
          return send(200, { versions: service.liveVersions() });
        if (path === "/api/me")
          return send(200, {
            user: service.publicUser(user),
            features: service.features ?? {},
          });
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
        if (path === "/api/admin/team") return send(200, { team: service.team(user) });
        if (path === "/api/admin/reports/sales")
          return send(200, service.salesReport(user, {
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
          }));
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
        if (/^\/api\/admin\/variants\/[^/]+\/inventory$/.test(path))
          return send(
            200,
            service.adminVariantInventory(user, path.split("/")[4], {
              status: url.searchParams.get("status") ?? undefined,
              cursor: url.searchParams.get("cursor") ?? undefined,
              limit: url.searchParams.get("limit") ?? undefined,
            }),
          );
      } else if (request.method === "PATCH") {
        if (/^\/api\/admin\/products\/[^/]+\/images$/.test(path))
          return send(
            200,
            service.reorderProductImages(user, path.split("/")[4], input),
          );
        if (/^\/api\/admin\/variants\/[^/]+$/.test(path))
          return send(
            200,
            service.updateVariant(user, path.split("/")[4], input),
          );
        return send(404, { error: "ไม่พบหน้าที่ร้องขอ" });
      } else if (request.method === "DELETE") {
        if (/^\/api\/admin\/product-images\/[^/]+$/.test(path))
          return send(
            200,
            await service.deleteProductImage(user, path.split("/")[4]),
          );
        if (/^\/api\/admin\/variants\/[^/]+$/.test(path))
          return send(200, service.deleteVariant(user, path.split("/")[4]));
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
        if (path === "/api/admin/team") return send(200, service.saveStaff(user, input));
        if (/^\/api\/admin\/team\/[^/]+\/role$/.test(path))
          return send(200, service.setMemberRole(user, path.split("/")[4], input));
        if (/^\/api\/admin\/team\/[^/]+\/active$/.test(path))
          return send(200, service.setStaffActive(user, path.split("/")[4], input));
        if (/^\/api\/chat\/threads\/[^/]+\/assign$/.test(path))
          return send(200, { thread: service.assignChatThread(user, path.split("/")[4], input) });
        if (/^\/api\/admin\/orders\/[^/]+\/note$/.test(path))
          return send(200, service.adminSetOrderNote(user, path.split("/")[4], input));
        if (/^\/api\/admin\/orders\/[^/]+\/cancel$/.test(path))
          return send(200, service.adminCancelOrder(user, path.split("/")[4], input));
        if (/^\/api\/admin\/orders\/[^/]+\/replace$/.test(path))
          return send(
            200,
            service.replaceOrderCredential(user, path.split("/")[4], input),
          );
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
        if (path === "/api/admin/payment-channel")
          return send(200, {
            channel: service.setPaymentChannel(user, input),
          });
        if (path === "/api/admin/inventory")
          return send(200, service.importCodes(user, input));
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
            service.deliverReservation(user, path.split("/")[4]),
          );
        if (path === "/api/admin/settings")
          return send(200, service.saveSettings(user, input));
        if (path === "/api/admin/products")
          return send(200, service.saveProduct(user, input));
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
