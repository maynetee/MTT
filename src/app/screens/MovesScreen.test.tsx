import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { playerId, register, renderApp, withTournament } from "../../test/app";

const region = (name: string | RegExp) => screen.findByRole("region", { name });
const todoItems = () => within(screen.getByRole("region", { name: "To do now" })).queryAllByRole("listitem");
const printSheet = () => document.querySelector<HTMLElement>(".print-sheet");

describe("MovesScreen manual move", () => {
  it("disables Move again when a select goes back to its placeholder", async () => {
    const { engine, id } = await withTournament({ tables: 2, seats: 2 });
    await register(engine, id, [["Bob", 1, 1]]);
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/moves`);

    await screen.findByRole("option", { name: "Bob" });
    const move = screen.getByRole("button", { name: "Move" });
    await user.selectOptions(screen.getByLabelText("Player"), "Bob");
    await user.selectOptions(screen.getByLabelText("Seat"), "Table 2 Seat 1");
    expect(move).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("Player"), "Select player");
    expect(move).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Player"), "Bob");
    await user.selectOptions(screen.getByLabelText("Seat"), "Select seat");
    expect(move).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Seat"), "Table 2 Seat 1");
    await user.click(move);
    await waitFor(async () => expect((await engine.getView(id)).ranking[0].seat).toEqual({ table: 2, seat: 1 }));
  });
});

describe("MovesScreen balancing", () => {
  it("asks for the unknown buttons inline, then applies the move as a balance move and lists it to announce", async () => {
    const { engine, id } = await withTournament({ tables: 2, seats: 4 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 1, 2],
      ["Cat", 1, 3],
      ["Dan", 1, 4],
      ["Eve", 2, 1]
    ]);
    await engine.dispatch(id, { type: "start_clock" });
    const dispatch = vi.spyOn(engine, "dispatch");
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/moves`);

    const step = (await screen.findByText("Move a player from table 1 to table 2")).closest("li") as HTMLElement;
    expect(within(step).getByText("Table 1 has 4 players and table 2 has 1 player; tables are balanced from a gap of 2.")).toBeInTheDocument();
    expect(within(step).getByText("Set the button at tables 1 and 2 to know who moves where.")).toBeInTheDocument();
    expect(within(step).queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();

    // The donor's button tells who moves: Ann has it, Ben is small blind, Cat the next big blind.
    await user.click(within(screen.getByRole("group", { name: "Button at table 1" })).getByRole("button", { name: "Put the button at seat 1 (Ann)" }));
    expect(await screen.findByText("Move Cat from table 1 seat 3 to table 2")).toBeInTheDocument();
    expect(await screen.findByText("Button at table 1, seat 1.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Button at table 1" })).not.toBeInTheDocument();
    // The chip clicked is gone: focus goes back to the step.
    await waitFor(() => expect(todoItems()[0]).toHaveFocus());

    // The receiver's button tells where: heads-up with Eve on the button, seat 2 is the big blind.
    await user.click(within(screen.getByRole("group", { name: "Button at table 2" })).getByRole("button", { name: "Put the button at seat 1 (Eve)" }));
    const resolved = (await screen.findByText("Move Cat from table 1 seat 3 to table 2 seat 2")).closest("li") as HTMLElement;
    await user.click(within(resolved).getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Tables are balanced.")).toBeInTheDocument();
    expect(dispatch).toHaveBeenLastCalledWith(id, { type: "move_player", player: playerId(await engine.getView(id), "Cat"), to: { table: 2, seat: 2 }, reason: "balance" });
    expect(await screen.findByText("Cat moved to table 2 seat 2.")).toBeInTheDocument();
    const announce = await region("Balancing moves");
    expect(within(announce).getByRole("row", { name: "Cat Table 1 Seat 3 Table 2 Seat 2" })).toBeInTheDocument();
    const view = await engine.getView(id);
    expect(view.tables.map((table) => table.players)).toEqual([3, 2]);
    expect(view.history.undo).toMatchObject({ kind: "player_moved", table: 2 });
  });

  it("applies every step of a resolved plan at once and announces them together", async () => {
    const { engine, id } = await withTournament({ tables: 2, seats: 6 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 1, 2],
      ["Cat", 1, 3],
      ["Dan", 1, 4],
      ["Eve", 1, 5],
      ["Fay", 1, 6],
      ["Gus", 2, 1]
    ]);
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/moves`);

    // Before the start buttons do not matter: the plan is known at once.
    await screen.findByText("Move Fay from table 1 seat 6 to table 2 seat 2");
    expect(todoItems()).toHaveLength(2);
    expect(within(todoItems()[1]).getByText("Table 1 has 5 players and table 2 has 2 players; tables are balanced from a gap of 2.")).toBeInTheDocument();
    expect(within(todoItems()[1]).queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply all 2 moves" }));

    expect(await screen.findByText("Tables are balanced.")).toBeInTheDocument();
    expect(await screen.findByText("2 players moved.")).toBeInTheDocument();
    const announce = await region("Balancing moves");
    expect(within(announce).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
      "EveTable 1 Seat 5Table 2 Seat 3",
      "FayTable 1 Seat 6Table 2 Seat 2"
    ]);
    expect((await engine.getView(id)).tables.map((table) => table.players)).toEqual([4, 3]);
  });
});

describe("MovesScreen table break", () => {
  it("previews who moves, breaks after confirmation and lists the moves to announce, copy and print", async () => {
    const { engine, id } = await withTournament({ tables: 3, seats: 4 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 2, 1],
      ["Cat", 3, 1],
      ["Dan", 3, 2],
      ["Eve", 3, 4]
    ]);
    await engine.dispatch(id, { type: "start_clock" });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/moves`);

    const item = (await screen.findByText("Break table 3: the other tables can seat everyone.")).closest("li") as HTMLElement;
    expect(within(item).getByText("Table 3 has 3 players; 5 players fit on the other 2 tables (8 seats).")).toBeInTheDocument();
    await user.click(within(item).getByRole("button", { name: "Break table 3" }));

    const dialog = screen.getByRole("alertdialog", { name: "Break table 3?" });
    expect(dialog).toHaveAccessibleDescription("Its 3 players are redrawn to free seats at the other tables.");
    expect(within(dialog).getByText("3 players to move")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "Seat 1Cat",
      "Seat 2Dan",
      "Seat 4Eve",
      "Table 13 free seats",
      "Table 23 free seats"
    ]);
    expect(within(dialog).getByText("Seats are drawn at random when you confirm. The list to announce comes next.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Break table 3" }));

    const announce = await region("Table 3 broken");
    expect(within(announce).getByText(/^3 players moved · /)).toBeInTheDocument();
    const rows = within(announce).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.firstChild!.textContent)).toEqual(["Cat", "Dan", "Eve"]);
    for (const row of rows) expect(row).toHaveAccessibleName(/^\w+ Table 3 Seat [124] Table [12] Seat [234]$/);
    await waitFor(() => expect(within(announce).getByRole("heading", { name: "Table 3 broken" })).toHaveFocus());
    expect(await screen.findByText("Table 3 broken: 3 players moved.")).toBeInTheDocument();

    // The printout holds the same list, on a sheet of its own.
    const sheet = printSheet()!;
    expect(sheet).toHaveTextContent("Test event");
    expect(within(sheet).getByRole("heading", { name: "Table 3 broken", hidden: true })).toBeInTheDocument();
    for (const name of ["Cat", "Dan", "Eve"]) expect(within(sheet).getByText(name)).toBeInTheDocument();
    await user.click(within(announce).getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledOnce();

    await user.click(within(announce).getByRole("button", { name: "Copy as text" }));
    const text = await navigator.clipboard.readText();
    const view = await engine.getView(id);
    const seatOf = (name: string) => view.ranking.find((row) => row.name === name)!.seat!;
    expect(text.split("\n")).toEqual([
      "Test event — Table 3 broken",
      expect.stringMatching(/^3 players moved · /),
      "",
      ...["Cat", "Dan", "Eve"].map(
        (name, index) => `${name}: Table 3 Seat ${[1, 2, 4][index]} → Table ${seatOf(name).table} Seat ${seatOf(name).seat}`
      )
    ]);
    expect(await screen.findByText("Moves copied to the clipboard.")).toBeInTheDocument();
    expect(view.tables.map((table) => table.status)).toEqual(["open", "open", "closed"]);

    // Undone: nothing is left to announce.
    await act(async () => {
      await engine.dispatch(id, { type: "undo" });
    });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Table 3 broken" })).not.toBeInTheDocument());
    expect(printSheet()).toBeNull();
  });

  it("warns in the dialog when the other tables have too few seats", async () => {
    const { engine, id } = await withTournament({ tables: 2, seats: 2 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 1, 2],
      ["Cat", 2, 1]
    ]);
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/seating`);

    const card = (await screen.findByRole("heading", { name: "Table 2" })).closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Break table" }));
    const dialog = screen.getByRole("alertdialog", { name: "Break table 2?" });
    expect(within(dialog).getByText("Not enough free seats: 1 needed, 0 available. Open a table first.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Break table 2" }));
    expect(await screen.findByText("Not enough free seats: 1 needed, 0 available.")).toBeInTheDocument();
  });
});

describe("MovesScreen final table", () => {
  it("redraws after confirmation, lists the seats in seat order and asks for the button", async () => {
    const { engine, id } = await withTournament({ tables: 2, seats: 4 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 1, 2],
      ["Cat", 2, 1]
    ]);
    await engine.dispatch(id, { type: "start_clock" });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/moves`);

    const item = (await screen.findByText("Final table: redraw the 3 remaining players at table 1.")).closest("li") as HTMLElement;
    expect(within(item).getByText("3 players are left: they all fit at the final table of 4 seats.")).toBeInTheDocument();
    await user.click(within(item).getByRole("button", { name: "Draw the final table" }));
    const dialog = screen.getByRole("alertdialog", { name: "Draw the final table?" });
    expect(dialog).toHaveAccessibleDescription("The 3 remaining players are redrawn to new seats at table 1, and the other tables close.");
    expect(within(dialog).getByText("After the draw, deal one card to each seat: the highest card takes the button.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Draw the final table" }));

    const announce = await region("Final table at table 1");
    await waitFor(() => expect(within(announce).getByRole("heading", { name: "Final table at table 1" })).toHaveFocus());
    expect(within(announce).getByText("Set the button: deal one card to each seat, the highest card takes it.")).toBeInTheDocument();
    const view = await engine.getView(id);
    expect(view.tables.map((table) => [table.status, table.players, table.button])).toEqual([
      ["open", 3, null],
      ["closed", 0, null]
    ]);
    const bySeat = view.tables[0].seats.filter((seat) => seat.name !== null);
    const rows = within(announce).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.firstChild!.textContent)).toEqual(bySeat.map((seat) => String(seat.seat)));
    expect(rows.map((row) => row.children[1].textContent)).toEqual(bySeat.map((seat) => seat.name));
    expect(within(announce).getByRole("row", { name: /^\d Cat Table 2 Seat 1$/ })).toBeInTheDocument();

    // The button is the next thing to do, asked right under the new seating.
    const [todo] = todoItems();
    expect(within(todo).getByText("Set the button at table 1")).toBeInTheDocument();
    expect(within(todo).getByText("Deal one card to each seat, then pick the seat with the highest card above the final table seating.")).toBeInTheDocument();
    expect(within(todo).queryByRole("group")).not.toBeInTheDocument();
    const cat = bySeat.find((seat) => seat.name === "Cat")!.seat;
    const picker = within(announce).getByRole("group", { name: "Seat with the highest card" });
    await user.click(within(picker).getByRole("button", { name: `Put the button at seat ${cat} (Cat)` }));

    expect(await screen.findByText("Tables are balanced.")).toBeInTheDocument();
    expect(await screen.findByText(`Button at table 1, seat ${cat}.`)).toBeInTheDocument();
    expect((await engine.getView(id)).tables[0].button).toBe(cat);
    const catRow = within(announce).getByRole("row", { name: /Cat/ });
    expect(within(catRow).getByText("D")).toBeInTheDocument();
    expect(within(announce).getByText("SB")).toBeInTheDocument();
    expect(within(announce).getByText("BB")).toBeInTheDocument();
    expect(within(announce).queryByRole("group")).not.toBeInTheDocument();
    expect(within(announce).getByRole("heading", { name: "Final table at table 1" })).toHaveFocus();
  });

  it("asks for the button of the last table when no list is being announced", async () => {
    const { engine, id } = await withTournament({ tables: 1, seats: 4 });
    await register(engine, id, ["Ann", "Ben", "Cat"]);
    await engine.dispatch(id, { type: "start_clock" });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/moves`);

    const todo = (await screen.findByText("Set the button at table 1")).closest("li") as HTMLElement;
    expect(within(todo).getByText("Deal one card to each player: the highest card takes the button. The blinds of the next hand follow from it.")).toBeInTheDocument();
    const ben = (await engine.getView(id)).ranking.find((row) => row.name === "Ben")!.seat!.seat;
    await user.click(within(todo).getByRole("button", { name: `Put the button at seat ${ben} (Ben)` }));
    expect(await screen.findByText("Tables are balanced.")).toBeInTheDocument();
    expect((await engine.getView(id)).tables[0].button).toBe(ben);
  });
});
