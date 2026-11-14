// products.created_at: stamped on insert, existing rows backfilled in insertion order, idempotent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { ensureProductCreatedAt } from "../server/ensure-admin-fr.mjs";

test("new products get created_at; backfill keeps insertion order; ensure is idempotent", (t) => {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const admin = s.session(s.demoMerchant().token);
  const a = s.saveProduct(admin, { name: "Older One", description: "สินค้าเก่ากว่า", category: "streaming", price: 1000, active: true, firstLabel: "1 เดือน" });
  const b = s.saveProduct(admin, { name: "Newer One", description: "สินค้าใหม่กว่า", category: "streaming", price: 1000, active: true, firstLabel: "1 เดือน" });
  const at = (id) => s.db.prepare("SELECT created_at FROM products WHERE id=?").get(id).created_at;
  assert.match(at(a.id), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  // Simulate rows from before the column existed, then backfill.
  s.db.prepare("UPDATE products SET created_at=NULL").run();
  ensureProductCreatedAt(s.db);
  ensureProductCreatedAt(s.db);
  assert.ok(at(a.id) < at(b.id), "older product keeps an earlier time");
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM products WHERE created_at IS NULL").get().n, 0);
  const listed = s.products().find((p) => p.id === b.id);
  assert.equal(listed.created_at, at(b.id), "exposed on the public product");
});
