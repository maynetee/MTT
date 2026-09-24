import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { Ante, LevelRow, View } from "../../engine/types";
import { useI18n, type I18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { useEngine } from "../EngineContext";
import { useClock } from "../hooks/useClock";
import { useTournamentView } from "../hooks/useTournamentView";
import { useTournament } from "../TournamentContext";
import { formatPlace } from "../utils/labels";

/** How long the exit control stays visible after the mouse stops moving. */
export const EXIT_CONTROL_HIDE_DELAY_MS = 3000;

/**
 * The fullscreen display has no window controls: Esc closes it, and moving the mouse shows
 * an exit button for a few seconds. Returns whether that button is visible.
 */
function useExitControl(enabled: boolean, close: () => void) {
  const [visible, setVisible] = useState(false);
  const closeRef = useRef(close);
  closeRef.current = close;

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
      closeRef.current();
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

function anteSuffix(i18n: I18n, ante: Ante): string {
  if (ante.type === "none") return "";
  return i18n.t(ante.type === "classic" ? "display.anteSuffix_classic" : "display.anteSuffix_big_blind", { amount: i18n.number(ante.amount) });
}

function nextLevelText(i18n: I18n, next: LevelRow): string {
  const { level } = next;
  const text =
    level.type === "break"
      ? i18n.t("display.nextBreak", { minutes: Math.round(level.durationMs / 60_000) })
      : i18n.t("display.nextLevel", { n: next.playLevel ?? 0, sb: i18n.number(level.sb), bb: i18n.number(level.bb), ante: anteSuffix(i18n, level.ante) });
  return i18n.t("display.next", { level: text });
}

interface DisplayProps {
  view: View;
  offsetMs: number;
  preview?: boolean;
}

export default function DisplayScreen({ view, offsetMs, preview = false }: DisplayProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const engine = useEngine();
  const listRef = useRef<HTMLDivElement | null>(null);
  const exitVisible = useExitControl(!preview, () => {
    engine.closeCurrentWindow().catch((error: unknown) => console.error("Could not close the display", error));
  });
  const local = useClock(view, offsetMs);

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

  const { clock, counts, chips, itm } = view;
  const finished = view.phase === "finished";
  const winner = view.winner === null ? null : view.ranking.find((row) => row.player === view.winner);
  // The clock re-renders the display four times a second; the ranking only changes with the view.
  const rankingRows = useMemo(
    () =>
      view.ranking
        .filter((row) => !row.alive)
        .map((row) => (
          <div key={row.player} className="display-row">
            {formatPlace(row)} {row.name}
          </div>
        )),
    [view.ranking]
  );
  const activeTables = view.tables.filter((table) => table.status === "open").length;
  const breakInMs = clock.nextBreakInMs === null || clock.isBreak ? null : Math.max(0, clock.nextBreakInMs - local.elapsedMs);
  const status = finished ? null : view.phase === "setup" ? t("display.notStarted") : clock.running ? null : t("display.paused");

  const averageStack =
    chips.avgStack === null
      ? null
      : chips.avgStackBbX100 === null
        ? t("display.averageStack", { chips: i18n.number(chips.avgStack) })
        : t("display.averageStackBb", { chips: i18n.number(chips.avgStack), bb: i18n.bigBlinds(chips.avgStackBbX100) });

  const money =
    itm.status === "in_money"
      ? { className: "display-success", text: t("display.inMoney") }
      : itm.status === "bubble"
        ? { className: "display-warning", text: t("display.bubble") }
        : { className: "display-warning", text: t("display.toMoney", { count: itm.toMoney }) };

  const content = (
    // The TV display stays dark whatever the director's theme: it faces a dim room.
    <div className={preview ? "display-preview" : "display"} data-theme="dark">
      {exitVisible && (
        <button
          type="button"
          className="display-exit"
          onClick={() => engine.closeCurrentWindow().catch((error: unknown) => console.error("Could not close the display", error))}
        >
          {t("display.exit")} <kbd>{t("display.exitKey")}</kbd>
        </button>
      )}
      <div className="display-left">
        <div className="display-card">
          <h2>{view.config.name}</h2>
          {status && <div className="display-paused">{status}</div>}
          {winner ? (
            <div className="display-break">{t("display.winner", { name: winner.name })}</div>
          ) : (
            <>
              <div className="display-time">{i18n.duration(local.remainingMs)}</div>
              {local.overtimeMs > 0 && <div className="display-warning">{t("clock.overtime", { duration: i18n.duration(local.overtimeMs) })}</div>}
              {clock.isBreak ? (
                <div className="display-break">{t("display.break")}</div>
              ) : (
                <>
                  <div className="display-level">{t("display.level", { n: clock.playLevel ?? 0 })}</div>
                  {clock.sb !== null && clock.bb !== null && (
                    <div className="display-blinds">
                      {t("display.blinds", { sb: i18n.number(clock.sb), bb: i18n.number(clock.bb) })}
                      {anteSuffix(i18n, clock.ante)}
                    </div>
                  )}
                </>
              )}
              {clock.next && <div className="display-next">{nextLevelText(i18n, clock.next)}</div>}
              {breakInMs !== null && <div className="display-next">{t("display.breakIn", { duration: i18n.duration(breakInMs) })}</div>}
            </>
          )}
        </div>

        <div className="display-card">
          <h2>{t("display.stats")}</h2>
          <div className="display-stat">{t("display.playersLeft", { alive: counts.alive, entries: counts.entries })}</div>
          {averageStack && <div className="display-stat">{averageStack}</div>}
          <div className="display-stat">{t("display.tables", { count: activeTables })}</div>
        </div>

        <div className="display-card">
          <h2>{t("display.itmTitle")}</h2>
          <div className="display-stat">{t("display.placesPaid", { count: view.placesPaid })}</div>
          {view.phase !== "setup" && <div className={money.className}>{money.text}</div>}
        </div>
      </div>

      <div className="display-card display-right">
        <h2>{t("display.ranking")}</h2>
        <div className="display-list" ref={listRef}>
          {rankingRows}
        </div>
      </div>
    </div>
  );

  if (preview) {
    return (
      <Section
        title={t("display.preview")}
        description={t("display.previewHint")}
        actions={
          <Button icon="external" onClick={() => void engine.openDisplayWindow(view.id).catch(() => undefined)}>
            {t("display.openWindow")}
          </Button>
        }
      >
        <div className="display-wrapper">{content}</div>
      </Section>
    );
  }

  return content;
}

/** The Display tab of the director window. */
export function DisplayPreview() {
  const { view, offsetMs } = useTournament();
  return <DisplayScreen view={view} offsetMs={offsetMs} preview />;
}

function DisplayWindow({ id }: { id: string }) {
  const { t, error } = useI18n();
  const { view, offsetMs, loadError } = useTournamentView(id);
  if (!view)
    return (
      <div className="display" data-theme="dark">
        {loadError ? error(loadError) : t("common.loading")}
      </div>
    );
  return <DisplayScreen view={view} offsetMs={offsetMs} />;
}

/** `/display/:id`: the public display window. Read-only: it never dispatches. */
export function DisplayRoute() {
  const { id = "" } = useParams();
  // The desktop host may point an open display at another tournament: start over then.
  return <DisplayWindow key={id} id={id} />;
}
