import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import {
  applyMigration011,
  MIGRATION_011_NAME,
  PERF_INDEX_SQL,
} from "../server/migrate-011.mjs";

test("MIG-011 applies perf indexes idempotently", (t) => {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  assert.ok(
    s.db.prepare("SELECT name FROM schema_migrations WHERE name=?").get(MIGRATION_011_NAME),
  );
  const names = s.db
    .prepare("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((r) => r.name);
  for (const sql of PERF_INDEX_SQL) {
    const name = /INDEX IF NOT EXISTS (\w+)/.exec(sql)[1];
    assert.ok(names.includes(name), "missing index " + name);
  }
  assert.equal(applyMigration011(s.db).skipped, true);
});
