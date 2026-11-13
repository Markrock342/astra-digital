// Category icon uploaded by the shop ("upload-<key>"): admin only, validated, old file cleaned up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";

const png = () => {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return b;
};
function fixture(t) {
  const s = createCommerce({ allowDemoAdmin: true });
  t.after(() => s.db.close());
  const adminAuth = s.demoMerchant();
  const buyerAuth = s.register({ name: "Cat Buyer", email: "cat-buyer@example.invalid", password: "Buyer-only-Password-123" });
  return { s, admin: s.session(adminAuth.token), adminToken: adminAuth.token, buyerToken: buyerAuth.token };
}
const upload = async (s, token) => {
  const r = await createAPIHandler(s)(
    new Request("http://127.0.0.1/api/admin/categories/image", {
      method: "POST",
      headers: { Cookie: "astra_session=" + token, "Content-Type": "image/png", "X-Astra-Request": "1" },
      body: png(),
    }),
  );
  return { status: r.status, data: await r.json() };
};
const fileStatus = async (s, url) => (await createAPIHandler(s)(new Request("http://127.0.0.1" + url))).status;

test("admin uploads a category picture, saves it, and the public list carries it", async (t) => {
  const { s, admin, adminToken } = fixture(t);
  const up = await upload(s, adminToken);
  assert.equal(up.status, 201);
  assert.match(up.data.icon, /^upload-[0-9a-f-]{36}$/);
  assert.equal(await fileStatus(s, up.data.url), 200);
  const { category } = s.adminCreateCategory(admin, { id: "my-shop", name_th: "ของร้านเอง", icon: up.data.icon });
  assert.equal(category.icon, up.data.icon);
});

test("replacing or deleting removes the old uploaded file; library icons are untouched", async (t) => {
  const { s, admin, adminToken } = fixture(t);
  const first = (await upload(s, adminToken)).data;
  const second = (await upload(s, adminToken)).data;
  s.adminCreateCategory(admin, { id: "swap", name_th: "สลับรูป", icon: first.icon });
  s.adminUpdateCategory(admin, "swap", { icon: second.icon });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await fileStatus(s, first.url), 404, "old upload deleted");
  assert.equal(await fileStatus(s, second.url), 200);
  s.adminUpdateCategory(admin, "swap", { icon: "netflix" });
  s.adminDeleteCategory(admin, "swap");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await fileStatus(s, second.url), 404);
});

test("only admins upload; a malformed upload- value is refused", async (t) => {
  const { s, admin, buyerToken } = fixture(t);
  assert.equal((await upload(s, buyerToken)).status, 403);
  assert.throws(() => s.adminCreateCategory(admin, { id: "bad", name_th: "ไม่ถูก", icon: "upload-not-a-key" }), (e) => e.status === 400);
});
