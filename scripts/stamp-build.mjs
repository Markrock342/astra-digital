import { writeFileSync } from "node:fs";
const commit = process.env.DEPLOY_COMMIT;
if (!/^[a-f0-9]{40}$/.test(commit ?? ""))
  throw Error("DEPLOY_COMMIT must be a complete Git commit SHA");
writeFileSync(
  "dist/deployment.json",
  JSON.stringify({ commit, builtAt: new Date().toISOString() }) + "\n",
);
console.log("Stamped verified build:", commit);
