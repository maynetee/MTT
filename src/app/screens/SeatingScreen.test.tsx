import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { register, renderApp, withTournament } from "../../test/app";

function tableCard(table: number) {
  return screen.getByRole("heading", { name: `Table ${table}` }).closest(".table-card") as HTMLElement;
}

describe("SeatingScreen", () => {
  it("shows the players at their seats and sets the button by clicking a seat", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament({ tables: 2, seats: 4 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 1, 3],
      ["Cat", 1, 4]
    ]);
    renderApp(engine, `/t/${id}/seating`);

    const card = await screen.findByRole("heading", { name: "Table 1" }).then(() => tableCard(1));
    expect(within(card).getByText("3 players")).toBeInTheDocument();
    expect(within(card).getByText("Ben")).toBeInTheDocument();
    expect(within(card).getAllByText("Empty")).toHaveLength(1);

    const toggle = within(card).getByRole("button", { name: "Set button" });
    await user.click(toggle);
    // Picking starts on the first seat; Esc gives up and goes back to the toggle.
    expect(within(card).getByRole("button", { name: "Put the button at seat 1" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(within(card).queryByRole("button", { name: "Put the button at seat 1" })).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();

    await user.click(toggle);
    await user.click(within(card).getByRole("button", { name: "Put the button at seat 3" }));

    await waitFor(async () => expect((await engine.getView(id)).tables[0].button).toBe(3));
    // Ben has the button: Cat posts the small blind, Ann the big blind.
    const seatRow = (name: string) => within(card).getByText(name).closest(".seat-row") as HTMLElement;
    expect(await within(seatRow("Ben")).findByText("D")).toBeInTheDocument();
    expect(within(seatRow("Cat")).getByText("SB")).toBeInTheDocument();
    expect(within(seatRow("Ann")).getByText("BB")).toBeInTheDocument();
    expect(toggle).toHaveFocus();

    // Keyboard only: the seat with the button is where picking starts.
    await user.keyboard("{Enter}");
    expect(within(card).getByRole("button", { name: "Put the button at seat 3" })).toHaveFocus();
    await user.keyboard("{Tab}{Enter}");
    await waitFor(async () => expect((await engine.getView(id)).tables[0].button).toBe(4));
  });

  it("highlights the tables to balance and points to the Moves screen", async () => {
    const { engine, id } = await withTournament({ tables: 2, seats: 4 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 1, 2],
      ["Cat", 1, 3],
      ["Dan", 1, 4],
      ["Eve", 2, 1]
    ]);
    await engine.dispatch(id, { type: "start_clock" });
    renderApp(engine, `/t/${id}/seating`);

    await screen.findByRole("heading", { name: "Table 1" });
    expect(tableCard(1)).toHaveClass("needs-attention");
    expect(within(tableCard(1)).getByText("Sends 1")).toBeInTheDocument();
    expect(within(tableCard(2)).getByText("Receives 1")).toBeInTheDocument();
    // The plan waits for both buttons.
    expect(within(tableCard(1)).getByText("No button")).toBeInTheDocument();
    expect(within(tableCard(2)).queryByText("No button")).not.toBeInTheDocument();
    expect(screen.getByText("The tables need balancing: 1 move to make.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Moves" })).toHaveAttribute("href", `/t/${id}/moves`);
  });

  it("breaks a table after confirmation, lists the moves to announce and opens another table", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament({ tables: 4, seats: 4 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 2, 1]
    ]);
    renderApp(engine, `/t/${id}/seating`);

    await screen.findByRole("heading", { name: "Table 2" });
    expect(screen.getByText("Table 2 can be broken: the other tables can seat everyone.")).toBeInTheDocument();
    await user.click(within(tableCard(2)).getByRole("button", { name: "Break table" }));
    const dialog = screen.getByRole("alertdialog", { name: "Break table 2?" });
    expect(dialog).toHaveAccessibleDescription("Its player is redrawn to a free seat at another table.");
    expect(within(dialog).getByText("1 player to move")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Break table 2" }));

    const announce = await screen.findByRole("region", { name: "Table 2 broken" });
    expect(within(announce).getByRole("row", { name: /^Ben Table 2 Seat 1 Table 1 Seat [234]$/ })).toBeInTheDocument();
    await waitFor(() => expect(within(announce).getByRole("heading", { name: "Table 2 broken" })).toHaveFocus());
    expect(screen.queryByRole("heading", { name: "Table 2" })).not.toBeInTheDocument();
    // The last open table cannot be broken.
    expect(within(tableCard(1)).getByRole("button", { name: "Break table" })).toBeDisabled();

    const others = screen.getByRole("heading", { name: "Other tables" }).closest(".card") as HTMLElement;
    expect(within(others).getByText("Table 2").closest(".list-row")).toHaveTextContent("Table 2ClosedReopen");
    expect(within(others).getByText("2 tables").closest(".list-row")).toHaveTextContent("2 tablesNot opened");
    await user.click(screen.getByRole("button", { name: "Open table 3" }));
    expect(await screen.findByRole("heading", { name: "Table 3" })).toBeInTheDocument();
    expect(await screen.findByText("Table 3 opened.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open table 4" })).toBeInTheDocument();

    // Switching tabs keeps the list to announce.
    await user.click(screen.getByRole("link", { name: "Moves" }));
    expect(await screen.findByRole("region", { name: "Table 2 broken" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "Table 2 broken" })).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("region", { name: "Table 2 broken" })).not.toBeInTheDocument();
  });
});
