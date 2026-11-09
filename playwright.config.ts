import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const cached =
  "/Users/nursego/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync(cached) ? cached : undefined);
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  retries: 0,
  reporter: "list",
  use: {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath, args: ["--disable-gpu"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
