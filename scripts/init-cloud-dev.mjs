import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".dev.vars"))
  writeFileSync(
    ".dev.vars",
    `SPACE_SIGNING_KEY=${randomBytes(32).toString("hex")}\nINVENTORY_KEY=${randomBytes(32).toString("hex")}\n`,
    { mode: 0o600, flag: "wx" },
  );
console.log(
  "Cloudflare local secrets are ready. Existing keys were preserved.",
);
