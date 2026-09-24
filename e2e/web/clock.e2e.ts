import type { Locator, Page } from "@playwright/test";
import {
  clockPod,
  createTournament,
  eliminate,
  errorToast,
  expect,
  nameField,
  openTab,
  pauseClock,
  registerAll,
  secondsShown,
  startClock,
  stat,
  test,
  tv
} from "./support";

const preview = (page: Page) => page.getByRole("region", { name: "Display preview" });

async function elapsedOver(scope: Locator, waitMs: number): Promise<number> {
  const before = await secondsShown(scope);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return before - (await secondsShown(scope));
}

test("the clock counts down in real time, also with the display open in another page", async ({ page, context }) => {
  const id = await createTournament(page, { name: "Real Time Turbo", tables: 2, seats: 6 });
  await registerAll(page, ["Hana Kobayashi", "Kwame Asante"]);
  await startClock(page);

  expect(await elapsedOver(clockPod(page), 3_000)).toBeGreaterThanOrEqual(2);
  expect(await elapsedOver(clockPod(page), 3_000)).toBeLessThanOrEqual(4);

  await openTab(page, "Display");
  const [display] = await Promise.all([context.waitForEvent("page"), preview(page).getByRole("button", { name: "Open display window" }).click()]);
  await display.waitForLoadState();
  expect(display.url()).toBe(new URL(`/#/display/${encodeURIComponent(id)}`, page.url()).href);
  await expect(tv.time(display)).toBeVisible();
  await expect(tv.level(display, 1)).toBeVisible();

  // Regression: with the display open, both pages advanced the clock and it ran twice as fast.
  const seen = await elapsedOver(clockPod(page), 4_000);
  expect(seen).toBeGreaterThanOrEqual(3);
  expect(seen).toBeLessThanOrEqual(5);
  const shown = await secondsShown(tv.time(display));
  expect(Math.abs(shown - (await secondsShown(clockPod(page))))).toBeLessThanOrEqual(1);
});

test("the display says PAUSED and BREAK, and level numbers skip breaks", async ({ page }) => {
  await createTournament(page, { name: "Break Numbering Classic", tables: 2, seats: 6 });
  await registerAll(page, ["Rafael Domínguez", "Chiara Bellini", "Sakura Itō"]);
  await startClock(page);
  await openTab(page, "Display");
  await expect(tv.time(preview(page))).toBeVisible();
  await expect(tv.level(preview(page), 1)).toBeVisible();
  await expect(tv.paused(preview(page))).toHaveCount(0);

  await pauseClock(page);
  await expect(tv.paused(preview(page))).toBeVisible();

  // Levels 1 to 4, then the first break.
  await openTab(page, "Clock");
  await page.getByRole("button", { name: "Next break" }).click();
  await expect(clockPod(page)).toContainText("Break");
  await expect(clockPod(page)).toContainText("10:00");
  await expect(page.getByRole("heading", { level: 2, name: "Break", exact: true })).toBeVisible();
  await openTab(page, "Display");
  // Regression: a paused break only said BREAK.
  await expect(tv.onBreak(preview(page))).toBeVisible();
  await expect(tv.paused(preview(page))).toBeVisible();

  await startClock(page);
  await expect(tv.paused(preview(page))).toHaveCount(0);
  await expect(tv.onBreak(preview(page))).toBeVisible();

  // Regression: the level after the first break was numbered 6, counting the break.
  await openTab(page, "Clock");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(clockPod(page)).toContainText("Level 5");
  await expect(page.getByRole("heading", { level: 2, name: "Level 5" })).toBeVisible();
  await expect(page.getByText(/^150\/300\s+BBA 300$/).first()).toBeVisible();
  await openTab(page, "Display");
  await expect(tv.level(preview(page), 5)).toBeVisible();
  await expect(tv.onBreak(preview(page))).toHaveCount(0);

  await openTab(page, "Clock");
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(clockPod(page)).toContainText("Break");
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(clockPod(page)).toContainText("Level 4");
});

test("keyboard shortcuts: Space, N and ?", async ({ page }) => {
  await createTournament(page, { name: "Shortcut Sprint", tables: 2, seats: 6 });
  await registerAll(page, ["Mikko Virtanen", "Amara Nwosu"]);
  await openTab(page, "Clock");
  await expect(clockPod(page)).toContainText("Not started");

  // Space in a text field types a space.
  await openTab(page, "Registration");
  await nameField(page).fill("Ana");
  await nameField(page).press("Space");
  await expect(nameField(page)).toHaveValue("Ana ");
  await expect(clockPod(page)).toContainText("Not started");
  await nameField(page).fill("");

  await openTab(page, "Clock");
  // Focus on nothing in particular: Space on a focused button would press it.
  await page.getByRole("heading", { name: "Upcoming levels" }).click();
  await page.keyboard.press("Space");
  await expect(clockPod(page)).toContainText("Running");
  await page.keyboard.press("Space");
  await expect(clockPod(page)).toContainText("Paused");

  // The next level starts in full; + and - move the clock by a minute.
  await page.keyboard.press("n");
  await expect(clockPod(page)).toContainText("Level 2");
  await expect(clockPod(page)).toContainText("20:00");
  await expect(page.getByRole("heading", { level: 2, name: "Level 2" })).toBeVisible();
  await page.keyboard.press("+");
  await expect(clockPod(page)).toContainText("21:00");
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await expect(clockPod(page)).toContainText("19:00");

  await page.keyboard.press("?");
  const overlay = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("Start or pause the clock");
  // Shortcuts are off behind a dialog.
  await page.keyboard.press("n");
  await expect(clockPod(page)).toContainText("Level 2");
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();

  // Tabs: 1 is Registration.
  await page.keyboard.press("1");
  await expect(page).toHaveURL(/\/registration$/);
});

test("undo and redo across an automatic level change", async ({ page }) => {
  // Level 1 lasts six seconds.
  await createTournament(page, { name: "Hyper Turbo Undo", tables: 2, seats: 6, minutes: [0.1] });
  await registerAll(page, ["Pavel Horák", "Anaïs Dubois", "Jörg Weiß"]);
  await startClock(page);
  await expect(clockPod(page)).toContainText("Level 1");

  await openTab(page, "Players");
  await eliminate(page, "Jörg Weiß");
  await expect(stat(page.getByRole("region", { name: "Field" }), "In play")).toHaveText("2");

  // Level 2 starts on its own.
  await expect(clockPod(page)).toContainText("Level 2", { timeout: 15_000 });
  await expect(clockPod(page)).toContainText("Running");

  // Undo takes back the elimination, not the level change.
  await page.getByRole("button", { name: "Undo eliminate Jörg Weiß" }).click();
  await expect(page.getByRole("button", { name: "Eliminate Jörg Weiß", exact: true })).toBeVisible();
  await expect(clockPod(page)).toContainText("Level 2");
  await expect(clockPod(page)).toContainText("Running");

  // Undoing the start puts the tournament back before its first level.
  await page.getByRole("button", { name: "Undo clock change" }).click();
  await expect(clockPod(page)).toContainText("Not started");
  await expect(clockPod(page)).toContainText("Level 1");

  // Redo replays the start as recorded: level 1 is over by now.
  await page.getByRole("button", { name: "Redo clock change" }).click();
  await expect(clockPod(page)).toContainText("Level 2");
  await expect(clockPod(page)).toContainText("Running");
  await page.getByRole("button", { name: "Redo eliminate Jörg Weiß" }).click();
  await expect(page.getByRole("button", { name: "Eliminate Jörg Weiß", exact: true })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Jörg Weiß/ })).toContainText("#3");
  await expect(errorToast(page)).toHaveCount(0);
});
