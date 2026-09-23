import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ClockState, Level, Player, StateSnapshot } from "../types";
import DisplayScreen from "./DisplayScreen";

function level(index: number, smallBlind: number, bigBlind: number, ante: number, isBreak = false): Level {
  return {
    id: index + 1,
    tournamentId: 1,
    index,
    durationSeconds: 20 * 60,
    smallBlind,
    bigBlind,
    ante,
    isBreak,
    label: isBreak ? "Break" : `Level ${index + 1}`
  };
}

const levels: Level[] = [
  level(0, 100, 200, 0),
  level(1, 150, 300, 0),
  level(2, 0, 0, 0, true),
  level(3, 200, 400, 50),
  level(4, 300, 600, 75)
];

function activePlayer(id: number): Player {
  return { id, tournamentId: 1, name: `Player ${id}`, status: "active", registeredAt: 0, eliminatedAt: null };
}

function snapshot(currentLevelIndex: number, clockState: ClockState, alive = 0): StateSnapshot {
  return {
    tournament: {
      id: 1,
      name: "MTT",
      tablesCount: 2,
      seatsPerTable: 9,
      itmCount: 3,
      lateRegEnabled: false,
      lateRegEndLevel: null,
      lateRegEndTimeSeconds: null,
      status: "running",
      currentLevelIndex,
      clockState,
      clockRemainingSeconds: 754,
      createdAt: 0
    },
    players: Array.from({ length: alive }, (_, i) => activePlayer(i + 1)),
    tables: [],
    seats: [],
    levels
  };
}

describe("DisplayScreen", () => {
  it("shows the level and blinds while a play level is running", () => {
    render(<DisplayScreen state={snapshot(1, "running")} />);
    expect(screen.getByText("12:34")).toBeInTheDocument();
    expect(screen.getByText("Level 2")).toBeInTheDocument();
    expect(screen.getByText("Blinds 150/300 Ante 0")).toBeInTheDocument();
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
    expect(screen.queryByText("BREAK")).not.toBeInTheDocument();
  });

  it("shows a paused indicator and keeps the level and blinds visible when the clock is paused", () => {
    render(<DisplayScreen state={snapshot(1, "paused")} />);
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
    expect(screen.getByText("Level 2")).toBeInTheDocument();
    expect(screen.getByText("Blinds 150/300 Ante 0")).toBeInTheDocument();
    expect(screen.queryByText("BREAK")).not.toBeInTheDocument();
  });

  it("shows the break banner during a break level", () => {
    render(<DisplayScreen state={snapshot(2, "running")} />);
    expect(screen.getByText("BREAK")).toBeInTheDocument();
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Blinds/)).not.toBeInTheDocument();
  });

  it("numbers play levels without counting breaks", () => {
    render(<DisplayScreen state={snapshot(3, "running")} />);
    expect(screen.getByText("Level 3")).toBeInTheDocument();
    expect(screen.getByText("Blinds 200/400 Ante 50")).toBeInTheDocument();
    expect(screen.getByText("Next: L4 300/600 A75")).toBeInTheDocument();
  });

  it("announces the bubble when one elimination is left before the money", () => {
    render(<DisplayScreen state={snapshot(1, "running", 4)} />);
    expect(screen.getByText("Bubble!")).toBeInTheDocument();
  });
});
