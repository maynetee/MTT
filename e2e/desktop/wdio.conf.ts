import { rmSync } from "node:fs";
import { browser } from "@wdio/globals";
import type { TauriCapabilities, TauriServiceOptions } from "@wdio/tauri-service";
import { APP_BINARY, OUTPUT_DIR, WEBDRIVER_PORT, appEnv, dataDir, stopRelaunchedApp } from "./app";

const capabilities: TauriCapabilities[] = [{ browserName: "tauri", "tauri:options": { application: APP_BINARY } }];

const tauri: TauriServiceOptions = {
  driverProvider: "embedded",
  embeddedPort: WEBDRIVER_PORT,
  env: appEnv(),
  startTimeout: 60_000
};

/**
 * Drives the real desktop app, built with `--features e2e` (see `npm run e2e:desktop`),
 * through the WebDriver server embedded in it (tauri-plugin-wdio-webdriver): the same setup on
 * macOS and on Linux (under a virtual X display in CI), no external driver needed.
 */
export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./smoke.e2e.ts"],
  maxInstances: 1,
  capabilities,
  services: [["@wdio/tauri-service", tauri]],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 120_000 },
  reporters: ["spec"],
  logLevel: "warn",
  outputDir: OUTPUT_DIR,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 30_000,
  connectionRetryCount: 1,

  // Tests pick their window themselves. Choosing one turns off the service's automatic window
  // focus, which asks tauri-plugin-wdio (not in this app) and waits 5 s for it on every command.
  before: async () => {
    await browser.switchToWindow("main");
  },
  onReload: async () => {
    await browser.switchToWindow("main");
  },
  // The app the persistence test started again.
  afterSession: stopRelaunchedApp,
  onComplete: () => rmSync(dataDir(), { recursive: true, force: true })
};
