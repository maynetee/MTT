import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { register, renderApp, withTournament } from "../../test/app";

const money = { currency: { code: "EUR", exponent: 2 }, buyIn: { prize: 10_000, fee: 1_000 }, roundingUnit: 100 };

describe("SettingsScreen money", () => {
  it("turns money tracking on before anyone registers", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    renderApp(engine, `/t/${id}/settings`);

    await user.click(await screen.findByRole("checkbox", { name: /Track buy-ins and the prize pool/ }));
    const buyIn = screen.getByLabelText("Buy-in");
    await user.clear(buyIn);
    await user.type(buyIn, "50");
    await user.clear(screen.getByLabelText("Fee"));
    await user.type(screen.getByLabelText("Fee"), ".5");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(async () => expect((await engine.getView(id)).config.money).toMatchObject({ buyIn: { prize: 5_000, fee: 50 } }));
  });

  it("locks money tracking and the currency once a player has registered, and says why", async () => {
    const { engine, id } = await withTournament({ config: { money } });
    await register(engine, id, ["Ann"]);
    renderApp(engine, `/t/${id}/settings`);

    const track = await screen.findByRole("checkbox", { name: /Track buy-ins and the prize pool/ });
    expect(track).toBeChecked();
    expect(track).toBeDisabled();
    expect(screen.getByLabelText("Currency")).toBeDisabled();
    expect(screen.getAllByText("Fixed once a player has registered.")).toHaveLength(2);
    // The buy-in can still change until the start.
    expect(screen.getByLabelText("Buy-in")).toBeEnabled();
  });

  it("locks the buy-in once started but still accepts a new guarantee", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament({ config: { money } });
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "start_clock" });
    renderApp(engine, `/t/${id}/settings`);

    expect(await screen.findByLabelText("Buy-in")).toBeDisabled();
    expect(screen.getByLabelText("Fee")).toBeDisabled();
    expect(screen.getByText("Fixed once the tournament has started: entries keep what they paid.")).toBeInTheDocument();
    expect(screen.getByLabelText("Buy-in")).toHaveValue("100");

    await user.type(screen.getByLabelText("Guaranteed prize pool"), "1000");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(async () => expect((await engine.getView(id)).money).toMatchObject({ pool: 20_000, guarantee: 100_000, overlay: 80_000 }));
  });

  it("locks the payout rounding while the payouts are locked", async () => {
    const { engine, id } = await withTournament({ config: { money } });
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "lock_payouts" });
    renderApp(engine, `/t/${id}/settings`);

    expect(await screen.findByLabelText("Round payouts to")).toBeDisabled();
    expect(screen.getByLabelText("Minimum cash")).toBeDisabled();
    expect(screen.getByLabelText("Places paid")).toBeDisabled();
    expect(screen.getAllByText("Payouts are locked: unlock them to change this.")).toHaveLength(3);
  });
});

describe("SettingsScreen purchases", () => {
  it("offers rebuys during play, without a price when money is not tracked", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "start_clock" });
    renderApp(engine, `/t/${id}/settings`);

    await user.click(await screen.findByRole("checkbox", { name: /Offer rebuys/ }));
    expect(screen.queryByLabelText("Rebuys: Price")).not.toBeInTheDocument();
    const chips = screen.getByLabelText("Rebuys: Chips");
    await user.clear(chips);
    await user.type(chips, "5000");
    await user.click(within(screen.getByRole("group", { name: "Rebuys: Available" })).getByRole("radio", { name: "During the break after play level" }));
    const level = screen.getByLabelText("Rebuys: during the break after play level");
    await user.clear(level);
    await user.type(level, "2");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(async () =>
      expect((await engine.getView(id)).config.rebuy).toEqual({ prize: 0, fee: 0, stack: 5_000, window: { type: "break_after", n: 2 } })
    );
  });

  it("explains a window the structure cannot hold", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    renderApp(engine, `/t/${id}/settings`);

    await user.click(await screen.findByRole("checkbox", { name: /Offer an add-on/ }));
    // The test structure's only break follows play level 2.
    const level = screen.getByLabelText("Add-ons: during the break after play level");
    await user.clear(level);
    await user.type(level, "3");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Check when re-entries, rebuys and add-ons are available");
  });
});
