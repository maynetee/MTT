import type { Page } from "@playwright/test";
import { createTournament, eliminate, expect, openTab, register, startClock, tableRows, test } from "./support";

/** Three players at each of three tables. */
const SEATED: ReadonlyArray<readonly [string, number, number]> = [
  ["Rasmus Holm", 1, 1],
  ["Leilani Kahale", 1, 3],
  ["Siddharth Iyer", 1, 5],
  ["Gráinne Walsh", 2, 2],
  ["Thanh Hà Nguyễn", 2, 4],
  ["Oluwaseun Adeyemi", 2, 5],
  ["Lucía Fernández", 3, 1],
  ["Mateus Oliveira", 3, 2],
  ["Élodie Marchand", 3, 4]
];

const todo = (page: Page) => page.getByRole("region", { name: "To do now" });

async function eliminateAll(page: Page, names: readonly string[]) {
  await openTab(page, "Players");
  for (const name of names) await eliminate(page, name);
}

test("breaking a table, then drawing the final table, lists the moves to announce", async ({ page }) => {
  await createTournament(page, { name: "Guided Moves Cup", tables: 3, seats: 5 });
  for (const [name, table, seat] of SEATED) await register(page, name, { table, seat });
  await startClock(page);

  // Seven players left fit at two tables of five: the plan asks for a table break.
  await eliminateAll(page, ["Rasmus Holm", "Lucía Fernández"]);
  await openTab(page, "Seating");
  await expect(page.getByText(/^Table \d can be broken: the other tables can seat everyone\.$/)).toBeVisible();
  await openTab(page, "Moves");
  const breakItem = todo(page).getByText(/^Break table \d: the other tables can seat everyone\.$/);
  await expect(breakItem).toBeVisible();
  const broken = Number(/Break table (\d)/.exec((await breakItem.textContent()) ?? "")![1]);
  const leaving = SEATED.filter(([name, table]) => table === broken && name !== "Rasmus Holm" && name !== "Lucía Fernández").map(([name]) => name);

  await todo(page).getByRole("button", { name: `Break table ${broken}` }).click();
  const dialog = page.getByRole("alertdialog", { name: `Break table ${broken}?` });
  await expect(dialog).toContainText(leaving.length === 1 ? "1 player to move" : `${leaving.length} players to move`);
  await dialog.getByRole("button", { name: `Break table ${broken}` }).click();

  const announce = page.getByRole("region", { name: `Table ${broken} broken` });
  await expect(announce).toBeVisible();
  const moves = await tableRows(announce.getByRole("table"));
  expect(moves.map(([name]) => name).sort()).toEqual([...leaving].sort());
  for (const [, from, to] of moves) {
    expect(from).toMatch(new RegExp(`^Table ${broken} Seat \\d$`));
    expect(to).toMatch(/^Table \d Seat \d$/);
    expect(to).not.toMatch(new RegExp(`^Table ${broken} `));
  }
  await announce.getByRole("button", { name: "Done" }).click();
  await expect(announce).toHaveCount(0);

  // Five players left for a final table of five, still at two tables.
  const alive = SEATED.map(([name]) => name).filter((name) => !["Rasmus Holm", "Lucía Fernández"].includes(name));
  await eliminateAll(page, alive.slice(0, 2));
  await openTab(page, "Moves");
  const finalItem = todo(page).getByText(/^Final table: redraw the 5 remaining players at table \d\.$/);
  await expect(finalItem).toBeVisible();
  const finalTable = Number(/at table (\d)/.exec((await finalItem.textContent()) ?? "")![1]);
  await todo(page).getByRole("button", { name: "Draw the final table" }).click();
  await page.getByRole("alertdialog", { name: "Draw the final table?" }).getByRole("button", { name: "Draw the final table" }).click();

  const final = page.getByRole("region", { name: `Final table at table ${finalTable}` });
  await expect(final).toBeVisible();
  const seats = await tableRows(final.getByRole("table"));
  expect(seats.map(([, name]) => name).sort()).toEqual(alive.slice(2).sort());
  await expect(final.getByText("Set the button: deal one card to each seat, the highest card takes it.")).toBeVisible();

  await openTab(page, "Seating");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: `Table ${finalTable}` })).toContainText("5 players");
});

test("the balancing plan names who moves where, once the buttons are known", async ({ page }) => {
  await createTournament(page, { name: "Balance Check Open", tables: 2, seats: 6 });
  const table1 = ["Rasmus Holm", "Leilani Kahale", "Siddharth Iyer", "Gráinne Walsh", "Élodie Marchand"];
  const table2 = ["Thanh Hà Nguyễn", "Oluwaseun Adeyemi", "Lucía Fernández", "Mateus Oliveira", "Ingrid Solberg", "Kwame Asante"];
  for (const [index, name] of table1.entries()) await register(page, name, { table: 1, seat: index + 1 });
  for (const [index, name] of table2.entries()) await register(page, name, { table: 2, seat: index + 1 });
  await startClock(page);

  // Three players against six (and too many for one table): one has to move.
  await eliminateAll(page, table1.slice(0, 2));
  await openTab(page, "Moves");
  await expect(todo(page).getByText("Move a player from table 2 to table 1")).toBeVisible();
  await expect(todo(page).getByText("Set the button at tables 2 and 1 to know who moves where.")).toBeVisible();
  for (const table of [2, 1]) {
    await todo(page)
      .getByRole("group", { name: `Button at table ${table}` })
      .getByRole("button", { name: /^Put the button at seat 3 / })
      .click();
    await expect(todo(page).getByRole("group", { name: `Button at table ${table}` })).toHaveCount(0);
  }
  const step = todo(page).getByText(/^Move .+ from table 2 seat \d to table 1 seat \d$/);
  await expect(step).toBeVisible();
  const mover = /^Move (.+) from table 2/.exec((await step.textContent()) ?? "")![1];
  expect(table2).toContain(mover);

  await todo(page).getByRole("button", { name: "Apply", exact: true }).click();
  const announce = page.getByRole("region", { name: "Balancing moves" });
  await expect(announce).toBeVisible();
  const [[name, from, to]] = await tableRows(announce.getByRole("table"));
  expect(name).toBe(mover);
  expect(from).toMatch(/^Table 2 Seat \d$/);
  expect(to).toMatch(/^Table 1 Seat \d$/);
  await expect(todo(page).getByText("Tables are balanced.")).toBeVisible();
});
