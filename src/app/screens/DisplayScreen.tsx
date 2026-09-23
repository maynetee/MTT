import { useEffect, useRef } from "react";
import { openDisplayWindow } from "../api";
import type { Player, StateSnapshot } from "../types";

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function sortEliminated(players: Player[]) {
  return [...players]
    .filter((p) => p.status === "eliminated")
    .sort((a, b) => (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0));
}

export default function DisplayScreen({ state, preview }: { state: StateSnapshot; preview?: boolean }) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const container = listRef.current;
      if (!container) return;
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll <= 0) return;
      const next = container.scrollTop + 120;
      container.scrollTo({ top: next >= maxScroll ? 0 : next, behavior: "smooth" });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const tournament = state.tournament;
  const currentLevel = state.levels.find((level) => level.index === tournament?.currentLevelIndex);
  const nextLevel = state.levels.find((level) => level.index === (tournament?.currentLevelIndex ?? 0) + 1);
  const remainingPlayers = state.players.filter((p) => p.status === "active").length;
  const eliminatedPlayers = state.players.filter((p) => p.status === "eliminated").length;
  const activeTables = state.tables.filter((t) => !t.isClosed).length;
  const remainingToITM = tournament ? remainingPlayers - tournament.itmCount : 0;
  const eliminatedList = sortEliminated(state.players);

  const content = (
    <div className={preview ? "display-preview" : "display"}>
      <div className="display-left">
        <div className="display-card">
          <h2>Clock</h2>
          <div className="display-time">{formatTime(tournament?.clockRemainingSeconds ?? 0)}</div>
          {currentLevel?.isBreak || tournament?.clockState === "paused" ? (
            <div className="display-break">BREAK</div>
          ) : (
            <>
              <div className="display-level">Level {currentLevel ? currentLevel.index + 1 : "—"}</div>
              {currentLevel && (
                <div className="display-blinds">Blinds {currentLevel.smallBlind}/{currentLevel.bigBlind} Ante {currentLevel.ante}</div>
              )}
            </>
          )}
          {nextLevel && (
            <div className="display-next">
              Next: {nextLevel.isBreak ? "Break" : `L${nextLevel.index + 1} ${nextLevel.smallBlind}/${nextLevel.bigBlind} A${nextLevel.ante}`}
            </div>
          )}
        </div>

        <div className="display-card">
          <h2>Stats</h2>
          <div className="display-stat">Registered: {state.players.length}</div>
          <div className="display-stat">Remaining: {remainingPlayers}</div>
          <div className="display-stat">Eliminated: {eliminatedPlayers}</div>
          <div className="display-stat">Active Tables: {activeTables}</div>
        </div>

        <div className="display-card">
          <h2>ITM / Bubble</h2>
          <div className="display-stat">ITM: {tournament?.itmCount ?? 0}</div>
          {remainingToITM > 0 && <div className="display-warning">{remainingToITM} eliminations to ITM</div>}
          {remainingToITM === 0 && <div className="display-warning">Bubble!</div>}
          {remainingToITM < 0 && <div className="display-success">ITM reached</div>}
        </div>
      </div>

      <div className="display-card display-right">
        <h2>Live Ranking</h2>
        <div className="display-list" ref={listRef}>
          {eliminatedList.map((player) => (
            <div key={player.id} className="display-row">
              {player.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (preview) {
    return (
      <div className="card">
        <div className="card-header">
          <h2>Display Preview</h2>
          <button className="btn" onClick={() => openDisplayWindow()}>Open Display Window</button>
        </div>
        <div className="display-wrapper">{content}</div>
      </div>
    );
  }

  return content;
}
