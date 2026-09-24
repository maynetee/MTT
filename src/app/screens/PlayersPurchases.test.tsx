import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Config } from "../../engine/types";
import { playerId, register, renderApp, withTournament } from "../../test/app";
import { MemoryStorage, createTestEngine, tournamentInput } from "../../test/wasm";

const money = { currency: { code: "EUR", exponent: 2 }, buyIn: { prize: 10_000, fee: 1_000 }, roundingUnit: 100 };

/** Ann, Ben and Cat at table 1 of 2 (6 seats), running; the structure's break follows play level 2. */
async function running(config: Partial<Config>) {
  const { engine, id } = await withTournament({ tables: 2, seats: 6, config: { money, ...config } });
  const view = await register(engine, id, [
    ["Ann", 1, 1],
    ["Ben", 1, 2],
    ["Cat", 1, 3]
  ]);
  await engine.dispatch(id, { type: "start_clock" });
  return { engine, id, ann: playerId(view, "Ann") };
}

const row = (name: string) => screen.getByRole("rowheader", { name: new RegExp(`^${name}`) }).closest("tr") as HTMLElement;
const notifications = () => screen.getByRole("region", { name: "Notifications" });

describe("PlayersScreen re-entries", () => {
  it("re-enters an eliminated player at a drawn seat and records the price", async () => {
    const { engine, id, ann } = await running({ reentry: { prize: 10_000, fee: 1_000, stack: 10_000 } });
    await engine.dispatch(id, { type: "bust_players", busts: [{ player: ann }] });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    await user.click(await screen.findByRole("button", { name: "Re-enter Ann" }));
    const dialog = screen.getByRole("dialog", { name: "Re-enter Ann" });
    expect(dialog).toHaveTextContent("Entry 2: €110 for 10,000 chips.");
    expect(within(dialog).getByRole("radio", { name: "Draw a seat" })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Re-enter" }));

    await waitFor(async () => expect((await engine.getView(id)).ranking.find((r) => r.player === ann)).toMatchObject({ alive: true, entries: 2 }));
    const view = await engine.getView(id);
    const seat = view.ranking.find((r) => r.player === ann)!.seat!;
    expect(await within(notifications()).findByText(`Ann re-entered: table ${seat.table}, seat ${seat.seat}`)).toBeInTheDocument();
    expect(view.counts).toMatchObject({ unique: 3, entries: 4, reentries: 1 });
    expect(view.money).toMatchObject({ pool: 40_000, fees: 4_000 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(row("Ann")).getByText("2 entries")).toBeInTheDocument();
  });

  it("re-enters at the seat the director chooses, opening the table", async () => {
    const { engine, id, ann } = await running({ reentry: { prize: 10_000, fee: 1_000, stack: 10_000 } });
    await engine.dispatch(id, { type: "bust_players", busts: [{ player: ann }] });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    await user.click(await screen.findByRole("button", { name: "Re-enter Ann" }));
    const dialog = screen.getByRole("dialog", { name: "Re-enter Ann" });
    await user.click(within(dialog).getByRole("radio", { name: "Choose the seat" }));
    await user.selectOptions(within(dialog).getByLabelText("Seat"), "Table 2 Seat 4");
    await user.click(within(dialog).getByRole("button", { name: "Re-enter" }));

    await waitFor(async () => expect((await engine.getView(id)).ranking.find((r) => r.player === ann)!.seat).toEqual({ table: 2, seat: 4 }));
    expect((await engine.getView(id)).tables.find((t) => t.table === 2)!.status).toBe("open");
  });

  it("stops offering re-entries at the limit and explains a closed window", async () => {
    const { engine, id, ann } = await running({ reentry: { prize: 10_000, fee: 1_000, stack: 10_000, max: 1 } });
    await register(engine, id, ["Dan"]);
    await engine.dispatch(id, { type: "bust_players", busts: [{ player: ann }] });
    await engine.dispatch(id, { type: "reenter", player: ann });
    await engine.dispatch(id, { type: "bust_players", busts: [{ player: ann }] });
    const bob = playerId(await engine.getView(id), "Ben");
    await engine.dispatch(id, { type: "bust_players", busts: [{ player: bob }] });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    expect(await screen.findByRole("button", { name: "Re-enter Ann" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Re-enter Ben" }));
    // Registration closes from another window while the dialog is open.
    await act(async () => {
      await engine.dispatch(id, { type: "close_registration" });
    });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Re-enter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Re-entries are closed.");
    expect((await engine.getView(id)).counts.alive).toBe(2);
  });
});

describe("PlayersScreen rebuys and add-ons", () => {
  it("records a rebuy, counts it and offers to undo it", async () => {
    const { engine, id, ann } = await running({ rebuy: { prize: 5_000, fee: 0, stack: 5_000 } });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    await user.click(await screen.findByRole("button", { name: "Rebuy Ann" }));

    const toast = (await within(notifications()).findByText("Rebuy for Ann: +5,000 chips")).closest("li") as HTMLElement;
    let view = await engine.getView(id);
    expect(view.ranking.find((r) => r.player === ann)!.rebuys).toBe(1);
    expect(view.counts.rebuys).toBe(1);
    expect(view.chips.inPlay).toBe(35_000);
    expect(within(row("Ann")).getByText("1 rebuy")).toBeInTheDocument();
    expect(within(screen.getByRole("complementary")).getByText("Rebuys").nextSibling).toHaveTextContent("1");

    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await engine.getView(id)).counts.rebuys).toBe(0));
    view = await engine.getView(id);
    expect(view.money!.pool).toBe(30_000);
  });

  it("offers the add-on only during its break, once per player", async () => {
    const { engine, id, ann } = await running({ addon: { prize: 5_000, fee: 500, stack: 15_000, max: 1, window: { type: "break_after", n: 2 } } });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    await screen.findByRole("button", { name: "Eliminate Ann" });
    expect(screen.queryByRole("button", { name: "Add-on Ann" })).not.toBeInTheDocument();
    expect(screen.getByText("Add-ons closed")).toBeInTheDocument();

    // The break after play level 2 is the third row of the structure.
    await act(async () => {
      await engine.dispatch(id, { type: "jump_to", level: 2 });
    });
    expect(await screen.findByText("Add-ons open")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add-on Ann" }));

    await waitFor(async () => expect((await engine.getView(id)).ranking.find((r) => r.player === ann)!.addons).toBe(1));
    expect(await screen.findByRole("button", { name: "Add-on Ann" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add-on Ben" })).toBeEnabled();
    expect((await engine.getView(id)).money).toMatchObject({ pool: 35_000, fees: 3_500 });
  });

  it("translates a purchase the core refuses", async () => {
    // Two tabs of the same browser: the other one closes registration, this one does not know yet.
    const storage = new MemoryStorage();
    const engine = createTestEngine({ storage });
    const other = createTestEngine({ storage });
    const id = await engine.createTournament(tournamentInput({ money, rebuy: { prize: 5_000, fee: 0, stack: 5_000 } }));
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "start_clock" });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    const rebuy = await screen.findByRole("button", { name: "Rebuy Ann" });
    await other.dispatch(id, { type: "close_registration" });
    await user.click(rebuy);

    expect(await screen.findByRole("alert")).toHaveTextContent("Rebuys are closed.");
    expect((await engine.getView(id)).counts.rebuys).toBe(0);
  });
});
