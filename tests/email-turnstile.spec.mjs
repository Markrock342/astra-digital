// Email + Turnstile in the browser, with nothing leaving the machine:
// 1. forgot → reset: the email is captured by a fake sender (test hook), the link is opened.
// 2. register with Turnstile on: the Cloudflare script is replaced by a local mock and
//    siteverify by a fake fetch. The script only loads on pages that need it.
import { test, expect } from "@playwright/test";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";
import { createTurnstile } from "../server/turnstile.mjs";

test.describe.configure({ mode: "serial" });

async function start(options) {
  const service = createCommerce(options);
  const server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { service, server, base: "http://127.0.0.1:" + server.address().port };
}
async function stop({ service, server }) {
  await service.emailIdle();
  await new Promise((r) => server.close(r));
  service.db.close();
}

test("customer resets a forgotten password from the emailed link (email captured, no real send)", async ({ page }) => {
  const outbox = [];
  const app = await start({
    email: {
      enabled: true,
      provider: "test",
      from: "shop@mail.example.com",
      send: async (message) => (outbox.push(message), { id: "e2e-" + outbox.length }),
    },
  });
  try {
    app.service.register({ name: "ลูกค้าลืมรหัส", username: "forgetful", email: "forgetful@mail.example.com", password: "Old-Password-12345" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(app.base + "/login");
    await page.getByRole("button", { name: "ลืมรหัสผ่าน?" }).click();
    await expect(page.getByRole("heading", { name: "ลืมรหัสผ่าน" })).toBeVisible();
    await page.getByLabel("อีเมลที่ใช้สมัคร").fill("forgetful@mail.example.com");
    await page.getByRole("button", { name: "ส่งลิงก์ตั้งรหัสผ่านใหม่" }).click();
    await expect(page.getByRole("heading", { name: "ตรวจอีเมลของคุณ" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await expect.poll(() => outbox.length).toBe(1);
    const link = /(\/reset-password\?token=[a-f0-9]{64})/.exec(outbox[0].text)?.[1];
    expect(link).toBeTruthy();
    expect(outbox[0].text).not.toContain("Old-Password-12345");

    await page.goto(app.base + link);
    await expect(page.getByRole("heading", { name: "ตั้งรหัสผ่านใหม่" })).toBeVisible();
    await expect(page).toHaveURL(/\/reset-password$/); // token removed from the address bar
    await page.getByLabel("รหัสผ่านใหม่", { exact: true }).fill("Fresh-Password-67890");
    await page.getByLabel("ยืนยันรหัสผ่านใหม่").fill("Fresh-Password-67890");
    await page.getByRole("button", { name: "บันทึกรหัสผ่านใหม่" }).click();
    await expect(page.getByRole("heading", { name: "ตั้งรหัสผ่านใหม่แล้ว" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await page.locator('input[name="username"]').fill("forgetful");
    await page.locator('input[name="password"]').fill("Fresh-Password-67890");
    await page.locator("form").getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);

    // The same link cannot be used twice.
    await page.goto(app.base + link);
    await page.getByLabel("รหัสผ่านใหม่", { exact: true }).fill("Third-Password-00000");
    await page.getByLabel("ยืนยันรหัสผ่านใหม่").fill("Third-Password-00000");
    await page.getByRole("button", { name: "บันทึกรหัสผ่านใหม่" }).click();
    await expect(page.getByRole("alert")).toContainText("ลิงก์");
  } finally {
    await stop(app);
  }
});

const MOCK_TURNSTILE = `
window.turnstile = {
  render(el, options) {
    const box = document.createElement("div");
    box.className = "mock-turnstile";
    box.textContent = "mock turnstile " + options.sitekey;
    el.append(box);
    setTimeout(() => options.callback("good-token"), 50);
    window.__turnstileRenders = (window.__turnstileRenders || 0) + 1;
    this._options = options;
    return "w1";
  },
  reset() { setTimeout(() => this._options.callback("good-token"), 50); },
  remove() {},
};`;

test("register with Turnstile on (mocked script + siteverify); script loads only where needed", async ({ page }) => {
  const verified = [];
  const turnstile = createTurnstile(
    { TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET: "e2e-secret" },
    {
      fetchImpl: async (url, init) => {
        const body = new URLSearchParams(init.body);
        verified.push(body.get("response"));
        return Response.json({ success: body.get("response") === "good-token" });
      },
    },
  );
  const app = await start({ turnstile });
  const scriptHits = [];
  await page.route("https://challenges.cloudflare.com/**", (route) => {
    scriptHits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/javascript", body: MOCK_TURNSTILE });
  });
  try {
    const home = await page.goto(app.base + "/");
    expect(home.headers()["content-security-policy"]).toContain("script-src 'self' https://challenges.cloudflare.com");
    await expect(page.locator(".storefront-shell")).toBeVisible();
    expect(scriptHits, "no Turnstile script on the home page").toEqual([]);
    const admin = await page.request.get(app.base + "/admin");
    expect(admin.headers()["content-security-policy"]).toContain("script-src 'self';");

    await page.goto(app.base + "/register");
    await expect(page.locator(".mock-turnstile")).toBeVisible();
    expect(scriptHits.length).toBe(1);
    await page.locator('input[name="username"]').fill("human_buyer");
    await page.locator('input[name="password"]').fill("Human-Password-123");
    await page.locator('input[name="confirmPassword"]').fill("Human-Password-123");
    await page.locator('input[name="acceptTerms"]').check();
    await expect(page.locator('.turnstile-box[data-verified="true"]')).toBeVisible();
    await page.locator("form").getByRole("button", { name: "สมัครสมาชิก", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    expect(verified).toEqual(["good-token"]);
    expect(app.service.db.prepare("SELECT COUNT(*) AS n FROM users WHERE username='human_buyer'").get().n).toBe(1);

    // Email is off on this server: the login page keeps the "contact the shop" text.
    await page.context().clearCookies();
    await page.goto(app.base + "/login");
    await expect(page.getByText("ร้านจะตั้งรหัสผ่านชั่วคราวให้หลังยืนยันตัวตน")).toBeVisible();
    await expect(page.locator('.turnstile-box[data-verified="true"]')).toBeVisible();
    // A wrong password consumes the token; the widget is reset and the next try works.
    await page.locator('input[name="username"]').fill("human_buyer");
    await page.locator('input[name="password"]').fill("wrong-password-1");
    await page.locator("form").getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("ไม่ถูกต้อง");
    await expect(page.locator('.turnstile-box[data-verified="true"]')).toBeVisible();
    await page.locator('input[name="password"]').fill("Human-Password-123");
    await page.locator("form").getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    expect(verified.length).toBe(3);

    // Without a token the server answers with the Thai 403.
    const raw = await page.request.post(app.base + "/api/register", {
      headers: { "X-Astra-Request": "1", "Content-Type": "application/json" },
      data: { name: "bot", username: "bot_user", password: "Bot-Password-12345" },
    });
    expect(raw.status()).toBe(403);
    expect((await raw.json()).error).toContain("ไม่ใช่บอท");
  } finally {
    await stop(app);
  }
});
