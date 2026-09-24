import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../test/app";
import { createTestEngine } from "../../test/wasm";
import { defaultStructure } from "../utils/structure";

describe("SetupScreen", () => {
  it("keeps focus in a structure input while typing", async () => {
    const user = userEvent.setup();
    renderApp(createTestEngine(), "/new");

    await user.type(await screen.findByLabelText("Level 1 SB"), "5");

    expect(screen.getByLabelText("Level 1 SB")).toHaveValue("255");
    expect(screen.getByLabelText("Level 1 SB")).toHaveFocus();
  });

  it("numbers play levels without counting breaks", async () => {
    const user = userEvent.setup();
    renderApp(createTestEngine(), "/new");

    // Level 5 follows the first break of the default structure.
    expect(await screen.findByLabelText("Level 5 SB")).toHaveValue("150");
    await user.click(screen.getByLabelText("Level 2 Break"));
    expect(screen.getByLabelText("Level 4 SB")).toHaveValue("150");
  });

  it("ships a default structure long enough for a full event", () => {
    const levels = defaultStructure();
    const play = levels.filter((level) => level.type === "play");
    expect(play.length).toBeGreaterThanOrEqual(20);
    expect(levels.filter((level) => level.type === "break").length).toBeGreaterThanOrEqual(4);
    expect(levels.reduce((sum, level) => sum + level.durationMs, 0)).toBeGreaterThanOrEqual(8 * 3_600_000);
    // Blinds only go up.
    for (let i = 1; i < play.length; i++) {
      expect(play[i].type === "play" && play[i - 1].type === "play" && play[i].bb > play[i - 1].bb).toBe(true);
    }
  });

  it("creates the tournament with the chosen settings and late registration", async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    renderApp(engine, "/new");

    const places = await screen.findByLabelText("Places paid");
    await user.clear(places);
    await user.type(places, "12");
    const seats = screen.getByLabelText("Seats per table");
    await user.clear(seats);
    await user.type(seats, "6");
    await user.click(screen.getByRole("radio", { name: /For a set time of play/ }));
    const minutes = screen.getByRole("spinbutton", { name: "For a set time of play" });
    await user.clear(minutes);
    await user.type(minutes, "90");
    await user.click(screen.getByRole("button", { name: "Add break" }));
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    await screen.findByRole("heading", { name: "Register player" });
    const [summary] = await engine.listTournaments();
    const view = await engine.getView(summary.id);
    expect(view.config).toMatchObject({ placesPaid: 12, seatsPerTable: 6, lateReg: { type: "elapsed", ms: 90 * 60_000 } });
    expect(view.levels.at(-1)!.level).toEqual({ type: "break", durationMs: 10 * 60_000, colorUp: null });
  });

  it("leaves money tracking off by default", async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    renderApp(engine, "/new");

    expect(await screen.findByRole("checkbox", { name: /Track buy-ins and the prize pool/ })).not.toBeChecked();
    expect(screen.queryByLabelText("Buy-in")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    await screen.findByRole("heading", { name: "Register player" });
    const [summary] = await engine.listTournaments();
    const view = await engine.getView(summary.id);
    expect(view.config.money).toBeUndefined();
    expect(view.money).toBeUndefined();
  });

  it("creates a tournament with a buy-in typed in major units, converted exactly", async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    renderApp(engine, "/new");

    await user.click(await screen.findByRole("checkbox", { name: /Track buy-ins and the prize pool/ }));
    await user.selectOptions(screen.getByLabelText("Currency"), "USD");
    const buyIn = screen.getByLabelText("Buy-in");
    await user.clear(buyIn);
    await user.type(buyIn, "19.99");
    await user.type(screen.getByLabelText("Fee"), "2,01");
    expect(screen.getByText("Player pays").nextSibling).toHaveTextContent("$22");
    await user.type(screen.getByLabelText("Guaranteed prize pool"), "1000.10");
    const unit = screen.getByLabelText("Round payouts to");
    await user.clear(unit);
    await user.type(unit, "5");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    await screen.findByRole("heading", { name: "Register player" });
    const [summary] = await engine.listTournaments();
    const view = await engine.getView(summary.id);
    expect(view.config.money).toEqual({
      currency: { code: "USD", exponent: 2 },
      buyIn: { prize: 1999, fee: 201 },
      guarantee: 100_010,
      roundingUnit: 500
    });
    expect(view.money).toMatchObject({ pool: 0, guarantee: 100_010, effectivePool: 100_010, overlay: 100_010 });
  });

  it("keeps the amounts typed when switching to a currency without decimals", async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    renderApp(engine, "/new");

    await user.click(await screen.findByRole("checkbox", { name: /Track buy-ins and the prize pool/ }));
    expect(screen.getByLabelText("Buy-in")).toHaveValue("100");
    await user.selectOptions(screen.getByLabelText("Currency"), "JPY");
    expect(screen.getByLabelText("Buy-in")).toHaveValue("100");
    // Yen have no decimals: the separator is ignored.
    await user.clear(screen.getByLabelText("Fee"));
    await user.type(screen.getByLabelText("Fee"), "1.5");
    expect(screen.getByLabelText("Fee")).toHaveValue("15");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    await screen.findByRole("heading", { name: "Register player" });
    const [summary] = await engine.listTournaments();
    expect((await engine.getView(summary.id)).config.money).toEqual({
      currency: { code: "JPY", exponent: 0 },
      buyIn: { prize: 100, fee: 15 },
      roundingUnit: 1
    });
  });

  it("offers re-entries, rebuys and add-ons with their price, chips, limit and window", async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    renderApp(engine, "/new");

    await user.click(await screen.findByRole("checkbox", { name: /Track buy-ins and the prize pool/ }));
    await user.click(screen.getByRole("checkbox", { name: /Offer re-entries/ }));
    // A re-entry costs the buy-in and gives a starting stack by default.
    expect(screen.getByLabelText("Re-entries: Price")).toHaveValue("100");
    expect(screen.getByLabelText("Re-entries: Chips")).toHaveValue("20000");
    await user.type(screen.getByLabelText("Re-entries: Re-entries per player"), "2");
    await user.click(within(screen.getByRole("group", { name: "Re-entries: Available" })).getByRole("radio", { name: "Until the end of play level" }));
    const level = screen.getByLabelText("Re-entries: until the end of play level");
    await user.clear(level);
    await user.type(level, "4");

    await user.click(screen.getByRole("checkbox", { name: /Offer an add-on/ }));
    const addonPrice = screen.getByLabelText("Add-ons: Price");
    await user.clear(addonPrice);
    await user.type(addonPrice, "50");
    const addonChips = screen.getByLabelText("Add-ons: Chips");
    await user.clear(addonChips);
    await user.type(addonChips, "30000");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    await screen.findByRole("heading", { name: "Register player" });
    const [summary] = await engine.listTournaments();
    const { config } = await engine.getView(summary.id);
    expect(config.reentry).toEqual({
      prize: 10_000,
      fee: 0,
      stack: 20_000,
      max: 2,
      window: { type: "until", deadline: { type: "end_of_play_level", n: 4, throughBreak: true } }
    });
    // The add-on defaults to once, during the first break (after play level 4).
    expect(config.addon).toEqual({ prize: 5_000, fee: 0, stack: 30_000, max: 1, window: { type: "break_after", n: 4 } });
    expect(config.rebuy).toBeUndefined();
  });

  it("reports the core's configuration errors", async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    renderApp(engine, "/new");

    const seats = await screen.findByLabelText("Seats per table");
    await user.clear(seats);
    await user.type(seats, "40");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Seats per table must be between 2 and 12.");
    await waitFor(async () => expect(await engine.listTournaments()).toEqual([]));
  });
});
