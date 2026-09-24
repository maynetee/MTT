import { createTournament, expect, expectApart, test } from "./support";

test("creates a tournament from the setup screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No tournament yet")).toBeVisible();

  const id = await createTournament(page, { name: "Vendredi à Kraków — Ωmega", tables: 3, seats: 6, placesPaid: 3 });
  expect(id).not.toBe("");
  await expect(page.getByRole("group", { name: "Tournament clock" })).toContainText("Not started");

  // Listed on the home screen, not started, with its player count.
  await page.getByRole("link", { name: "All tournaments" }).click();
  const row = page.getByRole("row", { name: /Vendredi à Kraków — Ωmega/ });
  await expect(row).toContainText("Setup");
  await row.getByRole("link", { name: "Open Vendredi à Kraków — Ωmega" }).click();
  await expect(page).toHaveURL(new RegExp(`#/t/${id}/registration$`));
});

test("typing in the structure editor keeps the focus and every character", async ({ page }) => {
  // Regression: the level editor re-created its row on every key, so the second character
  // typed went nowhere (typed "AB", got "Level 1A").
  await page.goto("/#/new");
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("");
  await name.pressSequentially("Łódź Deepstack", { delay: 20 });
  await expect(name).toHaveValue("Łódź Deepstack");
  await expect(name).toBeFocused();

  for (const [field, typed] of [
    ["Level 1 Minutes", "12.5"],
    ["Level 1 SB", "125"],
    ["Level 1 BB", "250"]
  ] as const) {
    const input = page.getByRole("spinbutton", { name: field, exact: true });
    await input.fill("");
    await input.pressSequentially(typed, { delay: 20 });
    await expect(input).toHaveValue(typed);
    await expect(input).toBeFocused();
  }

  // Letters never reach a number.
  const seats = page.getByRole("spinbutton", { name: "Seats per table", exact: true });
  await seats.fill("");
  await seats.pressSequentially("8x", { delay: 20 });
  await expect(seats).toHaveValue("8");
  await expect(page.getByText("64 seats")).toBeVisible();
});

test("an error at creation leaves the Create button clear", async ({ page }) => {
  await page.goto("/#/new");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("");
  const create = page.getByRole("button", { name: "Create tournament" });
  await create.click();
  const error = page.getByRole("region", { name: "Notifications" }).getByRole("alert");
  await expect(error).toContainText("The tournament name must be");
  await expectApart(error, create);

  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Second Try Series");
  await create.click({ timeout: 2_000 });
  await expect(page).toHaveURL(/#\/t\/[^/]+\/registration$/);
});
