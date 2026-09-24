import { screen, waitFor } from "@testing-library/react";
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
