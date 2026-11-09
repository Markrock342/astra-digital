import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const base = process.argv[2] ?? "http://127.0.0.1:4332";
const cached =
  "/Users/nursego/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const browser = await chromium.launch({
  headless: true,
  args: ["--disable-gpu"],
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    (existsSync(cached) ? cached : undefined),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const other = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let count = 0;
const check = (name, value) => {
  assert.ok(value, name);
  console.log("PASS", ++count, name);
};
async function api(ctx, path, body) {
  const r = await ctx.request.fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Astra-Request": "1" },
    data: body,
  });
  const data = await r.json();
  if (!r.ok()) throw Error(path + " " + r.status() + " " + data.error);
  return data;
}
async function visit(path) {
  await page.goto(base + path);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}
const shot = async (name) => {
  mkdirSync("docs/screenshots/cloud", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/cloud/" + name + ".png",
    fullPage: true,
    animations: "disabled",
  });
};
try {
  const health = await api(context, "/health");
  check(
    "Cloudflare persistent SQLite runtime",
    health.ok && health.storage === "cloudflare-durable-sqlite",
  );
  await visit("/");
  check(
    "real hero animation present",
    await page
      .locator(".hero-brand")
      .evaluate((el) => getComputedStyle(el).animationName === "hero-word"),
  );
  check(
    "headline enters as three staggered words",
    (await page.locator(".hero-word").count()) === 3,
  );
  check(
    "five continuous grid light streaks exist",
    (await page.locator(".grid-streak").count()) === 5,
  );
  const beamTransforms = () =>
    page
      .locator(".grid-streak")
      .evaluateAll((els) =>
        JSON.stringify(els.map((el) => getComputedStyle(el).transform)),
      );
  const beforeBeam = await beamTransforms();
  let moved = false;
  // The reference deliberately holds at the end of each cycle; observe every beam across that pause.
  for (let sample = 0; sample < 20 && !moved; sample++) {
    await page.waitForTimeout(140);
    moved = beforeBeam !== (await beamTransforms());
  }
  check("grid light actually moves over time", moved);
  check(
    "status has expanding pulse ring",
    await page
      .locator(".service-pill .service-dot")
      .first()
      .evaluate(
        (el) => getComputedStyle(el, "::after").animationName === "status-ring",
      ),
  );
  await shot("storefront-desktop");
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(
    "reduced motion disables animation",
    await page
      .locator(".hero-brand")
      .evaluate((el) => getComputedStyle(el).animationName === "none"),
  );
  check(
    "reduced motion removes moving grid lights",
    await page
      .locator(".streak-y-one")
      .evaluate((el) => getComputedStyle(el).display === "none"),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await visit("/stores");
  await page
    .getByRole("button", { name: /เริ่มทดลองเป็นเจ้าของร้าน/ })
    .first()
    .click();
  await page.locator('.store-name[href="/admin"]').waitFor();
  check(
    "merchant starts without a shared admin password",
    (await api(context, "/me")).user.role === "ADMIN",
  );
  await shot("stores-portal");
  await visit("/admin/products");
  await page.getByRole("link", { name: "เพิ่มสินค้า", exact: true }).click();
  const name = "QA CLOUD " + randomUUID().slice(0, 6);
  await page.getByLabel("ชื่อสินค้า", { exact: true }).fill(name);
  await page
    .getByLabel("รายละเอียด", { exact: true })
    .fill("สินค้าทดลองสำหรับตรวจการเชื่อมต่อหน้าร้านและหลังบ้านบน Cloudflare");
  await page
    .getByRole("button", { name: "สร้างฉบับร่าง", exact: true })
    .click();
  await page.getByLabel("ราคาเริ่มต้น (เครดิตทดลอง)").fill("123");
  await page
    .getByRole("checkbox", { name: "เปิดขายสินค้า", exact: true })
    .check();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "บันทึกสินค้าแล้ว" })
    .waitFor();
  let products = (await api(context, "/products")).products;
  const product = products.find((p) => p.name === name),
    variant = product.variants[0];
  check(
    "merchant-created product reaches storefront",
    !!product && variant.stock === 0,
  );
  await visit("/admin/inventory");
  await page.getByRole("button", { name: "นำเข้าโค้ด", exact: true }).click();
  await page.getByLabel("สินค้าและตัวเลือก").selectOption(variant.id);
  const prefix = "DEMO-CLOUD-" + randomUUID().slice(0, 8).toUpperCase();
  await page
    .getByLabel("โค้ด (หนึ่งโค้ดต่อบรรทัด)")
    .fill(prefix + "-0001\n" + prefix + "-0002");
  await page
    .getByRole("button", { name: "นำเข้าโค้ด", exact: true })
    .last()
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "นำเข้า 2 โค้ดสำเร็จ" })
    .waitFor();
  check(
    "code import updates actual inventory",
    (await api(context, "/products")).products.find((p) => p.id === product.id)
      .variants[0].stock === 2,
  );
  const publicProducts = (await api(other, "/products")).products;
  check(
    "another browser cannot see private demo products",
    !publicProducts.some((p) => p.id === product.id),
  );
  const denied = await other.request.get(base + "/api/admin");
  check("anonymous admin access denied", denied.status() === 401);
  const customer = await api(context, "/demo", {});
  check("customer demo is not an admin", customer.user.role === "CUSTOMER");
  await visit("/products/" + product.id);
  await page.getByRole("button", { name: "ซื้อเลย", exact: true }).click();
  await page.getByRole("button", { name: "ดำเนินการชำระเครดิต" }).click();
  await page.getByRole("button", { name: /ยืนยันชำระ/ }).click();
  await page.locator(".code-row code").filter({ hasText: prefix }).waitFor();
  const deliveredId = page.url().split("/").pop();
  check(
    "real browser receives imported test key",
    (await page.locator(".code-row code").innerText()).startsWith(prefix),
  );
  await shot("delivery");
  await page.reload();
  await page.getByRole("button", { name: "แสดงโค้ด", exact: true }).click();
  check(
    "delivery persists across reload",
    (await page.locator(".code-row code").innerText()).startsWith(prefix),
  );
  const a = await api(context, "/orders", {
    variantId: variant.id,
    quantity: 1,
    requestKey: randomUUID(),
  });
  const b = await api(context, "/orders", {
    variantId: variant.id,
    quantity: 1,
    requestKey: randomUUID(),
  });
  const results = await Promise.all(
    [a, b].map((order) =>
      api(context, "/orders/" + order.id + "/pay", {
        paymentToken: order.paymentToken,
        outcome: "success",
      }),
    ),
  );
  check(
    "concurrent final-unit confirmations allocate only once",
    results.filter((r) => r.status === "DELIVERED").length === 1 &&
      results.filter((r) => r.status === "OUT_OF_STOCK").length === 1,
  );
  const balance = (await api(context, "/me")).user.balance;
  check("wallet debits exactly two purchases", balance === 50000 - 24600);
  const original = await api(context, "/orders/" + deliveredId);
  const retry = await api(context, "/orders/" + deliveredId + "/pay", {
    paymentToken: "already-completed",
    outcome: "success",
  });
  check(
    "completed confirmations are idempotent",
    original.codes[0] === retry.codes[0] &&
      (await api(context, "/me")).user.balance === balance,
  );
  await api(other, "/demo", {});
  const forbidden = await other.request.get(
    base + "/api/orders/" + deliveredId,
  );
  check("other customer cannot read delivery", forbidden.status() === 404);
  await api(context, "/demo-merchant", {});
  const admin = await api(context, "/admin");
  check(
    "back office shows connected orders and stock",
    admin.orders.some((o) => o.id === deliveredId) &&
      admin.products.find((p) => p.id === product.id).variants[0].stock === 0,
  );
  const initialShop = (await api(context, "/overview")).shop;
  await api(context, "/admin/settings", {
    announcement: "QA settings persistence",
    shopOpen: false,
  });
  check(
    "shop settings persist through independent API requests",
    (await api(context, "/overview")).shop.announcement ===
      "QA settings persistence",
  );
  const closed = await context.request.post(base + "/api/orders", {
    headers: { "X-Astra-Request": "1" },
    data: {
      variantId: "stream-plus-30",
      quantity: 1,
      requestKey: randomUUID(),
    },
  });
  check("closed shop rejects new checkout", closed.status() === 409);
  await api(context, "/admin/settings", initialShop);
  await api(context, "/demo", {});
  const reservation = await api(context, "/orders", {
    variantId: "cinema-max-90",
    quantity: 1,
    requestKey: randomUUID(),
  });
  const preorderBalance = (await api(context, "/me")).user.balance;
  const prepay = () =>
    api(context, "/orders/" + reservation.id + "/pay", {
      paymentToken: reservation.paymentToken,
      outcome: "success",
    });
  const reserved = await prepay();
  await prepay();
  check(
    "preorder records payment without fabricating delivery",
    reserved.status === "PREORDER" && reserved.codes.length === 0,
  );
  check(
    "preorder retry debits exactly once",
    (await api(context, "/me")).user.balance === preorderBalance - 12900,
  );
  const noAccess = await other.request.get(
    base + "/api/orders/" + reservation.id,
  );
  check("preorder details remain private", noAccess.status() === 404);
  await api(context, "/demo-merchant", {});
  await visit("/admin");
  await shot("admin-desktop");
  for (const path of [
    "/",
    "/stores",
    "/admin",
    "/admin/inventory",
    "/wallet",
    "/orders",
    "/reviews",
    "/products/stream-plus",
    "/admin/products/new",
    "/admin/settings",
  ]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(path);
    check(
      "mobile no overflow " + path,
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    if (path === "/") await shot("storefront-mobile");
    if (path === "/admin") await shot("admin-mobile");
  }
  check("no JavaScript runtime errors", errors.length === 0);
  writeFileSync(
    "docs/cloud-qa-result.json",
    JSON.stringify(
      {
        base,
        completedAt: new Date().toISOString(),
        checks: count,
        passed: true,
        storage: health.storage,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Cloud QA complete:", count, "checks", base);
} finally {
  await browser.close();
}
