// Editable FAQ (settings.faq), announcements to customers (broadcasts) and buy-again helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createAPIHandler } from "../server/api-handler.mjs";
import { ensureBroadcasts } from "../server/ensure-admin-fr.mjs";
import { ROLES } from "../server/auth-policy.mjs";
import {
  DEFAULT_FAQ,
  DEFAULT_FAQ_EN,
  faqForPage,
  faqForProduct,
  faqItems,
  faqJsonLd,
  jsonLdText,
  localizeFaqItem,
  normalizeFaq,
  parseBlocks,
  searchFaq,
} from "../server/faq.mjs";
import { BROADCAST_LIMITS, cleanBroadcastLink } from "../server/broadcast.mjs";
import { rebuyAction, renewalDue } from "../server/rebuy.mjs";
import { sitemapXml } from "../server/seo.mjs";

const adminPassword = randomBytes(24).toString("hex");
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
function fakeMailer() {
  const sent = [];
  return {
    sent,
    enabled: true,
    provider: "test",
    from: "shop@mail.example.com",
    async send(message) {
      sent.push(message);
      return { id: "msg-" + sent.length };
    },
  };
}

function shop(t, options = {}) {
  let now = Date.parse("2026-11-13T05:00:00Z");
  const s = createCommerce({ adminPassword, clock: () => now, ...options });
  t.after(() => s.db.close());
  const admin = s.session(s.login({ email: "admin@astra.local", password: adminPassword }).token);
  s.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const customer = (name, email) => {
    const auth = s.register({ name, email, password: "Buyer-Pass-12345" });
    return { user: s.session(auth.token), token: auth.token };
  };
  const product = (name, extra = {}) => {
    const p = s.saveProduct(admin, {
      name,
      description: name + " สำหรับทดสอบ",
      category: "streaming",
      price: 9900,
      active: true,
      firstLabel: "1 เดือน",
      firstWarrantyDays: 30,
      ...extra,
    });
    const variantId = s.adminProductVariants(admin, p.id).variants[0].id;
    return { id: p.id, variantId };
  };
  const stock = (variantId, n = 3) =>
    s.importCodes(admin, {
      variantId,
      items: Array.from({ length: n }, (_, i) => ({
        loginId: "acc-" + variantId.slice(0, 6) + "-" + i + "-" + randomBytes(3).toString("hex"),
        password: "pw-" + i,
      })),
    });
  let seq = 0;
  const buy = (user, variantId, pay = true) => {
    const order = s.createOrder(user, { variantId, quantity: 1, requestKey: "req-key-" + ++seq });
    return pay ? s.pay(user, order.id, { paymentToken: order.paymentToken, outcome: "success" }) : order;
  };
  return {
    s,
    admin,
    customer,
    product,
    stock,
    buy,
    advance: (ms) => (now += ms),
    now: () => now,
  };
}

const call = async (s, method, path, token, body) => {
  const handle = createAPIHandler(s);
  const response = await handle(
    new Request("http://127.0.0.1" + path, {
      method,
      headers: {
        ...(token ? { Cookie: "astra_session=" + token } : {}),
        "Content-Type": "application/json",
        "X-Astra-Request": "1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, data: await response.json() };
};

// ------------------------------------------------------------------ FAQ

test("faq defaults: formal Thai answers that match how the shop works, English for each", () => {
  const ids = DEFAULT_FAQ.map((i) => i.id);
  for (const id of ["delivery-time", "preorder-queue", "warranty", "no-password-change", "refund", "contact"])
    assert.ok(ids.includes(id), id);
  const all = DEFAULT_FAQ.map((i) => i.question + "\n" + i.answer).join("\n");
  assert.match(all, /ทันทีหลังชำระเงินสำเร็จ/);
  assert.match(all, /เลขคิว/);
  assert.match(all, /แจ้งปัญหาบัญชีนี้/);
  assert.match(all, /อย่าเปลี่ยนรหัสผ่าน/);
  assert.match(all, /ข้อกำหนดการใช้บริการ/);
  assert.match(all, /แชท/);
  for (const item of DEFAULT_FAQ) {
    assert.ok(DEFAULT_FAQ_EN[item.id], "EN for " + item.id);
    assert.ok(parseBlocks(item.answer).length > 0);
  }
  assert.equal(DEFAULT_FAQ.find((i) => i.id === "preorder-queue").scope, "preorder");
  // Built-in text translates; anything the owner wrote stays as written.
  const d = faqItems(null)[0];
  assert.equal(localizeFaqItem(d, "en").question, DEFAULT_FAQ_EN[d.id].question);
  assert.equal(localizeFaqItem({ ...d, question: "ของร้านเอง" }, "en").question, "ของร้านเอง");
  assert.equal(localizeFaqItem(d, "th"), d);
});

test("normalizeFaq validates items, scope and products; rendering keeps markup as text", () => {
  const ok = normalizeFaq(
    {
      items: [
        { id: "a", question: "  คำถาม \n แรก ", answer: "ย่อหน้า\n\n- ข้อหนึ่ง\n- <b>ข้อสอง</b>\r\n", scope: "all", extra: 1 },
        { id: "b", question: "เฉพาะ", answer: "x", scope: "products", productIds: ["p1", "p1", "p2"] },
        { id: "c", question: "ซ่อน", answer: "y", hidden: true, productIds: ["ignored"] },
      ],
    },
    fail,
    { productExists: (id) => id !== "nope" },
  );
  assert.deepEqual(ok.items[0], { id: "a", question: "คำถาม แรก", answer: "ย่อหน้า\n\n- ข้อหนึ่ง\n- <b>ข้อสอง</b>", scope: "all" });
  assert.deepEqual(ok.items[1].productIds, ["p1", "p2"]);
  assert.deepEqual(ok.items[2], { id: "c", question: "ซ่อน", answer: "y", scope: "all", hidden: true });
  const blocks = parseBlocks(ok.items[0].answer);
  assert.deepEqual(blocks, [
    { type: "p", text: "ย่อหน้า" },
    { type: "ul", items: ["ข้อหนึ่ง", "<b>ข้อสอง</b>"] },
  ]);
  const bad = (input, re, opts) => assert.throws(() => normalizeFaq(input, fail, opts), (e) => e.status === 400 && re.test(e.message));
  bad(null, /ไม่ถูกต้อง/);
  bad({ items: "x" }, /ไม่ถูกต้อง/);
  bad({ items: [{ id: "BAD ID", question: "q", answer: "a" }] }, /รหัสคำถาม/);
  bad({ items: [{ id: "a", question: "q", answer: "a" }, { id: "a", question: "q", answer: "a" }] }, /ซ้ำ/);
  bad({ items: [{ id: "a", question: " ", answer: "a" }] }, /ทั้งคำถามและคำตอบ/);
  bad({ items: [{ id: "a", question: "q", answer: "a", scope: "vip" }] }, /ขอบเขต/);
  bad({ items: [{ id: "a", question: "q", answer: "a", scope: "products", productIds: [] }] }, /เลือกสินค้า/);
  bad({ items: [{ id: "a", question: "q", answer: "a", scope: "products", productIds: ["nope"] }] }, /ไม่พบสินค้า/, {
    productExists: (id) => id !== "nope",
  });
  bad({ items: [{ id: "a", question: "q".repeat(201), answer: "a" }] }, /ยาวเกินไป/);
  bad({ items: [{ id: "a", question: "q", answer: "a".repeat(5001) }] }, /ยาวเกินไป/);
  bad({ items: Array.from({ length: 61 }, (_, i) => ({ id: "q" + i, question: "q", answer: "a" })) }, /สูงสุด/);
});

test("faq scope: product pages get their own + preorder + general items; /faq gets general + preorder; search", () => {
  const faq = {
    items: [
      { id: "g1", question: "ทั่วไป ส่งไว", answer: "ทันที", scope: "all" },
      { id: "p1", question: "เฉพาะ Netflix", answer: "โปรไฟล์ส่วนตัว", scope: "products", productIds: ["netflix"] },
      { id: "pre", question: "พรีออเดอร์", answer: "ตามคิว", scope: "preorder" },
      { id: "h", question: "ซ่อนอยู่", answer: "ไม่แสดง", scope: "all", hidden: true },
      { id: "g2", question: "Refund policy", answer: "See TERMS page", scope: "all" },
    ],
  };
  const ids = (list) => list.map((i) => i.id);
  assert.deepEqual(ids(faqForProduct(faq, { id: "netflix" })), ["p1", "g1", "g2"]);
  assert.deepEqual(ids(faqForProduct(faq, { id: "other" })), ["g1", "g2"]);
  assert.deepEqual(ids(faqForProduct(faq, { id: "other", preorder: 1 })), ["pre", "g1", "g2"]);
  const page = faqForPage(faq);
  assert.deepEqual(ids(page.general), ["g1", "g2"]);
  assert.deepEqual(ids(page.preorder), ["pre"]);
  // Defaults when never saved.
  assert.equal(faqForPage(null).general.length, DEFAULT_FAQ.filter((i) => i.scope === "all").length);
  const general = page.general;
  assert.deepEqual(ids(searchFaq(general, "ส่งไว")), ["g1"]);
  assert.deepEqual(ids(searchFaq(general, "  terms   REFUND ")), ["g2"], "every word, any case, question or answer");
  assert.deepEqual(ids(searchFaq(general, "")), ["g1", "g2"]);
  assert.deepEqual(ids(searchFaq(general, "ไม่มีคำนี้")), []);
});

test("faq JSON-LD is FAQPage data with '<' escaped so it can never close the script element", () => {
  const data = faqJsonLd([{ question: "Q </script><script>alert(1)</script>", answer: "A\n\n- one\n- two" }]);
  assert.equal(data["@type"], "FAQPage");
  assert.equal(data.mainEntity[0]["@type"], "Question");
  assert.equal(data.mainEntity[0].acceptedAnswer.text, "A\n\n- one\n- two");
  const text = jsonLdText(data);
  assert.ok(!text.includes("<"), text);
  assert.deepEqual(JSON.parse(text), data);
});

test("faq saves through settings (ADMIN only), is served by GET /api/faq, kept out of /api/overview, audited", async (t) => {
  const { s, admin, customer, product } = shop(t);
  const p = product("FAQ Stream");
  const buyer = customer("FAQ Buyer", "faq-buyer@example.invalid");
  assert.deepEqual(s.faq(), { faq: null });
  const faq = {
    items: [
      { id: "mine", question: "ใช้กี่จอ", answer: "- 1 จอ\n- <img src=x onerror=alert(1)>", scope: "products", productIds: [p.id] },
      ...DEFAULT_FAQ.slice(0, 2),
    ],
  };
  assert.throws(() => s.saveSettings(buyer.user, { faq }), (e) => e.status === 403);
  assert.throws(
    () => s.saveSettings(admin, { faq: { items: [{ id: "x", question: "q", answer: "a", scope: "products", productIds: ["no-such"] }] } }),
    (e) => e.status === 400 && /ไม่พบสินค้า/.test(e.message),
  );
  s.saveSettings(admin, { faq });
  assert.equal(s.faq().faq.items.length, 3);
  assert.equal(s.overview().shop.faq, undefined);
  const res = await call(s, "GET", "/api/faq");
  assert.equal(res.status, 200);
  assert.equal(res.data.faq.items[0].answer, "- 1 จอ\n- <img src=x onerror=alert(1)>", "stored as typed; escaped when rendered");
  const list = faqForProduct(res.data.faq, { id: p.id });
  assert.equal(list[0].id, "mine");
  const row = s.db
    .prepare("SELECT detail FROM audit WHERE action='SAVE_SETTINGS' ORDER BY id DESC LIMIT 1")
    .get();
  assert.deepEqual(JSON.parse(row.detail).changed.faq, { fields: ["items"] });
});

test("sitemap lists /faq", () => {
  assert.ok(sitemapXml("https://shop.test", []).includes("<loc>https://shop.test/faq</loc>"));
});

// ------------------------------------------------------------------ broadcasts

test("ensureBroadcasts is idempotent", (t) => {
  const { s } = shop(t);
  ensureBroadcasts(s.db);
  ensureBroadcasts(s.db);
  const cols = s.db.prepare("PRAGMA table_info(broadcasts)").all().map((c) => c.name);
  for (const c of ["id", "created_ms", "sender_id", "title", "body", "link", "audience", "audience_label", "recipients", "email_requested", "emails_queued"])
    assert.ok(cols.includes(c), c);
});

test("broadcast links: same-site path or https only", () => {
  assert.equal(cleanBroadcastLink("", fail), null);
  assert.equal(cleanBroadcastLink(undefined, fail), null);
  assert.equal(cleanBroadcastLink(" /products/netflix ", fail), "/products/netflix");
  assert.equal(cleanBroadcastLink("https://example.com/x?y=1", fail), "https://example.com/x?y=1");
  for (const bad of ["javascript:alert(1)", "http://example.com", "//evil.example", "ftp://x", "/a b", "https://u:p@x.com", "data:text/html,x"])
    assert.throws(() => cleanBroadcastLink(bad, fail), (e) => e.status === 400, bad);
});

test("broadcast audiences: all customers, buyers of one product in N days, unpaid orders", (t) => {
  const { s, admin, customer, product, stock, buy, advance } = shop(t);
  const a = product("Audience A");
  const b = product("Audience B");
  stock(a.variantId, 5);
  stock(b.variantId, 5);
  const oldBuyer = customer("Old Buyer", "old@example.invalid");
  buy(oldBuyer.user, a.variantId);
  advance(20 * 86400000);
  const recentA = customer("Recent A", "recent-a@example.invalid");
  buy(recentA.user, a.variantId);
  const recentB = customer("Recent B", "recent-b@example.invalid");
  buy(recentB.user, b.variantId);
  const unpaid = customer("Unpaid", "unpaid@example.invalid");
  buy(unpaid.user, b.variantId, false);
  const failedOnly = customer("Failed", "failed@example.invalid");
  const failed = s.createOrder(failedOnly.user, { variantId: a.variantId, quantity: 1, requestKey: "failed-order-1" });
  s.pay(failedOnly.user, failed.id, { paymentToken: failed.paymentToken, outcome: "failure" });
  const suspended = customer("Suspended", "suspended@example.invalid");
  s.db.prepare("UPDATE users SET status='SUSPENDED' WHERE id=?").run(suspended.user.id);

  const customers = s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='CUSTOMER' AND COALESCE(status,'ACTIVE')='ACTIVE'").get().n;
  const all = s.broadcastPreview(admin, { audience: "all" });
  assert.equal(all.count, customers);
  assert.equal(all.label, "ลูกค้าทั้งหมด");
  const lastWeek = s.broadcastPreview(admin, { audience: "buyers", productId: a.id, days: "7" });
  assert.equal(lastWeek.count, 1, "only the recent paid buyer of A");
  assert.equal(lastWeek.label, "ลูกค้าที่ซื้อ Audience A ใน 7 วันที่ผ่านมา");
  assert.equal(s.broadcastPreview(admin, { audience: "buyers", productId: a.id, days: 30 }).count, 2);
  assert.equal(s.broadcastPreview(admin, { audience: "buyers", productId: b.id, days: 30 }).count, 1, "unpaid B order is not a purchase");
  assert.equal(s.broadcastPreview(admin, { audience: "unpaid" }).count, 1);
  for (const q of [
    { audience: "vip" },
    { audience: "buyers" },
    { audience: "buyers", productId: "no-such", days: 7 },
    { audience: "buyers", productId: a.id, days: 0 },
    { audience: "buyers", productId: a.id, days: 366 },
  ])
    assert.throws(() => s.broadcastPreview(admin, q), (e) => e.status === 400, JSON.stringify(q));
  assert.throws(() => s.broadcastPreview(recentA.user, { audience: "all" }), (e) => e.status === 403);
  // Unpaid orders whose payment window ran out are expired before counting.
  advance(2 * 3600000);
  assert.equal(s.broadcastPreview(admin, { audience: "unpaid" }).count, 0);
});

test("broadcast send: ADMIN + password, notifications for the audience only, history and audit", async (t) => {
  const { s, admin, customer, product, stock, buy } = shop(t);
  const p = product("Send Stream");
  stock(p.variantId, 3);
  const buyer = customer("Send Buyer", "send-buyer@example.invalid");
  const other = customer("Other Person", "other-person@example.invalid");
  buy(buyer.user, p.variantId);
  const staffAuth = s.register({ name: "Staff", email: "bc-staff@example.invalid", password: "Staff-only-Password-123" });
  s.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  const staff = s.session(staffAuth.token);
  const input = {
    title: "  ต่ออายุ  Send Stream ",
    body: "บัญชีของคุณใกล้หมดอายุ\n\n- กดซื้อซ้ำได้เลย\n<b>ไม่ใช่ HTML</b>",
    link: "/orders",
    audience: "buyers",
    productId: p.id,
    days: 30,
  };
  assert.throws(() => s.sendBroadcast(staff, { ...input, currentPassword: "x" }), (e) => e.status === 403);
  assert.throws(() => s.sendBroadcast(buyer.user, { ...input, currentPassword: "x" }), (e) => e.status === 403);
  assert.throws(() => s.sendBroadcast(admin, input), (e) => e.status === 403 && /รหัสผ่าน/.test(e.message));
  assert.throws(() => s.sendBroadcast(admin, { ...input, currentPassword: "wrong-password" }), (e) => e.status === 403);
  assert.throws(() => s.sendBroadcast(admin, { ...input, title: "", currentPassword: adminPassword }), (e) => e.status === 400);
  assert.throws(() => s.sendBroadcast(admin, { ...input, body: "x".repeat(2001), currentPassword: adminPassword }), (e) => e.status === 400);
  assert.throws(() => s.sendBroadcast(admin, { ...input, link: "javascript:alert(1)", currentPassword: adminPassword }), (e) => e.status === 400);
  assert.throws(
    () => s.sendBroadcast(admin, { ...input, email: true, currentPassword: adminPassword }),
    (e) => e.status === 400 && /อีเมล/.test(e.message),
    "email channel needs email configured",
  );
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='broadcast'").get().n, 0);

  const result = s.sendBroadcast(admin, { ...input, currentPassword: adminPassword });
  assert.equal(result.count, 1);
  assert.equal(result.emailsQueued, 0);
  assert.equal(result.broadcast.title, "ต่ออายุ Send Stream");
  assert.equal(result.broadcast.sender, s.publicUser(admin).name);
  const mine = s.notifications(buyer.user).filter((n) => n.kind === "broadcast");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].body, "บัญชีของคุณใกล้หมดอายุ\n\n- กดซื้อซ้ำได้เลย\n<b>ไม่ใช่ HTML</b>");
  assert.equal(mine[0].link, "/orders");
  assert.equal(s.notifications(other.user).filter((n) => n.kind === "broadcast").length, 0);
  assert.equal(s.notifications(admin).filter((n) => n.kind === "broadcast").length, 0, "staff accounts are not customers");

  const status = s.broadcastStatus(admin);
  assert.equal(status.history.length, 1);
  assert.equal(status.history[0].recipients, 1);
  assert.equal(status.history[0].audienceLabel, "ลูกค้าที่ซื้อ Send Stream ใน 30 วันที่ผ่านมา");
  assert.deepEqual(status.limit, { max: 5, used: 1, remaining: 4, windowHours: 24, nextAt: null });
  assert.equal(status.email.enabled, false);
  assert.ok(status.products.some((x) => x.id === p.id));
  assert.throws(() => s.broadcastStatus(staff), (e) => e.status === 403);

  const auditRow = s.db.prepare("SELECT user_id, entity_id, detail FROM audit WHERE action='BROADCAST_SEND'").get();
  assert.equal(auditRow.user_id, admin.id);
  assert.equal(auditRow.entity_id, result.broadcast.id);
  assert.deepEqual(JSON.parse(auditRow.detail), { count: 1, audience: "ลูกค้าที่ซื้อ Send Stream ใน 30 วันที่ผ่านมา", email: null });

  // An https link is kept for the bell; an audience with nobody in it sends nothing.
  s.sendBroadcast(admin, { title: "ข่าว", body: "ทุกคน", link: "https://example.com/news", audience: "all", currentPassword: adminPassword });
  assert.equal(s.notifications(other.user).find((n) => n.kind === "broadcast").link, "https://example.com/news");
  assert.throws(
    () => s.sendBroadcast(admin, { title: "x", body: "y", audience: "unpaid", currentPassword: adminPassword }),
    (e) => e.status === 400 && /ไม่มีลูกค้า/.test(e.message),
  );
  assert.equal(s.broadcastStatus(admin).history.length, 2, "the empty send left no history row");

  // Through the HTTP API: preview (GET) and send (POST, 201).
  const adminToken = s.login({ email: "admin@astra.local", password: adminPassword }).token;
  const preview = await call(s, "GET", "/api/admin/broadcasts/preview?audience=all", adminToken);
  assert.equal(preview.status, 200);
  assert.ok(preview.data.count >= 2);
  const sent = await call(s, "POST", "/api/admin/broadcasts", adminToken, {
    title: "API",
    body: "ส่งผ่าน API",
    audience: "all",
    currentPassword: adminPassword,
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.count, preview.data.count);
  assert.equal((await call(s, "GET", "/api/admin/broadcasts", buyer.token)).status, 403);
});

test("broadcast rate limit: 5 per rolling 24 hours, shop-wide", (t) => {
  const { s, admin, customer, advance } = shop(t);
  customer("Limit Buyer", "limit@example.invalid");
  const send = () => s.sendBroadcast(admin, { title: "t", body: "b", audience: "all", currentPassword: adminPassword });
  for (let i = 0; i < 5; i++) {
    send();
    advance(60000);
  }
  assert.throws(send, (e) => e.status === 429 && /5 ครั้งใน 24 ชั่วโมง/.test(e.message));
  const limit = s.broadcastStatus(admin).limit;
  assert.equal(limit.remaining, 0);
  assert.ok(limit.nextAt);
  // A rejected send does not burn a password attempt or create anything.
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM broadcasts").get().n, 5);
  advance(24 * 3600000 - 4 * 60000);
  send();
  assert.equal(s.broadcastStatus(admin).limit.used, 4, "the first two dropped out of the window");
});

test("broadcast email: real addresses only, capped, queued after the notifications", async (t) => {
  const mailer = fakeMailer();
  const { s, admin, customer } = shop(t, { email: mailer, publicBaseUrl: "https://shop.example.com" });
  const real = customer("Real Mail", "real-buyer@mail.example.com");
  customer("Placeholder", "nomail@no-email.asiax.local");
  const preview = s.broadcastPreview(admin, { audience: "all" });
  assert.equal(preview.emailEnabled, true);
  assert.equal(preview.emailRecipients, 1);
  const result = s.sendBroadcast(admin, {
    title: "โปรโมชันเดือนนี้",
    body: "ลด 10%\nทุกสินค้า <b>",
    link: "/products",
    audience: "all",
    email: true,
    currentPassword: adminPassword,
  });
  assert.equal(result.emailsQueued, 1);
  assert.equal(result.emailsSkipped, 0);
  assert.ok(s.notifications(real.user).some((n) => n.kind === "broadcast"));
  await s.emailIdle();
  assert.equal(mailer.sent.length, 1);
  const [mail] = mailer.sent;
  assert.equal(mail.to, "real-buyer@mail.example.com");
  assert.match(mail.subject, /^โปรโมชันเดือนนี้ — /);
  assert.match(mail.text, /ลด 10%\nทุกสินค้า <b>/);
  assert.match(mail.html, /ทุกสินค้า &lt;b&gt;/);
  assert.match(mail.html, /https:\/\/shop\.example\.com\/products/);
  assert.equal(s.broadcastStatus(admin).history[0].emailsQueued, 1);
  const log = s.db.prepare("SELECT kind, recipient, ref FROM email_log WHERE kind='broadcast'").all();
  assert.equal(log.length, 1);
  assert.match(log[0].recipient, /\*\*\*@mail\.example\.com$/);
  assert.equal(BROADCAST_LIMITS.emailCap, 100);
});

test("broadcast chunks: more customers than one chunk all get exactly one notification", (t) => {
  const { s, admin } = shop(t);
  const insert = s.db.prepare("INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,?,'CUSTOMER')");
  const n = BROADCAST_LIMITS.chunk + 37;
  s.db.exec("BEGIN");
  for (let i = 0; i < n; i++) insert.run("bulk-" + i, "bulk-" + i + "@example.invalid", "Bulk " + i, "x");
  s.db.exec("COMMIT");
  const customers = s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='CUSTOMER'").get().n;
  const result = s.sendBroadcast(admin, { title: "ทุกคน", body: "ข้อความ", audience: "all", currentPassword: adminPassword });
  assert.equal(result.count, customers);
  const rows = s.db
    .prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS u FROM notifications WHERE kind='broadcast'")
    .get();
  assert.deepEqual({ ...rows }, { n: customers, u: customers });
});

// ------------------------------------------------------------------ buy again

test("buy again: available → checkout line, out of stock → product page, removed/hidden → product list", (t) => {
  const { s, admin, customer, product, stock, buy } = shop(t);
  const p = product("Rebuy Stream");
  stock(p.variantId, 2);
  const buyer = customer("Rebuy Buyer", "rebuy@example.invalid");
  const order = buy(buyer.user, p.variantId);
  const detail = s.orderDetail(buyer.user, order.id);
  assert.equal(detail.status, "DELIVERED");
  assert.equal(detail.variant_id, p.variantId, "orders carry their variant for buy-again");

  assert.deepEqual(rebuyAction(detail, s.products()), {
    kind: "buy",
    variantId: p.variantId,
    quantity: 1,
    productId: p.id,
    to: "/products/" + encodeURIComponent(p.id),
  });
  assert.equal(rebuyAction({ ...detail, quantity: 25 }, s.products()).quantity, 10);
  assert.equal(rebuyAction({ ...detail, status: "PENDING_PAYMENT" }, s.products()), null);
  assert.equal(rebuyAction(detail, s.products(), { shopOpen: false }).kind, "out");

  // Sell the last unit: the option still exists but is out of stock.
  buy(customer("Last Unit", "last@example.invalid").user, p.variantId);
  assert.deepEqual(rebuyAction(detail, s.products()), {
    kind: "out",
    productId: p.id,
    to: "/products/" + encodeURIComponent(p.id),
  });
  // Product hidden (closed for sale) → the product list.
  s.saveProduct(admin, { id: p.id, name: "Rebuy Stream", description: "Rebuy Stream สำหรับทดสอบ", category: "streaming", price: 9900, active: false });
  assert.deepEqual(rebuyAction(detail, s.products()), { kind: "gone", to: "/products" });
  assert.deepEqual(rebuyAction(detail, []), { kind: "gone", to: "/products" });
});

test("renewal reminder: warranty_until within 5 days and not yet passed", () => {
  const now = Date.parse("2026-11-13T00:00:00Z");
  const order = (until, status = "DELIVERED") => ({ status, warranty_until: until });
  assert.equal(renewalDue(order("2026-11-17 23:00:00"), now), true);
  assert.equal(renewalDue(order("2026-11-18 00:00:00"), now), true, "exactly 5 days");
  assert.equal(renewalDue(order("2026-11-18 00:00:01"), now), false);
  assert.equal(renewalDue(order("2026-11-12 23:59:59"), now), false, "already ended");
  assert.equal(renewalDue(order(null), now), false);
  assert.equal(renewalDue(order("2026-11-14 00:00:00", "PREORDER"), now), false);
  assert.equal(renewalDue(order("not a date"), now), false);
});
