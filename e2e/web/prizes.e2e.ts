import type { Page } from "@playwright/test";
import { createTournament, expect, openTab, registerAll, startClock, tableRows, test, tv } from "./support";

const preview = (page: Page) => page.getByRole("region", { name: "Display preview" });
const tabs = (page: Page) => page.getByRole("navigation", { name: "Tournament sections" });

test("a tournament without prizes: no payouts, no bubble, nothing paid on the display", async ({ page }) => {
  await createTournament(page, { name: "Tuesday League Night", tables: 1, seats: 6, placesPaid: 3, prizes: false, money: true });
  await expect(tabs(page).getByRole("link", { name: "Payouts", exact: true })).toHaveCount(0);
  await registerAll(page, ["Mateus Lima", "Ingrid Solberg", "Tomasz Wójcik", "Amara Diallo"]);
  await startClock(page);

  // Four left for what would be three places paid: no bubble, no prize pool, the levels to come.
  await openTab(page, "Display");
  await expect(tv.time(preview(page))).toBeVisible();
  await expect(preview(page).getByRole("status")).toHaveCount(0);
  await expect(preview(page).getByText("Prize pool")).toHaveCount(0);
  await expect(preview(page).getByText("Places paid")).toHaveCount(0);
  await expect(preview(page).getByRole("region", { name: "Coming up" })).toBeVisible();

  // The ranking has no prize column, although the buy-ins are tracked.
  await openTab(page, "Exports");
  await expect(page.getByRole("table", { name: "Exports" }).getByRole("columnheader")).toHaveText(["Place", "Player", "Status"]);
  expect(await tableRows(page.getByRole("table", { name: "Exports" }))).toHaveLength(4);

  // Turning the prizes on brings the payouts and the bubble back; undo takes them away again.
  await openTab(page, "Settings");
  await page.getByRole("checkbox", { name: /This tournament pays prizes/ }).check();
  await expect(page.getByRole("spinbutton", { name: "Places paid", exact: true })).toHaveValue("3");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(tabs(page).getByRole("link", { name: "Payouts", exact: true })).toBeVisible();
  await openTab(page, "Display");
  await expect(preview(page).getByRole("status")).toHaveText(/^Bubble/);

  await page.getByRole("button", { name: "Undo settings change" }).click();
  await expect(tabs(page).getByRole("link", { name: "Payouts", exact: true })).toHaveCount(0);
  await expect(preview(page).getByRole("status")).toHaveCount(0);
  await expect(preview(page).getByRole("region", { name: "Coming up" })).toBeVisible();
});
