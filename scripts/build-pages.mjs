import { cpSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
rmSync("dist-pages",{recursive:true,force:true});
mkdirSync("dist-pages", { recursive: true });
cpSync("dist", "dist-pages", { recursive: true });
// The proxy imports the shared SEO helpers (server/seo.mjs), so bundle it into one module.
await build({
  entryPoints: ["cloud/pages-proxy.mjs"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "dist-pages/_worker.js",
  logLevel: "warning",
});
writeFileSync(
  "dist-pages/_headers",
  "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'\n",
);
console.log(
  "Optional Pages artifact is ready. No cloud resources were created.",
);
