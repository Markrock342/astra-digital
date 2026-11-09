import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
const base = new URL(process.argv[2] ?? "https://astra-demo-133.pages.dev");
const commit = process.env.DEPLOY_COMMIT;
if (!/^[a-f0-9]{40}$/.test(commit ?? ""))
  throw Error("DEPLOY_COMMIT must be a complete Git commit SHA");
async function get(path) {
  const response = await fetch(new URL(path, base), {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, `${path} must respond HTTP 200`);
  return response;
}
let failure;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const stamp = await (await get("/deployment.json?commit=" + commit)).json();
    assert.equal(stamp.commit, commit, "Pages must serve this commit");
    const health = await (await get("/api/health")).json();
    assert.equal(health.ok, true);
    assert.equal(health.storage, "cloudflare-durable-sqlite");
    for (const path of ["/", "/stores", "/admin"]) {
      const response = await get(path);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
    console.log(
      "Verified live commit, API storage and storefront/merchant routes:",
      commit,
    );
    process.exit(0);
  } catch (error) {
    failure = error;
    console.log(
      `Release check ${attempt + 1}/12 is waiting for the current deployment.`,
    );
    if (attempt < 11) await delay(10000);
  }
}
throw failure;
