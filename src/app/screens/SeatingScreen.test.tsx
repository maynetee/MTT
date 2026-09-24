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

    await user.click(within(card).getByRole("button", { name: "Set button" }));
    await user.click(within(card).getByRole("button", { name: "Put the button at seat 3" }));

    await waitFor(async () => expect((await engine.getView(id)).tables[0].button).toBe(3));
    // Ben has the button: Cat posts the small blind, Ann the big blind.
    const seatRow = (name: string) => within(card).getByText(name).closest(".seat-row") as HTMLElement;
    expect(await within(seatRow("Ben")).findByText("D")).toBeInTheDocument();
    expect(within(seatRow("Cat")).getByText("SB")).toBeInTheDocument();
    expect(within(seatRow("Ann")).getByText("BB")).toBeInTheDocument();
  });

  it("breaks a table after confirmation and opens another", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament({ tables: 3, seats: 4 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 2, 1]
    ]);
    renderApp(engine, `/t/${id}/seating`);

    await screen.findByRole("heading", { name: "Table 2" });
    await user.click(within(tableCard(2)).getByRole("button", { name: "Break table" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Break table" }));

    expect(await screen.findByText(/^Ben: Table 2 Seat 1 → Table 1 Seat [234]$/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Table 2" })).not.toBeInTheDocument();

    const others = screen.getByRole("heading", { name: "Other tables" }).closest(".card") as HTMLElement;
    const idle = within(others).getByText("Table 3").closest(".list-row") as HTMLElement;
    await user.click(within(idle).getByRole("button", { name: "Open table" }));
    expect(await screen.findByRole("heading", { name: "Table 3" })).toBeInTheDocument();
  });
});
