import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Player, StateSnapshot, Tournament, TournamentStatus } from "../types";
import ExportsScreen from "./ExportsScreen";

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

function snapshot(status: TournamentStatus, players: Player[]): StateSnapshot {
  const tournament: Tournament = {
    id: 1,
    name: "Sunday Major",
    tablesCount: 2,
    seatsPerTable: 9,
    itmCount: 3,
    lateRegEnabled: false,
    lateRegEndLevel: null,
    lateRegEndTimeSeconds: null,
    status,
    currentLevelIndex: 0,
    clockState: "paused",
    clockRemainingSeconds: 0,
    createdAt: 0
  };
  return { tournament, players, tables: [], seats: [], levels: [] };
}

function rows() {
  return screen.getAllByText(/^(#\d+|—)$/).map((pill) => {
    const row = pill.closest(".list-row") as HTMLElement;
    return within(row)
      .getAllByText(/.+/)
      .map((cell) => cell.textContent);
  });
}

describe("ExportsScreen", () => {
  it("shows players in play first without a place, then eliminated players by finishing place", () => {
    const players = [player(1, "Chloé", 100), player(2, "Łukasz"), player(3, "Bob", 200), player(4, "Anna")];
    render(<ExportsScreen state={snapshot("running", players)} />);

    expect(rows()).toEqual([
      ["—", "Anna", "In play"],
      ["—", "Łukasz", "In play"],
      ["#3", "Bob", "Eliminated"],
      ["#4", "Chloé", "Eliminated"]
    ]);
  });

  it("shows the winner first once the tournament is finished", () => {
    const players = [player(1, "Chloé", 100), player(2, "Łukasz"), player(3, "Bob", 200)];
    render(<ExportsScreen state={snapshot("finished", players)} />);

    expect(rows()).toEqual([
      ["#1", "Łukasz", "Winner"],
      ["#2", "Bob", "Eliminated"],
      ["#3", "Chloé", "Eliminated"]
    ]);
  });
});
