// Optional short pages.dev frontend. The existing Worker remains the only API/database owner.
// Besides forwarding /api/* it serves /robots.txt and /sitemap.xml and rewrites the <head>
// of "/", "/products/<id>" and "/products?category=<id>" so link previews show the shop /
// product / category (HTMLRewriter).
// Bundled to dist-pages/_worker.js by scripts/build-pages.mjs.
import {
  REPLACED_HEAD_SELECTORS,
  categoryIdFromQuery,
  categoryMeta,
  homeMeta,
  isListedCategory,
  metaTags,
  productIdFromPath,
  productMeta,
  robotsTxt,
  sitemapXml,
} from "../server/seo.mjs";

const API_TTL_MS = 60_000;
const API_TIMEOUT_MS = 2_500;
const apiCache = new Map();

/** GET a public JSON API through the Worker binding; small in-isolate cache, never cookies. */
async function publicApi(env, origin, path) {
  const now = Date.now();
  const hit = apiCache.get(path);
  if (hit && hit.expires > now) return hit.data;
  let timer;
  const data = await Promise.race([
    env.COMMERCE_API.fetch(
      new Request(origin + path, { headers: { Accept: "application/json" } }),
    ).then((response) => {
      if (!response.ok) throw new Error("api " + response.status);
      return response.json();
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), API_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  if (apiCache.size > 200) apiCache.clear();
  apiCache.set(path, { data, expires: now + API_TTL_MS });
  return data;
}

function textResponse(body, type, request, maxAge) {
  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": `public, max-age=${maxAge}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Replace the shop-wide head tags with page-specific ones. */
function rewriteHead(response, meta) {
  let rewriter = new HTMLRewriter();
  for (const selector of REPLACED_HEAD_SELECTORS)
    rewriter = rewriter.on(selector, { element: (el) => el.remove() });
  rewriter = rewriter.on("head", {
    element: (el) => el.append(metaTags(meta), { html: true }),
  });
  const rewritten = rewriter.transform(response);
  const out = new Response(rewritten.body, rewritten);
  // The asset's validators describe the untouched index.html, not this page.
  out.headers.delete("ETag");
  out.headers.delete("Last-Modified");
  return out;
}

async function pageMeta(env, origin, pathname, search) {
  const overview = await publicApi(env, origin, "/api/overview").catch(() => null);
  const shop = overview?.shop ?? null;
  if (pathname === "/") return homeMeta(origin, shop);
  if (pathname === "/products") {
    // "/products?category=x": same cached overview call, nothing extra per request.
    const id = categoryIdFromQuery(new URLSearchParams(search).get("category"));
    const category = id && (overview?.categories ?? []).find((c) => c.id === id);
    return category && isListedCategory(category) ? categoryMeta(origin, category, shop) : null;
  }
  const id = productIdFromPath(pathname);
  if (!id) return null;
  const data = await publicApi(env, origin, "/api/products/" + encodeURIComponent(id));
  return data?.product ? productMeta(origin, data.product, shop) : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return env.COMMERCE_API.fetch(request);
    const read = request.method === "GET" || request.method === "HEAD";
    // One address for the shop: www.<domain> pages go to <domain> (same path and query).
    if (read && url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    if (read && url.pathname === "/robots.txt")
      return textResponse(robotsTxt(url.origin), "text/plain; charset=utf-8", request, 3600);
    if (read && url.pathname === "/sitemap.xml") {
      let products = [];
      let categories = [];
      let maxAge = 600;
      try {
        const [list, overview] = await Promise.all([
          publicApi(env, url.origin, "/api/products"),
          publicApi(env, url.origin, "/api/overview"),
        ]);
        products = list.products ?? [];
        categories = overview?.categories ?? [];
      } catch {
        maxAge = 60; // list the static pages now, retry products soon
      }
      return textResponse(
        sitemapXml(url.origin, products, categories),
        "application/xml; charset=utf-8",
        request,
        maxAge,
      );
    }
    const response = await env.ASSETS.fetch(request);
    const wantsMeta =
      read &&
      (url.pathname === "/" ||
        productIdFromPath(url.pathname) !== null ||
        (url.pathname === "/products" && url.searchParams.has("category")));
    if (
      !wantsMeta ||
      response.status !== 200 ||
      !(response.headers.get("Content-Type") ?? "").includes("text/html")
    )
      return response;
    try {
      const meta = await pageMeta(env, url.origin, url.pathname, url.search);
      return meta ? rewriteHead(response, meta) : response;
    } catch {
      return response; // product missing or API down: plain SPA HTML
    }
  },
};
