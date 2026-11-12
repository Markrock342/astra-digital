import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { sniffImageMime, assertAllowedImage } from "../server/file-store.mjs";

function pngBytes(size = 64) {
  // Minimal valid-ish PNG header + padding (magic only matters for sniff)
  const bytes = new Uint8Array(Math.max(size, 32));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

function jpegBytes() {
  const bytes = new Uint8Array(32);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

function webpBytes() {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return bytes;
}

function svgBytes() {
  return new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
}

function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const merchantAuth = s.demoMerchant();
  const merchant = s.session(merchantAuth.token);
  const buyerAuth = s.register({
    name: "Upload Buyer",
    email: "upload-buyer@example.invalid",
    password: "Buyer-only-Password-123",
  });
  const buyer = s.session(buyerAuth.token);
  return { s, merchant, buyer, merchantToken: merchantAuth.token, buyerToken: buyerAuth.token };
}

test("UP-1: magic bytes sniff and reject SVG", () => {
  assert.equal(sniffImageMime(pngBytes()), "image/png");
  assert.equal(sniffImageMime(jpegBytes()), "image/jpeg");
  assert.equal(sniffImageMime(webpBytes()), "image/webp");
  assert.equal(sniffImageMime(svgBytes()), null);
  assert.throws(
    () =>
      assertAllowedImage("image/svg+xml", svgBytes(), (status, message) => {
        const err = new Error(message);
        err.status = status;
        throw err;
      }),
    (e) => e.status === 415,
  );
});

test("UP-1: add reorder delete product images; storefront lists images", async (t) => {
  const { s, merchant, buyer } = fixture(t);
  const product = s.saveProduct(merchant, {
    name: "Upload Demo Product",
    description: "สินค้าทดสอบอัปโหลดรูป",
    category: "streaming",
    price: 500,
    active: true,
  });
  assert.equal(s.features.uploads, true);
  assert.deepEqual(s.productDetail(product.id).images, []);
  assert.equal(s.productDetail(product.id).imageUrl, null);

  const a = await s.addProductImage(merchant, product.id, {
    bytes: pngBytes(),
    contentType: "image/png",
  });
  const b = await s.addProductImage(merchant, product.id, {
    bytes: jpegBytes(),
    contentType: "image/jpeg",
  });
  assert.equal(a.image.sort_order, 0);
  assert.equal(b.image.sort_order, 1);
  let detail = s.productDetail(product.id);
  assert.equal(detail.images.length, 2);
  assert.equal(detail.imageUrl, a.image.url);
  assert.equal(detail.images[0].id, a.image.id);

  const reordered = s.reorderProductImages(merchant, product.id, {
    order: [b.image.id, a.image.id],
  });
  assert.equal(reordered.images[0].id, b.image.id);
  detail = s.productDetail(product.id);
  assert.equal(detail.imageUrl, b.image.url);

  const storefront = s.products().find((p) => p.id === product.id);
  assert.equal(storefront.images.length, 2);
  assert.equal(storefront.imageUrl, b.image.url);

  const adminList = s.adminProducts(merchant, {});
  const adminRow = adminList.products.find((p) => p.id === product.id);
  assert.ok(adminRow.images?.length === 2);

  const file = await s.getFile(b.image.url.split("/").pop());
  assert.equal(file.mime, "image/jpeg");
  assert.ok(file.bytes.byteLength >= 4);

  await s.deleteProductImage(merchant, b.image.id);
  detail = s.productDetail(product.id);
  assert.equal(detail.images.length, 1);
  assert.equal(detail.images[0].id, a.image.id);
  assert.equal(detail.imageUrl, a.image.url);

  assert.throws(
    () =>
      s.reorderProductImages(buyer, product.id, { order: [a.image.id] }),
    (e) => e.status === 403,
  );
});

test("UP-1: reject oversized mismatched unauthorized via HTTP", async (t) => {
  const { s, merchantToken, buyerToken } = fixture(t);
  const handle = createAPIHandler(s);
  const product = s.saveProduct(s.session(merchantToken), {
    name: "HTTP Upload Product",
    description: "ทดสอบผ่าน api-handler",
    category: "streaming",
    price: 500,
    active: true,
  });

  async function call(method, path, { token, body, contentType } = {}) {
    const headers = { "X-Astra-Request": "1" };
    if (token) headers.Cookie = "astra_session=" + token;
    if (contentType) headers["Content-Type"] = contentType;
    if (body != null) headers["Content-Length"] = String(body.byteLength ?? Buffer.byteLength(body));
    const response = await handle(
      new Request("http://fixture" + path, {
        method,
        headers,
        body,
      }),
    );
    const buf = new Uint8Array(await response.arrayBuffer());
    let data = null;
    const ct = response.headers.get("Content-Type") || "";
    if (ct.includes("application/json"))
      data = JSON.parse(new TextDecoder().decode(buf));
    return { status: response.status, data, buf, headers: response.headers };
  }

  const badSvg = await call("POST", `/api/admin/products/${product.id}/images`, {
    token: merchantToken,
    body: svgBytes(),
    contentType: "image/svg+xml",
  });
  assert.equal(badSvg.status, 415);

  const mismatch = await call("POST", `/api/admin/products/${product.id}/images`, {
    token: merchantToken,
    body: pngBytes(),
    contentType: "image/jpeg",
  });
  assert.equal(mismatch.status, 415);

  const forbidden = await call("POST", `/api/admin/products/${product.id}/images`, {
    token: buyerToken,
    body: pngBytes(),
    contentType: "image/png",
  });
  assert.equal(forbidden.status, 403);

  const huge = new Uint8Array(2 * 1024 * 1024 + 8);
  huge.set([0x89, 0x50, 0x4e, 0x47], 0);
  const tooBig = await call("POST", `/api/admin/products/${product.id}/images`, {
    token: merchantToken,
    body: huge,
    contentType: "image/png",
  });
  assert.equal(tooBig.status, 413);

  const ok = await call("POST", `/api/admin/products/${product.id}/images`, {
    token: merchantToken,
    body: webpBytes(),
    contentType: "image/webp",
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const key = ok.data.image.url.split("/").pop();
  const got = await call("GET", `/api/files/${key}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("Content-Type"), "image/webp");
  assert.equal(got.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(got.headers.get("Content-Disposition"), "inline");
  assert.match(got.headers.get("Cache-Control") || "", /immutable/);
  assert.deepEqual([...got.buf.slice(0, 4)], [0x52, 0x49, 0x46, 0x46]);

  const jsonStillRequired = await call("POST", "/api/admin/settings", {
    token: merchantToken,
    body: webpBytes(),
    contentType: "image/webp",
  });
  assert.equal(jsonStillRequired.status, 415);
});
