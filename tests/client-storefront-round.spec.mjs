// Client storefront round (Nov 2026), items 1–11, phone first (390 px):
// hero (plain background, shop name as a display title from ตั้งค่า › หน้าตาร้าน, login-aware
// buttons), header (ภาษา + ธีม popover, bell, balance, profile; no cart, no shadow), the menu
// bottom sheet, the home catalog button, the ตัวกรอง sheet and the product card actions —
// in light and dark, with no sideways scroll. SHOTS=<dir> saves review screenshots.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base, admin, adminToken, buyerToken, balanceText;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.SHOTS;
const PHONE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  admin = service.session(adminToken);
  service.saveSettings(admin, { line: "@asiax", email: "shop@example.invalid" });
  // Catalog for the sort checks: a cheap one, a pricey one (both newer than the seed products).
  for (const [name, price] of [
    ["Round Cheap Pack", 1900],
    ["Round Pricey Pack", 99900],
  ])
    service.saveProduct(admin, { name, description: "สินค้าทดสอบ", category: "software", price, active: true });
  // An option-group product (shop-fulfilled, so it is orderable without stock).
  const optioned = service.saveProduct(admin, {
    name: "Round Option Pack",
    description: "สินค้ามีตัวเลือก",
    category: "software",
    price: 15000,
    active: true,
  });
  service.adminEnableOptionGroups(admin, optioned.id, { name: "ระยะเวลา" });
  const group = service.adminOptionGroups(admin, optioned.id).groups[0];
  service.adminSaveOptionGroups(admin, optioned.id, {
    price: 15000,
    groups: [
      { name: "แพ็กเกจ", values: ["Basic", "Premium"] },
      { id: group.id, name: "ระยะเวลา", values: [{ id: group.values[0].id, label: group.values[0].label }, { label: "30 วัน" }] },
    ],
  });
  // Shop-fulfilled = orderable without stock rows (ready to buy, not preorder).
  service.db.prepare("UPDATE products SET delivery_type='manual' WHERE name LIKE 'Round %'").run();
  const buyer = service.register({ name: "Round Buyer", email: "round-buyer@example.invalid", password: "Round-buyer-Password-123" });
  buyerToken = buyer.token;
  service.topup(service.session(buyerToken), { amount: 300, requestKey: "round-topup-0001" });
  const satang = service.publicUser(service.session(buyerToken)).balance;
  balanceText = new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  }).format(satang / 100);
});
test.afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function open(browser, { token = null, mode = "light", lang = "th", viewport = PHONE, live = false, reducedMotion } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion });
  await context.addInitScript(
    ([l, m]) => {
      localStorage.setItem("asiax-lang", l);
      localStorage.setItem("asiax-mode", m);
    },
    [lang, mode],
  );
  if (token)
    await context.addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  // Live payments: no customer top-up (the storefront asks /api/health for the mode).
  if (live)
    await page.route("**/api/health", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), mode: "live" } });
    });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, errors };
}
async function ready(page, path = "/") {
  await page.goto(base + path);
  await expect(page.getByRole("heading", { name: "เชื่อมต่อร้านค้าไม่ได้" })).toHaveCount(0);
  await page.locator(".loading-row").first().waitFor({ state: "hidden" });
  await page.evaluate(() => document.fonts.ready);
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shot = (page, name) =>
  shots ? page.screenshot({ path: `${shots}/${name}.png`, animations: "disabled" }) : null;
/** Visible box + the invisible ::after hit area (brand.css "Phone tap targets"). */
const hitArea = (locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const after = getComputedStyle(el, "::after");
    const px = (v) => (v && v.endsWith("px") ? parseFloat(v) : 0);
    const grow = after.content && after.content !== "none" && after.position === "absolute";
    return {
      width: r.width + (grow ? -px(after.left) - px(after.right) : 0),
      height: r.height + (grow ? -px(after.top) - px(after.bottom) : 0),
    };
  });
const accentOf = (page) =>
  page.locator(".storefront-shell").evaluate((el) => {
    const probe = document.createElement("i");
    probe.style.color = "var(--accent)";
    el.append(probe);
    const color = getComputedStyle(probe).color;
    probe.style.color = "var(--accent-text)";
    const text = getComputedStyle(probe).color;
    probe.remove();
    return { fill: color, text };
  });

test("1–5 hero: plain background, shop name display title, login-aware buttons", async ({ browser }) => {
  for (const mode of ["light", "dark"]) {
    const { context, page, errors } = await open(browser, { mode });
    await ready(page);
    const hero = page.locator(".home-hero");
    // 1. No grid / glow behind the hero.
    expect(await hero.evaluate((el) => getComputedStyle(el, "::before").content)).toBe("none");
    await expect(hero.locator(".hero-grid, .hero-orbs")).toHaveCount(0);
    // 2. No status pill, no big logo image; the shop name as a big bold brand-colour line.
    await expect(hero.locator(".service-pill, .hero-logo, img")).toHaveCount(0);
    await expect(page.getByText("เปิดให้บริการ", { exact: true })).toHaveCount(0);
    const title = page.getByRole("heading", { level: 1, name: "WELCOME TO ASIA EXTRA" });
    await expect(title).toBeVisible();
    const style = await title.evaluate((el) => {
      const s = getComputedStyle(el);
      return { weight: Number(s.fontWeight), size: parseFloat(s.fontSize), align: s.textAlign, color: s.color };
    });
    expect(style.weight).toBeGreaterThanOrEqual(800);
    expect(style.size).toBeGreaterThanOrEqual(36);
    expect(style.align).toBe("center");
    expect(style.color).toBe((await accentOf(page)).text);
    // The small header logo stays.
    await expect(page.locator("header .brand-logo img")).toBeVisible();
    // 3–5. Logged out: "สินค้าทั้งหมด" (no arrow) + "เข้าสู่ระบบ".
    await expect(hero.locator(".hero-cta")).toHaveText("สินค้าทั้งหมด");
    await expect(hero.locator(".hero-cta")).toHaveAttribute("href", "/products");
    await expect(hero.locator(".hero-cta svg")).toHaveCount(0);
    await expect(hero.locator(".hero-ghost")).toHaveText("เข้าสู่ระบบ");
    await expect(hero.locator(".hero-ghost")).toHaveAttribute("href", "/login");
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, "home-390-" + mode);
    expect(errors).toEqual([]);
    await context.close();
  }
  // Logged in: "สินค้าทั้งหมด" + "รีวิวจากลูกค้า".
  const { context, page } = await open(browser, { token: buyerToken });
  await ready(page);
  await expect(page.locator(".hero-cta")).toHaveText("สินค้าทั้งหมด");
  await expect(page.locator(".hero-ghost")).toHaveText("รีวิวจากลูกค้า");
  await expect(page.locator(".hero-ghost")).toHaveAttribute("href", "/reviews");
  await context.close();
  // English.
  const en = await open(browser, { lang: "en" });
  await ready(en.page);
  await expect(en.page.locator(".hero-cta")).toHaveText("All products");
  await expect(en.page.locator(".hero-ghost")).toHaveText("Sign in");
  await en.context.close();
});

test("2+5 admin edits the hero title and the logged-out button with live preview", async ({ page, browser }) => {
  test.setTimeout(90000);
  await page.context().addCookies([{ name: "astra_session", value: adminToken, url: base, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(base + "/admin/settings/appearance");
  await expect(page.getByRole("heading", { name: "หน้าตาร้าน", level: 1 })).toBeVisible();
  const frame = page.frameLocator('iframe[title="ตัวอย่างหน้าร้านจริง"]');
  await expect(frame.locator(".hero-display")).toHaveText("WELCOME TO ASIA EXTRA");
  await expect(page.getByLabel("ชื่อร้านตัวใหญ่ (ไทย)")).toHaveAttribute("placeholder", "WELCOME TO ASIA EXTRA");
  await page.getByLabel("ชื่อร้านตัวใหญ่ (ไทย)").fill("ยินดีต้อนรับ ASIAX");
  await page.getByLabel("ชื่อร้านตัวใหญ่ (อังกฤษ)").fill("HELLO ASIAX");
  await expect(frame.locator(".hero-display")).toHaveText("ยินดีต้อนรับ ASIAX");
  const guest = page.getByRole("group", { name: "ปุ่มรอง (ยังไม่เข้าสู่ระบบ)" });
  await guest.getByLabel("ข้อความบนปุ่ม (ไทย)").fill("ล็อกอินเลย");
  await guest.getByLabel("ลิงก์").fill("/register");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.locator(".appearance-save-bar")).toContainText("ตรงกับหน้าร้าน");

  const th = await open(browser);
  await ready(th.page);
  await expect(th.page.locator(".hero-display")).toHaveText("ยินดีต้อนรับ ASIAX");
  await expect(th.page.locator(".hero-ghost")).toHaveText("ล็อกอินเลย");
  await expect(th.page.locator(".hero-ghost")).toHaveAttribute("href", "/register");
  await th.context.close();
  const en = await open(browser, { lang: "en" });
  await ready(en.page);
  await expect(en.page.locator(".hero-display")).toHaveText("HELLO ASIAX");
  await en.context.close();

  // Back to the defaults for the other tests.
  await page.getByRole("button", { name: "คืนค่าเดิม", exact: true }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "คืนค่าเดิม" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(frame.locator(".hero-display")).toHaveText("WELCOME TO ASIA EXTRA");
});

test("6–7 header: no shadow, ภาษา + ธีม popover, bell, balance, profile; no cart; 44px targets", async ({ browser }) => {
  for (const mode of ["light", "dark"]) {
    const { context, page, errors } = await open(browser, { token: buyerToken, mode });
    await ready(page);
    const header = page.locator("header.site-header");
    // 6. No shadow / line under the bar.
    const look = await header.evaluate((el) => {
      const s = getComputedStyle(el);
      return { shadow: s.boxShadow, border: s.borderBottomColor };
    });
    expect(look.shadow).toBe("none");
    expect(look.border).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    // 7. Exactly: ภาษา + ธีม, bell, balance, profile — and no cart.
    const actions = header.locator(".header-actions");
    await expect(actions.getByRole("button", { name: "ภาษาและธีม" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "แจ้งเตือน" })).toBeVisible();
    const balance = actions.locator(".balance-pill");
    await expect(balance).toHaveText(balanceText);
    await expect(balance).toHaveAttribute("href", "/wallet");
    await expect(actions.locator(".account-button")).toBeVisible();
    await expect(header.locator('a[href="/cart"], .cart-button')).toHaveCount(0);
    await expect(header.locator(".lang-toggle:visible, .theme-trigger")).toHaveCount(0);
    const visible = await actions.evaluate((el) =>
      [...el.children]
        .filter((c) => c.getBoundingClientRect().width > 0 && getComputedStyle(c).visibility !== "hidden")
        .map((c) => c.className),
    );
    expect(visible.length).toBe(4);
    // Every control: tap area ≥ 44 × 44; the row fits 390 px.
    for (const control of [
      actions.locator(".prefs-trigger"),
      actions.locator(".notice-button"),
      balance,
      actions.locator(".account-button"),
    ]) {
      const area = await hitArea(control);
      expect(area.width, await control.evaluate((e) => e.className)).toBeGreaterThanOrEqual(44);
      expect(area.height).toBeGreaterThanOrEqual(44);
    }
    const right = await actions.evaluate((el) => el.getBoundingClientRect().right);
    expect(right).toBeLessThanOrEqual(390);
    expect(await noSideScroll(page)).toBe(true);
    // The popover: TH/EN + mode + accent.
    await actions.getByRole("button", { name: "ภาษาและธีม" }).click();
    const prefs = page.getByRole("dialog", { name: "ภาษาและธีม" });
    await expect(prefs).toBeVisible();
    await expect(prefs.getByRole("button", { name: "TH", exact: true })).toBeVisible();
    await expect(prefs.getByRole("button", { name: "EN", exact: true })).toBeVisible();
    await expect(prefs.getByRole("button", { name: "ธีมสว่าง" }).or(prefs.getByRole("button", { name: "สว่าง" }))).toBeVisible();
    // 4 preset swatches + the "เลือกสีเอง" colour dot, and the hue slider.
    await expect(prefs.locator(".swatch")).toHaveCount(5);
    await expect(prefs.getByRole("slider", { name: "เลือกสีเอง" })).toBeVisible();
    const box = await prefs.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await shot(page, "prefs-390-" + mode);
    await prefs.getByRole("button", { name: mode === "light" ? "มืด" : "สว่าง" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode === "light" ? "dark" : "light");
    await prefs.getByRole("button", { name: "เหลือง EXTRA" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-accent", "yellow");
    await prefs.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Language & theme" })).toBeHidden();
    expect(errors).toEqual([]);
    await context.close();
  }
  // Live payments: the balance opens the account page instead of the wallet.
  const live = await open(browser, { token: buyerToken, live: true });
  await ready(live.page);
  await expect(live.page.locator(".balance-pill")).toHaveAttribute("href", "/account");
  await live.context.close();
  // Logged out: no balance, the sign-up button as before.
  const guest = await open(browser);
  await ready(guest.page);
  await expect(guest.page.locator(".balance-pill")).toHaveCount(0);
  await expect(guest.page.locator("header .register-link")).toBeVisible();
  await expect(guest.page.locator("header .register-link")).toHaveText("สมัครสมาชิก");
  expect((await hitArea(guest.page.locator("header .register-link"))).height).toBeGreaterThanOrEqual(44);
  await guest.context.close();
});

test("8 menu: bottom sheet with user card, tiles, contact chips, sign out; focus trap and close", async ({ browser }) => {
  for (const mode of ["light", "dark"]) {
    const { context, page, errors } = await open(browser, { token: buyerToken, mode });
    await ready(page);
    const trigger = page.getByRole("button", { name: "เมนูลัด" });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "เมนูทั้งหมด" });
    await expect(sheet).toBeVisible();
    // Slides up from the bottom; drag handle + backdrop + close X.
    await page.waitForTimeout(400);
    const box = await sheet.boundingBox();
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(PHONE.height - 1);
    await expect(page.locator(".sheet-handle")).toBeVisible();
    await expect(page.locator(".sheet-overlay")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "ปิด" })).toBeVisible();
    // The card: name, balance and top-up (test payments on).
    const card = sheet.getByTestId("menu-user-card");
    await expect(card).toContainText("Round Buyer");
    await expect(card).toContainText(balanceText);
    await expect(card.getByRole("link", { name: "เติมเงิน" })).toHaveAttribute("href", "/wallet");
    // Tiles.
    for (const [name, href] of [
      ["สินค้าทั้งหมด", "/products"],
      ["เครดิตร้าน", "/credits"],
      ["ประวัติการซื้อ", "/orders"],
      ["บัญชีของฉัน", "/account"],
      ["ข่าวสาร", "/news"],
      ["เกี่ยวกับเรา", "/about"],
    ])
      await expect(sheet.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    await expect(sheet.getByRole("button", { name: "แจ้งปัญหา" })).toBeVisible();
    // Contact chips from ตั้งค่า › ร้าน.
    await expect(sheet.getByRole("link", { name: "LINE" })).toHaveAttribute("href", "https://line.me/R/ti/p/%40asiax");
    await expect(sheet.getByRole("link", { name: "อีเมล" })).toHaveAttribute("href", "mailto:shop@example.invalid");
    await expect(sheet.getByRole("button", { name: "ออกจากระบบ" })).toBeVisible();
    // Text ≥ 12 px, targets ≥ 44 px, no sideways scroll.
    const small = await sheet.evaluate((el) =>
      [...el.querySelectorAll("a, button, strong, span, p, b")]
        .filter((n) => n.textContent.trim() && n.getBoundingClientRect().width > 0)
        .filter((n) => parseFloat(getComputedStyle(n).fontSize) < 12)
        .map((n) => n.textContent.trim()),
    );
    expect(small).toEqual([]);
    const tooSmall = await sheet.evaluate((el) =>
      [...el.querySelectorAll("a, button")]
        .filter((n) => n.getBoundingClientRect().width > 0)
        .filter((n) => n.getBoundingClientRect().height < 44 || n.getBoundingClientRect().width < 44)
        .map((n) => n.textContent.trim() || n.getAttribute("aria-label")),
    );
    expect(tooSmall).toEqual([]);
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, "menu-390-" + mode);
    // Focus stays inside (Tab from the last control wraps to the first).
    for (let i = 0; i < 16; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#storefront-menu"))).toBe(true);
    // Esc closes and gives focus back to the trigger.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    // Backdrop closes.
    await trigger.click();
    await expect(sheet).toBeVisible();
    await page.mouse.click(195, 40);
    await expect(sheet).toBeHidden();
    // X closes.
    await trigger.click();
    await sheet.getByRole("button", { name: "ปิด" }).click();
    await expect(sheet).toBeHidden();
    // "แจ้งปัญหา" opens the chat.
    await trigger.click();
    await sheet.getByRole("button", { name: "แจ้งปัญหา" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("dialog", { name: "แชทกับร้าน" }).or(page.locator(".chat-panel"))).toBeVisible();
    // A tile navigates and closes the sheet.
    await page.goto(base + "/");
    await trigger.click();
    await sheet.getByRole("link", { name: "สินค้าทั้งหมด", exact: true }).click();
    await expect(page).toHaveURL(base + "/products");
    await expect(sheet).toBeHidden();
    expect(errors).toEqual([]);
    await context.close();
  }
  // Live payments: no top-up button.
  const live = await open(browser, { token: buyerToken, live: true });
  await ready(live.page);
  await live.page.getByRole("button", { name: "เมนูลัด" }).click();
  await expect(live.page.getByTestId("menu-user-card")).toContainText(balanceText);
  await expect(live.page.getByRole("link", { name: "เติมเงิน" })).toHaveCount(0);
  await live.context.close();
  // Logged out: sign in / sign up instead of the card, no sign out.
  const guest = await open(browser, { reducedMotion: "reduce" });
  await ready(guest.page);
  await guest.page.getByRole("button", { name: "เมนูลัด" }).click();
  const sheet = guest.page.getByRole("dialog", { name: "เมนูทั้งหมด" });
  await expect(sheet.getByTestId("menu-user-card")).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: "เข้าสู่ระบบ" })).toHaveAttribute("href", "/login");
  await expect(sheet.getByRole("link", { name: "สมัครสมาชิก" })).toHaveAttribute("href", "/register");
  await expect(sheet.getByRole("button", { name: "ออกจากระบบ" })).toHaveCount(0);
  // Reduced motion: no slide.
  const duration = await guest.page.locator(".sheet-panel").evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
  expect(duration).toBeLessThan(0.05);
  await guest.context.close();
});

test("9 home: no category block, bordered 'สินค้าทั้งหมด' button at the list heading", async ({ browser }) => {
  const { context, page } = await open(browser);
  await ready(page);
  await expect(page.locator(".home-categories")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "เลือกตามหมวดหมู่" })).toHaveCount(0);
  await expect(page.getByText("ดูสินค้าทั้งหมด")).toHaveCount(0);
  const heading = page.locator(".home-main .reference-catalog-title");
  await expect(heading.getByRole("heading", { name: "สินค้าทั้งหมด" })).toBeVisible();
  const button = heading.getByRole("link", { name: "สินค้าทั้งหมด" });
  await expect(button).toHaveAttribute("href", "/products");
  const [h, b] = await Promise.all([heading.getByRole("heading").boundingBox(), button.boundingBox()]);
  expect(b.x).toBeGreaterThan(h.x + h.width - 1);
  expect(Math.abs(b.y + b.height / 2 - (h.y + h.height / 2))).toBeLessThan(16);
  const look = await button.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopColor, width: parseFloat(s.borderTopWidth), bg: s.backgroundColor };
  });
  expect(look.border).toBe((await accentOf(page)).fill);
  expect(look.width).toBeGreaterThanOrEqual(1);
  expect(look.bg).toBe("rgba(0, 0, 0, 0)");
  // Category chips stay on /products.
  await ready(page, "/products");
  await expect(page.getByRole("navigation", { name: "หมวดหมู่สินค้า" })).toBeVisible();
  await context.close();
});

test("10 ตัวกรอง: bottom sheet with six radio choices; the list re-sorts", async ({ browser }) => {
  for (const mode of ["light", "dark"]) {
    const { context, page, errors } = await open(browser, { mode });
    await ready(page, "/products");
    await expect(page.locator("select")).toHaveCount(0);
    const filter = page.getByRole("button", { name: /^ตัวกรอง/ });
    await expect(filter).toHaveText("แนะนำ");
    await filter.click();
    const sheet = page.getByRole("dialog", { name: "ตัวกรอง" });
    await expect(sheet).toBeVisible();
    const radios = sheet.getByRole("radio");
    await expect(radios).toHaveText(["แนะนำ", "ขายดีที่สุด", "ใหม่ล่าสุด", "รีวิวดีที่สุด", "ราคาต่ำ → สูง", "ราคาสูง → ต่ำ"]);
    await expect(sheet.getByRole("radio", { name: "แนะนำ" })).toHaveAttribute("aria-checked", "true");
    await expect(sheet.getByRole("radio", { checked: true }).locator("svg")).toHaveCount(1);
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, "filter-390-" + mode);
    const prices = () =>
      page.locator(".product-card .product-card-price strong").evaluateAll((els) =>
        els.map((e) => Number(e.textContent.replace(/[^\d.]/g, ""))),
      );
    await sheet.getByRole("radio", { name: "ราคาสูง → ต่ำ" }).click();
    await expect(sheet).toBeHidden();
    await expect(filter).toHaveText("ราคาสูง → ต่ำ");
    let list = await prices();
    expect(list).toEqual([...list].sort((a, b) => b - a));
    await filter.click();
    await sheet.getByRole("radio", { name: "ราคาต่ำ → สูง" }).click();
    list = await prices();
    expect(list).toEqual([...list].sort((a, b) => a - b));
    // Best selling: the seed DISNEY+ (sold 2) first; newest: the last product added first.
    await filter.click();
    await sheet.getByRole("radio", { name: "ขายดีที่สุด" }).click();
    await expect(page.locator(".product-card h3").first()).toHaveText("DISNEY+");
    await filter.click();
    await sheet.getByRole("radio", { name: "ใหม่ล่าสุด" }).click();
    await expect(page.locator(".product-card h3").first()).toHaveText("Round Option Pack");
    await filter.click();
    await sheet.getByRole("radio", { name: "รีวิวดีที่สุด" }).click();
    await expect(page.locator(".product-card h3").first()).toHaveText("DISNEY+");
    // Esc closes without changing the choice.
    await filter.click();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(filter).toHaveText("รีวิวดีที่สุด");
    expect(errors).toEqual([]);
    await context.close();
  }
  const en = await open(browser, { lang: "en" });
  await ready(en.page);
  await expect(en.page.getByRole("button", { name: /^Filter/ })).toHaveText("Featured");
  await en.context.close();
});

test("11 product cards: no preorder badge, action under the price, ready vs preorder styles", async ({ browser }) => {
  for (const mode of ["light", "dark"]) {
    const { context, page } = await open(browser, { mode });
    await ready(page, "/products");
    await expect(page.locator(".card-hover-action")).toHaveCount(0);
    await expect(page.locator(".product-card .stock-tag", { hasText: "สั่งจอง" })).toHaveCount(0);
    const card = (name) => page.locator(".product-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
    const preorder = card("MONOMAX").locator(".card-action");
    const ready_ = card("Round Cheap Pack").locator(".card-action");
    const options = card("Round Option Pack").locator(".card-action");
    await expect(preorder).toHaveText("จองล่วงหน้า");
    await expect(preorder).toHaveAttribute("data-kind", "preorder");
    await expect(ready_).toHaveAttribute("data-kind", "ready");
    await expect(ready_).toHaveText("ซื้อเลย");
    await expect(options).toHaveText("เลือกตัวเลือก");
    await expect(options).toHaveAttribute("data-kind", "ready");
    // Below the price.
    for (const name of ["MONOMAX", "Round Cheap Pack"]) {
      const price = await card(name).locator(".product-card-price").boundingBox();
      const action = await card(name).locator(".card-action").boundingBox();
      expect(action.y).toBeGreaterThanOrEqual(price.y + price.height);
      expect(Math.round(action.height)).toBeGreaterThanOrEqual(44);
    }
    // Solid brand fill vs outlined.
    const { fill } = await accentOf(page);
    const paint = (loc) =>
      loc.evaluate((el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, border: s.borderTopColor };
      });
    expect((await paint(ready_)).bg).toBe(fill);
    const outlined = await paint(preorder);
    expect(outlined.bg).toBe("rgba(0, 0, 0, 0)");
    expect(outlined.border).toBe(fill);
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, "products-390-" + mode);
    await context.close();
  }
  // Option-group product still opens its picker from the card.
  const { context, page } = await open(browser);
  await ready(page, "/products");
  await page.locator(".product-card").filter({ hasText: "Round Option Pack" }).click();
  await expect(page).toHaveURL(/\/products\//);
  await expect(page.getByRole("group", { name: "แพ็กเกจ", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "ระยะเวลา", exact: true })).toBeVisible();
  await context.close();
});

test("390 px light / dark, every accent: no sideways scroll with sheets open; footer credit stays", async ({ browser }) => {
  for (const mode of ["light", "dark"])
    for (const accent of ["blue", "yellow", "duo", "mono"]) {
      const { context, page } = await open(browser, { token: buyerToken, mode });
      await context.addInitScript((a) => localStorage.setItem("asiax-accent", a), accent);
      await ready(page);
      expect(await noSideScroll(page), mode + " " + accent).toBe(true);
      await expect(page.locator(".footer-credit")).toHaveText("Theme By limitcode studio");
      await page.getByRole("button", { name: "เมนูลัด" }).click();
      expect(await noSideScroll(page)).toBe(true);
      await page.keyboard.press("Escape");
      await ready(page, "/products");
      await page.getByRole("button", { name: /^ตัวกรอง/ }).click();
      expect(await noSideScroll(page)).toBe(true);
      await context.close();
    }
});
