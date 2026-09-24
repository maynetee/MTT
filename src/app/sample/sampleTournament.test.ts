import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TauriEngine } from "../../engine/tauriEngine";
import type { Command, Engine, NewTournamentInput, View } from "../../engine/types";
import { createTestEngine } from "../../test/wasm";
import {
  createSampleTournament,
  SAMPLE_LATE_REG_LEVEL,
  SAMPLE_LEVEL_INDEX,
  SAMPLE_PLAYERS,
  SAMPLE_REMAINING_MS,
  SAMPLE_SEATS,
  SAMPLE_STARTING_STACK,
  SAMPLE_TABLES,
  sampleSeat
} from "./sampleTournament";

const NAME = "Sample — Friday Deepstack";

afterEach(() => clearMocks());

/** Who sits where, table by table. */
function seating(view: View): string[][] {
  return view.tables.map((table) => table.seats.map((seat) => seat.name ?? ""));
}

describe("the sample tournament", () => {
  it("is a running tournament of 36 players at 4 tables of 9, mid-level 3", async () => {
    const engine = createTestEngine();
    const id = await createSampleTournament(engine, NAME);
    const view = await engine.getView(id);

    expect(view.config).toMatchObject({ name: NAME, seatsPerTable: SAMPLE_SEATS, maxTables: SAMPLE_TABLES, startingStack: SAMPLE_STARTING_STACK });
    expect(view.phase).toBe("running");
    expect(view.counts).toMatchObject({ unique: 36, entries: 36, alive: 31, busted: 5 });
    expect(new Set(view.ranking.map((row) => row.name))).toEqual(new Set(SAMPLE_PLAYERS));
    expect(SAMPLE_PLAYERS.some((name) => /[^\x20-\x7e]/.test(name))).toBe(true);

    // The clock runs in play level 3, about half of it left.
    expect(view.clock).toMatchObject({ levelIndex: SAMPLE_LEVEL_INDEX, playLevel: 3, running: true, isBreak: false });
    expect(view.clock.remainingMs).toBeLessThanOrEqual(SAMPLE_REMAINING_MS);
    expect(view.clock.remainingMs).toBeGreaterThan(SAMPLE_REMAINING_MS - 60_000);
    expect(view.clock).toMatchObject({ sb: 200, bb: 400, ante: { type: "big_blind", amount: 400 } });
  });

  it("has a big blind ante structure with breaks and late registration to the end of level 6", async () => {
    const engine = createTestEngine();
    const view = await engine.getView(await createSampleTournament(engine, NAME));

    const play = view.levels.filter((row) => row.level.type === "play");
    expect(play.length).toBeGreaterThanOrEqual(20);
    expect(play.every((row) => row.level.type === "play" && row.level.ante.type === "big_blind")).toBe(true);
    expect(view.levels.filter((row) => row.level.type === "break").length).toBeGreaterThanOrEqual(3);
    expect(view.warnings).toEqual([]);
    expect(view.config.lateReg).toEqual({ type: "end_of_play_level", n: SAMPLE_LATE_REG_LEVEL, throughBreak: false });
    expect(view.registration.open).toBe(true);
  });

  it("has buttons at every table, five players out and tables to balance", async () => {
    const engine = createTestEngine();
    const view = await engine.getView(await createSampleTournament(engine, NAME));

    expect(view.tables.map((table) => table.status)).toEqual(["open", "open", "open", "open"]);
    expect(view.tables.every((table) => table.button !== null && table.nextSb !== null && table.nextBb !== null)).toBe(true);
    expect(view.tables.map((table) => table.players)).toEqual([8, 6, 9, 8]);

    const out = view.ranking.filter((row) => !row.alive);
    expect(out.map((row) => row.place)).toEqual([32, 33, 34, 35, 36]);
    expect(out.every((row) => row.provisional)).toBe(true);
    // Tables differ by more than the balancing threshold: there is something to move.
    expect(view.suggestions.balance.length).toBeGreaterThan(0);
  });

  it("tracks money: EUR 100 + 10, a guarantee and the default payouts", async () => {
    const engine = createTestEngine();
    const view = await engine.getView(await createSampleTournament(engine, NAME));

    expect(view.config.money).toMatchObject({ currency: { code: "EUR", exponent: 2 }, buyIn: { prize: 10_000, fee: 1_000 }, guarantee: 300_000 });
    expect(view.money).toMatchObject({ pool: 360_000, fees: 36_000, effectivePool: 360_000, overlay: 0 });
    expect(view.money!.payouts.length).toBe(view.placesPaid);
    expect(view.money!.payouts.reduce((sum, amount) => sum + amount, 0)).toBe(360_000);
  });

  it("seats everyone the same way every time", async () => {
    const engine = createTestEngine();
    const first = await engine.getView(await createSampleTournament(engine, NAME));
    const second = await engine.getView(await createSampleTournament(engine, NAME));
    expect(seating(second)).toEqual(seating(first));
    expect(first.ranking.filter((row) => !row.alive)).toEqual(second.ranking.filter((row) => !row.alive));

    const seats = SAMPLE_PLAYERS.map((_, index) => sampleSeat(index));
    expect(new Set(seats.map((seat) => `${seat.table}:${seat.seat}`)).size).toBe(36);
  });

  it("ranks the two players of the same hand by their starting stacks", async () => {
    const engine = createTestEngine();
    const view = await engine.getView(await createSampleTournament(engine, NAME));
    const at = (table: number, seat: number) =>
      view.ranking.find((row) => row.name === SAMPLE_PLAYERS.find((_, index) => sampleSeat(index).table === table && sampleSeat(index).seat === seat));

    // Out first: 36th. The same hand: the bigger stack (23,450) 34th, the smaller 35th.
    expect(at(2, 4)).toMatchObject({ alive: false, place: 36, placeTo: null });
    expect(at(2, 8)).toMatchObject({ alive: false, place: 34, placeTo: null });
    expect(at(2, 2)).toMatchObject({ alive: false, place: 35, placeTo: null });
    expect(at(4, 6)).toMatchObject({ alive: false, place: 33 });
    expect(at(1, 9)).toMatchObject({ alive: false, place: 32 });
  });

  it("is built with ordinary commands only, so the desktop app builds the same one", async () => {
    // The desktop engine, its IPC answered by the core compiled to WebAssembly.
    const core = createTestEngine();
    const calls: string[] = [];
    mockIPC((cmd, args) => {
      calls.push(cmd);
      const payload = args as { input: NewTournamentInput; id: string; command: Command };
      if (cmd === "create_tournament") return core.createTournament(payload.input);
      if (cmd === "dispatch") return core.dispatch(payload.id, payload.command);
      throw new Error(`unexpected command ${cmd}`);
    });
    const desktop: Engine = new TauriEngine();

    const id = await createSampleTournament(desktop, NAME);

    expect(new Set(calls)).toEqual(new Set(["create_tournament", "dispatch"]));
    const browser = createTestEngine();
    const reference = await browser.getView(await createSampleTournament(browser, NAME));
    const built = await core.getView(id);
    expect(seating(built)).toEqual(seating(reference));
    expect(built.counts).toEqual(reference.counts);
    expect(built.clock.levelIndex).toBe(reference.clock.levelIndex);
  });

  it("deletes what it built when a step fails", async () => {
    const engine = createTestEngine();
    const dispatch = engine.dispatch.bind(engine);
    let calls = 0;
    vi.spyOn(engine, "dispatch").mockImplementation((id, command) => {
      if (++calls === 20) return Promise.reject({ code: "HOST_ERROR", params: { message: "disk full" } });
      return dispatch(id, command);
    });

    await expect(createSampleTournament(engine, NAME)).rejects.toEqual({ code: "HOST_ERROR", params: { message: "disk full" } });
    expect(await engine.listTournaments()).toEqual([]);
  });
});
