import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommerce } from "../server/commerce.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import { openLocalCommerce } from "../server/commerce.mjs";

test("local .data migrate applies through 005 and keeps product API free of codes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-data-"));
  const dbPath = join(dir, "commerce.sqlite");
  const s = createCommerce({ path: dbPath, seed: true });
  t.after(() => {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const applied = s.db
    .prepare("SELECT name FROM schema_migrations ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepEqual(applied, [
    "001_initial.sql",
    "002_reviews.sql",
    "003_reference_layout.sql",
    "004_commerce_ops.sql",
    "005_credential_preorder_indexes.sql",
  ]);
  assert.ok(
    s.db
      .prepare("PRAGMA table_info(inventory)")
      .all()
      .some((c) => c.name === "login_id_enc"),
  );
  const channel = s.db
    .prepare("SELECT provider, active FROM payment_channel WHERE id='primary'")
    .get();
  assert.equal(channel.provider, "unset");
  assert.equal(channel.active, 0);
  assert.ok(
    s.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('payments','chat_threads','notifications')",
      )
      .all().length >= 3,
  );
  s.db
    .prepare("UPDATE users SET role=? WHERE id=?")
    .run(ROLES.STAFF, s.db.prepare("SELECT id FROM users LIMIT 1").get().id);
  const products = s.products();
  const blob = JSON.stringify(products);
  assert.equal(blob.includes("DEMO-KEY"), false);
  assert.equal(blob.includes("secret"), false);
  assert.ok(
    products.every((p) => p.variants.every((v) => Number.isInteger(v.price))),
  );
});

test("npm migrate target openLocalCommerce writes schema into .data/commerce.sqlite", () => {
  const s = openLocalCommerce({ seed: false });
  try {
    const names = s.db
      .prepare("SELECT name FROM schema_migrations ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.ok(names.includes("003_reference_layout.sql"));
    assert.ok(names.includes("004_commerce_ops.sql"));
    assert.ok(names.includes("005_credential_preorder_indexes.sql"));
    const kind = s.db.prepare("PRAGMA table_info(ledger)").all();
    assert.ok(kind.some((c) => c.name === "kind"));
  } finally {
    s.db.close();
  }
});
