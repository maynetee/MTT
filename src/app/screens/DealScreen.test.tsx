import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { playerId, register, renderApp, withTournament } from "../../test/app";

const money = { currency: { code: "EUR", exponent: 2 }, buyIn: { prize: 10_000, fee: 1_000 }, roundingUnit: 100 };
const payout = { amounts: { type: "custom_bps" as const, bps: [5_000, 3_000, 2_000] } };
const NAMES = ["Ann", "Ben", "Cat", "Dan", "Eve"];

/** Five players at EUR 100 (EUR 500 pool, 50/30/20), running; Dan and Eve are out. */
async function threeLeft() {
  const { engine, id } = await withTournament({ tables: 1, placesPaid: 3, config: { money, payout } });
  const view = await register(engine, id, NAMES);
  await engine.dispatch(id, { type: "start_clock" });
  for (const name of ["Eve", "Dan"]) await engine.dispatch(id, { type: "bust_players", busts: [{ player: playerId(view, name) }] });
  return { engine, id, view };
}

type User = ReturnType<typeof userEvent.setup>;

/** Quotes follow the chip counts after a short pause; a busy test machine may need longer. */
const settled = { timeout: 5_000 };

async function enterChips(user: User, chips: Record<string, string>) {
  for (const [name, count] of Object.entries(chips)) await user.type(await screen.findByLabelText(`Chips of ${name}`), count);
}

/** The calculator's body rows: player, chips, ICM, chip chop, difference. */
function quoteRows() {
  const table = screen.getByRole("table", { name: "Deal calculator" });
  return [...table.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("th, td")].map((cell) => cell.querySelector("input")?.value ?? cell.textContent)
  );
}

const tabs = () => screen.getByRole("navigation", { name: "Tournament sections" });

// Several changes go through the engine per test: more time than the default on a busy machine.
describe("DealScreen", { timeout: 20_000 }, () => {
  it("offers the deal tab only with money tracking and 20 players or fewer left", async () => {
    const { engine, id } = await withTournament({ tables: 3, config: { money } });
    const view = await register(
      engine,
      id,
      Array.from({ length: 21 }, (_, index) => `Player ${index + 1}`)
    );
    await engine.dispatch(id, { type: "start_clock" });
    renderApp(engine, `/t/${id}/players`);

    await screen.findByRole("rowheader", { name: "Player 1" });
    expect(within(tabs()).queryByRole("link", { name: "Deal" })).not.toBeInTheDocument();
    await act(async () => {
      await engine.dispatch(id, { type: "bust_players", busts: [{ player: playerId(view, "Player 21") }] });
    });
    expect(await within(tabs()).findByRole("link", { name: "Deal" })).toBeInTheDocument();
  });

  it("has no deal tab when the tournament pays no prizes, and says why at its address", async () => {
    const { engine, id } = await withTournament({ tables: 1, config: { money, payouts: false } });
    const view = await register(engine, id, NAMES);
    await engine.dispatch(id, { type: "start_clock" });
    await engine.dispatch(id, { type: "bust_players", busts: [{ player: playerId(view, "Eve") }] });
    renderApp(engine, `/t/${id}/deal`);

    expect(await screen.findByText("This tournament pays no prizes")).toBeInTheDocument();
    expect(within(tabs()).queryByRole("link", { name: "Deal" })).not.toBeInTheDocument();
    expect(within(tabs()).queryByRole("link", { name: "Payouts" })).not.toBeInTheDocument();
    // The tab, and the way to turn the prizes on.
    expect(screen.getAllByRole("link", { name: "Settings" })).toHaveLength(2);
  });

  it("quotes ICM and chip chop for the chip counts entered", async () => {
    const { engine, id } = await threeLeft();
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/deal`);

    expect(await screen.findByText("Enter the chip count of the 3 players left. The remaining places pay €500.00.")).toBeInTheDocument();
    const chips: Record<string, number> = { Ann: 25_000, Ben: 15_000, Cat: 10_000 };
    await enterChips(user, { Ann: "25000", Ben: "15000", Cat: "10000" });

    // Rows follow the seats; the quote comes from the engine for the same stacks and prizes.
    const names = quoteRows().map((row) => row[0]!);
    expect([...names].sort()).toEqual(["Ann", "Ben", "Cat"]);
    const quote = await engine.quoteDeal({ stacks: names.map((name) => chips[name]), prizes: [25_000, 15_000, 10_000] });
    const euros = (amount: number) => `€${(amount / 100).toFixed(2)}`;
    await waitFor(() => expect(quoteRows()[0][2]).toBe(euros(quote.icm[0])), settled);
    expect(quoteRows()).toEqual(
      names.map((name, index) => {
        const difference = quote.icm[index] - quote.chipChop[index];
        const sign = difference > 0 ? "+" : difference < 0 ? "−" : "";
        return [name, String(chips[name]), euros(quote.icm[index]), euros(quote.chipChop[index]), `${sign}${euros(Math.abs(difference))}`];
      })
    );
    // The bigger stack gets more with chip chop than with ICM.
    expect(quote.chipChop[names.indexOf("Ann")]).toBeGreaterThan(quote.icm[names.indexOf("Ann")]);
    expect(quote.icm.reduce((sum, amount) => sum + amount, 0)).toBe(50_000);
    expect(screen.getByText("50,000 of 50,000 in play")).toBeInTheDocument();
  });

  it("guides the director through the prerequisites, then records the deal", async () => {
    const { engine, id, view } = await threeLeft();
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/deal`);

    await enterChips(user, { Ann: "60000", Ben: "60000", Cat: "30000" });
    const record = screen.getByRole("button", { name: "Record this deal" });
    expect(record).toBeDisabled();
    expect(screen.getByText("Close registration and lock the payouts first.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close registration" }));
    expect(await screen.findByText("Registration is closed.")).toBeInTheDocument();
    expect(screen.getByText("Lock the payouts first.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lock payouts" }));
    expect(await screen.findByText("Payouts are locked.")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Chip chop" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Record this deal" })).toBeEnabled(), settled);
    await user.click(screen.getByRole("button", { name: "Record this deal" }));
    const dialog = screen.getByRole("alertdialog", { name: "Record the chip-chop deal?" });
    // Chip chop: everyone gets the lowest prize (EUR 100), the rest (EUR 200) by chips.
    expect(within(dialog).getByText("Ann").nextSibling).toHaveTextContent("€180.00");
    expect(within(dialog).getByText("Cat").nextSibling).toHaveTextContent("€140.00");
    await user.click(within(dialog).getByRole("button", { name: "Record this deal" }));

    await waitFor(async () => expect((await engine.getView(id)).money!.deal).not.toBeNull(), settled);
    const after = await engine.getView(id);
    expect(after.money!.deal!.playFor).toBe(0);
    expect([...after.money!.deal!.amounts].sort((a, b) => a.player - b.player)).toEqual([
      { player: playerId(view, "Ann"), amount: 18_000 },
      { player: playerId(view, "Ben"), amount: 18_000 },
      { player: playerId(view, "Cat"), amount: 14_000 }
    ]);
    // The ranking shows the agreed amounts.
    const prizes = Object.fromEntries(after.ranking.filter((row) => row.alive).map((row) => [row.name, row.prize]));
    expect(prizes).toEqual({ Ann: 18_000, Ben: 18_000, Cat: 14_000 });
    const recorded = await screen.findByRole("table", { name: "Deal" });
    expect(within(recorded).getByRole("rowheader", { name: "Cat" }).nextSibling).toHaveTextContent("€140.00");
  });

  it("keeps an amount to play for and explains an impossible one", async () => {
    const { engine, id } = await threeLeft();
    await engine.dispatch(id, { type: "close_registration" });
    await engine.dispatch(id, { type: "lock_payouts" });
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/deal`);

    await enterChips(user, { Ann: "50000", Ben: "50000", Cat: "50000" });
    const playFor = screen.getByLabelText("Left to play for");
    await user.type(playFor, "300");
    expect(await screen.findByRole("alert")).toHaveTextContent("The amount left to play for cannot be more than the first prize");
    await user.clear(playFor);
    await user.type(playFor, "50");

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument(), settled);
    await waitFor(() => expect(screen.getByRole("button", { name: "Record this deal" })).toBeEnabled(), settled);
    await user.click(screen.getByRole("button", { name: "Record this deal" }));
    const dialog = screen.getByRole("alertdialog", { name: "Record the ICM deal?" });
    expect(dialog).toHaveTextContent("€50.00 is left to play for");
    await user.click(within(dialog).getByRole("button", { name: "Record this deal" }));

    await waitFor(async () => expect((await engine.getView(id)).money!.deal?.playFor).toBe(5_000), settled);
    const deal = (await engine.getView(id)).money!.deal!;
    // Equal stacks: the prizes left, EUR 450, split equally.
    expect(deal.amounts.map((share) => share.amount)).toEqual([15_000, 15_000, 15_000]);
  });
});
