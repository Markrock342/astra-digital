/**
 * Delivery types + option groups against wrangler dev --local (Durable Object SQLite):
 * 1) shared-account product: import "id,password,profile:PIN|profile:PIN" → a sale gets seat 1
 *    with its profile + PIN, stock = free seats;
 * 2) option groups: switch to groups, 2 groups → grid, open a combo, buy it (label = joined values);
 * 3) shop-fulfilled product: checkout field → paid order in the queue → staff delivers → customer
 *    sees the message.
 * Usage: node scripts/wrangler-local-delivery-options-smoke.mjs [baseUrl]   (ASTRA_ADMIN_PASSWORD set,
 * wrangler started with --var ASTRA_TEST_PAYMENTS:on)
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:8793";
const adminPassword = process.env.ASTRA_ADMIN_PASSWORD;
if (!adminPassword) throw new Error("Set ASTRA_ADMIN_PASSWORD");

function client() {
  const jar = new Map();
  return async function api(method, path, body) {
    const headers = { "X-Astra-Request": "1", Origin: base };
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    let data = {};
    try {
      data = await response.json();
    } catch {
      /* not JSON */
    }
    return { status: response.status, data };
  };
}
let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? " — " + JSON.stringify(detail).slice(0, 300) : ""));
  console.log("PASS", ++passed, name);
}
const tag = randomUUID().slice(0, 6);

const admin = client();
ok("admin login", (await admin("POST", "/api/login", { email: "admin@astra.local", password: adminPassword })).status === 200);
ok("test payments on", (await admin("GET", "/api/health")).data.mode === "sandbox");
const newProduct = async (name, firstLabel) => {
  const p = await admin("POST", "/api/admin/products", {
    name: name + " " + tag,
    description: "ทดสอบวิธีส่งมอบ",
    category: "streaming",
    price: 10000,
    active: true,
    firstLabel,
  });
  ok("create " + name, p.status === 200 || p.status === 201, p.data);
  const variantId = (await admin("GET", "/api/admin/products/" + p.data.id + "/variants")).data.variants[0].id;
  return { id: p.data.id, variantId };
};

const buyer = client();
ok(
  "register buyer",
  (await buyer("POST", "/api/register", { name: "Delivery Smoke", email: `dlv-${randomUUID()}@example.invalid`, password: "Buyer-only-Password-123" })).status === 200,
);
ok("top up test credit", (await buyer("POST", "/api/topup", { amount: 1000, requestKey: "dlv-" + randomUUID() })).status === 200);
const buy = async (variantId, extra = {}) => {
  const order = await buyer("POST", "/api/orders", { variantId, quantity: 1, requestKey: "dlv-" + randomUUID(), ...extra });
  ok("order created", order.status === 201, order.data);
  const paid = await buyer("POST", "/api/orders/" + order.data.id + "/pay", { paymentToken: order.data.paymentToken, outcome: "success" });
  ok("order paid", paid.status === 200 && paid.data.status === "DELIVERED", paid.data);
  return paid.data;
};

// 1) Shared seats.
const seats = await newProduct("Seat Smoke", "1 เดือน");
const setShared = await admin("PATCH", "/api/admin/products/" + seats.id + "/delivery", { type: "shared" });
ok("set บัญชีแชร์", setShared.status === 200 && setShared.data.type === "shared", setShared.data);
const login = `fam-${tag}@example.invalid`;
const imported = await admin("POST", "/api/admin/inventory", { variantId: seats.variantId, seats: `${login},Seat-pass-1,จอ1:1111|จอ2:2222|จอ3` });
ok("import 1 account = 3 seats", imported.status === 200 && imported.data.units === 3, imported.data);
const seatOrder = await buy(seats.variantId);
const seat = seatOrder.credentials?.[0];
ok("seat 1 with profile + PIN", seat?.loginId === login && seat.seat === 1 && seat.profile === "จอ1" && seat.pin === "1111", seatOrder);
const stock = (await admin("GET", "/api/admin/products/" + seats.id + "/variants")).data.variants[0].stock;
ok("stock = free seats", stock === 2, { stock });
const masked = await admin("GET", "/api/admin/orders/" + seatOrder.id);
ok("admin view masks the PIN", masked.data.credentials?.[0]?.pin === "••••" && !JSON.stringify(masked.data).includes("Seat-pass-1"), masked.data.credentials);
const groupId = masked.data.units[0].groupId;
const raised = await admin("PATCH", "/api/admin/seat-groups/" + groupId, { seats: 5 });
ok("raise seats to 5", raised.status === 200 && raised.data.added === 2, raised.data);

// 2) Option groups.
const opt = await newProduct("Options Smoke", "7 วัน");
const enabled = await admin("POST", "/api/admin/products/" + opt.id + "/options/enable", { name: "ระยะเวลา" });
ok("switch to groups", enabled.status === 200 && enabled.data.groups.length === 1, enabled.data);
const g = enabled.data.groups[0];
const saved = await admin("PATCH", "/api/admin/products/" + opt.id + "/options", {
  groups: [
    { id: g.id, name: "ระยะเวลา", values: [...g.values, { label: "30 วัน" }] },
    { name: "แพ็กเกจ", values: ["Basic", "Premium"] },
  ],
});
ok("2 groups → 4 combos (3 new, closed)", saved.status === 200 && saved.data.created === 3, saved.data);
const variants = (await admin("GET", "/api/admin/products/" + opt.id + "/variants")).data.variants;
const premium30 = variants.find((v) => v.label === "30 วัน / Premium");
ok("label = joined values", !!premium30 && !premium30.active, variants);
const bulk = await admin("PATCH", "/api/admin/products/" + opt.id + "/variants/bulk", { variantIds: [premium30.id], price: 29900, active: true });
ok("bulk open + price", bulk.status === 200 && bulk.data.changed === 1, bulk.data);
await admin("POST", "/api/admin/inventory", { variantId: premium30.id, items: [{ loginId: `opt-${tag}@example.invalid`, password: "opt-pass" }] });
const pub = (await client()("GET", "/api/products/" + opt.id)).data.product;
ok("storefront: groups + only open combos", pub.optionGroups.length === 2 && pub.variants.length === 2 && pub.variants.every((v) => Object.keys(v.options).length === 2), pub);
const optOrder = await buy(premium30.id);
ok("combo order: price + label", optOrder.total === 29900 && optOrder.label === "30 วัน / Premium", optOrder);

// 3) Shop-fulfilled.
const manual = await newProduct("Manual Smoke", "1 เดือน");
const setManual = await admin("PATCH", "/api/admin/products/" + manual.id + "/delivery", {
  type: "manual",
  fields: [{ label: "อีเมล Gmail", type: "email", required: true }],
});
ok("set ร้านทำให้", setManual.status === 200 && setManual.data.fields.length === 1, setManual.data);
const fieldId = (await client()("GET", "/api/products/" + manual.id)).data.product.checkoutFields[0].id;
const missing = await buyer("POST", "/api/orders", { variantId: manual.variantId, quantity: 1, requestKey: "dlv-" + randomUUID() });
ok("required field enforced", missing.status === 400, missing.data);
const manualOrder = await buy(manual.variantId, { deliveryInputs: { [fieldId]: "smoke@gmail.com" } });
ok("waiting in queue", manualOrder.fulfilment?.state === "waiting", manualOrder.fulfilment);
const queue = await admin("GET", "/api/admin/fulfilment");
ok("queue lists the answer", queue.data.rows.some((r) => r.id === manualOrder.id && r.inputs[0].value === "smoke@gmail.com"), queue.data);
const fulfilled = await admin("POST", "/api/admin/orders/" + manualOrder.id + "/fulfil", { message: "เชิญแล้ว" });
ok("staff delivers", fulfilled.status === 200 && fulfilled.data.state === "done", fulfilled.data);
const seen = await buyer("GET", "/api/orders/" + manualOrder.id);
ok("customer sees the message", seen.data.fulfilment?.state === "done" && seen.data.fulfilment.message === "เชิญแล้ว", seen.data.fulfilment);
console.log(`OK ${passed} checks`);
