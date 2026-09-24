import { createTournament, errorToast, expect, expectApart, openTab, registerAll, startClock, test, toasts } from "./support";

test("changes the structure during play", async ({ page }) => {
  // Regression: saving the structure threw ("updateLevelsLocal is not defined").
  await createTournament(page, { name: "Structure Edit Weekly", tables: 2, seats: 6 });
  await registerAll(page, ["Chiara Bellini", "Oluwaseun Adeyemi"]);
  await startClock(page);
  await openTab(page, "Levels");

  // The level in progress and the ones before it are locked.
  await expect(page.getByRole("spinbutton", { name: "Level 1 SB", exact: true })).toBeEditable();
  await page.getByRole("button", { name: "Skip level" }).click();
  await expect(page.getByRole("spinbutton", { name: "Level 1 SB", exact: true })).toBeDisabled();

  // A row the core rejects is reported, with its row number.
  const sb = page.getByRole("spinbutton", { name: "Level 5 SB", exact: true });
  await sb.fill("5000");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("alertdialog", { name: "Change the structure during play?" }).getByRole("button", { name: "Save changes" }).click();
  await expect(errorToast(page)).toContainText("Row 6: the small blind must be more than 0 and the big blind at least the small blind.");

  // Regression: the notification covered the Save button for ten seconds.
  const save = page.getByRole("button", { name: "Save changes" });
  await expectApart(errorToast(page), save);
  await sb.fill("150");
  await page.getByRole("spinbutton", { name: "Level 6 Amount", exact: true }).fill("450");
  await save.click({ timeout: 2_000 });
  await page.getByRole("alertdialog", { name: "Change the structure during play?" }).getByRole("button", { name: "Save changes" }).click();
  await expect(toasts(page).filter({ hasText: "Structure saved" })).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);

  await openTab(page, "Clock");
  await expect(page.getByRole("row", { name: /^Level 6 200\/400\s+BBA 450/ })).toBeVisible();
});
