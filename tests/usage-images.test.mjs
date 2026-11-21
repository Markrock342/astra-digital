// วิธีใช้งานหลังซื้อ pictures (server/usage-images.mjs): admin upload / remove, at most 6,
// buyers see them on their delivered order only.
import test from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { USAGE_IMAGES_MAX } from "../server/usage-images.mjs";

const png = () => {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
};

test("usage pictures: admin adds up to 6, buyer sees them once delivered, remove works", async () => {
  const pw = "x".repeat(32);
  const s = createCommerce({ adminPassword: pw });
  const admin = s.session(s.login({ email: "admin@astra.local", password: pw }).token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const p = s.saveProduct(admin, { name: "Usage Pics", description: "Usage Pics บัญชีสตรีมมิ่งรายเดือน", category: "streaming", price: 1000, active: true, firstLabel: "30 วัน" });
  const variantId = s.adminProductVariants(admin, p.id).variants[0].id;
  s.importCodes(admin, { variantId, items: [{ loginId: "u@x.test", password: "pw" }] });

  for (let i = 0; i < USAGE_IMAGES_MAX; i++) await s.addUsageImage(admin, p.id, { bytes: png(), contentType: "image/png" });
  await assert.rejects(() => s.addUsageImage(admin, p.id, { bytes: png(), contentType: "image/png" }), (e) => e.status === 409);
  const { images } = s.adminUsageImages(admin, p.id);
  assert.equal(images.length, USAGE_IMAGES_MAX);
  assert.ok(images.every((i) => /^\/api\/files\/[0-9a-f-]{36}$/.test(i.url)));

  const buyer = s.session(s.register({ name: "Usage Buyer", email: "usage@example.invalid", password: "Buyer-Pass-12345" }).token);
  await assert.rejects(() => s.addUsageImage(buyer, p.id, { bytes: png(), contentType: "image/png" }), (e) => e.status === 403);
  const pending = s.createOrder(buyer, { variantId, quantity: 1, requestKey: "usage-pending-1" });
  assert.equal(s.orderDetail(buyer, pending.id).usageImages, undefined, "nothing before delivery");
  const paid = s.pay(buyer, pending.id, { paymentToken: pending.paymentToken, outcome: "success" });
  assert.equal(paid.usageImages.length, USAGE_IMAGES_MAX);

  const after = await s.removeUsageImage(admin, images[0].id);
  assert.equal(after.images.length, USAGE_IMAGES_MAX - 1);
  assert.equal(s.orderDetail(buyer, pending.id).usageImages.length, USAGE_IMAGES_MAX - 1);
});
