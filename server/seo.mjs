// Basic SEO: sitemap.xml, robots.txt and link-preview meta tags.
// Pure functions (no Workers APIs) so the Pages proxy, the Node server and tests share them.

export const BRAND = "ASIA EXTRA";
export const DEFAULT_DESCRIPTION = "ร้านสินค้าดิจิทัล ส่งไว ปลอดภัย ใช้งานได้ทันที";
export const DEFAULT_IMAGE = "/brand/og.png";
/** Storefront pages listed in the sitemap besides one URL per active product. */
export const STATIC_PATHS = ["/", "/products", "/reviews", "/faq", "/terms", "/privacy"];

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export const escapeXml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

const trimOrigin = (origin) => String(origin).replace(/\/+$/, "");
export const productPath = (id) => "/products/" + encodeURIComponent(id);

/** "/products/<id>" → id (decoded); anything else → null. */
export function productIdFromPath(pathname) {
  const match = /^\/products\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return id && id.length <= 80 && !/[\u0000-\u001f]/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Public products only: /api/products already filters, this guards against stale input. */
export const isListedProduct = (p) =>
  !!p &&
  typeof p.id === "string" &&
  p.id.length > 0 &&
  p.active !== 0 &&
  p.active !== false &&
  !p.hidden_seed;

/** "/products?category=<id>" — the storefront's filtered list. */
export const categoryPath = (id) => "/products?category=" + encodeURIComponent(id);

/** Valid category slug from a URL query value, or null. */
export function categoryIdFromQuery(value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return id && id.length <= 40 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ? id : null;
}

/**
 * Public categories only: /api/overview already lists just the visible ones that have a
 * product on sale; this guards against stale or admin-shaped input.
 */
export const isListedCategory = (c) =>
  !!c && typeof c.id === "string" && !!categoryIdFromQuery(c.id) && !c.hidden && (c.count ?? 1) > 0;

export function sitemapXml(origin, products = [], categories = []) {
  const base = trimOrigin(origin);
  const seen = new Set();
  const urls = [];
  const add = (path, priority) => {
    if (seen.has(path)) return;
    seen.add(path);
    urls.push(
      `  <url><loc>${escapeXml(base + path)}</loc><priority>${priority}</priority></url>`,
    );
  };
  for (const path of STATIC_PATHS)
    add(path, path === "/" ? "1.0" : path === "/products" ? "0.9" : "0.5");
  for (const category of categories.filter(isListedCategory)) add(categoryPath(category.id), "0.7");
  for (const product of products.filter(isListedProduct)) add(productPath(product.id), "0.8");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join("\n") +
    "\n</urlset>\n"
  );
}

export function robotsTxt(origin) {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /api",
    "",
    "Sitemap: " + trimOrigin(origin) + "/sitemap.xml",
    "",
  ].join("\n");
}

export const shopTitle = (shop) =>
  shop?.shopName && shop.shopName !== "ร้านค้า" ? String(shop.shopName) : BRAND;

/** Collapse whitespace and cut at a word boundary for meta descriptions. */
export function summary(text, max = 160) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + "…";
}

/** Absolute http(s) URL for an image path; anything else falls back to the shop banner. */
export function absoluteUrl(origin, value) {
  try {
    const url = new URL(value || DEFAULT_IMAGE, trimOrigin(origin) + "/");
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    /* fall through */
  }
  return trimOrigin(origin) + DEFAULT_IMAGE;
}

export function homeMeta(origin, shop) {
  const name = shopTitle(shop);
  return {
    title: name + " — สินค้าดิจิทัล",
    siteName: name,
    description: summary(shop?.announcement || shop?.description || DEFAULT_DESCRIPTION),
    image: absoluteUrl(origin, DEFAULT_IMAGE),
    imageIsDefault: true,
    url: trimOrigin(origin) + "/",
    type: "website",
  };
}

export function productMeta(origin, product, shop) {
  const name = shopTitle(shop);
  return {
    title: summary(product.name, 90) + " — " + name,
    siteName: name,
    description: summary(product.description || product.name + " — " + DEFAULT_DESCRIPTION),
    image: absoluteUrl(origin, product.imageUrl),
    imageIsDefault: !product.imageUrl,
    url: trimOrigin(origin) + productPath(product.id),
    type: "product",
  };
}

/** "/products?category=x" link preview: "<หมวด> — <ร้าน>". Thai name (the default language). */
export function categoryMeta(origin, category, shop) {
  const name = shopTitle(shop);
  const label = summary(category.name, 60);
  const count = Number.isSafeInteger(category.count) && category.count > 0 ? category.count : 0;
  return {
    title: label + " — " + name,
    siteName: name,
    description: summary(
      "สินค้าหมวด " + label + (count ? " " + count + " รายการ" : "") + " — " +
        (shop?.description || DEFAULT_DESCRIPTION),
    ),
    image: absoluteUrl(origin, DEFAULT_IMAGE),
    imageIsDefault: true,
    url: trimOrigin(origin) + categoryPath(category.id),
    type: "website",
  };
}

/**
 * Tags appended to <head> after the old title/description/og/twitter/canonical tags are
 * removed. Every value is HTML-escaped.
 */
export function metaTags(meta) {
  const property = (name, content) =>
    `<meta property="${name}" content="${escapeHtml(content)}" />`;
  const named = (name, content) => `<meta name="${name}" content="${escapeHtml(content)}" />`;
  return [
    `<title>${escapeHtml(meta.title)}</title>`,
    named("description", meta.description),
    `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
    property("og:type", meta.type),
    property("og:site_name", meta.siteName),
    property("og:title", meta.title),
    property("og:description", meta.description),
    property("og:url", meta.url),
    property("og:image", meta.image),
    ...(meta.imageIsDefault
      ? [property("og:image:width", "1200"), property("og:image:height", "630")]
      : []),
    named("twitter:card", "summary_large_image"),
    named("twitter:title", meta.title),
    named("twitter:description", meta.description),
    named("twitter:image", meta.image),
  ].join("\n    ");
}

/** Selectors of the head tags that metaTags() replaces. */
export const REPLACED_HEAD_SELECTORS = [
  "title",
  'meta[name="description"]',
  'link[rel="canonical"]',
  'meta[property^="og:"]',
  'meta[name^="twitter:"]',
];
