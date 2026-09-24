import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command, View } from "../../engine/types";
import type { WasmEngine } from "../../engine/wasmEngine";
import { Providers, register, renderApp } from "../../test/app";
import { MIN, createTestEngine, pause, play, tournamentInput } from "../../test/wasm";
import DisplayScreen, { EXIT_CONTROL_HIDE_DELAY_MS } from "./DisplayScreen";

const T0 = 1_700_000_000_000;

// 100/200, 150/300, break, 200/400 ante 50, 300/600 BBA 600: 20-minute levels.
const structure = [
  play(100, 200),
  play(150, 300),
  pause(10),
  play(200, 400, 20, { type: "classic", amount: 50 }),
  play(300, 600, 20, { type: "big_blind", amount: 600 })
];

/** An engine on a hand-driven clock, with `players` registered on one table. */
async function running(players = 4) {
  let now = T0;
  const engine = createTestEngine({ now: () => now });
  const id = await engine.createTournament(tournamentInput({ maxTables: 1, placesPaid: 3 }, structure));
  await register(
    engine,
    id,
    Array.from({ length: players }, (_, i) => `Player ${i + 1}`)
  );
  await engine.dispatch(id, { type: "start_clock" });
  return {
    engine,
    id,
    advance: (ms: number) => (now += ms),
    run: (command: Command) => engine.dispatch(id, command),
    view: () => engine.getView(id)
  };
}

function show(engine: WasmEngine, view: View, preview = false) {
  // Measured like useTournamentView does: host clock minus local clock.
  const offsetMs = view.generatedAtMs - Date.now();
  return render(
    <Providers engine={engine}>
      <DisplayScreen view={view} offsetMs={offsetMs} preview={preview} />
    </Providers>
  );
}

/** Lets pending engine calls and React updates settle (the engine resolves in microtasks). */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("DisplayScreen", () => {
  it("shows the level and blinds while a play level is running", async () => {
    const t = await running();
    await t.run({ type: "next_level" });
    t.advance(446_000);
    show(t.engine, await t.view());

    expect(screen.getByText("12:34")).toBeInTheDocument();
    expect(screen.getByText("Level 2")).toBeInTheDocument();
    expect(screen.getByText("Blinds 150/300")).toBeInTheDocument();
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
    expect(screen.queryByText("BREAK")).not.toBeInTheDocument();
  });

  it("shows a paused indicator and keeps the level and blinds visible when the clock is paused", async () => {
    const t = await running();
    await t.run({ type: "next_level" });
    await t.run({ type: "pause_clock" });
    show(t.engine, await t.view());

    expect(screen.getByText("PAUSED")).toBeInTheDocument();
    expect(screen.getByText("Level 2")).toBeInTheDocument();
    expect(screen.getByText("Blinds 150/300")).toBeInTheDocument();
    expect(screen.queryByText("BREAK")).not.toBeInTheDocument();
  });

  it("shows the break banner during a break, not the paused indicator", async () => {
    const t = await running();
    await t.run({ type: "jump_to_next_break" });
    show(t.engine, await t.view());

    expect(screen.getByText("BREAK")).toBeInTheDocument();
    expect(screen.getByText("10:00")).toBeInTheDocument();
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Blinds/)).not.toBeInTheDocument();
    expect(screen.getByText("Next: L3 200/400 Ante 50")).toBeInTheDocument();
  });

  it("numbers play levels without counting breaks and labels the big blind ante", async () => {
    const t = await running();
    await t.run({ type: "jump_to", level: 3 });
    show(t.engine, await t.view());

    expect(screen.getByText("Level 3")).toBeInTheDocument();
    expect(screen.getByText("Blinds 200/400 Ante 50")).toBeInTheDocument();
    expect(screen.getByText("Next: L4 300/600 BBA 600")).toBeInTheDocument();
  });

  it("counts down to the next break", async () => {
    const t = await running();
    t.advance(5 * MIN);
    show(t.engine, await t.view());

    // 15 minutes left in level 1, then 20 minutes of level 2.
    expect(screen.getByText("Next break in 35:00")).toBeInTheDocument();
  });

  it("shows players left, entries, the average stack in big blinds and places paid", async () => {
    const t = await running(5);
    const view = await t.view();
    await t.run({ type: "bust_players", busts: [{ player: view.ranking[0].player }] });
    show(t.engine, await t.view());

    expect(screen.getByText("Players: 4 / 5")).toBeInTheDocument();
    // 50,000 chips among 4 players, at 100/200.
    expect(screen.getByText("Average stack: 12,500 (62.5 BB)")).toBeInTheDocument();
    expect(screen.getByText("Places paid: 3")).toBeInTheDocument();
  });

  it("announces the money: eliminations to go, the bubble, in the money", async () => {
    const t = await running(5);
    const players = (await t.view()).ranking.map((row) => row.player);
    const { unmount } = show(t.engine, await t.view());
    expect(screen.getByText("2 eliminations to the money")).toBeInTheDocument();
    unmount();

    await t.run({ type: "bust_players", busts: [{ player: players[0] }] });
    const bubble = show(t.engine, await t.view());
    expect(screen.getByText("Bubble!")).toBeInTheDocument();
    bubble.unmount();

    await t.run({ type: "bust_players", busts: [{ player: players[1] }] });
    show(t.engine, await t.view());
    expect(screen.getByText("In the money")).toBeInTheDocument();
    expect(screen.getByText(`#4 ${(await t.view()).ranking.find((row) => row.player === players[1])!.name}`)).toBeInTheDocument();
  });
});

describe("DisplayScreen clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down locally from endsAtMs and refetches the view when the level ends", async () => {
    vi.useFakeTimers({ now: T0 });
    const engine = createTestEngine();
    const id = await engine.createTournament(tournamentInput({ maxTables: 1 }, structure));
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "start_clock" });

    renderApp(engine, `/display/${id}`);
    await settle();
    expect(screen.getByText("20:00")).toBeInTheDocument();
    expect(screen.getByText("Level 1")).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(1000));
    expect(screen.getByText("19:59")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(18 * MIN + 59_000));
    expect(screen.getByText("01:00")).toBeInTheDocument();

    // The level ends: the view is refetched at recomputeAtMs, nothing was written.
    const before = (await engine.getView(id)).history.head;
    // The refetch fires 25 ms after the boundary.
    await act(async () => vi.advanceTimersByTime(60_025));
    await settle();
    await act(async () => vi.advanceTimersByTime(975));
    expect(screen.getByText("Level 2")).toBeInTheDocument();
    expect(screen.getByText("Blinds 150/300")).toBeInTheDocument();
    expect(screen.getByText("19:59")).toBeInTheDocument();
    expect((await engine.getView(id)).history.head).toBe(before);
  });

  it("shows the same clock in the director's window and on the display", async () => {
    vi.useFakeTimers({ now: T0 });
    const engine = createTestEngine();
    const id = await engine.createTournament(tournamentInput({ maxTables: 1 }, structure));
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "start_clock" });

    const director = renderApp(engine, `/t/${id}/clock`);
    const display = renderApp(engine, `/display/${id}`);
    await settle();

    await act(async () => vi.advanceTimersByTime(3 * MIN + 30_000));
    const directorTime = director.container.querySelector(".clock-time")!.textContent;
    const displayTime = display.container.querySelector(".display-time")!.textContent;
    expect(directorTime).toBe("16:30");
    expect(displayTime).toBe(directorTime);

    // A pause from the director reaches the display.
    await act(async () => {
      await engine.dispatch(id, { type: "pause_clock" });
    });
    await settle();
    await act(async () => vi.advanceTimersByTime(MIN));
    expect(display.container.querySelector(".display-time")!.textContent).toBe("16:30");
    expect(display.getByText("PAUSED")).toBeInTheDocument();
  });
});

describe("DisplayScreen exit control (browser)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const exitButton = () => screen.queryByRole("button", { name: /exit display/i });

  it("appears when the mouse moves, hides a few seconds later and closes the display", async () => {
    const t = await running();
    const view = await t.view();
    vi.useFakeTimers();
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    show(t.engine, view);
    expect(exitButton()).not.toBeInTheDocument();

    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    expect(exitButton()).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(EXIT_CONTROL_HIDE_DELAY_MS - 1));
    expect(exitButton()).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(exitButton()).not.toBeInTheDocument();

    // A mousemove without movement (content scrolling under the cursor) does not bring it back.
    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    expect(exitButton()).not.toBeInTheDocument();

    fireEvent.mouseMove(window, { clientX: 20, clientY: 10 });
    fireEvent.click(exitButton()!);
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the display on Escape", async () => {
    const t = await running();
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    show(t.engine, await t.view());

    fireEvent.keyDown(window, { key: "Enter" });
    await settle();
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("is not part of the preview", async () => {
    const t = await running();
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    show(t.engine, await t.view(), true);

    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: "Escape" });
    await settle();

    expect(exitButton()).not.toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });
});
