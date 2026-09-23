import React from "react";
import { adjustClock, nextLevel, pauseClock, previousLevel, startClock, triggerNextBreak } from "../api";
import type { Level, StateSnapshot } from "../types";

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function levelLabel(level?: Level | null) {
  if (!level) return "—";
  if (level.isBreak) return "Break";
  return `L${level.index + 1} ${level.smallBlind}/${level.bigBlind} (A${level.ante})`;
}

export default function ClockScreen({ state }: { state: StateSnapshot }) {
  const tournament = state.tournament;
  const current = state.levels.find((level) => level.index === tournament?.currentLevelIndex);
  const next = state.levels.find((level) => level.index === (tournament?.currentLevelIndex ?? 0) + 1);

  return (
    <div className="card">
      <div className="clock-grid">
        <div>
          <div className="stat-label">Remaining</div>
          <div className="clock-time">{formatTime(tournament?.clockRemainingSeconds ?? 0)}</div>
        </div>
        <div>
          <div className="stat-label">Current</div>
          <div className="clock-level">{levelLabel(current)}</div>
        </div>
        <div>
          <div className="stat-label">Next</div>
          <div className="clock-level">{levelLabel(next)}</div>
        </div>
      </div>

      <div className="button-row">
        {tournament?.clockState === "running" ? (
          <button className="btn primary" onClick={() => pauseClock()}>Pause</button>
        ) : (
          <button className="btn primary" onClick={() => startClock()}>Start</button>
        )}
        <button className="btn" onClick={() => previousLevel()}>Previous</button>
        <button className="btn" onClick={() => nextLevel()}>Next</button>
        <button className="btn" onClick={() => adjustClock(-60)}>-1:00</button>
        <button className="btn" onClick={() => adjustClock(60)}>+1:00</button>
        <button className="btn" onClick={() => triggerNextBreak()}>Next Break</button>
      </div>
    </div>
  );
}
