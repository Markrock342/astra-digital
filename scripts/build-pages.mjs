import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
rmSync("dist-pages",{recursive:true,force:true});
mkdirSync("dist-pages", { recursive: true });
cpSync("dist", "dist-pages", { recursive: true });
writeFileSync("dist-pages/_worker.js", readFileSync("cloud/pages-proxy.mjs"));
writeFileSync(
  "dist-pages/_headers",
  "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'\n",
);
console.log(
  "Optional Pages artifact is ready. No cloud resources were created.",
);
