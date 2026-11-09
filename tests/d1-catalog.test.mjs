import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";
import { openD1Schema } from "../server/d1/db.mjs";
import { createD1Catalog } from "../server/d1/catalog.mjs";

function seedCatalog(db) {
  db.prepare(
    `INSERT INTO products(id,name,category,description,art,featured,active,hidden_seed,preorder)
     VALUES(?,?,?,?,?,1,1,0,0)`,
  ).run(
    "demo-stream",
    "STREAM DEMO",
    "streaming",
    "Demo product for D1 catalog",
    "stream",
  );
  db.prepare(
    `INSERT INTO variants(id,product_id,label,price) VALUES(?,?,?,?)`,
  ).run("demo-stream-30", "demo-stream", "30 DAYS", 10000);
  const secret = "DEMO-KEY-NOT-VALID-LEAK-TEST";
  db.prepare(
    `INSERT INTO inventory_units(id,variant_id,fingerprint,secret)
     VALUES(?,?,?,?)`,
  ).run(
    "unit-1",
    "demo-stream-30",
    createHash("sha256").update(secret).digest("hex"),
    "iv:ciphertext:tag-not-real-but-sensitive",
  );
}

test("D1 catalog list and detail never leak inventory secrets", async (t) => {
  const d1 = openD1Schema();
  t.after(() => d1.close());
  seedCatalog(d1);
  const catalog = createD1Catalog(d1);
  const products = catalog.listProducts();
  assert.equal(products.length, 1);
  assert.equal(products[0].variants[0].stock, 1);
  assert.equal(products[0].variants[0].price, 10000);
  const detail = catalog.getProduct("demo-stream");
  assert.equal(detail.id, "demo-stream");
  const blob = JSON.stringify({ products, detail });
  assert.equal(blob.includes("DEMO-KEY-NOT-VALID"), false);
  assert.equal(blob.includes("ciphertext"), false);
  assert.equal(blob.includes("fingerprint"), false);
  assert.equal(blob.includes("secret"), false);
  assert.throws(
    () => catalog.getProduct("missing"),
    (e) => e.status === 404,
  );
});

test("HTTP D1 catalog routes are public and block secret dump path", async (t) => {
  const legacy = createCommerce();
  const d1 = openD1Schema();
  t.after(() => {
    legacy.db.close();
    d1.close();
  });
  seedCatalog(d1);
  const server = createApp(legacy, { d1Catalog: createD1Catalog(d1) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = "http://127.0.0.1:" + server.address().port;

  const list = await fetch(base + "/api/d1/products");
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.storage, "d1-schema-sqlite");
  assert.equal(listBody.products[0].variants[0].stock, 1);
  assert.equal(JSON.stringify(listBody).includes("DEMO-KEY"), false);

  const detail = await fetch(base + "/api/d1/products/demo-stream");
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.product.name, "STREAM DEMO");
  assert.equal(JSON.stringify(detailBody).includes("ciphertext"), false);

  const missing = await fetch(base + "/api/d1/products/nope");
  assert.equal(missing.status, 404);

  const dump = await fetch(base + "/api/d1/inventory/secrets");
  assert.equal(dump.status, 403);
});
