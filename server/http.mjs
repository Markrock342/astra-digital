import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { resolve, extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createAPIHandler, securityHeaders, pageSecurityHeaders } from "./api-handler.mjs";
import { robotsTxt, sitemapXml } from "./seo.mjs";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
};
export function createApp(service, { production = false, d1Catalog } = {}) {
  const handle = createAPIHandler(service, { d1Catalog });
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://" + req.headers.host);
      if (url.pathname.startsWith("/api/")) {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (value)
            headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const request = new Request(url, {
          method: req.method,
          headers,
          ...(["POST", "PATCH", "DELETE"].includes(req.method)
            ? { body: Readable.toWeb(req), duplex: "half" }
            : {}),
        });
        const response = await handle(request, { ip: req.socket.remoteAddress });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      const send = (status, error) => {
        res.writeHead(status, {
          ...securityHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ error }));
      };
      if (!production)
        return send(404, "Use the Vite server at http://127.0.0.1:4330");
      if (!["GET", "HEAD"].includes(req.method))
        return send(405, "Method not allowed");
      if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") {
        const robots = url.pathname === "/robots.txt";
        const body = robots
          ? robotsTxt(url.origin)
          : sitemapXml(url.origin, service.products());
        res.writeHead(200, {
          ...securityHeaders,
          "Content-Type": robots
            ? "text/plain; charset=utf-8"
            : "application/xml; charset=utf-8",
          "Cache-Control": "public,max-age=600",
        });
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }
      const root = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
      let file = resolve(root, "." + decodeURIComponent(url.pathname));
      if (!file.startsWith(root + sep) && file !== root)
        return send(403, "Forbidden");
      if (!extname(file) || url.pathname === "/") file = join(root, "index.html");
      try {
        const content = await readFile(file);
        res.writeHead(200, {
          ...pageSecurityHeaders(url.pathname, !!service.features?.turnstile),
          "Content-Type": mime[extname(file)] ?? "application/octet-stream",
          "Cache-Control": file.includes("/assets/")
            ? "public,max-age=31536000,immutable"
            : "no-cache",
        });
        res.end(req.method === "HEAD" ? undefined : content);
      } catch {
        return send(404, "ไม่พบหน้านี้");
      }
    } catch (error) {
      console.error("HTTP request failed:", error.message);
      if (!res.headersSent)
        res.writeHead(500, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
      res.end(JSON.stringify({ error: "ระบบไม่สามารถทำรายการได้" }));
    }
  });
}
