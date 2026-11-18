import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let service, server, base, product, pre, buyerToken;
const name = "Round2 Long Product Name That Must Stay On One Line And End With Ellipsis";
test.beforeAll(async () => {
  const password = randomUUID();
  service = createCommerce({ adminPassword: password });
  const admin = service.session(service.login({ email: "admin@astra.local", password }).token);
  product = service.saveProduct(admin, { name, description: "Round 2 acceptance product", category: "software", price: 9900, firstLabel: "Basic", active: true });
  service.db.prepare("UPDATE products SET art='stream' WHERE id=?").run(product.id);
  const first = service.adminProductVariants(admin, product.id).variants[0].id;
  service.db.prepare("INSERT INTO variants(id,product_id,label,price,active,sort_order,warranty_days) VALUES(?,?,?,?,1,1,0)").run(product.id + "-pro", product.id, "Pro", 39900);
  service.db.prepare("INSERT INTO variants(id,product_id,label,price,active,sort_order,warranty_days) VALUES(?,?,?,?,1,2,0)").run(product.id + "-out", product.id, "Out of stock", 19900);
  service.importCodes(admin, { variantId: first, codes: "R2-E2E-1\nR2-E2E-2\nR2-E2E-3" });
  service.importCodes(admin, { variantId: product.id + "-pro", codes: "R2-PRO-1" });
  pre = service.saveProduct(admin, { name: "Round2 Preorder", description: "Questions before checkout", category: "software", price: 9900, active: true, preorder: true });
  service.adminSetOrderQuestions(admin, pre.id, { fields: [{ label: "วันที่ต้องการ", type: "text", required: true }, { label: "อีเมลติดต่อ", type: "email", required: true }] });
  const auth = service.register({ name: "Round2 UI Buyer", email: "r2-ui@example.invalid", password: randomUUID() });
  buyerToken = auth.token;
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); service.db.close(); });

for (const width of [320, 390, 430, 1440]) {
  test(`Round2 customer acceptance at ${width}px, including touch and modal close`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width < 700 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/products");
    const card = page.locator(".product-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card).toBeVisible();
    const heading = await card.locator("h3").evaluate((el) => ({ fs: parseFloat(getComputedStyle(el).fontSize), nowrap: getComputedStyle(el).whiteSpace, ellipsis: getComputedStyle(el).textOverflow, overflow: el.scrollWidth > el.clientWidth }));
    expect(heading.fs).toBeLessThanOrEqual(15);
    expect(heading.nowrap).toBe("nowrap");
    expect(heading.ellipsis).toBe("ellipsis");
    expect(heading.overflow).toBe(true);
    await expect(card.locator(".product-title svg")).toHaveCount(0);
    await expect(card.locator(".product-card-price")).toHaveText(/99\.00.*-.*399\.00/);
    await expect(card.locator(".product-sold")).toContainText("เหลือ 4");
    await expect(card.locator(".product-sold")).toContainText("ขายแล้ว 0");
    await expect(card.locator(".card-action")).toHaveText("ซื้อเลย");
    expect(await card.locator(".card-action").evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    expect(await card.locator(".product-card-info").evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
    const preorder = page.locator(".product-card").filter({ hasText: "Round2 Preorder" });
    await expect(preorder.locator(".card-action")).toHaveText("พรีออเดอร์");
    await expect(preorder.locator(".product-sold")).not.toContainText("เหลือ");
    const icon = page.locator(".storefront-category-chip .category-icon").first();
    expect(parseFloat(await icon.evaluate((el) => getComputedStyle(el).borderRadius))).toBeLessThanOrEqual(6);
    await card.click();
    await expect(page.locator(".reference-variants legend")).toHaveText("ตัวเลือกสินค้า");
    const basic = page.locator(".reference-variants button").filter({ hasText: "Basic" });
    const out = page.locator(".reference-variants button").filter({ hasText: "Out of stock" });
    await expect(basic).toHaveClass(/variant-stock-in/);
    await expect(basic).toContainText("เหลือ 3");
    await expect(out).toHaveClass(/variant-stock-out/);
    await expect(out).toContainText("สินค้าหมด");
    await expect(out).toContainText("ขายแล้ว 0");
    await out.click();
    await expect(page.locator(".reference-buy-row")).toHaveCount(0);
    await basic.click();
    const sizes = await page.locator(".reference-buy-row").evaluate((el) => [...el.querySelectorAll(".quantity-control,.button")].map((n) => n.getBoundingClientRect().height));
    expect(sizes.length).toBe(3);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(3);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(52);
    await expect(page.getByRole("button", { name: "สอบถามสินค้านี้ในแชท" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "แชทกับร้าน", exact: true })).toBeVisible();
    await expect(page.locator(".back-link-lg")).toBeVisible();
    const slider = page.locator(".product-gallery-slider");
    const bounds = await slider.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(240);
    // Real touch input (rather than setting scrollLeft) verifies the swipe interaction.
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    const cdp = await context.newCDPSession(page);
    const y = box.y + box.height / 2, from = box.x + box.width * .85, to = box.x + box.width * .15;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from + (to - from) * i / 8, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => slider.evaluate((el) => Math.round(el.scrollLeft / el.clientWidth))).toBeGreaterThan(0);
    await page.getByRole("button", { name: "รูปสินค้า 2", exact: true }).tap();
    await page.getByRole("button", { name: "ขยายรูปสินค้า 2", exact: true }).tap();
    const modal = page.getByRole("dialog", { name: "รูปสินค้าขยาย" });
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "ปิดรูปขยาย" }).tap();
    await expect(modal).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.SHOTS) {
      mkdirSync(process.env.SHOTS, { recursive: true });
      await page.screenshot({ path: `${process.env.SHOTS}/round2-${width}-pdp.png`, fullPage: true });
    }
    await page.goto(base);
    if (width < 700) {
      await expect(page.locator(".mobile-activity-ticker")).toBeHidden();
      await expect(page.locator(".activity-row").first()).toBeVisible();
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("preorder answers are filled in the browser and saved with the checkout order", async ({ page }) => {
  await page.context().addCookies([{ name: "astra_session", value: buyerToken, url: base }]);
  await page.goto(base + "/products/" + pre.id);
  await page.locator(".reference-buy-row .button.primary").click();
  await expect(page).toHaveURL(/\/checkout/);
  const pay = page.locator(".cart-bar .button.primary");
  await expect(pay).toBeDisabled();
  await expect(page.getByLabel("วันที่ต้องการ", { exact: true })).toBeVisible();
  await page.getByLabel("วันที่ต้องการ", { exact: true }).fill("December 1");
  await page.getByLabel("อีเมลติดต่อ", { exact: true }).fill("r2-order@example.invalid");
  // Normal checkout action, including the HTTP handler and basket service.
  await pay.click();
  await expect(page).toHaveURL(/\/orders\//);
  const orderId = new URL(page.url()).pathname.split("/").pop();
  const values = service.orderDetail(service.session(buyerToken), orderId).fulfilment.inputs.map((i) => i.value);
  expect(values).toEqual(["December 1", "r2-order@example.invalid"]);
});
