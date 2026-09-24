import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { playerId, register, renderApp, withTournament } from "../../test/app";

describe("RegistrationScreen", () => {
  it("shows the empty seats of tables that are not closed as seats left", async () => {
    const { engine, id } = await withTournament({ tables: 2, seats: 3 });
    const view = await register(engine, id, [
      ["Alice", 1, 1],
      ["Bob", 2, 1],
      ["Carol", 2, 2]
    ]);
    await engine.dispatch(id, { type: "start_clock" });
    await engine.dispatch(id, { type: "bust_players", busts: [{ player: playerId(view, "Alice") }] });
    await engine.dispatch(id, { type: "break_table", table: 1 });

    renderApp(engine, `/t/${id}/registration`);

    const label = await screen.findByText("Seats left");
    expect(label.nextElementSibling).toHaveTextContent(/^1$/);
  });

  it("registers a player at a random seat and says where", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    renderApp(engine, `/t/${id}/registration`);

    await user.type(await screen.findByPlaceholderText("Player name"), "  Dana   Scully {Enter}");

    const feedback = await screen.findByRole("status");
    const dana = (await engine.getView(id)).ranking.find((row) => row.name === "Dana Scully")!;
    expect(within(feedback).getByText("Dana Scully")).toBeInTheDocument();
    expect(within(feedback).getByText(`Table ${dana.seat!.table}, seat ${dana.seat!.seat}`)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Player name")).toHaveValue("");
  });

  it("registers a player at a chosen seat", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    renderApp(engine, `/t/${id}/registration`);

    await user.click(await screen.findByRole("checkbox", { name: "Choose the seat" }));
    const table = screen.getByLabelText("Table");
    await user.clear(table);
    await user.type(table, "2");
    const seat = screen.getByLabelText("Seat");
    await user.clear(seat);
    await user.type(seat, "7");
    await user.type(screen.getByPlaceholderText("Player name"), "Eve{Enter}");

    expect(await screen.findByText("Table 2, seat 7")).toBeInTheDocument();
    expect((await engine.getView(id)).ranking[0].seat).toEqual({ table: 2, seat: 7 });

    await user.type(screen.getByPlaceholderText("Player name"), "Finn{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Seat 7 at table 2 is taken.");
  });

  it("shows when registration closes and lets the director close and reopen it", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament({ config: { lateReg: { type: "end_of_play_level", n: 1, throughBreak: false } } });
    await register(engine, id, ["Ann", "Ben"]);
    renderApp(engine, `/t/${id}/registration`);

    expect(await screen.findByText("Registration open")).toBeInTheDocument();
    expect(screen.getByText("Open until the end of play level 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close registration" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText(/^Closes at .+ \(in 20:00\)$/)).toBeInTheDocument();

    // It would close on its own at the end of level 1: closing now is confirmed first.
    await user.click(screen.getByRole("button", { name: "Close registration" }));
    const dialog = screen.getByRole("alertdialog", { name: "Close registration now?" });
    await user.click(within(dialog).getByRole("button", { name: "Close registration" }));
    expect(await screen.findByText("Registration closed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reopen registration" }));
    expect(await screen.findByText("Registration open")).toBeInTheDocument();
  });

  it("closes a registration left open until closed by hand without asking", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "start_clock" });
    renderApp(engine, `/t/${id}/registration`);

    await user.click(await screen.findByRole("button", { name: "Close registration" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await screen.findByText("Registration closed")).toBeInTheDocument();
  });

  it("removes a registration before the start", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    await register(engine, id, ["Ann"]);
    renderApp(engine, `/t/${id}/registration`);

    await user.click(await screen.findByRole("button", { name: "Remove Ann" }));

    expect((await engine.getView(id)).counts.unique).toBe(0);
    expect(await screen.findByRole("button", { name: "Undo unregister a player" })).toBeInTheDocument();
  });
});
