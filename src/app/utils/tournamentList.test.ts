import { describe, expect, it } from "vitest";
import type { TournamentSummary } from "../../engine/types";
import { createTestEngine, pause, play, tournamentInput } from "../../test/wasm";
import { relativeTime } from "./relativeTime";
import { byLastChange, copyName, duplicateTournament, filterTournaments, MAX_TOURNAMENT_NAME } from "./tournamentList";

const templates = { first: "{name} (copy)", nth: "{name} (copy {n})" };

function summary(name: string, overrides: Partial<TournamentSummary> = {}): TournamentSummary {
  return { id: name, name, phase: "setup", createdAtMs: 0, updatedAtMs: 0, players: 0, alive: 0, ...overrides };
}

describe("copyName", () => {
  it("adds (copy), then numbers the copies", () => {
    expect(copyName("Friday", [], templates)).toBe("Friday (copy)");
    expect(copyName("Friday", ["Friday", "friday (COPY)"], templates)).toBe("Friday (copy 2)");
    expect(copyName("Friday", ["Friday (copy)", "Friday (copy 2)"], templates)).toBe("Friday (copy 3)");
  });

  it("counts a copy of a copy from the original", () => {
    expect(copyName("Friday (copy)", ["Friday", "Friday (copy)"], templates)).toBe("Friday (copy 2)");
    expect(copyName("Friday (copy 2)", ["Friday (copy)", "Friday (copy 2)"], templates)).toBe("Friday (copy 3)");
  });

  it("works with the templates of another language", () => {
    expect(copyName("Vendredi (copie)", ["Vendredi (copie)"], { first: "{name} (copie)", nth: "{name} (copie {n})" })).toBe("Vendredi (copie 2)");
  });

  it("stays within the core's limit", () => {
    const long = "Ł".repeat(MAX_TOURNAMENT_NAME);
    const copy = copyName(long, [], templates);
    expect([...copy]).toHaveLength(MAX_TOURNAMENT_NAME);
    expect(copy.endsWith(" (copy)")).toBe(true);
  });
});

describe("duplicateTournament", () => {
  it("creates a tournament with the same settings and structure, without players", async () => {
    const engine = createTestEngine();
    const structure = [play(100, 200), pause(15), play(200, 400, 30, { type: "big_blind", amount: 400 })];
    const source = await engine.createTournament(
      tournamentInput(
        {
          name: "Friday",
          maxTables: 3,
          startingStack: 30_000,
          lateReg: { type: "end_of_play_level", n: 2, throughBreak: false },
          money: { currency: { code: "EUR", exponent: 2 }, buyIn: { prize: 10_000, fee: 1_000 }, roundingUnit: 500, guarantee: 200_000 }
        },
        structure
      )
    );
    await engine.dispatch(source, { type: "register", name: "Aoife" });
    await engine.dispatch(source, { type: "register", name: "Søren" });
    await engine.dispatch(source, { type: "start_clock" });
    const original = await engine.getView(source);

    const id = await duplicateTournament(engine, source, "Friday (copy)");
    const copy = await engine.getView(id);

    expect(id).not.toBe(source);
    expect(copy.config).toEqual({ ...original.config, name: "Friday (copy)" });
    expect(copy.levels.map((row) => row.level)).toEqual(structure);
    expect(copy.phase).toBe("setup");
    expect(copy.counts.unique).toBe(0);
    expect(copy.clock).toMatchObject({ levelIndex: 0, running: false });
    // The source is untouched.
    expect((await engine.getView(source)).counts.unique).toBe(2);
  });
});

describe("the list", () => {
  it("puts the most recently changed first", () => {
    const list = [summary("a", { updatedAtMs: 1 }), summary("b", { updatedAtMs: 3 }), summary("c", { updatedAtMs: 2 })];
    expect(byLastChange(list).map((entry) => entry.name)).toEqual(["b", "c", "a"]);
  });

  it("filters by name, ignoring case and accents, and by phase", () => {
    const list = [summary("Zoë's Sunday", { phase: "running" }), summary("Sunday Major"), summary("Monday Turbo", { phase: "finished" })];
    expect(filterTournaments(list, "zoe", "all").map((entry) => entry.name)).toEqual(["Zoë's Sunday"]);
    expect(filterTournaments(list, " SUNDAY ", "all")).toHaveLength(2);
    expect(filterTournaments(list, "sunday", "setup").map((entry) => entry.name)).toEqual(["Sunday Major"]);
    expect(filterTournaments(list, "", "finished").map((entry) => entry.name)).toEqual(["Monday Turbo"]);
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 8, 24, 12);
  const MIN = 60_000;

  it("says how long ago, in words for the locale", () => {
    expect(relativeTime(now - 10_000, now, "en")).toBe("now");
    expect(relativeTime(now + 5_000, now, "en")).toBe("now");
    expect(relativeTime(now - 5 * MIN, now, "en")).toBe("5 minutes ago");
    expect(relativeTime(now - 3 * 60 * MIN, now, "en")).toBe("3 hours ago");
    expect(relativeTime(now - 24 * 60 * MIN, now, "en")).toBe("yesterday");
    expect(relativeTime(now - 3 * 24 * 60 * MIN, now, "en")).toBe("3 days ago");
    expect(relativeTime(now - 14 * 24 * 60 * MIN, now, "en")).toBe("2 weeks ago");
    expect(relativeTime(now - 90 * 24 * 60 * MIN, now, "en")).toBe("3 months ago");
    expect(relativeTime(now - 800 * 24 * 60 * MIN, now, "en")).toBe("2 years ago");
    expect(relativeTime(now - 5 * MIN, now, "fr")).toBe("il y a 5 minutes");
  });
});
