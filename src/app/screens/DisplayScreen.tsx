import { useEffect, useRef, useState } from "react";
import { closeDisplayWindow, openDisplayWindow } from "../api";
import type { Player, StateSnapshot } from "../types";
import { formatTime, moneyStatus, playLevelNumber } from "../utils/tournament";

/** How long the exit control stays visible after the mouse stops moving. */
export const EXIT_CONTROL_HIDE_DELAY_MS = 3000;

function sortEliminated(players: Player[]) {
  return [...players]
    .filter((p) => p.status === "eliminated")
    .sort((a, b) => (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0));
}

function closeDisplay() {
  closeDisplayWindow().catch((error) => console.error("Could not close the display", error));
}

/**
 * The fullscreen display has no window controls: Esc closes it, and moving the mouse shows
 * an exit button for a few seconds. Returns whether that button is visible.
 */
function useExitControl(enabled: boolean) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let lastPosition: { x: number; y: number } | null = null;

    const onMouseMove = (event: MouseEvent) => {
      // Browsers also fire mousemove when content scrolls under a still cursor.
      if (lastPosition?.x === event.clientX && lastPosition.y === event.clientY) return;
      lastPosition = { x: event.clientX, y: event.clientY };
      setVisible(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setVisible(false), EXIT_CONTROL_HIDE_DELAY_MS);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeDisplay();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled]);

  return visible;
}

export default function DisplayScreen({ state, preview }: { state: StateSnapshot; preview?: boolean }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const exitVisible = useExitControl(!preview);

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
  const money = tournament ? moneyStatus(remainingPlayers, tournament.itmCount) : null;
  const eliminatedList = sortEliminated(state.players);

  const content = (
    <div className={preview ? "display-preview" : "display"}>
      {exitVisible && (
        <button type="button" className="display-exit" onClick={closeDisplay}>
          Exit display <kbd>Esc</kbd>
        </button>
      )}
      <div className="display-left">
        <div className="display-card">
          <h2>Clock</h2>
          {tournament?.clockState === "paused" && <div className="display-paused">PAUSED</div>}
          <div className="display-time">{formatTime(tournament?.clockRemainingSeconds ?? 0)}</div>
          {currentLevel?.isBreak ? (
            <div className="display-break">BREAK</div>
          ) : (
            <>
              <div className="display-level">Level {currentLevel ? playLevelNumber(state.levels, currentLevel) : "—"}</div>
              {currentLevel && (
                <div className="display-blinds">Blinds {currentLevel.smallBlind}/{currentLevel.bigBlind} Ante {currentLevel.ante}</div>
              )}
            </>
          )}
          {nextLevel && (
            <div className="display-next">
              Next: {nextLevel.isBreak ? "Break" : `L${playLevelNumber(state.levels, nextLevel)} ${nextLevel.smallBlind}/${nextLevel.bigBlind} A${nextLevel.ante}`}
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
          {money && <div className={money.kind === "itm" ? "display-success" : "display-warning"}>{money.text}</div>}
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
