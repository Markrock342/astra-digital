// Back-in-stock notices ("แจ้งเตือนเมื่อสินค้าเข้า") and review replies / moderation:
// subscribe / cancel and their limits, one notice per restock (200 cap, subscription
// order, one-shot), nothing for preorder or in-stock options, waiting counts for the admin,
// reply create + edit, hide / unhide with audit, public data and ratings skip hidden
// reviews, STAFF can reply but cannot hide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ensureReviewModeration, ensureStockWatch } from "../server/ensure-admin-fr.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import {
  BACK_IN_STOCK_TITLE,
  RESTOCK_NOTIFY_LIMIT,
  STOCK_WATCH_MAX_PER_USER,
  STOCK_WATCH_RATE_LIMIT,
} from "../server/stock-watch.mjs";
import { REVIEW_REPLY_TITLE } from "../server/review-moderation.mjs";
import { emailVerificationOff } from "./fixtures/email-verification-off.mjs";

const PREORDER = "cinema-max-90";
const IN_STOCK = "stream-plus-30";

function fixture(t, options = {}) {
  const s = emailVerificationOff(createCommerce({ allowDemoAdmin: true, ...options }));
  t.after(() => s.db.close());
  let n = 0;
  const customer = (name = "Watcher " + ++n, email) => {
    const auth = s.register({
      name,
      email: email ?? name.toLowerCase().replace(/\s+/g, "-") + "@example.invalid",
      password: "Test-only-Password-123",
    });
    return { user: s.session(auth.token), token: auth.token };
  };
  const buyer = customer("Restock Buyer");
  const adminAuth = s.demoMerchant();
  const admin = s.session(adminAuth.token);
  const staffAuth = customer("Review Staff");
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  // A ready-stock product whose only option is out of stock.
  const product = s.saveProduct(admin, {
    name: "Restock Item",
    description: "สินค้าทดสอบแจ้งเตือนเมื่อมีของ",
    category: "streaming",
    price: 5000,
    active: true,
  });
  const variantId = s.adminProductVariants(admin, product.id).variants[0].id;
  let seq = 0;
  const restock = (count = 1, id = variantId) =>
    s.importCodes(admin, {
      variantId: id,
      items: Array.from({ length: count }, () => ({
        loginId: "restock-" + ++seq + "@example.invalid",
        password: "pw-" + seq,
      })),
    });
  return {
    s,
    admin,
    adminToken: adminAuth.token,
    staff,
    staffToken: staffAuth.token,
    user: buyer.user,
    token: buyer.token,
    customer,
    product,
    variantId,
    restock,
  };
}
const notices = (s, userId, kind) =>
  s.db
    .prepare("SELECT * FROM notifications WHERE user_id=? AND kind=? ORDER BY rowid")
    .all(userId, kind);
const audits = (s, action, entity) =>
  s.db
    .prepare("SELECT * FROM audit WHERE action=? AND entity_id=? ORDER BY id")
    .all(action, entity);
const buyAll = (s, user, variantId) => {
  const stock = s.db
    .prepare(
      "SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0",
    )
    .get(variantId).n;
  for (let left = stock; left > 0; left -= Math.min(left, 10)) {
    const order = s.createOrder(user, {
      variantId,
      quantity: Math.min(left, 10),
      requestKey: "buy-all-" + variantId + "-" + left + "-" + Math.random().toString(36).slice(2),
      acceptTerms: true,
    });
    s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  }
};

test("schema helpers are idempotent", (t) => {
  const { s } = fixture(t);
  ensureStockWatch(s.db);
  ensureStockWatch(s.db);
  ensureReviewModeration(s.db);
  ensureReviewModeration(s.db);
  const cols = s.db.prepare("PRAGMA table_info(stock_watch)").all().map((c) => c.name);
  assert.deepEqual(cols, ["id", "user_id", "variant_id", "created_at", "notified_at"]);
  const review = s.db.prepare("PRAGMA table_info(reviews)").all().map((c) => c.name);
  for (const c of ["reply_text", "reply_by", "reply_at", "reply_updated_at", "hidden_at", "hidden_by", "hidden_reason", "hidden_note"])
    assert.ok(review.includes(c), c);
});

test("subscribe, list and cancel; one row per customer and option", (t) => {
  const { s, user, variantId, product } = fixture(t);
  assert.throws(() => s.addStockWatch(null, { variantId }), (e) => e.status === 401);
  assert.deepEqual(s.addStockWatch(user, { variantId }), { watching: true, variantId });
  // Asking twice keeps one row.
  s.addStockWatch(user, { variantId });
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM stock_watch").get().n, 1);
  const list = s.myStockWatches(user);
  assert.equal(list.length, 1);
  assert.equal(list[0].productId, product.id);
  assert.equal(list[0].product, "Restock Item");
  assert.equal(list[0].available, false);
  assert.ok(!("stock" in list[0]));
  assert.deepEqual(s.removeStockWatch(user, variantId), { watching: false, variantId });
  assert.equal(s.myStockWatches(user).length, 0);
  // Cancelling again is fine.
  s.removeStockWatch(user, variantId);
  assert.throws(() => s.addStockWatch(user, { variantId: "missing" }), (e) => e.status === 404);
});

test("no subscription for preorder or in-stock options, nor closed products", (t) => {
  const { s, admin, user, product, variantId } = fixture(t);
  assert.throws(() => s.addStockWatch(user, { variantId: PREORDER }), (e) => e.status === 409);
  assert.throws(() => s.addStockWatch(user, { variantId: IN_STOCK }), (e) => e.status === 409);
  s.saveProduct(admin, {
    id: product.id,
    name: "Restock Item",
    description: "สินค้าทดสอบแจ้งเตือนเมื่อมีของ",
    category: "streaming",
    active: false,
  });
  assert.throws(() => s.addStockWatch(user, { variantId }), (e) => e.status === 404);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM stock_watch").get().n, 0);
});

test("a customer may wait for at most STOCK_WATCH_MAX_PER_USER options", (t) => {
  const { s, admin, user, product } = fixture(t);
  const ids = [];
  for (let i = 0; i < STOCK_WATCH_MAX_PER_USER + 1; i++)
    ids.push(s.createVariant(admin, product.id, { label: "Option " + i, price: 5000 }).id);
  for (const id of ids.slice(0, STOCK_WATCH_MAX_PER_USER)) s.addStockWatch(user, { variantId: id });
  assert.throws(
    () => s.addStockWatch(user, { variantId: ids[STOCK_WATCH_MAX_PER_USER] }),
    (e) => e.status === 409,
  );
});

test("subscribe + cancel share a 30 per hour budget per customer (API)", async (t) => {
  const { s, token, variantId, customer } = fixture(t);
  const handle = createAPIHandler(s);
  const call = async (method, path, who, body) => {
    const response = await handle(
      new Request("http://127.0.0.1" + path, {
        method,
        headers: {
          Cookie: "astra_session=" + who,
          "Content-Type": "application/json",
          "X-Astra-Request": "1",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, data: await response.json() };
  };
  assert.equal(STOCK_WATCH_RATE_LIMIT.perUser, 30);
  assert.equal(STOCK_WATCH_RATE_LIMIT.windowMs, 3600000);
  assert.equal((await call("POST", "/api/stock-watch", "", { variantId })).status, 401);
  for (let i = 0; i < 15; i++) {
    assert.equal((await call("POST", "/api/stock-watch", token, { variantId })).status, 201);
    assert.equal(
      (await call("DELETE", "/api/stock-watch/" + encodeURIComponent(variantId), token)).status,
      200,
    );
  }
  const blocked = await call("POST", "/api/stock-watch", token, { variantId });
  assert.equal(blocked.status, 429);
  assert.equal((await call("DELETE", "/api/stock-watch/" + variantId, token)).status, 429);
  // Another customer has their own budget; listing is not limited.
  const other = customer("Other Watcher");
  assert.equal((await call("POST", "/api/stock-watch", other.token, { variantId })).status, 201);
  const list = await call("GET", "/api/stock-watch", other.token);
  assert.equal(list.status, 200);
  assert.equal(list.data.watches.length, 1);
});

test("a restock notifies each waiting customer once, with a link, and marks them", (t) => {
  const { s, user, customer, variantId, product, restock } = fixture(t);
  const other = customer("Second Watcher");
  s.addStockWatch(user, { variantId });
  s.addStockWatch(other.user, { variantId });
  // Preview (dry run) changes nothing.
  s.previewImportCodes(s.session(s.demoMerchant().token), {
    variantId,
    items: [{ loginId: "preview@example.invalid", password: "pw" }],
  });
  assert.equal(notices(s, user.id, "back_in_stock").length, 0);

  restock(2);
  const [notice] = notices(s, user.id, "back_in_stock");
  assert.equal(notice.title, BACK_IN_STOCK_TITLE);
  assert.equal(notice.body, "Restock Item · โค้ดดิจิทัล");
  assert.equal(notice.link, "/products/" + product.id + "?variant=" + variantId);
  assert.ok(!/\d+\s*ชิ้น|เหลือ/.test(notice.body), "never reveals the stock count");
  assert.equal(notices(s, other.user.id, "back_in_stock").length, 1);
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM stock_watch WHERE notified_at IS NOT NULL").get().n,
    2,
  );
  assert.equal(s.myStockWatches(user).length, 0);

  // More stock while still in stock: not a new restock event, nobody is told again.
  restock(1);
  assert.equal(notices(s, user.id, "back_in_stock").length, 1);
  // Already in stock: cannot subscribe now.
  assert.throws(() => s.addStockWatch(user, { variantId }), (e) => e.status === 409);
});

test("one-shot: after selling out again only customers who ask again are told", (t) => {
  const { s, user, customer, variantId, restock } = fixture(t);
  const other = customer("Once Only");
  s.addStockWatch(user, { variantId });
  s.addStockWatch(other.user, { variantId });
  restock(1);
  buyAll(s, customer("Fast Buyer").user, variantId);
  // Sold out again: only `user` asks again.
  s.addStockWatch(user, { variantId });
  restock(1);
  assert.equal(notices(s, user.id, "back_in_stock").length, 2);
  assert.equal(notices(s, other.user.id, "back_in_stock").length, 1);
});

test("at most 200 notices per restock, in subscription order; the rest wait for the next one", (t) => {
  const { s, variantId, restock, customer } = fixture(t);
  const ids = [];
  const insert = s.db.prepare(
    "INSERT INTO stock_watch(id,user_id,variant_id,created_at) VALUES(?,?,?,datetime('2026-01-01 00:00:00', ?))",
  );
  // 205 waiting customers; created_at spaced one second apart (the first asked first).
  for (let i = 0; i < RESTOCK_NOTIFY_LIMIT + 5; i++) {
    const id = "user-" + String(i).padStart(3, "0");
    s.db
      .prepare("INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)")
      .run(id, id + "@example.invalid", "Waiter " + i, "x:y");
    insert.run("watch-" + i, id, variantId, "+" + i + " seconds");
    ids.push(id);
  }
  restock(1);
  const told = s.db
    .prepare("SELECT user_id FROM notifications WHERE kind='back_in_stock' ORDER BY user_id")
    .all()
    .map((r) => r.user_id);
  assert.equal(told.length, RESTOCK_NOTIFY_LIMIT);
  assert.deepEqual(told, ids.slice(0, RESTOCK_NOTIFY_LIMIT));
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM stock_watch WHERE notified_at IS NULL").get().n,
    5,
  );
  // The 5 left over keep their place and are told on the next restock.
  buyAll(s, customer("Sell Out").user, variantId);
  restock(1);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='back_in_stock'").get().n, RESTOCK_NOTIFY_LIMIT + 5);
});

test("nothing is sent for preorder or in-stock options, or without waiting customers", (t) => {
  const { s, admin, user, restock } = fixture(t);
  // Rows that could only exist through old data: an in-stock option and a preorder one.
  s.db
    .prepare("INSERT INTO stock_watch(id,user_id,variant_id) VALUES('w1',?,?),('w2',?,?)")
    .run(user.id, IN_STOCK, user.id, PREORDER);
  restock(1, IN_STOCK);
  s.importCodes(admin, { variantId: PREORDER, items: [{ loginId: "pre@example.invalid", password: "pw" }] });
  assert.equal(notices(s, user.id, "back_in_stock").length, 0);
  // No waiting customers: an import sends nothing.
  restock(1);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='back_in_stock'").get().n, 0);
});

test("re-opening a product or option that has stock counts as a restock", (t) => {
  const { s, admin, user, product, variantId, restock } = fixture(t);
  s.addStockWatch(user, { variantId });
  // Closed while stock arrives: nobody is told yet.
  s.updateVariant(admin, variantId, { active: false });
  restock(1);
  assert.equal(notices(s, user.id, "back_in_stock").length, 0);
  s.updateVariant(admin, variantId, { active: true });
  assert.equal(notices(s, user.id, "back_in_stock").length, 1);

  const { s: s2, admin: admin2, user: user2, product: p2, variantId: v2, restock: restock2 } = fixture(t);
  s2.addStockWatch(user2, { variantId: v2 });
  s2.bulkUpdateProducts(admin2, { ids: [p2.id], action: "deactivate" });
  restock2(1);
  assert.equal(notices(s2, user2.id, "back_in_stock").length, 0);
  s2.bulkUpdateProducts(admin2, { ids: [p2.id], action: "activate" });
  assert.equal(notices(s2, user2.id, "back_in_stock").length, 1);
  assert.ok(product.id);
});

test("admin sees the waiting count per option; customers never do", (t) => {
  const { s, admin, staff, user, customer, variantId, product } = fixture(t);
  s.addStockWatch(user, { variantId });
  s.addStockWatch(customer("Third").user, { variantId });
  const variants = s.adminProductVariants(admin, product.id).variants;
  assert.equal(variants.find((v) => v.id === variantId).waiting, 2);
  const listed = s.adminProducts(staff, { q: "Restock Item" }).products[0];
  assert.equal(listed.variants.find((v) => v.id === variantId).waiting, 2);
  const publicVariant = s.productDetail(product.id).variants.find((v) => v.id === variantId);
  assert.ok(!("waiting" in publicVariant));
  assert.equal(publicVariant.stockStatus, "out");
  // Cancelled and notified rows are not counted.
  s.removeStockWatch(user, variantId);
  assert.equal(s.adminProductVariants(admin, product.id).variants[0].waiting, 1);
});

test("the outside daily summary lists the most-waited options", async (t) => {
  const OWNER = "Owner-restock-Password-1";
  const EVENING = Date.UTC(2026, 10, 13, 14, 30, 0); // 21:30 Bangkok
  const calls = [];
  const s = createCommerce({
    adminPassword: OWNER,
    clock: () => EVENING,
    alertFetch: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    },
  });
  t.after(() => s.db.close());
  const adminToken = s.login({ email: "admin@astra.local", password: OWNER }).token;
  const admin = s.session(adminToken);
  const p = s.saveProduct(admin, { name: "Summary Wait", description: "ทดสอบสรุปรายวัน", category: "streaming", price: 100, active: true });
  const variantId = s.adminProductVariants(admin, p.id).variants[0].id;
  for (const name of ["Wait One", "Wait Two"]) {
    const auth = s.register({ name, email: name.replace(" ", "-") + "@example.invalid", password: "Test-only-Password-123" });
    s.addStockWatch(s.session(auth.token), { variantId });
  }
  const handle = createAPIHandler(s);
  const response = await handle(
    new Request("https://shop.example.test/api/admin/alerts", {
      method: "POST",
      headers: { Cookie: "astra_session=" + adminToken, "Content-Type": "application/json", "X-Astra-Request": "1" },
      body: JSON.stringify({
        currentPassword: OWNER,
        channels: { discord: { enabled: true, url: "https://discord.com/api/webhooks/123456789012345678/fake-webhook-token-for-tests-only-0000" } },
        events: { order_paid: false, stock_low: false },
      }),
    }),
  );
  assert.equal(response.status, 200);
  await s.runScheduledJobs(EVENING);
  await s.alertsIdle();
  const text = calls.map((c) => c.content ?? c.text).find((x) => x.includes("สรุปยอดวันนี้"));
  assert.match(text, /รอแจ้งเตือนเมื่อมีของ: Summary Wait \/ โค้ดดิจิทัล 2 คน/);
});

test("restock email goes only to real addresses, once", async (t) => {
  const mails = [];
  const mailer = {
    enabled: true,
    provider: "test",
    from: "shop@example.com",
    send: async (message) => {
      mails.push(message);
      return { id: "m" + mails.length };
    },
  };
  const { s, user, customer, variantId, restock } = fixture(t, { email: mailer, publicBaseUrl: "https://shop.example.com" });
  const real = customer("Real Mail", "real.person@gmail.com");
  const placeholder = customer("No Mail", "someone@no-email.asiax.local");
  s.addStockWatch(real.user, { variantId });
  s.addStockWatch(placeholder.user, { variantId });
  s.addStockWatch(user, { variantId }); // @example.invalid: not a real address either
  restock(1);
  await s.emailIdle();
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "real.person@gmail.com");
  assert.match(mails[0].subject, /สินค้าที่คุณรอกลับมามีของแล้ว/);
  assert.ok(mails[0].text.includes("https://shop.example.com/products/"));
  assert.ok(!/เหลือ\s*\d/.test(mails[0].text));
  assert.equal(notices(s, placeholder.user.id, "back_in_stock").length, 1);
});

// ------------------------------------------------------------------ reviews

function reviewed(t) {
  const f = fixture(t);
  const { s, user } = f;
  const order = s.createOrder(user, {
    variantId: IN_STOCK,
    quantity: 1,
    requestKey: "review-order-1",
    acceptTerms: true,
  });
  s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" });
  s.addReview(user, { orderId: order.id, rating: 1, comment: "ไม่ประทับใจ ได้ของช้า" });
  const review = s.db.prepare("SELECT * FROM reviews WHERE order_id=?").get(order.id);
  return { ...f, order, review };
}

test("shop reply: create notifies the customer once, edit updates without a new notice", (t) => {
  const { s, admin, staff, user, review } = reviewed(t);
  assert.throws(() => s.replyToReview(user, review.id, { text: "hi" }), (e) => e.status === 403);
  assert.throws(() => s.replyToReview(staff, review.id, { text: "   " }), (e) => e.status === 400);
  assert.throws(() => s.replyToReview(staff, "missing", { text: "hi" }), (e) => e.status === 404);
  const first = s.replyToReview(staff, review.id, { text: "ขออภัยค่ะ ร้านเร่งส่งให้แล้ว" });
  assert.equal(first.reply.text, "ขออภัยค่ะ ร้านเร่งส่งให้แล้ว");
  assert.equal(first.reply.by, "Review Staff");
  assert.equal(first.reply.updatedAt, null);
  const [notice] = notices(s, user.id, "review_reply");
  assert.equal(notice.title, REVIEW_REPLY_TITLE);
  assert.equal(notice.link, "/reviews?review=" + review.id);

  const edited = s.replyToReview(admin, review.id, { text: "ขออภัยค่ะ ร้านส่งของให้แล้ว ติดต่อแชทได้เลย" });
  assert.equal(edited.reply.text, "ขออภัยค่ะ ร้านส่งของให้แล้ว ติดต่อแชทได้เลย");
  assert.ok(edited.reply.updatedAt);
  assert.equal(edited.reply.at, first.reply.at);
  assert.equal(notices(s, user.id, "review_reply").length, 1);
  const rows = audits(s, "REVIEW_REPLY", review.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(JSON.parse(rows[0].detail), { edited: false, length: "ขออภัยค่ะ ร้านเร่งส่งให้แล้ว".length });
  assert.equal(JSON.parse(rows[1].detail).edited, true);

  const pub = s.reviews().find((r) => r.id === review.id);
  assert.equal(pub.reply.text, edited.reply.text);
  assert.ok(!JSON.stringify(pub).includes("Review Staff"), "the replier's name stays internal");
});

test("hide needs ADMIN and a listed reason; unhide restores; both audited", (t) => {
  const { s, admin, staff, review } = reviewed(t);
  assert.throws(() => s.hideReview(staff, review.id, { reason: "SPAM" }), (e) => e.status === 403);
  assert.throws(() => s.hideReview(admin, review.id, {}), (e) => e.status === 400);
  assert.throws(() => s.hideReview(admin, review.id, { reason: "NEGATIVE" }), (e) => e.status === 400);
  assert.throws(() => s.hideReview(admin, review.id, { reason: "OTHER" }), (e) => e.status === 400);
  const hidden = s.hideReview(admin, review.id, { reason: "OTHER", note: "ลูกค้าขอให้ลบเอง" });
  assert.equal(hidden.hidden.reason, "OTHER");
  assert.equal(hidden.hidden.reasonText, "อื่นๆ");
  assert.equal(hidden.hidden.note, "ลูกค้าขอให้ลบเอง");
  assert.throws(() => s.hideReview(admin, review.id, { reason: "SPAM" }), (e) => e.status === 409);
  assert.throws(() => s.unhideReview(staff, review.id), (e) => e.status === 403);
  const shown = s.unhideReview(admin, review.id);
  assert.equal(shown.hidden, null);
  assert.throws(() => s.unhideReview(admin, review.id), (e) => e.status === 409);
  const hide = audits(s, "REVIEW_HIDE", review.id);
  const unhide = audits(s, "REVIEW_UNHIDE", review.id);
  assert.equal(hide.length, 1);
  assert.equal(hide[0].user_id, admin.id);
  assert.deepEqual(JSON.parse(hide[0].detail), { reason: "OTHER", note: "ลูกค้าขอให้ลบเอง", rating: 1 });
  assert.equal(unhide.length, 1);
  assert.equal(JSON.parse(unhide[0].detail).previousReason, "OTHER");
});

test("public reviews and the rating skip hidden reviews; the admin list keeps them", (t) => {
  const { s, admin, staff, review } = reviewed(t);
  const product = () => s.products().find((p) => p.id === "stream-plus");
  // Seeded 5-star review + the new 1-star review.
  assert.equal(product().rating.count, 2);
  assert.equal(product().rating.average, 3);
  assert.ok(s.reviews().some((r) => r.id === review.id));

  s.hideReview(admin, review.id, { reason: "SPAM" });
  assert.ok(!s.reviews().some((r) => r.id === review.id));
  assert.equal(product().rating.count, 1);
  assert.equal(product().rating.average, 5);
  assert.equal(s.productDetail("stream-plus").rating.average, 5);

  const list = s.adminReviews(staff, {});
  const row = list.reviews.find((r) => r.id === review.id);
  assert.equal(row.hidden.reason, "SPAM");
  assert.equal(row.hidden.reasonText, "สแปม/โฆษณา");
  assert.equal(list.summary.hidden, 1);
  assert.equal(list.summary.average, 5);
  assert.equal(list.canHide, false);
  assert.equal(s.adminReviews(admin, {}).canHide, true);
  assert.deepEqual(
    s.adminReviews(admin, { hidden: "yes" }).reviews.map((r) => r.id),
    [review.id],
  );
  assert.ok(!s.adminReviews(admin, { hidden: "no" }).reviews.some((r) => r.id === review.id));

  s.unhideReview(admin, review.id);
  assert.equal(product().rating.count, 2);
  assert.equal(product().rating.average, 3);
});

test("admin review filters: rating, product, reply and paging", (t) => {
  const { s, admin, user, review } = reviewed(t);
  assert.throws(() => s.adminReviews(user, {}), (e) => e.status === 403);
  assert.deepEqual(s.adminReviews(admin, { rating: "1" }).reviews.map((r) => r.id), [review.id]);
  assert.throws(() => s.adminReviews(admin, { rating: "9" }), (e) => e.status === 400);
  assert.equal(s.adminReviews(admin, { product: "stream-plus" }).reviews.length, 2);
  assert.equal(s.adminReviews(admin, { product: "cinema-max" }).reviews.length, 0);
  assert.equal(s.adminReviews(admin, { reply: "yes" }).reviews.length, 0);
  s.replyToReview(admin, review.id, { text: "ขอบคุณค่ะ" });
  assert.deepEqual(s.adminReviews(admin, { reply: "yes" }).reviews.map((r) => r.id), [review.id]);
  assert.equal(s.adminReviews(admin, { reply: "no" }).reviews.length, 1);
  const first = s.adminReviews(admin, { limit: "1" });
  assert.equal(first.reviews.length, 1);
  assert.ok(first.nextCursor);
  const second = s.adminReviews(admin, { limit: "1", cursor: first.nextCursor });
  assert.equal(second.reviews.length, 1);
  assert.notEqual(second.reviews[0].id, first.reviews[0].id);
  assert.equal(second.nextCursor, null);
  assert.ok(first.products.some((p) => p.id === "stream-plus"));
  assert.equal(first.reasons.length, 4);
});

test("review APIs: STAFF replies, STAFF cannot hide, ADMIN hides", async (t) => {
  const { s, staffToken, adminToken, token, review } = reviewed(t);
  const handle = createAPIHandler(s);
  const call = async (method, path, who, body) => {
    const response = await handle(
      new Request("http://127.0.0.1" + path, {
        method,
        headers: {
          Cookie: "astra_session=" + who,
          "Content-Type": "application/json",
          "X-Astra-Request": "1",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await call("GET", "/api/admin/reviews", token)).status, 403);
  assert.equal((await call("GET", "/api/admin/reviews?rating=1", staffToken)).data.reviews.length, 1);
  const reply = await call("POST", "/api/admin/reviews/" + review.id + "/reply", staffToken, { text: "ขอบคุณค่ะ" });
  assert.equal(reply.status, 200);
  assert.equal(reply.data.review.reply.text, "ขอบคุณค่ะ");
  assert.equal(
    (await call("POST", "/api/admin/reviews/" + review.id + "/hide", staffToken, { reason: "SPAM" })).status,
    403,
  );
  const hide = await call("POST", "/api/admin/reviews/" + review.id + "/hide", adminToken, { reason: "ABUSE" });
  assert.equal(hide.status, 200);
  assert.equal(hide.data.review.hidden.reason, "ABUSE");
  const pub = await call("GET", "/api/reviews", token);
  assert.ok(!pub.data.reviews.some((r) => r.id === review.id));
  assert.equal(
    (await call("POST", "/api/admin/reviews/" + review.id + "/unhide", adminToken, {})).status,
    200,
  );
});
