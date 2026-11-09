import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
    ),
    "pages",
    "deploy",
    "../dist-pages",
    "--project-name",
    "astra-demo",
    "--branch",
    "main",
  ],
  { cwd: new URL("../pages/", import.meta.url), stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => (process.exitCode = code ?? 1));
