import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ClockState, Level, StateSnapshot } from "../types";
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
  level(3, 200, 400, 50)
];

function snapshot(currentLevelIndex: number, clockState: ClockState): StateSnapshot {
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
    players: [],
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
});
