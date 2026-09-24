import type { Page } from "@playwright/test";
import {
  clockPod,
  createTournament,
  dismissToasts,
  downloadBytes,
  downloadText,
  eliminate,
  errorToast,
  expect,
  openTab,
  registerAll,
  startClock,
  tableRows,
  test,
  toasts,
  tv
} from "./support";

const PLAYERS = ["Łukasz Nowak", "Zoë Brennan", "Søren Kjær", "Ngozi Okafor", "Björn Lindqvist", "Aoife Byrne"];

const preview = (page: Page) => page.getByRole("region", { name: "Display preview" });
/** The money status of the display: the one line beyond the clock these tests read there. */
const bubble = (page: Page) => preview(page).getByText(/^bubble!?$/i);
const exportsTable = (page: Page) => page.getByRole("table", { name: "Exports" });

async function closeRegistration(page: Page) {
  await openTab(page, "Registration");
  await page.getByRole("region", { name: "Registration", exact: true }).getByRole("button", { name: "Close registration" }).click();
  await page.getByRole("alertdialog", { name: "Close registration now?" }).getByRole("button", { name: "Close registration" }).click();
  await expect(page.getByText("Registration closed", { exact: true })).toBeVisible();
}

async function exportFile(page: Page, format: "CSV" | "PDF") {
  await dismissToasts(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: `Export ${format}` }).click()]);
  await expect(toasts(page).filter({ hasText: `Ranking exported as ${format}` })).toBeVisible();
  return download;
}

test("eliminations, the live ranking, its exports and the end of the tournament", async ({ page }) => {
  await createTournament(page, { name: "Kraków Monthly", tables: 2, seats: 6, placesPaid: 3 });
  await registerAll(page, PLAYERS);
  await startClock(page);
  await closeRegistration(page);

  await openTab(page, "Players");
  await eliminate(page, "Ngozi Okafor");
  await eliminate(page, "Zoë Brennan");

  // Four left for three places: the next elimination is the bubble.
  await openTab(page, "Display");
  await expect(bubble(page)).toBeVisible();

  await openTab(page, "Players");
  await eliminate(page, "Søren Kjær");
  // Regression: the bubble was announced one elimination late, with everyone left already paid.
  await openTab(page, "Display");
  await expect(tv.time(preview(page))).toBeVisible();
  await expect(bubble(page)).toHaveCount(0);
  await expect(preview(page)).not.toContainText(/(?<!\d)1 eliminations/);

  // Regression: the ranking put the first players out on top while others were still playing.
  await openTab(page, "Exports");
  const live = await tableRows(exportsTable(page));
  expect(live.slice(0, 3).map(([place, , status]) => [place, status])).toEqual([
    ["—", "In play"],
    ["—", "In play"],
    ["—", "In play"]
  ]);
  expect(live.slice(0, 3).map(([, name]) => name).sort()).toEqual(["Aoife Byrne", "Björn Lindqvist", "Łukasz Nowak"].sort());
  expect(live.slice(3)).toEqual([
    ["#4", "Søren Kjær", "Eliminated"],
    ["#5", "Zoë Brennan", "Eliminated"],
    ["#6", "Ngozi Okafor", "Eliminated"]
  ]);

  const csv = await exportFile(page, "CSV");
  expect(csv.suggestedFilename()).toBe("Kraków Monthly-ranking.csv");
  const text = await downloadText(csv);
  expect(text.startsWith("\uFEFF")).toBe(true);
  const lines = text.slice(1).split("\r\n");
  expect(lines[0]).toBe("Place,Player,Status");
  expect(lines.slice(1, 4).every((line) => line.startsWith(",") && line.endsWith(",In play"))).toBe(true);
  expect(lines.slice(4)).toEqual(["4,Søren Kjær,Eliminated", "5,Zoë Brennan,Eliminated", "6,Ngozi Okafor,Eliminated", ""]);

  // Regression: the PDF font could not encode "Ł" and the export failed.
  const pdf = await exportFile(page, "PDF");
  expect(pdf.suggestedFilename()).toBe("Kraków Monthly-ranking.pdf");
  const bytes = await downloadBytes(pdf);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1_000);
  await expect(errorToast(page)).toHaveCount(0);

  // The same hand busts two players: the bigger starting stack finishes higher.
  await openTab(page, "Players");
  await page.getByRole("button", { name: "Eliminated in the same hand…" }).click();
  await page.getByRole("checkbox", { name: "Select Björn Lindqvist" }).check();
  await page.getByRole("checkbox", { name: "Select Aoife Byrne" }).check();
  await page.getByRole("spinbutton", { name: "Starting stack Björn Lindqvist" }).fill("12000");
  await page.getByRole("spinbutton", { name: "Starting stack Aoife Byrne" }).fill("30500");
  await page.getByRole("button", { name: "Eliminate 2 players" }).click();
  await expect(page.getByText("Łukasz Nowak won the tournament.")).toBeVisible();

  // Regression: the winner could still be eliminated, and the clock restarted.
  await expect(page.getByRole("button", { name: /^Eliminate / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Eliminated in the same hand…" })).toHaveCount(0);
  await expect(clockPod(page)).toContainText("Finished");
  await expect(clockPod(page).getByRole("button")).toHaveCount(0);
  await page.getByRole("heading", { name: "Players", exact: true }).click();
  await page.keyboard.press("Space");
  await page.keyboard.press("n");
  await expect(clockPod(page)).toContainText("Finished");
  await expect(page.getByText("Łukasz Nowak won the tournament.")).toBeVisible();

  await openTab(page, "Exports");
  await expect(page.getByText("Final ranking")).toBeVisible();
  expect(await tableRows(exportsTable(page))).toEqual([
    ["#1", "Łukasz Nowak", "Winner"],
    ["#2", "Aoife Byrne", "Eliminated"],
    ["#3", "Björn Lindqvist", "Eliminated"],
    ["#4", "Søren Kjær", "Eliminated"],
    ["#5", "Zoë Brennan", "Eliminated"],
    ["#6", "Ngozi Okafor", "Eliminated"]
  ]);
  const final = await downloadText(await exportFile(page, "CSV"));
  expect(final.slice(1).split("\r\n").slice(0, 4)).toEqual(["Place,Player,Status", "1,Łukasz Nowak,Winner", "2,Aoife Byrne,Eliminated", "3,Björn Lindqvist,Eliminated"]);

  // Undoing the last hand brings the tournament back into play.
  await page.getByRole("button", { name: "Undo eliminate Björn Lindqvist and Aoife Byrne" }).click();
  await expect(clockPod(page)).not.toContainText("Finished");
  await openTab(page, "Players");
  await expect(page.getByText("Łukasz Nowak won the tournament.")).toHaveCount(0);
  for (const name of ["Łukasz Nowak", "Björn Lindqvist", "Aoife Byrne"]) {
    await expect(page.getByRole("button", { name: `Eliminate ${name}`, exact: true })).toBeVisible();
  }
});

test("revives an eliminated player at the seat offered first", async ({ page }) => {
  // Regression: the seat preselected for a revive was taken, so reviving failed.
  await createTournament(page, { name: "Second Chance Series", tables: 2, seats: 6 });
  await registerAll(page, ["Ingrid Solberg", "Nikos Papadakis", "Ayşe Demir", "Tomás Ó Ceallaigh"]);
  await startClock(page);
  await openTab(page, "Players");
  await eliminate(page, "Ayşe Demir");

  const revive = page.getByRole("region", { name: "Revive eliminated player" });
  await revive.getByRole("combobox", { name: "Player" }).selectOption({ label: "Ayşe Demir" });
  await expect(revive.getByRole("combobox", { name: "Seat" })).toHaveValue(/\d+:\d+/);
  await revive.getByRole("button", { name: "Revive player" }).click();
  await expect(page.getByRole("button", { name: "Eliminate Ayşe Demir", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Ayşe Demir/ })).toContainText("In play");
  await expect(revive).toHaveCount(0);
  await expect(errorToast(page)).toHaveCount(0);
});
