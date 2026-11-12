// Products + stock round: import preview / skip duplicates, per-variant stock in the
// product list, warranty snapshot, bulk actions and duplicate product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ensureProductsStock } from "../server/ensure-admin-fr.mjs";
import { ROLES } from "../server/auth-policy.mjs";

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const buyerAuth = s.register({
    name: "Stock Buyer",
    email: "stock-buyer@example.invalid",
    password: "Buyer-only-Password-123",
  });
  const user = s.session(buyerAuth.token);
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  const staffAuth = s.register({
    name: "Stock Staff",
    email: "stock-staff@example.invalid",
    password: "Staff-only-Password-123",
  });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  const product = s.saveProduct(admin, {
    name: "Stock Round Item",
    description: "สินค้าทดสอบรอบสต็อก",
    category: "streaming",
    price: 5000,
    active: true,
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  return { s, user, admin, staff, product, variantId, adminToken: adminAuth.token, staffToken: staffAuth.token };
}

const call = async (s, method, path, token, body) => {
  const handle = createAPIHandler(s);
  const response = await handle(
    new Request("http://127.0.0.1" + path, {
      method,
      headers: {
        Cookie: "astra_session=" + token,
        "Content-Type": "application/json",
        "X-Astra-Request": "1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, data: await response.json() };
};

const count = (s, sql, ...args) => s.db.prepare(sql).get(...args).n;

test("ensureProductsStock is idempotent and adds the warranty and login_key columns", (t) => {
  const { s } = fixture(t);
  ensureProductsStock(s.db);
  ensureProductsStock(s.db);
  const cols = (table) => s.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  assert.ok(cols("variants").includes("warranty_days"));
  assert.ok(cols("orders").includes("warranty_until"));
  assert.ok(cols("reservations").includes("warranty_until"));
  assert.ok(cols("inventory").includes("login_key"));
});

test("import dry run reports each line, masks secrets and writes nothing", (t) => {
  const { s, admin, variantId } = fixture(t);
  s.importCodes(admin, { variantId, items: [{ loginId: "Taken@Example.invalid", password: "first-pass" }] });
  const before = count(s, "SELECT COUNT(*) AS n FROM inventory");
  const audits = count(s, "SELECT COUNT(*) AS n FROM audit WHERE action='IMPORT_CODES'");
  const preview = s.importCodes(admin, {
    variantId,
    dryRun: true,
    items: [
      { loginId: "new-a@example.invalid", password: "Secret-A-1" },
      { loginId: "  NEW-A@example.invalid ", password: "other-pass" },
      { loginId: "taken@example.invalid", password: "a-new-password" },
      { loginId: "no-password@example.invalid", password: "" },
      { loginId: "new-b@example.invalid", password: "Secret-B-2" },
    ],
  });
  assert.equal(preview.dryRun, true);
  assert.deepEqual(
    preview.lines.map((l) => [l.line, l.status]),
    [
      [1, "ok"],
      [2, "duplicate_batch"],
      [3, "existing"],
      [4, "invalid"],
      [5, "ok"],
    ],
  );
  assert.equal(preview.lines[1].duplicateOf, 1);
  assert.equal(preview.lines[2].existingStatus, "available");
  assert.equal(preview.lines[0].display, "new-a@example.invalid");
  assert.equal(preview.lines[0].passwordMasked, "••••••••");
  assert.deepEqual(preview.counts, { total: 5, ok: 2, duplicateInBatch: 1, existing: 1, invalid: 1 });
  const blob = JSON.stringify(preview);
  for (const secret of ["Secret-A-1", "other-pass", "a-new-password", "Secret-B-2"])
    assert.ok(!blob.includes(secret), "preview leaked " + secret);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM inventory"), before);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM audit WHERE action='IMPORT_CODES'"), audits);
});

test("import with skipDuplicates adds only ok lines and audits the counts; strict mode stays all-or-nothing", (t) => {
  const { s, admin, staff, variantId } = fixture(t);
  s.importCodes(admin, { variantId, items: [{ loginId: "dup@example.invalid", password: "p1" }] });
  const before = count(s, "SELECT COUNT(*) AS n FROM inventory WHERE variant_id=?", variantId);
  const items = [
    { loginId: "fresh-1@example.invalid", password: "p-fresh-1" },
    { loginId: "DUP@example.invalid", password: "p-changed" },
    { loginId: "fresh-1@example.invalid", password: "p-again" },
    { loginId: "", password: "orphan" },
  ];
  assert.throws(
    () => s.importCodes(admin, { variantId, items: items.slice(0, 3) }),
    (e) => e.status === 409 && /บรรทัด 2/.test(e.message),
  );
  assert.throws(
    () => s.importCodes(admin, { variantId, items }),
    (e) => e.status === 400 && /บรรทัด 4/.test(e.message),
  );
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM inventory WHERE variant_id=?", variantId), before);

  const result = s.importCodes(admin, { variantId, items, skipDuplicates: true });
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 3);
  assert.equal(result.skippedDuplicates, 2);
  assert.equal(result.skippedInvalid, 1);
  assert.ok(!JSON.stringify(result).includes("p-fresh-1"));
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM inventory WHERE variant_id=?", variantId), before + 1);
  const audit = s.db
    .prepare("SELECT detail FROM audit WHERE action='IMPORT_CODES' AND entity_id=? ORDER BY id DESC LIMIT 1")
    .get(variantId);
  assert.deepEqual(JSON.parse(audit.detail), {
    total: 4,
    imported: 1,
    skippedDuplicates: 2,
    skippedInvalid: 1,
    skipDuplicates: true,
  });
  // Nothing new: still a 200 with zero added.
  assert.equal(s.importCodes(admin, { variantId, items: items.slice(0, 2), skipDuplicates: true }).imported, 0);
  assert.throws(
    () => s.importCodes(staff, { variantId, dryRun: true, items }),
    (e) => e.status === 403,
  );
});

test("legacy codes compare by code text and are masked; CSV keeps pasted line numbers", (t) => {
  const { s, admin, variantId } = fixture(t);
  s.importCodes(admin, { variantId, codes: "GIFT-CODE-0001" });
  const preview = s.importCodes(admin, {
    variantId,
    dryRun: true,
    codes: "GIFT-CODE-0002\n\nGIFT-CODE-0001\nbad code\nGIFT-CODE-0002",
  });
  assert.deepEqual(
    preview.lines.map((l) => [l.line, l.status]),
    [
      [1, "ok"],
      [3, "existing"],
      [4, "invalid"],
      [5, "duplicate_batch"],
    ],
  );
  assert.ok(!JSON.stringify(preview).includes("GIFT-CODE-0002"));
  assert.equal(preview.lines[0].display, "GIF••••02");

  const csv = s.importCodes(admin, {
    variantId,
    dryRun: true,
    csv: "csv-a@example.invalid,pw-a\nmissing-comma\n\ncsv-b@example.invalid,",
  });
  assert.deepEqual(
    csv.lines.map((l) => [l.line, l.status]),
    [
      [1, "ok"],
      [2, "invalid"],
      [4, "invalid"],
    ],
  );
  assert.throws(
    () => s.importCodes(admin, { variantId, dryRun: true, codes: Array.from({ length: 101 }, (_, i) => "CODE-" + (1000 + i)).join("\n") }),
    (e) => e.status === 400,
  );
});

test("rows written before login_key existed are still caught as duplicates", (t) => {
  const { s, admin, variantId } = fixture(t);
  s.importCodes(admin, { variantId, items: [{ loginId: "old-row@example.invalid", password: "old" }] });
  s.db.prepare("UPDATE inventory SET login_key=NULL").run();
  const preview = s.importCodes(admin, {
    variantId,
    dryRun: true,
    items: [{ loginId: "OLD-ROW@example.invalid", password: "different" }],
  });
  assert.equal(preview.lines[0].status, "existing");
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM inventory WHERE login_key IS NULL"), 0);
});

test("HTTP dry run does not bump live versions; sold accounts count as already in the system", async (t) => {
  const { s, user, admin, variantId, adminToken, staffToken } = fixture(t);
  s.importCodes(admin, { variantId, items: [{ loginId: "sold@example.invalid", password: "pw" }] });
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const order = s.createOrder(user, { variantId, quantity: 1, requestKey: "stock-round-sold-1" });
  s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  const before = s.liveVersions().catalog;
  const res = await call(s, "POST", "/api/admin/inventory", adminToken, {
    variantId,
    dryRun: true,
    items: [{ loginId: "sold@example.invalid", password: "pw" }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.lines[0].status, "existing");
  assert.equal(res.data.lines[0].existingStatus, "sold");
  assert.equal(s.liveVersions().catalog, before);
  const denied = await call(s, "POST", "/api/admin/inventory", staffToken, {
    variantId,
    dryRun: true,
    items: [{ loginId: "x@example.invalid", password: "pw" }],
  });
  assert.equal(denied.status, 403);
});

test("products list shows stock per variant with low/out badges and the cover image", async (t) => {
  const { s, admin, staff, product, variantId } = fixture(t);
  s.saveSettings(admin, { lowStockAt: 2 });
  const second = s.createVariant(admin, product.id, { label: "90 วัน", price: 12000 });
  const third = s.createVariant(admin, product.id, { label: "1 ปี", price: 30000 });
  s.importCodes(admin, {
    variantId,
    items: ["a", "b", "c"].map((x) => ({ loginId: x + "@list.invalid", password: "pw-" + x })),
  });
  s.importCodes(admin, { variantId: second.id, items: [{ loginId: "low@list.invalid", password: "pw" }] });
  const png = new Uint8Array(64);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const image = await s.addProductImage(admin, product.id, { bytes: png, contentType: "image/png" });
  const row = s.adminProducts(staff, { q: "Stock Round Item" }).products[0];
  assert.equal(row.stock, 4);
  assert.equal(row.imageUrl, image.image.url);
  assert.deepEqual(
    row.variants.map((v) => [v.id, v.stock, v.stockStatus]),
    [
      [variantId, 3, "in"],
      [second.id, 1, "low"],
      [third.id, 0, "out"],
    ],
  );
});

test("warranty days are validated, snapshotted at purchase and fixed at delivery", (t) => {
  const { s, user, admin, staff, product, variantId } = fixture(t);
  assert.throws(() => s.updateVariant(admin, variantId, { warranty_days: 366 }), (e) => e.status === 400);
  assert.throws(() => s.updateVariant(admin, variantId, { warranty_days: -1 }), (e) => e.status === 400);
  assert.throws(() => s.updateVariant(staff, variantId, { warranty_days: 5 }), (e) => e.status === 403);
  assert.equal(s.updateVariant(admin, variantId, { warranty_days: 30 }).warranty_days, 30);
  assert.equal(s.adminProductVariants(admin, product.id).variants[0].warranty_days, 30);
  assert.equal(s.productDetail(product.id).variants[0].warranty_days, 30);
  const created = s.createVariant(admin, product.id, { label: "ประกัน 7 วัน", price: 9000, warranty_days: 7 });
  assert.equal(created.warranty_days, 7);

  s.importCodes(admin, { variantId, items: [{ loginId: "w1@example.invalid", password: "pw1" }] });
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const order = s.createOrder(user, { variantId, quantity: 1, requestKey: "warranty-order-01" });
  // Editing after purchase (before payment) does not change what the buyer was promised.
  s.updateVariant(admin, variantId, { warranty_days: 90 });
  s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  const detail = s.orderDetail(user, order.id);
  assert.equal(detail.warranty_days, 30);
  const days = (Date.parse(detail.warranty_until.replace(" ", "T") + "Z") - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30, "warranty about 30 days, got " + days);
  s.updateVariant(admin, variantId, { warranty_days: 0 });
  assert.equal(s.orderDetail(user, order.id).warranty_until, detail.warranty_until);
  assert.equal(s.adminOrderDetail(staff, order.id).warranty_until, detail.warranty_until);

  // No warranty → no end date.
  s.importCodes(admin, { variantId, items: [{ loginId: "w2@example.invalid", password: "pw2" }] });
  const plain = s.createOrder(user, { variantId, quantity: 1, requestKey: "warranty-order-02" });
  s.pay(user, plain.id, { paymentToken: plain.paymentToken, outcome: "success" });
  assert.equal(s.orderDetail(user, plain.id).warranty_until, null);
});

test("preorder warranty starts when the order is delivered", (t) => {
  const { s, user, admin, staff } = fixture(t);
  const pre = s.saveProduct(admin, {
    name: "Warranty Preorder",
    description: "พรีออเดอร์มีประกัน",
    category: "streaming",
    price: 5000,
    preorder: true,
    active: true,
  });
  const variantId = s.adminProductVariants(admin, pre.id).variants[0].id;
  s.updateVariant(admin, variantId, { warranty_days: 14 });
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const reservation = s.createOrder(user, { variantId, quantity: 1, requestKey: "warranty-pre-01" });
  s.pay(user, reservation.id, { paymentToken: reservation.paymentToken, outcome: "success" });
  assert.equal(s.orderDetail(user, reservation.id).warranty_until, null);
  s.importCodes(admin, { variantId, items: [{ loginId: "pre@example.invalid", password: "pw" }] });
  s.deliverReservation(staff, reservation.id);
  const delivered = s.orderDetail(user, reservation.id);
  const row = s.db.prepare("SELECT delivered_at FROM reservations WHERE id=?").get(reservation.id);
  const gap = (Date.parse(delivered.warranty_until.replace(" ", "T") + "Z") - Date.parse(row.delivered_at.replace(" ", "T") + "Z")) / 86400000;
  assert.equal(gap, 14);
  assert.equal(s.adminOrderDetail(staff, reservation.id).warranty_until, delivered.warranty_until);
});

test("bulk activate / deactivate / feature is one admin request and audited per product", async (t) => {
  const { s, admin, staff, product, adminToken, staffToken } = fixture(t);
  const other = s.saveProduct(admin, {
    name: "Bulk Second",
    description: "สินค้าชิ้นที่สอง",
    category: "streaming",
    price: 5000,
    active: false,
  });
  const ids = [product.id, other.id];
  const res = await call(s, "POST", "/api/admin/products/bulk", adminToken, { action: "deactivate", ids });
  assert.equal(res.status, 200);
  assert.equal(res.data.updated, 1);
  assert.equal(res.data.unchanged, 1);
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM products WHERE active=1 AND id IN (?,?)", ...ids), 0);
  s.bulkUpdateProducts(admin, { action: "activate", ids });
  s.bulkUpdateProducts(admin, { action: "feature", ids });
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM products WHERE active=1 AND featured=1 AND id IN (?,?)", ...ids), 2);
  s.bulkUpdateProducts(admin, { action: "unfeature", ids: [other.id] });
  assert.equal(count(s, "SELECT COUNT(*) AS n FROM products WHERE featured=1 AND id=?", other.id), 0);
  assert.equal(
    count(s, "SELECT COUNT(*) AS n FROM audit WHERE action='PRODUCT_BULK_FEATURE' AND entity_id IN (?,?)", ...ids),
    2,
  );
  // Unknown id: nothing changes.
  assert.throws(
    () => s.bulkUpdateProducts(admin, { action: "deactivate", ids: [product.id, "missing"] }),
    (e) => e.status === 404,
  );
  assert.equal(count(s, "SELECT active AS n FROM products WHERE id=?", product.id), 1);
  assert.throws(() => s.bulkUpdateProducts(admin, { action: "delete", ids }), (e) => e.status === 400);
  assert.throws(() => s.bulkUpdateProducts(admin, { action: "activate", ids: [] }), (e) => e.status === 400);
  assert.throws(() => s.bulkUpdateProducts(staff, { action: "activate", ids }), (e) => e.status === 403);
  const denied = await call(s, "POST", "/api/admin/products/bulk", staffToken, { action: "activate", ids });
  assert.equal(denied.status, 403);
});

test("duplicate product makes an inactive draft with variants and images but no stock", async (t) => {
  const { s, admin, staff, product, variantId, adminToken, staffToken } = fixture(t);
  s.updateVariant(admin, variantId, { warranty_days: 30, price: 7900 });
  s.createVariant(admin, product.id, { label: "90 วัน", price: 19900, warranty_days: 90 });
  s.updateVariant(admin, variantId, { active: false });
  s.bulkUpdateProducts(admin, { action: "feature", ids: [product.id] });
  s.importCodes(admin, { variantId, items: [{ loginId: "keep@example.invalid", password: "pw" }] });
  const png = new Uint8Array(64);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  await s.addProductImage(admin, product.id, { bytes: png, contentType: "image/png" });
  await s.addProductImage(admin, product.id, { bytes: png, contentType: "image/png" });

  const res = await call(s, "POST", "/api/admin/products/" + product.id + "/duplicate", adminToken, {});
  assert.equal(res.status, 201);
  const copy = s.db.prepare("SELECT * FROM products WHERE id=?").get(res.data.id);
  const source = s.db.prepare("SELECT * FROM products WHERE id=?").get(product.id);
  assert.equal(copy.name, "Stock Round Item (สำเนา)");
  assert.equal(copy.active, 0);
  assert.equal(copy.featured, 0);
  assert.equal(copy.description, source.description);
  assert.equal(copy.category, source.category);
  assert.equal(copy.preorder, source.preorder);
  const variants = (id) =>
    s.db
      .prepare("SELECT label,price,active,sort_order,warranty_days FROM variants WHERE product_id=? ORDER BY sort_order,id")
      .all(id)
      .map((v) => ({ ...v }));
  assert.deepEqual(variants(copy.id), variants(product.id));
  assert.equal(
    count(s, "SELECT COUNT(*) AS n FROM inventory i JOIN variants v ON v.id=i.variant_id WHERE v.product_id=?", copy.id),
    0,
  );
  const keys = (id) =>
    s.db.prepare("SELECT file_key FROM product_images WHERE product_id=? ORDER BY sort_order").all(id).map((r) => r.file_key);
  assert.deepEqual(keys(copy.id), keys(product.id));
  assert.ok(s.db.prepare("SELECT 1 FROM audit WHERE action='DUPLICATE_PRODUCT' AND entity_id=?").get(copy.id));
  assert.ok(!s.products().some((p) => p.id === copy.id), "the draft is hidden from the storefront");

  // Removing the copy's image keeps the file the original still shows.
  const [sharedKey] = keys(copy.id);
  const copyImage = s.db.prepare("SELECT id FROM product_images WHERE product_id=? AND file_key=?").get(copy.id, sharedKey);
  await s.deleteProductImage(admin, copyImage.id);
  assert.ok(await s.getFile(sharedKey), "original image file is still there");
  // Last reference gone → the file is deleted.
  const originalImage = s.db.prepare("SELECT id FROM product_images WHERE product_id=? AND file_key=?").get(product.id, sharedKey);
  await s.deleteProductImage(admin, originalImage.id);
  await assert.rejects(() => s.getFile(sharedKey), (e) => e.status === 404);

  assert.throws(() => s.duplicateProduct(staff, product.id), (e) => e.status === 403);
  assert.throws(() => s.duplicateProduct(admin, "missing"), (e) => e.status === 404);
  const denied = await call(s, "POST", "/api/admin/products/" + product.id + "/duplicate", staffToken, {});
  assert.equal(denied.status, 403);

  const long = s.saveProduct(admin, {
    name: "L".repeat(80),
    description: "ชื่อยาวเต็มที่",
    category: "streaming",
    price: 5000,
  });
  const longCopy = s.duplicateProduct(admin, long.id);
  assert.ok(longCopy.name.length <= 80 && longCopy.name.endsWith(" (สำเนา)"));
});
