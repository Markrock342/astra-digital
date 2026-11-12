import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
const STRICT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
// Turnstile (bot check on register / login / forgot-password) needs its script and iframe
// origin on storefront pages. Only added when the build is told Turnstile is on
// (TURNSTILE_SITE_KEY set at build time); the default build is unchanged.
const TURNSTILE_CSP =
  "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
const turnstile = !!process.env.TURNSTILE_SITE_KEY;
rmSync("dist-pages",{recursive:true,force:true});
mkdirSync("dist-pages", { recursive: true });
cpSync("dist", "dist-pages", { recursive: true });
writeFileSync("dist-pages/_worker.js", readFileSync("cloud/pages-proxy.mjs"));
const common =
  "  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n";
writeFileSync(
  "dist-pages/_headers",
  turnstile
    ? // Pages joins matching rules: /admin gets both policies, so the strict one still wins there.
      `/*\n${common}  Content-Security-Policy: ${TURNSTILE_CSP}\n/admin\n  Content-Security-Policy: ${STRICT_CSP}\n/admin/*\n  Content-Security-Policy: ${STRICT_CSP}\n`
    : `/*\n${common}  Content-Security-Policy: ${STRICT_CSP}\n`,
);
console.log(
  "Optional Pages artifact is ready. No cloud resources were created.",
);
