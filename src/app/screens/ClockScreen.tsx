import { adjustClock, nextLevel, pauseClock, previousLevel, startClock, triggerNextBreak } from "../api";
import type { Level, StateSnapshot } from "../types";
import { formatTime, playLevelNumber } from "../utils/tournament";

function levelLabel(levels: Level[], level?: Level | null) {
  if (!level) return "—";
  if (level.isBreak) return "Break";
  return `L${playLevelNumber(levels, level)} ${level.smallBlind}/${level.bigBlind} (A${level.ante})`;
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
          <div className="clock-level">{levelLabel(state.levels, current)}</div>
        </div>
        <div>
          <div className="stat-label">Next</div>
          <div className="clock-level">{levelLabel(state.levels, next)}</div>
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
