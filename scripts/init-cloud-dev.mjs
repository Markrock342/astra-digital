import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".dev.vars"))
  writeFileSync(
    ".dev.vars",
    [
      `SPACE_SIGNING_KEY=${randomBytes(32).toString("hex")}`,
      `INVENTORY_KEY=${randomBytes(32).toString("hex")}`,
      // Local wrangler only — rotate before any real deploy.
      `ASTRA_ADMIN_PASSWORD=Local-Admin-Password-99`,
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
else {
  const text = readFileSync(".dev.vars", "utf8");
  if (!/^ASTRA_ADMIN_PASSWORD=/m.test(text))
    appendFileSync(
      ".dev.vars",
      `\nASTRA_ADMIN_PASSWORD=Local-Admin-Password-99\n`,
    );
}
console.log(
  "Cloudflare local secrets are ready. Existing keys were preserved.",
);
