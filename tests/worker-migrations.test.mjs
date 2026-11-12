import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TRACK_A_MIGRATION_FILES } from "../server/migrate-005.mjs";

test("MU3: worker migration list matches server/migrations/*.sql", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const folder = join(root, "../server/migrations");
  const onDisk = readdirSync(folder)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.deepEqual(
    [...TRACK_A_MIGRATION_FILES].sort(),
    onDisk,
    "TRACK_A_MIGRATION_FILES must equal files in server/migrations",
  );

  const worker = readFileSync(join(root, "../cloud/worker.mjs"), "utf8");
  for (const name of TRACK_A_MIGRATION_FILES) {
    assert.ok(
      worker.includes(name),
      "worker.mjs must reference " + name,
    );
  }
  assert.ok(
    worker.includes("005_credential_preorder_indexes.sql") ||
      worker.includes("credentialPreorder"),
    "worker must import 005 migration content",
  );
  assert.ok(
    worker.includes("applyMigration005"),
    "worker must call applyMigration005",
  );
  assert.ok(
    worker.includes("applyMigration006"),
    "worker must call applyMigration006",
  );
  assert.ok(
    worker.includes("applyMigration007"),
    "worker must call applyMigration007",
  );
  assert.ok(
    worker.includes("applyMigration008"),
    "worker must call applyMigration008",
  );
  assert.ok(
    worker.includes("applyMigration009"),
    "worker must call applyMigration009",
  );
});
