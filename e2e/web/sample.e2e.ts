import type { Page } from "@playwright/test";
import { clockPod, expect, openTab, test, tournamentId, tv } from "./support";

/** Every tab, with a heading it always shows. */
const TABS: ReadonlyArray<readonly [string, string]> = [
  ["Registration", "Register player"],
  ["Seating", "Table 1"],
  ["Players", "Players"],
  ["Moves", "To do now"],
  ["Clock", "Upcoming levels"],
  ["Levels", "Structure"],
  ["Settings", "Settings"],
  ["Display", "Display preview"],
  ["Exports", "Exports"]
];

async function openSample(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample tournament" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sample — Friday Deepstack" })).toBeVisible();
  await expect(page).toHaveURL(/#\/t\/[^/]+\/registration$/);
  return tournamentId(page);
}

test("the sample tournament opens and every tab renders", async ({ page }) => {
  await openSample(page);
  await expect(clockPod(page)).toContainText("Level 3");

  for (const [tab, heading] of TABS) {
    await openTab(page, tab);
    await expect(page.getByRole("main").getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
  }

  await openTab(page, "Players");
  await expect(page.getByRole("row", { name: /Łukasz Nowak/ })).toBeVisible();
  // The console watcher fails the test on any error or warning.
});

test("the display window opens at its own URL and can be left", async ({ page, context }) => {
  const id = await openSample(page);
  await openTab(page, "Display");

  const [display] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Open display window" }).click()]);
  await display.waitForLoadState();
  expect(display.url()).toBe(new URL(`/#/display/${encodeURIComponent(id)}`, page.url()).href);
  await expect(tv.time(display.locator("body"))).toBeVisible();
  await expect(display.locator("body")).toContainText(tv.level(3));

  // The exit control shows when the mouse moves.
  await display.mouse.move(200, 200);
  await display.mouse.move(400, 300);
  const exit = display.getByRole("button", { name: /exit/i });
  await expect(exit).toBeVisible();
  await Promise.all([display.waitForEvent("close"), exit.click()]);

  // D opens it again, Esc closes it.
  await page.getByRole("heading", { name: "Display preview" }).click();
  const [again] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("d")]);
  await again.waitForLoadState();
  expect(again.url()).toBe(display.url());
  await expect(again.locator("body")).toContainText(tv.level(3));
  // The page closes while the key is still being pressed.
  await Promise.all([again.waitForEvent("close"), again.keyboard.press("Escape").catch(() => undefined)]);
});
