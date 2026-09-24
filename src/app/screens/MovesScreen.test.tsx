import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { register, renderApp, withTournament } from "../../test/app";

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

describe("MovesScreen suggestions", () => {
  it("asks for the buttons, then applies a balancing step as a balance move", async () => {
    const { engine, id } = await withTournament({ tables: 2, seats: 4 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 1, 2],
      ["Cat", 1, 3],
      ["Dan", 1, 4],
      ["Eve", 2, 1]
    ]);
    await engine.dispatch(id, { type: "start_clock" });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/moves`);

    expect(await screen.findByRole("heading", { name: "Balance the tables" })).toBeInTheDocument();
    expect(screen.getByText("Move a player from table 1 to table 2")).toBeInTheDocument();
    expect(screen.getByText(/^Set the button at tables? .*to know who moves where\.$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set buttons" })).toHaveAttribute("href", `/t/${id}/seating`);
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();

    // The director sets the buttons (Seating tab, or another window).
    await act(async () => {
      await engine.dispatch(id, { type: "set_button", table: 1, seat: 1 });
      await engine.dispatch(id, { type: "set_button", table: 2, seat: 1 });
    });
    const step = (await engine.getView(id)).suggestions.balance[0];
    expect(step.player).not.toBeNull();
    const text = await screen.findByText(/^Move \w+ from table 1 seat \d to table 2 seat \d$/);
    await user.click(within(text.closest(".list-row") as HTMLElement).getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Tables are balanced.")).toBeInTheDocument();
    const view = await engine.getView(id);
    expect(view.ranking.find((row) => row.player === step.player)!.seat).toEqual({ table: 2, seat: step.toSeat });
    expect(view.tables.map((table) => table.players)).toEqual([3, 2]);
    expect(view.history.undo).toMatchObject({ kind: "player_moved", table: 2 });
  });

  it("breaks the suggested table after confirmation and lists the moves", async () => {
    const { engine, id } = await withTournament({ tables: 3, seats: 4 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 1, 2],
      ["Cat", 2, 1],
      ["Dan", 2, 2],
      ["Eve", 3, 1]
    ]);
    await engine.dispatch(id, { type: "start_clock" });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/moves`);

    expect(await screen.findByText("Break table 3: the other tables can seat everyone.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Break table 3" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Break table 3" }));

    const moved = await screen.findByRole("status", { name: "Players moved" });
    expect(within(moved).getByRole("row", { name: /^Eve Table 3 Seat 1 Table [12] Seat [34]$/ })).toBeInTheDocument();
    const view = await engine.getView(id);
    expect(view.tables.map((table) => table.status)).toEqual(["open", "open", "closed"]);
  });

  it("draws the final table", async () => {
    const { engine, id } = await withTournament({ tables: 2, seats: 4 });
    await register(engine, id, [
      ["Ann", 1, 1],
      ["Ben", 1, 2],
      ["Cat", 2, 1]
    ]);
    await engine.dispatch(id, { type: "start_clock" });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/moves`);

    expect(await screen.findByText("Final table: redraw the 3 remaining players at table 1.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Draw the final table" }));

    const moved = await screen.findByRole("status", { name: "Players moved" });
    expect(within(moved).getByRole("row", { name: /^Cat Table 2 Seat 1 Table 1 Seat \d$/ })).toBeInTheDocument();
    const view = await engine.getView(id);
    expect(view.tables.map((table) => [table.status, table.players])).toEqual([
      ["open", 3],
      ["closed", 0]
    ]);
    expect(await screen.findByText("Tables are balanced.")).toBeInTheDocument();
  });
});
