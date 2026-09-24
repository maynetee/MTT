import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The app under test: the debug binary built by `npm run e2e:desktop` with the `e2e` cargo
 * feature, i.e. with its embedded WebDriver server.
 */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const APP_BINARY = join(ROOT, "target", "debug", process.platform === "win32" ? "mtt.exe" : "mtt");
export const WEBDRIVER_PORT = Number(process.env.MTT_E2E_WEBDRIVER_PORT ?? 4445);
export const OUTPUT_DIR = join(ROOT, "test-results", "desktop");

/** Set by the launcher for its worker: the data directory of this run. */
const DATA_DIR_ENV = "MTT_E2E_DATA_DIR";

/**
 * A fresh, empty data directory for the run, created once by the launcher (the worker
 * inherits it), so the app never touches the real tournaments.
 */
export function dataDir(): string {
  process.env[DATA_DIR_ENV] ||= mkdtempSync(join(tmpdir(), "mtt-e2e-"));
  return process.env[DATA_DIR_ENV];
}

/**
 * The app's environment: the throwaway data directory, and a previous-version database that
 * does not exist, so the real one (from the app's previous identifier) is never read.
 */
export function appEnv(): Record<string, string> {
  const dir = dataDir();
  return { MTT_DATA_DIR: dir, MTT_LEGACY_DB: join(dir, "no-previous-version.sqlite") };
}

async function webDriverReady(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${WEBDRIVER_PORT}/status`, { signal: AbortSignal.timeout(1_000) });
    const body = (await response.json()) as { value?: { ready?: boolean } };
    return body.value?.ready === true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** The app started again by `relaunchApp`, stopped after the session. */
let relaunched: ChildProcess | null = null;

/** Waits until the app has quit, then starts it again on the same data directory. */
export async function relaunchApp(): Promise<void> {
  await waitFor(async () => !(await webDriverReady()), 15_000, "the app has quit");
  relaunched = spawn(APP_BINARY, [], {
    env: { ...process.env, ...appEnv(), TAURI_WEBDRIVER_PORT: String(WEBDRIVER_PORT) },
    stdio: "ignore"
  });
  await waitFor(webDriverReady, 60_000, "the app is back");
}

export async function stopRelaunchedApp(): Promise<void> {
  const child = relaunched;
  relaunched = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}
