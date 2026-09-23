import { describe, expect, it } from "vitest";
import type { Player } from "../types";
import { computeRanking, formatPlace, formatTimestamp, rankingStatusLabel, rankingTitle, sortByMostRecentElimination } from "./ranking";

function player(id: number, name: string, eliminatedAt: number | null = null): Player {
  return {
    id,
    tournamentId: 1,
    name,
    status: eliminatedAt === null ? "active" : "eliminated",
    registeredAt: 0,
    eliminatedAt
  };
}

/** 16 players; everyone except ids 4, 10 and 13 is eliminated, in this order (first out first). */
const ELIMINATION_ORDER = [5, 12, 1, 9, 16, 3, 7, 14, 2, 11, 6, 15, 8];
const ALIVE_NAMES: Record<number, string> = { 4: "Zoë", 10: "Adam", 13: "Mia" };

function sixteenPlayers(eliminationOrder: number[] = ELIMINATION_ORDER): Player[] {
  return Array.from({ length: 16 }, (_, index) => {
    const id = index + 1;
    const order = eliminationOrder.indexOf(id);
    if (order === -1) return player(id, ALIVE_NAMES[id] ?? `Player ${id}`);
    return player(id, `Player ${id}`, 1_000 + order * 60);
  });
}

describe("computeRanking", () => {
  it("lists players still in play first, by name, without a place", () => {
    const ranking = computeRanking(sixteenPlayers(), "running");

    expect(ranking.slice(0, 3).map((entry) => [entry.playerName, entry.place])).toEqual([
      ["Adam", null],
      ["Mia", null],
      ["Zoë", null]
    ]);
  });

  it("gives eliminated players places 4..16, most recent elimination finishing highest", () => {
    const ranking = computeRanking(sixteenPlayers(), "running");
    const eliminated = ranking.slice(3);

    expect(ranking).toHaveLength(16);
    expect(eliminated.map((entry) => entry.place)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(eliminated.map((entry) => entry.playerId)).toEqual([...ELIMINATION_ORDER].reverse());
    expect(eliminated.every((entry) => entry.status === "eliminated")).toBe(true);
    // The first player out finishes last.
    expect(ranking[15]).toMatchObject({ place: 16, playerId: 5 });
  });

  it("ranks the last player standing first once the tournament is finished", () => {
    const players = sixteenPlayers([5, 12, 1, 9, 16, 3, 7, 14, 2, 11, 6, 15, 8, 10, 4]);
    const ranking = computeRanking(players, "finished");

    expect(ranking[0]).toMatchObject({ place: 1, playerId: 13, playerName: "Mia", status: "active" });
    expect(ranking.map((entry) => entry.place)).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
    expect(ranking[1]).toMatchObject({ place: 2, playerId: 4 });
    expect(ranking[15]).toMatchObject({ place: 16, playerId: 5 });
  });

  it("does not crown the last player standing while the tournament is not finished", () => {
    const players = sixteenPlayers([5, 12, 1, 9, 16, 3, 7, 14, 2, 11, 6, 15, 8, 10, 4]);
    const ranking = computeRanking(players, "running");

    expect(ranking[0]).toMatchObject({ place: null, playerId: 13 });
    expect(ranking[1]).toMatchObject({ place: 2, playerId: 4 });
  });

  it("breaks equal elimination times by the higher player id first", () => {
    const players = [player(1, "A"), player(2, "B", 500), player(7, "C", 500), player(3, "D", 400)];

    expect(sortByMostRecentElimination(players).map((p) => p.id)).toEqual([7, 2, 3]);
    expect(computeRanking(players, "running").map((entry) => [entry.playerId, entry.place])).toEqual([
      [1, null],
      [7, 2],
      [2, 3],
      [3, 4]
    ]);
  });

  it("does not mutate its input", () => {
    const players = sixteenPlayers();
    const snapshot = players.map((p) => p.id);
    computeRanking(players, "running");
    expect(players.map((p) => p.id)).toEqual(snapshot);
  });
});

describe("ranking labels", () => {
  it("formats places and statuses", () => {
    const [winner, runnerUp] = computeRanking([player(1, "A"), player(2, "B", 10)], "finished");
    const [inPlay] = computeRanking([player(1, "A"), player(2, "B")], "running");

    expect(formatPlace(null)).toBe("—");
    expect(formatPlace(4)).toBe("#4");
    expect(rankingStatusLabel(winner)).toBe("Winner");
    expect(rankingStatusLabel(runnerUp)).toBe("Eliminated");
    expect(rankingStatusLabel(inPlay)).toBe("In play");
  });

  it("titles the ranking as final only when the tournament is finished", () => {
    const at = new Date(2026, 8, 4, 7, 5);

    expect(formatTimestamp(at)).toBe("2026-09-04 07:05");
    expect(rankingTitle(true, at)).toBe("Final ranking");
    expect(rankingTitle(false, at)).toBe("Ranking — 2026-09-04 07:05");
  });
});
