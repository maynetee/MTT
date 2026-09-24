import {
  chooseSeat,
  createTournament,
  eliminate,
  errorToast,
  expect,
  nameField,
  openTab,
  register,
  registerAll,
  startClock,
  stat,
  tableRows,
  test
} from "./support";
import type { Page } from "@playwright/test";

const statusPanel = (page: Page) => page.getByRole("region", { name: "Registration", exact: true });
const playersTable = (page: Page) => page.getByRole("table", { name: "Players in play" });
const ticket = (page: Page) => page.getByRole("status").filter({ hasText: "Registered" });

test("registers players at a drawn seat and at a chosen one", async ({ page }) => {
  await createTournament(page, { name: "Seat Draw Open", tables: 3, seats: 6 });

  await register(page, "Zoë Brennan");
  // The first table opens first; the seat is drawn.
  await expect(ticket(page)).toContainText(/Table 1, seat [1-6]/);

  await register(page, "Søren Kjær", { table: 2, seat: 5 });
  await expect(ticket(page)).toContainText("Table 2, seat 5");
  await expect(playersTable(page).getByRole("row", { name: /Søren Kjær/ })).toContainText("T2 S5");

  await expect(stat(statusPanel(page), "Registered")).toHaveText("2");
  await expect(stat(statusPanel(page), "Seats left")).toHaveText("16");
});

test("refuses a taken seat and a name already registered", async ({ page }) => {
  await createTournament(page, { name: "Refusals Cup", tables: 3, seats: 6 });
  await register(page, "Zoë Brennan");
  await register(page, "Søren Kjær", { table: 2, seat: 1 });

  // Regression: the refusal used to be a bare "Seat is not available".
  await chooseSeat(page, { table: 2, seat: 1 });
  await nameField(page).fill("José Castaño");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(errorToast(page)).toContainText("Seat 1 at table 2 is taken.");
  await expect(nameField(page)).toHaveValue("José Castaño");

  // Names are compared without case or accents composed differently.
  await chooseSeat(page);
  await nameField(page).fill("zoë brennan");
  await nameField(page).press("Enter");
  await expect(errorToast(page).filter({ hasText: "Zoë Brennan is already registered." })).toBeVisible();

  await expect(stat(statusPanel(page), "Registered")).toHaveText("2");
  expect((await tableRows(playersTable(page))).map(([name]) => name)).toEqual(["Zoë Brennan", "Søren Kjær"]);
});

test("refuses a chosen seat at a table that was broken", async ({ page }) => {
  // Regression: a forced seat could put a player at a closed table.
  await createTournament(page, { name: "Closed Table Classic", tables: 3, seats: 4 });
  await registerAll(page, ["Ngozi Okafor", "Mei-Lin Chen", "Aoife Byrne"]);
  await register(page, "Ömer Yıldız", { table: 3, seat: 2 });

  await openTab(page, "Seating");
  const table3 = page.getByRole("article", { name: "Table 3" });
  await table3.getByRole("button", { name: "Break table" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Break table 3?" });
  await dialog.getByRole("button", { name: "Break table 3" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Table 3 broken" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Other tables" })).toContainText(/Table 3\s*Closed/);

  await openTab(page, "Registration");
  await chooseSeat(page, { table: 3, seat: 2 });
  await nameField(page).fill("Kwame Asante");
  await nameField(page).press("Enter");
  await expect(errorToast(page)).toContainText("Table 3 is closed.");
  await expect(stat(statusPanel(page), "Registered")).toHaveText("4");
  await expect(playersTable(page).getByRole("row", { name: /Kwame Asante/ })).toHaveCount(0);
});

test("Cmd/Ctrl+Z in the name field edits the text, not the tournament", async ({ page }) => {
  // Regression: the undo shortcut fired inside the field and removed the last registration.
  await createTournament(page, { name: "Undo Guard Open", tables: 2, seats: 6 });
  await registerAll(page, ["Björn Lindqvist", "Priya Raman", "Łukasz Nowak"]);
  const undo = page.getByRole("button", { name: "Undo register Łukasz Nowak" });
  await expect(undo).toBeEnabled();

  await nameField(page).fill("Zed");
  await nameField(page).press("ControlOrMeta+z");
  await nameField(page).press("ControlOrMeta+z");
  await expect(stat(statusPanel(page), "Registered")).toHaveText("3");
  await expect(playersTable(page).getByRole("row", { name: /Łukasz Nowak/ })).toHaveCount(1);
  await expect(undo).toBeEnabled();

  // Outside a field the shortcut undoes the last registration.
  await nameField(page).fill("");
  await nameField(page).blur();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(playersTable(page).getByRole("row", { name: /Łukasz Nowak/ })).toHaveCount(0);
  await expect(stat(statusPanel(page), "Registered")).toHaveText("2");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(playersTable(page).getByRole("row", { name: /Łukasz Nowak/ })).toHaveCount(1);
});

test("seats freed by eliminations count as seats left", async ({ page }) => {
  // Regression: "Seats left" stayed at its value from before the eliminations.
  await createTournament(page, { name: "Late Reg Deepstack", tables: 3, seats: 6 });
  const names = [
    "Ngozi Okafor",
    "Mei-Lin Chen",
    "José Castaño",
    "Aoife Byrne",
    "Hana Kobayashi",
    "Kwame Asante",
    "Élodie Marchand",
    "Björn Lindqvist",
    "Priya Raman",
    "Mateus Oliveira",
    "Fatima El Idrissi",
    "Tomás Ó Ceallaigh",
    "Yuki Tanaka",
    "Ayşe Demir",
    "Nikos Papadakis",
    "Łukasz Nowak"
  ];
  await registerAll(page, names);
  await expect(stat(statusPanel(page), "Registered")).toHaveText("16");
  await expect(stat(statusPanel(page), "Seats left")).toHaveText("2");

  await startClock(page);
  await openTab(page, "Players");
  await eliminate(page, "Mei-Lin Chen");
  await eliminate(page, "Yuki Tanaka");

  await openTab(page, "Registration");
  await expect(statusPanel(page).getByText("Registration open")).toBeVisible();
  await expect(stat(statusPanel(page), "Registered")).toHaveText("16");
  await expect(stat(statusPanel(page), "Seats left")).toHaveText("4");
  // A late player takes one of the freed seats.
  await register(page, "Ingrid Solberg");
  await expect(stat(statusPanel(page), "Seats left")).toHaveText("3");
});
