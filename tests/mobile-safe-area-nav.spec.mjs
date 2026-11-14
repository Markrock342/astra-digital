// PWA / phone bottom dock: edge-to-edge + viewport-fit=cover so rounded screens do not clip tabs.
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";

let server, service, base;
const adminPassword = randomBytes(24).toString("hex");

test.describe.configure({ mode: "serial" });
test.setTimeout(90000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function navBox(page) {
  return page.locator(".mobile-bottom-nav").evaluate((el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      display: s.display,
      bottom: s.bottom,
      left: s.left,
      right: s.right,
      borderRadius: s.borderRadius,
      paddingBottom: s.paddingBottom,
      width: r.width,
      top: r.top,
      bottomEdge: r.bottom,
      viewportH: innerHeight,
      viewportW: innerWidth,
    };
  });
}

test("viewport meta enables safe-area (viewport-fit=cover)", async ({ page }) => {
  await page.goto(base + "/");
  const content = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(content || "").toMatch(/viewport-fit\s*=\s*cover/i);
});

for (const width of [320, 390, 430]) {
  test(`${width}px: bottom nav docks edge-to-edge without sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
    const box = await navBox(page);
    expect(box.display).toBe("flex");
    expect(box.left).toBe("0px");
    expect(box.right).toBe("0px");
    // Docked to the physical bottom (not a floating pill with a gap).
    expect(Math.abs(box.bottomEdge - box.viewportH)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - box.viewportW)).toBeLessThanOrEqual(1);
    // No rounded outer pill that phone bezels can clip.
    expect(box.borderRadius === "0px" || box.borderRadius.startsWith("0px")).toBe(true);
    expect(await noSideScroll(page)).toBe(true);
    await expect(page.getByRole("navigation", { name: /เมนูมือถือ|Mobile menu/i })).toBeVisible();
  });
}

test("390px: labels stay readable and tap targets stay usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/");
  const tabs = page.locator(".mobile-bottom-nav > a, .mobile-bottom-nav > button");
  await expect(tabs).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const tab = tabs.nth(i);
    const size = await tab.boundingBox();
    expect(size?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(size?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("390px: chat FAB sits above the bottom dock (does not cover เมนู)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/");
  const fab = page.locator(".chat-fab");
  const nav = page.locator(".mobile-bottom-nav");
  await expect(fab).toBeVisible();
  const fabBox = await fab.boundingBox();
  const navBox = await nav.boundingBox();
  expect(fabBox && navBox).toBeTruthy();
  // FAB bottom edge must be above the dock's top edge.
  expect(fabBox.y + fabBox.height).toBeLessThanOrEqual(navBox.y + 1);
});
