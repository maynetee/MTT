import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../engine/types";
import { playerId, register, renderApp, withTournament } from "../../test/app";
import { APPLY_DELAY_MS } from "./PayoutsScreen";

const money = { currency: { code: "EUR", exponent: 2 }, buyIn: { prize: 10_000, fee: 1_000 }, roundingUnit: 100 };
const NAMES = ["Ann", "Ben", "Cat", "Dan", "Eve", "Fay", "Gus", "Hal", "Ida", "Joe"];

/** Changes apply after a short pause; a busy test machine may need longer. */
const applied = { timeout: 5_000 };

const FIFTY_THIRTY_TWENTY: Config["payout"] = { amounts: { type: "custom_bps", bps: [5_000, 3_000, 2_000] } };

/** Ten players at EUR 100 + 10: a EUR 1,000 pool, 3 places paid on the default curve. */
async function tenPlayers(config: Partial<Config> = {}) {
  const { engine, id } = await withTournament({ tables: 2, seats: 9, placesPaid: 3, config: { money, ...config } });
  const view = await register(engine, id, NAMES);
  return { engine, id, view };
}

/** The ladder's body rows, cell by cell: place, amount, % of pool, player. */
function ladder() {
  const [, ...body] = within(screen.getByRole("table", { name: "Payouts" })).getAllByRole("row");
  return body.map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent));
}

// Several changes go through the engine per test: more time than the default on a busy machine.
describe("PayoutsScreen", { timeout: 20_000 }, () => {
  it("shows the prize pool and the ladder from the view", async () => {
    const { engine, id } = await tenPlayers({ money: { ...money, guarantee: 150_000 }, payout: FIFTY_THIRTY_TWENTY });
    renderApp(engine, `/t/${id}/payouts`);

    await screen.findByRole("table", { name: "Payouts" });
    expect((await engine.getView(id)).money!.payouts).toEqual([75_000, 45_000, 30_000]);
    expect(ladder()).toEqual([
      ["#1", "€750.00", "50%", "—"],
      ["#2", "€450.00", "30%", "—"],
      ["#3", "€300.00", "20%", "—"]
    ]);
    const pool = screen.getByRole("region", { name: "Prize pool" });
    expect(within(pool).getByText("To distribute").nextSibling).toHaveTextContent("€1,500");
    expect(within(pool).getByText("Paid in").nextSibling).toHaveTextContent("€1,000");
    expect(within(pool).getByText("Overlay").nextSibling).toHaveTextContent("€500");
    expect(within(pool).getByText("Fees").nextSibling).toHaveTextContent("€100");
  });

  it("moves the first place share with the slider and the ladder follows", async () => {
    const { engine, id } = await tenPlayers();
    renderApp(engine, `/t/${id}/payouts`);

    // The default curve gives first place about half of three places.
    await screen.findByRole("table", { name: "Payouts" });
    const before = (await engine.getView(id)).money!.payouts;
    expect(ladder()[0][1]).toBe(`€${(before[0] / 100).toFixed(2)}`);
    const slider = screen.getByRole("slider", { name: "First place" });
    expect(screen.getByText("· default", { exact: false })).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "6000" } });

    await waitFor(async () => expect((await engine.getView(id)).config.payout).toEqual({ amounts: { type: "curve", firstShareBps: 6_000 } }), applied);
    // First place gets 60 % plus what rounding to whole euros leaves.
    await waitFor(() => expect(ladder()[0]).toEqual(["#1", "€601.00", "60.1%", "—"]), applied);
    const after = (await engine.getView(id)).money!.payouts;
    expect(ladder().map((row) => row[1])).toEqual(after.map((amount) => `€${(amount / 100).toFixed(2)}`));
    expect(after.reduce((sum, amount) => sum + amount, 0)).toBe(100_000);
    expect(screen.getByRole("slider", { name: "First place" })).toHaveValue("6000");

    // Back to the default share.
    await userEvent.setup().click(screen.getByRole("button", { name: "Use the default share" }));
    await waitFor(async () => expect((await engine.getView(id)).config.payout).toEqual({}), applied);
    await waitFor(() => expect(ladder()[0][1]).toBe(`€${(before[0] / 100).toFixed(2)}`), applied);
  });

  it("keeps an edit made while the previous one is being saved", async () => {
    const { engine, id } = await tenPlayers();
    // A slow host: each settings change takes a while to come back.
    const dispatch = engine.dispatch.bind(engine);
    vi.spyOn(engine, "dispatch").mockImplementation(async (tournament, command) => {
      if (command.type === "update_config") await new Promise((resolve) => setTimeout(resolve, 400));
      return dispatch(tournament, command);
    });
    renderApp(engine, `/t/${id}/payouts`);

    const slider = await screen.findByRole("slider", { name: "First place" });
    fireEvent.change(slider, { target: { value: "6000" } });
    // The first change is on its way when the director moves the slider again.
    await act(() => new Promise((resolve) => setTimeout(resolve, APPLY_DELAY_MS + 100)));
    fireEvent.change(slider, { target: { value: "7000" } });

    await waitFor(async () => expect((await engine.getView(id)).config.payout).toEqual({ amounts: { type: "curve", firstShareBps: 7_000 } }), applied);
    expect(slider).toHaveValue("7000");
  });

  it("pays a share of the entries", async () => {
    const { engine, id } = await tenPlayers();
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/payouts`);

    await user.click(await screen.findByRole("radio", { name: "Share of the entries" }));
    const percent = screen.getByLabelText("Percent of the entries paid");
    await user.clear(percent);
    await user.type(percent, "20");

    await waitFor(async () => expect((await engine.getView(id)).config.payout.placesPaid).toEqual({ type: "percent", bps: 2_000 }), applied);
    await waitFor(() => expect(ladder()).toHaveLength(2), applied);
    expect(screen.getByText("2 places paid.")).toBeInTheDocument();
  });

  it("applies custom percentages once they add up, and explains when they do not", async () => {
    const { engine, id } = await tenPlayers({ payout: { amounts: { type: "curve", firstShareBps: 5_000 } } });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/payouts`);

    await user.click(await screen.findByRole("radio", { name: "Custom percentages" }));
    // Starts from the ladder in force.
    expect(screen.getByLabelText("Place 3")).toBeInTheDocument();
    expect(screen.getByText("Total 100%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove the last place" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Payout percentages must add up to 100%");
    expect((await engine.getView(id)).config.payout.amounts?.type).not.toBe("custom_bps");
    const first = screen.getByLabelText("Place 1");
    await user.clear(first);
    await user.type(first, "50");

    const second = screen.getByLabelText("Place 2");
    await user.clear(second);
    await user.type(second, "50");

    await waitFor(async () => expect((await engine.getView(id)).config.payout.amounts).toEqual({ type: "custom_bps", bps: [5_000, 5_000] }), applied);
    await waitFor(() => expect(ladder().map((row) => row[1])).toEqual(["€500.00", "€500.00"]), applied);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Total 100%")).toBeInTheDocument();
  });

  it("pays custom amounts and warns when they miss the pool", async () => {
    const { engine, id } = await tenPlayers({ payout: FIFTY_THIRTY_TWENTY });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/payouts`);

    await user.click(await screen.findByRole("radio", { name: "Custom amounts" }));
    const third = screen.getByLabelText("Place 3");
    await user.clear(third);
    await user.type(third, "250");

    await waitFor(
      async () => expect((await engine.getView(id)).config.payout.amounts).toEqual({ type: "custom_amounts", amounts: [50_000, 30_000, 25_000] }),
      applied
    );
    expect(await screen.findByText("The custom amounts add up to €1,050, but there is €1,000 to distribute.")).toBeInTheDocument();
    expect(screen.getByText("Total €1,050 of €1,000")).toBeInTheDocument();
  });

  it("locks and unlocks the payouts after confirmation, and explains stale locked payouts", async () => {
    const { engine, id } = await tenPlayers({ payout: FIFTY_THIRTY_TWENTY });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/payouts`);

    await user.click(await screen.findByRole("button", { name: "Lock payouts" }));
    const dialog = screen.getByRole("alertdialog", { name: "Lock the payouts?" });
    await user.click(within(dialog).getByRole("button", { name: "Lock payouts" }));

    await waitFor(async () => expect((await engine.getView(id)).money!.locked).toBe(true), applied);
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Custom percentages" })).toBeDisabled();
    expect(screen.getByLabelText("Place 1")).toBeDisabled();
    expect(screen.getByText("Payouts are locked: unlock them to change the places paid or the split.")).toBeInTheDocument();

    // A late entry: the locked payouts no longer match the pool.
    await act(async () => {
      await register(engine, id, ["Kim"]);
    });
    expect(
      await screen.findByText(
        "Payouts were locked for a pool of €1,000; there is now €1,100 to distribute. Lock them again to pay the current pool, or keep them."
      )
    ).toBeInTheDocument();
    expect(ladder()[0][1]).toBe("€500.00");
    await user.click(screen.getByRole("button", { name: "Lock again" }));
    await waitFor(() => expect(ladder()[0][1]).toBe("€550.00"), applied);
    expect(screen.queryByText(/were locked for a pool/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Unlock payouts" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Unlock the payouts?" })).getByRole("button", { name: "Unlock payouts" }));
    await waitFor(async () => expect((await engine.getView(id)).money!.locked).toBe(false), applied);
    await waitFor(() => expect(screen.getByLabelText("Place 1")).toBeEnabled(), applied);
  });

  it("shows who finished in the money, ties split", async () => {
    const { engine, id, view } = await tenPlayers({ payout: FIFTY_THIRTY_TWENTY });
    await engine.dispatch(id, { type: "start_clock" });
    await engine.dispatch(id, { type: "close_registration" });
    for (const name of ["Ann", "Ben", "Cat", "Dan", "Eve", "Fay", "Gus"]) {
      await engine.dispatch(id, { type: "bust_players", busts: [{ player: playerId(view, name) }] });
    }
    // Hal and Ida go out in the same hand without stacks: a tie for 2nd and 3rd.
    await engine.dispatch(id, { type: "bust_players", busts: [{ player: playerId(view, "Hal") }, { player: playerId(view, "Ida") }] });
    renderApp(engine, `/t/${id}/payouts`);

    await screen.findByRole("table", { name: "Payouts" });
    expect(ladder()).toEqual([
      ["#1", "€500.00", "50%", "Joe"],
      ["#2", "€300.00", "30%", "Hal (tie 2–3: €250.00)Ida (tie 2–3: €250.00)"],
      ["#3", "€200.00", "20%", "Hal (tie 2–3: €250.00)Ida (tie 2–3: €250.00)"]
    ]);
  });

  it("explains that amounts need money tracking", async () => {
    const { engine, id } = await withTournament({ placesPaid: 4 });
    renderApp(engine, `/t/${id}/payouts`);

    expect(await screen.findByText("Turn on money tracking in Settings to split a prize pool.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lock payouts" })).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Places paid" })).toHaveValue("4");
  });
});
