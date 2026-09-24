import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command, NewTournamentInput, View } from "../../engine/types";
import type { WasmEngine } from "../../engine/wasmEngine";
import { Providers, register, renderApp } from "../../test/app";
import { MIN, createTestEngine, pause, play, tournamentInput } from "../../test/wasm";
import DisplayScreen, { EXIT_CONTROL_HIDE_DELAY_MS } from "./DisplayScreen";

const T0 = 1_700_000_000_000;

// 100/200, 150/300, break (color-up to 25), 200/400 ante 50, 300/600 BBA 600: 20-minute levels.
const structure = [
  play(100, 200),
  play(150, 300),
  { ...pause(10), colorUp: 25 },
  play(200, 400, 20, { type: "classic", amount: 50 }),
  play(300, 600, 20, { type: "big_blind", amount: 600 })
];

/** Buy-in €100 + €10, whole euros. */
const money: NewTournamentInput["config"]["money"] = {
  currency: { code: "EUR", exponent: 2 },
  buyIn: { prize: 10_000, fee: 1_000 },
  roundingUnit: 100
};

/** An engine on a hand-driven clock, with `players` registered on one table, clock started. */
async function running(players = 4, config: Partial<NewTournamentInput["config"]> = {}) {
  let now = T0;
  const engine = createTestEngine({ now: () => now });
  const id = await engine.createTournament(tournamentInput({ maxTables: 1, placesPaid: 3, ...config }, structure));
  await register(
    engine,
    id,
    Array.from({ length: players }, (_, i) => `Player ${i + 1}`)
  );
  await engine.dispatch(id, { type: "start_clock" });
  const t = {
    engine,
    id,
    advance: (ms: number) => (now += ms),
    run: (command: Command) => engine.dispatch(id, command),
    view: () => engine.getView(id),
    /** Eliminates the last `count` players in play, one at a time. */
    async bust(count: number) {
      for (let i = 0; i < count; i++) {
        const alive = (await t.view()).ranking.filter((row) => row.alive);
        await t.run({ type: "bust_players", busts: [{ player: alive[alive.length - 1].player }] });
      }
    }
  };
  return t;
}

function show(engine: WasmEngine, view: View, options: { preview?: boolean } = {}) {
  // Measured like useTournamentView does: host clock minus local clock.
  const offsetMs = view.generatedAtMs - Date.now();
  return render(
    <Providers engine={engine}>
      <DisplayScreen view={view} offsetMs={offsetMs} {...options} />
    </Providers>
  );
}

/** The clock as it reads. */
const clock = () => screen.getByRole("timer").textContent;

/** The text of each part of an element, space separated (the parts are separate spans). */
function parts(selector: string): string {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`no ${selector}`);
  const texts: string[] = [];
  const walk = (node: Element) => {
    if (node.children.length === 0) texts.push(node.textContent ?? "");
    else Array.from(node.children).forEach(walk);
  };
  walk(element);
  return texts.join(" ");
}

/** Lets pending engine calls and React updates settle (the engine resolves in microtasks). */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("DisplayScreen", () => {
  it("shows the level, the time, the blinds and what comes next while a level runs", async () => {
    const t = await running();
    await t.run({ type: "next_level" });
    t.advance(446_000);
    show(t.engine, await t.view());

    expect(screen.getByRole("heading", { name: "Test event" })).toBeInTheDocument();
    expect(clock()).toBe("12:34");
    expect(screen.getByRole("heading", { name: "Level 2" })).toBeInTheDocument();
    expect(parts(".tv-blinds")).toBe("Blinds 150/300");
    expect(parts(".tv-upcoming")).toBe("Next Break 10 min");
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
    expect(screen.queryByText("Break", { selector: "h2" })).not.toBeInTheDocument();
  });

  it("names the ante: Ante for a classic ante, BBA for a big blind ante", async () => {
    const t = await running();
    await t.run({ type: "jump_to", level: 3 });
    show(t.engine, await t.view());

    expect(screen.getByRole("heading", { name: "Level 3" })).toBeInTheDocument();
    expect(parts(".tv-blinds")).toBe("Blinds 200/400 Ante 50");
    expect(parts(".tv-upcoming")).toBe("Next Level 4 300/600 BBA 600");
  });

  it("counts down to the next break", async () => {
    const t = await running();
    t.advance(5 * MIN);
    show(t.engine, await t.view());

    // 15 minutes left in level 1, then 20 minutes of level 2.
    expect(parts(".tv-upcoming")).toBe("Next Level 2 150/300 Break in 35:00");
  });

  it("shows a paused state over the level, never the break", async () => {
    const t = await running();
    await t.run({ type: "next_level" });
    await t.run({ type: "pause_clock" });
    show(t.engine, await t.view());

    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(document.querySelector(".tv")).toHaveAttribute("data-state", "paused");
    expect(screen.getByRole("heading", { name: "Level 2" })).toBeInTheDocument();
    expect(parts(".tv-blinds")).toBe("Blinds 150/300");
    expect(screen.queryByRole("heading", { name: "Break" })).not.toBeInTheDocument();
  });

  it("shows the break with the blinds after it and the color-up, not a pause", async () => {
    const t = await running();
    await t.run({ type: "jump_to_next_break" });
    show(t.engine, await t.view());

    expect(screen.getByRole("heading", { name: "Break" })).toBeInTheDocument();
    expect(clock()).toBe("10:00");
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
    expect(parts(".tv-blinds")).toBe("After the break: level 3 200/400 Ante 50");
    expect(parts(".tv-upcoming")).toBe("Color-up: smallest chip 25");
  });

  it("shows both a break and a pause when the clock stops during a break", async () => {
    const t = await running();
    await t.run({ type: "jump_to_next_break" });
    await t.run({ type: "pause_clock" });
    show(t.engine, await t.view());

    expect(screen.getByRole("heading", { name: "Break" })).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("counts the overtime once the structure is over", async () => {
    const t = await running();
    await t.run({ type: "jump_to", level: 4 });
    const last = show(t.engine, await t.view());
    expect(screen.getByText("Last level")).toBeInTheDocument();
    last.unmount();

    t.advance(20 * MIN + 75_000);
    show(t.engine, await t.view());
    expect(screen.getByText("Overtime")).toBeInTheDocument();
    expect(clock()).toBe("+01:15");
    expect(screen.getByRole("timer")).toHaveAccessibleName("Time past the end of the last level");
    expect(parts(".tv-blinds")).toBe("Blinds 300/600 BBA 600");
    expect(screen.getByText("End of the structure: the blinds stay here")).toBeInTheDocument();
  });

  it("shows a tournament not started yet", async () => {
    const engine = createTestEngine();
    const id = await engine.createTournament(tournamentInput({ maxTables: 1 }, structure));
    await register(engine, id, ["Ann", "Ben"]);
    show(engine, await engine.getView(id));

    expect(screen.getByText("Starting soon")).toBeInTheDocument();
    expect(screen.getByText("Registration open")).toBeInTheDocument();
    expect(clock()).toBe("20:00");
    // No money status before the start.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows when late registration closes, then that it is closed", async () => {
    const t = await running(4, { lateReg: { type: "end_of_play_level", n: 2, throughBreak: false } });
    t.advance(5 * MIN);
    const open = show(t.engine, await t.view());
    expect(screen.getByText("Late registration open")).toBeInTheDocument();
    expect(screen.getByText("Closes in 35:00")).toBeInTheDocument();
    open.unmount();

    await t.run({ type: "close_registration" });
    show(t.engine, await t.view());
    expect(screen.getByText("Registration closed")).toBeInTheDocument();
  });

  it("shows players left, entries, re-entries, the average stack in chips and big blinds, chips in play", async () => {
    const t = await running(5, { reentry: { prize: 0, fee: 0, stack: 10_000 } });
    await t.bust(1);
    const busted = (await t.view()).ranking.find((row) => !row.alive)!;
    await t.run({ type: "reenter", player: busted.player });
    await t.bust(2);
    show(t.engine, await t.view());

    // 5 players, one re-entered, 3 still in.
    const players = screen.getByText("Players").nextElementSibling as HTMLElement;
    expect(within(players).getByText("3")).toBeInTheDocument();
    expect(within(players).getByText("of 6 entries")).toBeInTheDocument();
    expect(within(players).getByText("1 re-entry")).toBeInTheDocument();
    // 60,000 chips among 3 players, at 100/200.
    const average = screen.getByText("Average stack").nextElementSibling as HTMLElement;
    expect(within(average).getByText("20,000")).toBeInTheDocument();
    expect(within(average).getByText("100 BB")).toBeInTheDocument();
    expect(within(screen.getByText("Chips in play").nextElementSibling as HTMLElement).getByText("60,000")).toBeInTheDocument();
  });

  it("without money: the places paid and the levels coming up", async () => {
    const t = await running();
    show(t.engine, await t.view());

    expect(screen.queryByText("Prize pool")).not.toBeInTheDocument();
    expect(within(screen.getByText("Places paid").nextElementSibling as HTMLElement).getByText("3")).toBeInTheDocument();
    const schedule = within(screen.getByRole("region", { name: "Coming up" }));
    const rows = schedule.getAllByRole("listitem").map((row) => Array.from(row.children, (cell) => cell.textContent));
    expect(rows[0].slice(0, 2)).toEqual(["Level 2", "150/300"]);
    expect(rows[1].slice(0, 2)).toEqual(["Break", "10 min"]);
    expect(rows).toHaveLength(4);
  });

  it("with money: the prize pool, the payouts and the smallest prize still to reach", async () => {
    const t = await running(5, { money, placesPaid: 2 });
    const view = await t.view();
    show(t.engine, view);
    const [first, second] = view.money!.payouts.map((amount) => `€${amount / 100}`);

    expect(screen.getByText("Prize pool")).toBeInTheDocument();
    expect(screen.getByText("€500")).toBeInTheDocument();
    expect(screen.getByText("2 places paid")).toBeInTheDocument();
    const ladder = within(screen.getByRole("region", { name: "Payouts" })).getAllByRole("listitem");
    expect(ladder.map((row) => Array.from(row.children, (cell) => cell.textContent).join(" "))).toEqual([`1 ${first}`, `2 Min cash ${second}`]);
    expect(ladder[1]).toHaveAttribute("data-mark", "min");
    expect(screen.getByRole("status")).toHaveTextContent("3 eliminations to the money");
  });

  it("announces the bubble, then the money with the next payout", async () => {
    const t = await running(5, { money, placesPaid: 3 });
    await t.bust(1);
    const bubble = show(t.engine, await t.view());
    expect(screen.getByRole("status")).toHaveTextContent("BubbleThe next player out misses the money");
    expect(document.querySelector(".tv-band")).toHaveAttribute("data-itm", "bubble");
    bubble.unmount();

    await t.bust(1);
    show(t.engine, await t.view());
    const view = await t.view();
    const third = view.money!.payouts[2] / 100;
    expect(screen.getByRole("status")).toHaveTextContent(`In the moneyNext payout €${third}`);
    const next = document.querySelector('.tv-ladder-row[data-mark="next"]')!;
    expect(Array.from(next.children, (cell) => cell.textContent)).toEqual(["3", "Next out", `€${third}`]);
  });

  it("names the winner and lists the final places with their prizes", async () => {
    const t = await running(4, { money, placesPaid: 2 });
    await t.run({ type: "close_registration" });
    await t.bust(3);
    const view = await t.view();
    expect(view.phase).toBe("finished");
    show(t.engine, view);

    const winner = view.ranking.find((row) => row.player === view.winner)!;
    const [first, second] = view.money!.payouts.map((amount) => `€${amount / 100}`);
    expect(screen.getByText("Winner")).toBeInTheDocument();
    expect(screen.getByText(winner.name, { selector: ".tv-winner-name" })).toBeInTheDocument();
    expect(screen.getByText(first, { selector: ".tv-winner-prize" })).toBeInTheDocument();
    const results = within(screen.getByRole("list")).getAllByRole("listitem");
    const byPlace = [...view.ranking].sort((a, b) => a.place! - b.place!).map((row) => row.name);
    expect(byPlace[0]).toBe(winner.name);
    expect(results.map((row) => Array.from(row.children, (cell) => cell.textContent))).toEqual([
      ["1", byPlace[0], first],
      ["2", byPlace[1], second],
      ["3", byPlace[2]],
      ["4", byPlace[3]]
    ]);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
});

describe("DisplayScreen clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps each character of the time in a fixed cell, so nothing moves as the seconds tick", async () => {
    vi.useFakeTimers({ now: T0 });
    const t = await running();
    await t.run({ type: "set_remaining", ms: 10 * MIN + 2_000 });
    show(t.engine, await t.view());
    const cells = () => Array.from(screen.getByRole("timer").children, (cell) => cell.className);

    const layout = cells();
    expect(layout).toEqual(["tv-digit", "tv-digit", "tv-sep", "tv-digit", "tv-digit"]);
    const seen = new Set<string>();
    for (let second = 0; second < 4; second++) {
      seen.add(clock()!);
      expect(cells()).toEqual(layout);
      await act(async () => vi.advanceTimersByTime(1000));
    }
    // 10:02, 10:01, 10:00, 09:59: every digit changed, the cells did not.
    expect([...seen]).toEqual(["10:02", "10:01", "10:00", "09:59"]);

    // The cells have a fixed width, and the figures are tabular anyway.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles/display.css"), "utf8");
    expect(css).toMatch(/\.tv-digit \{[^}]*display: inline-block;[^}]*width: 0\.6em;/);
    expect(css).toMatch(/\.tv-sep \{[^}]*width: 0\.3em;/);
    expect(css).toMatch(/\.tv-time,[^{]*\{\s*font-variant-numeric: tabular-nums;/);
  });

  it("turns amber in the last minute", async () => {
    vi.useFakeTimers({ now: T0 });
    const t = await running();
    await t.run({ type: "set_remaining", ms: 61_000 });
    show(t.engine, await t.view());
    expect(document.querySelector(".tv")).not.toHaveAttribute("data-last-minute");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(document.querySelector(".tv")).toHaveAttribute("data-last-minute");
  });

  it("counts down locally from endsAtMs and refetches the view when the level ends", async () => {
    vi.useFakeTimers({ now: T0 });
    const engine = createTestEngine();
    const id = await engine.createTournament(tournamentInput({ maxTables: 1 }, structure));
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "start_clock" });

    renderApp(engine, `/display/${id}`);
    await settle();
    expect(clock()).toBe("20:00");
    expect(screen.getByRole("heading", { name: "Level 1" })).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(1000));
    expect(clock()).toBe("19:59");
    await act(async () => vi.advanceTimersByTime(18 * MIN + 59_000));
    expect(clock()).toBe("01:00");

    // The level ends: the view is refetched at recomputeAtMs, nothing was written.
    const before = (await engine.getView(id)).history.head;
    // The refetch fires 25 ms after the boundary.
    await act(async () => vi.advanceTimersByTime(60_025));
    await settle();
    await act(async () => vi.advanceTimersByTime(975));
    expect(screen.getByRole("heading", { name: "Level 2" })).toBeInTheDocument();
    expect(parts(".tv-blinds")).toBe("Blinds 150/300");
    expect(clock()).toBe("19:59");
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
    const displayTime = display.container.querySelector(".tv-time")!.textContent;
    expect(directorTime).toBe("16:30");
    expect(displayTime).toBe(directorTime);

    // A pause from the director reaches the display.
    await act(async () => {
      await engine.dispatch(id, { type: "pause_clock" });
    });
    await settle();
    await act(async () => vi.advanceTimersByTime(MIN));
    expect(display.container.querySelector(".tv-time")!.textContent).toBe("16:30");
    expect(within(display.container).getByText("Paused")).toBeInTheDocument();
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
    show(t.engine, await t.view(), { preview: true });

    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: "Escape" });
    await settle();

    expect(exitButton()).not.toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });
});
