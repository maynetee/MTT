import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests of the browser demo (the WASM engine), run by `npm run e2e` against the
 * production build served by `vite preview`. Chromium only: the demo targets evergreen
 * browsers and the desktop app has its own suite (e2e/desktop).
 */
const PORT = Number(process.env.E2E_PORT ?? 4317);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e/web",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results/web",
  // Tests share nothing: each gets a fresh browser context, hence an empty localStorage.
  fullyParallel: true,
  forbidOnly: CI,
  retries: 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    // The app speaks the browser's language and the tests read English, whatever the machine's.
    locale: "en-US",
    timezoneId: "Europe/Paris",
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    // `npm run e2e` builds first; the preview only serves dist/.
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    // A server left on this port by something else would test the wrong build.
    reuseExistingServer: false,
    timeout: 60_000
  }
});
