import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createCommerce } from "../server/commerce.mjs";

test("preorder order_questions: admin saves 2+ fields; checkout requires answers; admin sees them", () => {
  const adminPassword = randomUUID();
  const s = createCommerce({ adminPassword });
  const adminToken = s.login({ email: "admin@astra.local", password: adminPassword }).token;
  const admin = s.session(adminToken);

  const product = s.saveProduct(admin, {
    name: "Preorder Q Pack",
    description: "ทดสอบคำถามพรีออเดอร์",
    category: "software",
    price: 9900,
    active: true,
    preorder: true,
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  assert.equal(!!s.productDetail(product.id).preorder, true);

  // Ready-stock product cannot use order questions.
  const ready = s.saveProduct(admin, {
    name: "Ready No Q",
    description: "พร้อมส่ง",
    category: "software",
    price: 1000,
    active: true,
  });
  assert.throws(
    () => s.adminSetOrderQuestions(admin, ready.id, { fields: [{ label: "x", type: "text" }] }),
    (e) => e.status === 409,
  );

  const saved = s.adminSetOrderQuestions(admin, product.id, {
    fields: [
      { label: "วันที่ต้องการรับสินค้า", type: "text", required: true },
      { label: "รหัสผ่านที่ต้องการ", type: "text", required: true },
      { label: "อีเมลสำรอง", type: "email", required: false },
    ],
  });
  assert.equal(saved.fields.length, 3);
  assert.equal(saved.fields[0].label, "วันที่ต้องการรับสินค้า");

  const pub = s.productDetail(product.id);
  assert.equal(pub.checkoutFields.length, 3);
  const [f1, f2] = pub.checkoutFields;

  const buyer = s.register({
    name: "Q Buyer",
    email: "q-buyer@example.invalid",
    password: "Q-buyer-Password-12345",
  });
  const u = s.session(buyer.token);

  assert.throws(
    () =>
      s.createOrder(u, {
        variantId,
        quantity: 1,
        requestKey: randomUUID(),
      }),
    (e) => e.status === 400 && /วันที่ต้องการรับสินค้า/.test(e.message),
  );

  assert.throws(
    () =>
      s.createOrder(u, {
        variantId,
        quantity: 1,
        requestKey: randomUUID(),
        deliveryInputs: { [f1.id]: "2026-12-01" },
      }),
    (e) => e.status === 400 && /รหัสผ่านที่ต้องการ/.test(e.message),
  );

  const order = s.createOrder(u, {
    variantId,
    quantity: 1,
    requestKey: randomUUID(),
    deliveryInputs: {
      [f1.id]: "2026-12-01",
      [f2.id]: "SecretPass1",
    },
  });
  assert.ok(order.id);
  assert.equal(order.preorder, true);
  assert.ok(order.fulfilment);
  assert.equal(order.fulfilment.inputs.length, 2);
  assert.equal(order.fulfilment.inputs[0].value, "2026-12-01");
  assert.equal(order.fulfilment.inputs[1].value, "SecretPass1");

  const adminView = s.adminOrderDetail(admin, order.id);
  assert.equal(adminView.fulfilment?.inputs?.length, 2);
  assert.equal(adminView.fulfilment.inputs[0].value, "2026-12-01");
});
