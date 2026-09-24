import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { register, renderApp, withTournament } from "../../test/app";
import { editAsViewArrives } from "../../test/busy";

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

  it("locks money tracking once a player has registered, and says why, but not the currency", async () => {
    const { engine, id } = await withTournament({ config: { money } });
    await register(engine, id, ["Ann"]);
    renderApp(engine, `/t/${id}/settings`);

    const track = await screen.findByRole("checkbox", { name: /Track buy-ins and the prize pool/ });
    expect(track).toBeChecked();
    expect(track).toBeDisabled();
    expect(screen.getByText("Fixed once a player has registered.")).toBeInTheDocument();
    expect(screen.getByLabelText("Currency")).toBeEnabled();
    expect(screen.getByText("Nothing is converted: amounts keep their value.")).toBeInTheDocument();
    // The buy-in can still change until the start.
    expect(screen.getByLabelText("Buy-in")).toBeEnabled();
  });

  it("relabels the currency after the first entry, amounts kept to the cent, and undoes it", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament({ config: { money: { ...money, buyIn: { prize: 10_050, fee: 0 } } } });
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "start_clock" });
    renderApp(engine, `/t/${id}/settings`);

    await user.selectOptions(await screen.findByLabelText("Currency"), "JPY");
    // Yen normally have no decimals: the amounts keep the two they were recorded with.
    expect(screen.getByText("Nothing is converted: amounts keep their value and their 2 decimals, as recorded.")).toBeInTheDocument();
    expect(screen.getByLabelText("Buy-in")).toHaveValue("100.50");
    expect(screen.getByText("Player pays").nextSibling).toHaveTextContent("¥100.50");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(async () => expect((await engine.getView(id)).config.money?.currency).toEqual({ code: "JPY", exponent: 2 }));
    expect((await engine.getView(id)).money).toMatchObject({ currency: { code: "JPY", exponent: 2 }, pool: 20_100 });

    await user.click(screen.getByRole("button", { name: /^Undo/ }));
    await waitFor(async () => expect((await engine.getView(id)).config.money?.currency).toEqual({ code: "EUR", exponent: 2 }));
    expect(screen.getByLabelText("Currency")).toHaveValue("EUR");
    expect(screen.getByText("Nothing is converted: amounts keep their value.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Redo/ }));
    await waitFor(() => expect(screen.getByLabelText("Currency")).toHaveValue("JPY"));
  });

  it("adopts the new currency's decimals before anyone has paid", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament({ config: { money } });
    renderApp(engine, `/t/${id}/settings`);

    await user.selectOptions(await screen.findByLabelText("Currency"), "JPY");
    expect(screen.queryByText(/Nothing is converted/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(async () => expect((await engine.getView(id)).config.money).toMatchObject({ currency: { code: "JPY", exponent: 0 }, buyIn: { prize: 100 } }));
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
    expect(screen.getByRole("checkbox", { name: /This tournament pays prizes/ })).toBeDisabled();
    expect(screen.getAllByText("Payouts are locked: unlock them to change this.")).toHaveLength(4);
  });
});

describe("SettingsScreen prizes", () => {
  it("turns the prizes off during a tournament, and back on with undo", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament({ config: { money } });
    await register(engine, id, ["Ann", "Ben", "Cat", "Dan"]);
    await engine.dispatch(id, { type: "start_clock" });
    renderApp(engine, `/t/${id}/settings`);
    const nav = await screen.findByRole("navigation", { name: "Tournament sections" });
    expect(within(nav).getByRole("link", { name: "Payouts" })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /This tournament pays prizes/ }));
    expect(screen.queryByRole("spinbutton", { name: "Places paid" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Round payouts to")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(within(nav).queryByRole("link", { name: "Payouts" })).not.toBeInTheDocument());
    const view = await engine.getView(id);
    expect(view.config.payouts).toBe(false);
    expect(view.placesPaid).toBe(0);
    expect(view.itm).toEqual({ status: "none" });
    // Buy-ins stay tracked: the pool is still there, but paid to nobody.
    expect(view.money).toMatchObject({ pool: 40_000, payouts: [] });
    expect(screen.getByRole("checkbox", { name: /This tournament pays prizes/ })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: /^Undo/ }));
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Payouts" })).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: /This tournament pays prizes/ })).toBeChecked();
    expect((await engine.getView(id)).placesPaid).toBe(3);
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

describe("SettingsScreen places paid", () => {
  it("points to the Payouts tab when a share of the entries sets the places paid", async () => {
    const { engine, id } = await withTournament({ config: { payout: { placesPaid: { type: "percent", bps: 1_500 } } } });
    renderApp(engine, `/t/${id}/settings`);

    expect(await screen.findByRole("spinbutton", { name: "Places paid" })).toBeDisabled();
    expect(screen.getByText("Set on the Payouts tab.")).toBeInTheDocument();
  });
});

describe("SettingsScreen draft", () => {
  it("keeps an edit made while the tournament changes elsewhere, on a busy machine", async () => {
    // Regression: like the Levels tab, the form copied each new view into its draft from an
    // effect, which could overwrite an edit made between a render and its effects.
    const { engine, id } = await withTournament();
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "start_clock" });
    renderApp(engine, `/t/${id}/settings`);
    const tables = await screen.findByRole("spinbutton", { name: "Tables" });

    await editAsViewArrives({
      watch: screen.getByRole("group", { name: "Tournament clock" }),
      change: () => engine.dispatch(id, { type: "adjust_time", deltaMs: -60_000 }),
      edit: () => fireEvent.change(tables, { target: { value: "5" } })
    });

    expect(screen.getByRole("spinbutton", { name: "Tables" })).toHaveValue("5");
    expect(screen.getByRole("button", { name: "Save settings" })).toBeInTheDocument();
  });
});
