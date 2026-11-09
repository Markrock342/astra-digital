import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { openD1Schema } from "../server/d1/db.mjs";
import { createD1Fulfillment } from "../server/d1/fulfillment.mjs";
import {
  blockedSlipOkAdapter,
  blockedGatewayAdapter,
  createSandboxPaymentAdapter,
} from "../server/payment/adapters.mjs";

function seedShop(db) {
  const userId = randomUUID();
  db.prepare(
    `INSERT INTO users(id,email,name,password_hash,role)
     VALUES(?,?,?,?, 'CUSTOMER')`,
  ).run(userId, userId + "@example.invalid", "Buyer", "x:y");
  const otherId = randomUUID();
  db.prepare(
    `INSERT INTO users(id,email,name,password_hash,role)
     VALUES(?,?,?,?, 'CUSTOMER')`,
  ).run(otherId, otherId + "@example.invalid", "Other", "x:y");
  db.prepare(
    `INSERT INTO products(id,name,category,description,art,featured,active,hidden_seed,preorder)
     VALUES('p1','P','streaming','d','a',0,1,0,0)`,
  ).run();
  db.prepare(
    `INSERT INTO variants(id,product_id,label,price) VALUES('v1','p1','30D',10000)`,
  ).run();
  return { userId, otherId };
}

function addUnit(db, code, id = randomUUID()) {
  db.prepare(
    `INSERT INTO inventory_units(id,variant_id,fingerprint,secret)
     VALUES(?,?,?,?)`,
  ).run(id, "v1", createHash("sha256").update(code).digest("hex"), code);
}

test("sandbox adapter refuses real providers and webhook activation", async () => {
  const db = openD1Schema();
  try {
    const sandbox = createSandboxPaymentAdapter({ db });
    assert.equal(sandbox.providerId, "sandbox");
    await assert.rejects(() => sandbox.parseAndVerifyWebhook({}), (e) => e.status === 501);
    await assert.rejects(() => blockedSlipOkAdapter.createPayment({}), (e) => e.status === 501);
    await assert.rejects(() => blockedGatewayAdapter.createPayment({}), (e) => e.status === 501);
  } finally {
    db.close();
  }
});

test("D1 fulfillment is idempotent and allocates one key per unit", (t) => {
  const db = openD1Schema();
  t.after(() => db.close());
  const { userId } = seedShop(db);
  addUnit(db, "DEMO-KEY-A");
  const f = createD1Fulfillment(db);
  f.credit(userId, 50000, "welcome-" + userId);
  const order = f.createOrder(userId, {
    variantId: "v1",
    quantity: 1,
    requestKey: "req-1",
  });
  assert.equal(order.status, "PENDING_PAYMENT");
  assert.deepEqual(order.codes, []);
  const again = f.createOrder(userId, {
    variantId: "v1",
    quantity: 1,
    requestKey: "req-1",
  });
  assert.equal(again.id, order.id);
  const paid = f.confirmAndFulfill(userId, {
    orderId: order.id,
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.equal(paid.status, "DELIVERED");
  assert.deepEqual(paid.codes, ["DEMO-KEY-A"]);
  const replay = f.confirmAndFulfill(userId, {
    orderId: order.id,
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.deepEqual(replay.codes, ["DEMO-KEY-A"]);
  assert.equal(f.balanceOf(userId), 40000);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM allocations").get().n,
    1,
  );
});

test("failed sandbox payment does not allocate keys", (t) => {
  const db = openD1Schema();
  t.after(() => db.close());
  const { userId } = seedShop(db);
  addUnit(db, "DEMO-KEY-B");
  const f = createD1Fulfillment(db);
  f.credit(userId, 50000, "welcome-" + userId);
  const order = f.createOrder(userId, {
    variantId: "v1",
    quantity: 1,
    requestKey: "fail-1",
  });
  const failed = f.confirmAndFulfill(userId, {
    orderId: order.id,
    paymentToken: order.paymentToken,
    outcome: "failure",
  });
  assert.equal(failed.status, "FAILED");
  assert.deepEqual(failed.codes, []);
  assert.equal(f.balanceOf(userId), 50000);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM allocations").get().n,
    0,
  );
});

test("last inventory unit can be won by only one concurrent buyer", (t) => {
  const db = openD1Schema();
  t.after(() => db.close());
  const { userId, otherId } = seedShop(db);
  addUnit(db, "DEMO-KEY-LAST");
  const f = createD1Fulfillment(db);
  f.credit(userId, 50000, "w1");
  f.credit(otherId, 50000, "w2");
  const a = f.createOrder(userId, {
    variantId: "v1",
    quantity: 1,
    requestKey: "race-a",
  });
  const b = f.createOrder(otherId, {
    variantId: "v1",
    quantity: 1,
    requestKey: "race-b",
  });
  const first = f.confirmAndFulfill(userId, {
    orderId: a.id,
    paymentToken: a.paymentToken,
    outcome: "success",
  });
  const second = f.confirmAndFulfill(otherId, {
    orderId: b.id,
    paymentToken: b.paymentToken,
    outcome: "success",
  });
  const delivered = [first, second].filter((o) => o.status === "DELIVERED");
  const out = [first, second].filter((o) => o.status === "OUT_OF_STOCK");
  assert.equal(delivered.length, 1);
  assert.equal(out.length, 1);
  assert.deepEqual(delivered[0].codes, ["DEMO-KEY-LAST"]);
  assert.deepEqual(out[0].codes, []);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM allocations").get().n,
    1,
  );
});

test("buyer cannot read another buyers delivery codes", (t) => {
  const db = openD1Schema();
  t.after(() => db.close());
  const { userId, otherId } = seedShop(db);
  addUnit(db, "DEMO-KEY-PRIVATE");
  const f = createD1Fulfillment(db);
  f.credit(userId, 50000, "w1");
  const order = f.createOrder(userId, {
    variantId: "v1",
    quantity: 1,
    requestKey: "own-1",
  });
  f.confirmAndFulfill(userId, {
    orderId: order.id,
    paymentToken: order.paymentToken,
    outcome: "success",
  });
  assert.throws(
    () => f.deliveryFor(order.id, otherId),
    (e) => e.status === 404,
  );
});
