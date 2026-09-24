import { readFile } from "node:fs/promises";
import { test as base, expect, type Download, type Locator, type Page } from "@playwright/test";

/**
 * Every test fails on a console error, a console warning or an uncaught exception, in any
 * page of its context (the display window included).
 */
export const test = base.extend<{ consoleProblems: string[] }>({
  consoleProblems: [
    async ({ context }, use) => {
      const problems: string[] = [];
      const watch = (page: Page) => {
        page.on("console", (message) => {
          if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
        });
        page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
      };
      context.pages().forEach(watch);
      context.on("page", watch);
      await use(problems);
      expect(problems, "console errors and warnings").toEqual([]);
    },
    { auto: true }
  ]
});

export { expect };

export interface TournamentSpec {
  name: string;
  tables?: number;
  seats?: number;
  placesPaid?: number;
  /** Minutes of the first rows of the default structure (4 play levels, then a break). */
  minutes?: number[];
}

/** The id in `#/t/<id>/...`. */
export function tournamentId(page: Page): string {
  const match = /#\/t\/([^/]+)/.exec(page.url());
  if (!match) throw new Error(`not on a tournament page: ${page.url()}`);
  return decodeURIComponent(match[1]);
}

/** Creates a tournament through the setup screen and lands on its registration tab. */
export async function createTournament(page: Page, spec: TournamentSpec): Promise<string> {
  await page.goto("/");
  await page.getByRole("link", { name: "New tournament" }).first().click();
  await expect(page.getByRole("heading", { name: "New tournament" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(spec.name);
  if (spec.tables !== undefined) await page.getByRole("spinbutton", { name: "Tables", exact: true }).fill(String(spec.tables));
  if (spec.seats !== undefined) await page.getByRole("spinbutton", { name: "Seats per table", exact: true }).fill(String(spec.seats));
  if (spec.placesPaid !== undefined) await page.getByRole("spinbutton", { name: "Places paid", exact: true }).fill(String(spec.placesPaid));
  for (const [index, minutes] of (spec.minutes ?? []).entries()) {
    await page.getByRole("spinbutton", { name: `Level ${index + 1} Minutes`, exact: true }).fill(String(minutes));
  }
  await page.getByRole("button", { name: "Create tournament" }).click();
  await expect(page).toHaveURL(/#\/t\/[^/]+\/registration$/);
  await expect(page.getByRole("heading", { level: 1, name: spec.name })).toBeVisible();
  return tournamentId(page);
}

export function nameField(page: Page): Locator {
  return page.getByRole("textbox", { name: "Player name" });
}

/** Registers a player (at a chosen seat when given) and waits for the seat ticket. */
export async function register(page: Page, name: string, seat?: { table: number; seat: number }): Promise<void> {
  await chooseSeat(page, seat);
  await nameField(page).fill(name);
  await nameField(page).press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Registered" })).toContainText(name);
  await expect(nameField(page)).toHaveValue("");
}

/** Ticks "Choose the seat" and fills it in, or unticks it. */
export async function chooseSeat(page: Page, seat?: { table: number; seat: number }): Promise<void> {
  const box = page.getByRole("checkbox", { name: "Choose the seat" });
  await box.setChecked(seat !== undefined);
  if (seat) {
    await page.getByRole("spinbutton", { name: "Table", exact: true }).fill(String(seat.table));
    await page.getByRole("spinbutton", { name: "Seat", exact: true }).fill(String(seat.seat));
  }
}

export async function registerAll(page: Page, names: readonly string[]): Promise<void> {
  for (const name of names) await register(page, name);
}

/** Opens one of the director's tabs. */
export async function openTab(page: Page, label: string): Promise<void> {
  await page.getByRole("navigation", { name: "Tournament sections" }).getByRole("link", { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${label.toLowerCase()}$`));
}

/**
 * The TV display, in its window or previewed in the Display tab. Only what any layout keeps is
 * checked: the time left (a timer), the level or break as the heading of the clock, PAUSED.
 */
export const tv = {
  time: (scope: Locator | Page) => scope.getByRole("timer"),
  level: (scope: Locator | Page, n: number) => scope.getByRole("heading", { name: `Level ${n}`, exact: true }),
  onBreak: (scope: Locator | Page) => scope.getByRole("heading", { name: "Break", exact: true }),
  paused: (scope: Locator | Page) => scope.getByText(/^paused$/i)
};

/** The header clock: level, state and time left. */
export function clockPod(page: Page): Locator {
  return page.getByRole("group", { name: "Tournament clock" });
}

const TIME = /(?:\d+:)?\d{1,2}:\d{2}/;

/** Seconds shown by a clock (`12:34` or `1:02:03`) inside `scope`. */
export async function secondsShown(scope: Locator): Promise<number> {
  const text = (await scope.textContent()) ?? "";
  const match = TIME.exec(text);
  if (!match) throw new Error(`no clock time in "${text}"`);
  return match[0].split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

export async function startClock(page: Page): Promise<void> {
  await clockPod(page).getByRole("button", { name: "Start" }).click();
  await expect(clockPod(page)).toContainText("Running");
}

export async function pauseClock(page: Page): Promise<void> {
  await clockPod(page).getByRole("button", { name: "Pause" }).click();
  await expect(clockPod(page)).toContainText("Paused");
}

/** Eliminates one player from the Players tab, and waits for the notification. */
export async function eliminate(page: Page, name: string): Promise<void> {
  // Room for its notification: three show at a time.
  await dismissToasts(page);
  await page.getByRole("button", { name: `Eliminate ${name}`, exact: true }).click();
  await expect(toasts(page).filter({ hasText: `${name} eliminated` })).toBeVisible();
}

export function toasts(page: Page): Locator {
  return page.getByRole("region", { name: "Notifications" }).getByRole("listitem");
}

/** Closes every notification, the queued ones included (three show at a time). */
export async function dismissToasts(page: Page): Promise<void> {
  const close = page.getByRole("region", { name: "Notifications" }).getByRole("button", { name: "Dismiss notification" });
  // A notification may also go away on its own meanwhile.
  while ((await close.count()) > 0) await close.first().click({ timeout: 2_000 }).catch(() => undefined);
}

/** The error notification, which interrupts (role alert). */
export function errorToast(page: Page): Locator {
  return page.getByRole("region", { name: "Notifications" }).getByRole("alert");
}

/** Asserts that two elements on screen do not overlap (a notification over a button). */
export async function expectApart(a: Locator, b: Locator): Promise<void> {
  const [first, second] = [await a.boundingBox(), await b.boundingBox()];
  if (!first || !second) throw new Error("both elements must be visible");
  const apart =
    first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y;
  expect(apart, `${JSON.stringify(first)} overlaps ${JSON.stringify(second)}`).toBe(true);
}

/** The value of a statistic (`<dt>` label, `<dd>` value) inside `scope`. */
export function stat(scope: Locator | Page, label: string): Locator {
  return scope.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
}

/** Body rows of a table, each as its cells' text (header cells included). */
export async function tableRows(table: Locator): Promise<string[][]> {
  const rows = table.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  const out: string[][] = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const cells = rows.nth(i).locator("th, td");
    out.push((await cells.allTextContents()).map((text) => text.trim()));
  }
  return out;
}

export async function downloadText(download: Download): Promise<string> {
  const path = await download.path();
  return readFile(path, "utf8");
}

export async function downloadBytes(download: Download): Promise<Buffer> {
  return readFile(await download.path());
}
