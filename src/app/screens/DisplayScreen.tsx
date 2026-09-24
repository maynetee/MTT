import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { toEngineError, type Ante, type LevelRow, type View } from "../../engine/types";
import { useI18n, type I18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { Icon } from "../components/Icon";
import { useEngine } from "../EngineContext";
import { useClock, type LocalClock } from "../hooks/useClock";
import { useTournamentView } from "../hooks/useTournamentView";
import { useLevelSounds } from "../sound/useLevelSounds";
import { useTournament } from "../TournamentContext";
import { anteLabel, blindsLabel } from "../utils/labels";
import { displayState, finalPlaces, formatMoney, payoutLadder, type DisplayState } from "./DisplayModel";

/** How long the exit control stays visible after the mouse stops moving. */
export const EXIT_CONTROL_HIDE_DELAY_MS = 3000;
/** Payout rows that fit the rail under the field statistics. */
export const LADDER_ROWS = 8;
/** Upcoming levels listed when there are no payouts to show. */
export const SCHEDULE_ROWS = 6;
/** Places listed on the winner screen. */
export const FINAL_PLACES = 10;
const LAST_MINUTE_MS = 60_000;

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

/**
 * The time in fixed-width cells, one per character: as the seconds tick nothing around it
 * moves, whatever the digits (tabular figures, and cells of the same width on top).
 */
function Digits({ text }: { text: string }) {
  return (
    <>
      {[...text].map((char, index) => (
        <span key={index} className={/\d/.test(char) ? "tv-digit" : char === ":" ? "tv-sep" : "tv-sign"}>
          {char}
        </span>
      ))}
    </>
  );
}

interface Part {
  text: string;
  muted?: boolean;
  /** A figure that ticks: tabular, so the line does not move. */
  ticking?: boolean;
}

/** `Level 8  500/1,000  BBA 1,000`, or `Break  10 min`, as separate parts. */
function levelParts(i18n: I18n, row: LevelRow): Part[] {
  const { level } = row;
  if (level.type === "break") {
    return [{ text: i18n.t("display.break") }, { text: i18n.t("clock.minutes", { count: Math.round(level.durationMs / 60_000) }), muted: true }];
  }
  const ante = anteLabel(i18n, level.ante);
  return [
    { text: i18n.t("display.level", { n: row.playLevel ?? 0 }), muted: true },
    { text: blindsLabel(i18n, level.sb, level.bb) },
    ...(ante ? [{ text: ante, muted: true }] : [])
  ];
}

/**
 * The largest size (in --u, up to `max`) at which a line fits `room` --u, from its width in em
 * estimated from its characters. No measuring: a long line of blinds shrinks instead of wrapping.
 */
function fit(max: number, room: number, widthEm: number): string {
  return Math.min(max, room / Math.max(widthEm, 1)).toFixed(2);
}

/** Inter's figures and punctuation average about 0.56em. */
const CHAR_EM = 0.56;

/** Blinds and ante on one line, as large as the column allows. */
function Blinds({ label, sb, bb, ante }: { label: string; sb: number; bb: number; ante: Ante }) {
  const i18n = useI18n();
  const blinds = blindsLabel(i18n, sb, bb);
  const anteText = anteLabel(i18n, ante);
  // The ante is set at 0.53 of the blinds' size, after a gap of about a third of an em.
  const width = CHAR_EM * blinds.length + (anteText ? 0.53 * CHAR_EM * anteText.length + 0.33 : 0);
  return (
    <div className="tv-blinds" style={{ "--blinds-size": fit(6.8, 54, width) } as CSSProperties}>
      <span className="tv-blinds-label">{label}</span>
      <span className="tv-blinds-value">{blinds}</span>
      {anteText && <span className="tv-blinds-ante">{anteText}</span>}
    </div>
  );
}

/** What comes next, on one line: the next level, the next break, a color-up. */
function Upcoming({ items }: { items: Array<{ label: string | null; parts: Part[] }> }) {
  if (items.length === 0) return null;
  // Labels are set at 0.7 of the line's size; parts 0.52em apart, items 2.2em apart.
  const chars = (parts: Part[]) => parts.reduce((sum, part) => sum + part.text.length, 0);
  const width = items.reduce(
    (sum, item) => sum + CHAR_EM * chars(item.parts) + 0.52 * (item.parts.length - 1) + (item.label ? 0.7 * CHAR_EM * item.label.length + 0.6 : 0),
    2.2 * (items.length - 1)
  );
  return (
    <dl className="tv-upcoming" style={{ "--upcoming-size": fit(2.3, 54, width) } as CSSProperties}>
      {items.map((item, index) => (
        <div key={index}>
          {item.label && <dt>{item.label}</dt>}
          <dd>
            {item.parts.map((part, partIndex) => (
              <span key={partIndex} className={[part.muted ? "tv-muted" : "", part.ticking ? "tv-ticking" : ""].join(" ").trim() || undefined}>
                {part.text}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StateBadge({ state, lastLevel }: { state: DisplayState; lastLevel: boolean }) {
  const { t } = useI18n();
  if (state === "paused") {
    return (
      <span className="tv-badge tv-badge--paused">
        <Icon name="pause" />
        {t("display.paused")}
      </span>
    );
  }
  if (state === "setup") return <span className="tv-badge">{t("display.notStarted")}</span>;
  if (state === "overtime") return <span className="tv-badge tv-badge--warning">{t("display.overtime")}</span>;
  if (lastLevel) return <span className="tv-badge tv-badge--warning">{t("display.lastLevel")}</span>;
  return null;
}

/** Late registration: open with its countdown, or closed. */
function Registration({ view, local }: { view: View; local: LocalClock }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { registration } = view;
  if (view.phase === "setup") {
    return (
      <p className="tv-reg" data-open="">
        <span className="tv-reg-title">{t("display.registrationOpen")}</span>
      </p>
    );
  }
  if (!registration.open) {
    return (
      <p className="tv-reg">
        <span className="tv-reg-title">{t("display.registrationClosed")}</span>
      </p>
    );
  }
  const closesInMs = registration.closesInMs === null ? null : Math.max(0, registration.closesInMs - local.elapsedMs);
  return (
    <p className="tv-reg" data-open="">
      <span className="tv-reg-title">{t("display.lateRegOpen")}</span>
      {closesInMs !== null && <span className="tv-reg-detail">{t("display.lateRegClosesIn", { duration: i18n.duration(closesInMs) })}</span>}
    </p>
  );
}

/** Where the field stands against the places paid. */
function MoneyBand({ view }: { view: View }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { itm, money } = view;
  const [text, hint] =
    itm.status === "in_money"
      ? [t("display.inMoney"), money && itm.nextPayout !== undefined ? t("display.nextPayout", { amount: formatMoney(i18n.locale, itm.nextPayout, money.currency) }) : null]
      : itm.status === "bubble"
        ? [t("display.bubble"), t("display.bubbleHint")]
        : [t("display.toMoney", { count: itm.toMoney }), null];
  return (
    <div className="tv-band" data-itm={itm.status} role="status">
      <span className="tv-band-text">{text}</span>
      {hint && <span className="tv-band-hint">{hint}</span>}
    </div>
  );
}

/** A figure in a half-width column of the rail: longer numbers get a smaller size. */
function Figure({ value }: { value: string }) {
  return (
    <span className="tv-stat-value" style={{ "--chars": value.length } as CSSProperties}>
      {value}
    </span>
  );
}

/**
 * The next levels with when they start: a time of day while the clock runs, a time still to
 * play while it is paused. Neither changes with the seconds.
 */
function ComingUp({ view }: { view: View }) {
  const i18n = useI18n();
  const { t } = i18n;
  const rows = view.clock.schedule.slice(0, SCHEDULE_ROWS);
  if (rows.length === 0) return null;
  return (
    <section className="tv-schedule" aria-label={t("display.comingUp")}>
      <h2 className="tv-rail-title">{t("display.comingUp")}</h2>
      <ol className="tv-ladder">
        {rows.map((boundary) => {
          const row = view.levels[boundary.levelIndex];
          const { level } = row;
          return (
            <li key={boundary.levelIndex} className="tv-ladder-row" data-break={level.type === "break" || undefined}>
              <span className="tv-schedule-level">{level.type === "break" ? t("display.break") : t("display.level", { n: row.playLevel ?? 0 })}</span>
              {/* Blinds only: the ante of the next level is on the main column. */}
              <span className="tv-schedule-blinds">
                {level.type === "break" ? t("clock.minutes", { count: Math.round(level.durationMs / 60_000) }) : blindsLabel(i18n, level.sb, level.bb)}
              </span>
              <span className="tv-ladder-amount">
                {boundary.startsAtMs !== null ? i18n.timeOfDay(boundary.startsAtMs) : t("display.startsIn", { duration: i18n.duration(boundary.startsInMs) })}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The field and the money; changes only with the view, not with the seconds. */
const Rail = memo(function Rail({ view }: { view: View }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { counts, chips, money } = view;
  const reentries = counts.reentries ?? 0;
  return (
    <aside className="tv-rail">
      <dl className="tv-stats">
        <div className="tv-stat tv-stat--lead">
          <dt>{t("display.players")}</dt>
          <dd>
            <Figure value={i18n.number(counts.alive)} />
            <span className="tv-stat-aside">{t("display.ofEntries", { count: counts.entries })}</span>
            {reentries > 0 && <span className="tv-stat-aside">{t("display.reentries", { count: reentries })}</span>}
          </dd>
        </div>
        {chips.avgStack !== null && (
          <div className="tv-stat tv-stat--lead">
            <dt>{t("display.averageStack")}</dt>
            <dd>
              <Figure value={i18n.number(chips.avgStack)} />
              {chips.avgStackBbX100 !== null && <span className="tv-stat-aside">{t("display.bigBlinds", { bb: i18n.bigBlinds(chips.avgStackBbX100) })}</span>}
            </dd>
          </div>
        )}
        <div className="tv-stat">
          <dt>{t("display.chipsInPlay")}</dt>
          <dd>
            <span className="tv-stat-value">{i18n.number(chips.inPlay)}</span>
          </dd>
        </div>
        {!money && (
          <div className="tv-stat">
            <dt>{t("display.placesPaidLabel")}</dt>
            <dd>
              <span className="tv-stat-value">{i18n.number(view.placesPaid)}</span>
            </dd>
          </div>
        )}
      </dl>

      {/* Without payouts to show, the rail has room for the levels to come. */}
      {!money && <ComingUp view={view} />}

      {money && (
        <section className="tv-money" aria-label={t("display.payouts")}>
          <div className="tv-pool">
            <span className="tv-pool-label">{t("display.prizePool")}</span>
            <span className="tv-pool-label">{t("display.placesPaid", { count: view.placesPaid })}</span>
            <span className="tv-pool-value">{formatMoney(i18n.locale, money.effectivePool, money.currency)}</span>
            {money.guarantee !== null && money.overlay > 0 && (
              <span className="tv-pool-note">{t("display.guarantee", { amount: formatMoney(i18n.locale, money.guarantee, money.currency) })}</span>
            )}
          </div>
          <ol className="tv-ladder">
            {payoutLadder(view, LADDER_ROWS).map((entry) =>
              "gap" in entry ? (
                <li key="gap" className="tv-ladder-gap" aria-hidden="true">
                  ⋯
                </li>
              ) : (
                <li key={entry.place} className="tv-ladder-row" data-mark={entry.mark ?? undefined}>
                  <span className="tv-ladder-place">{entry.place}</span>
                  {entry.mark && <span className="tv-ladder-tag">{t(entry.mark === "next" ? "display.nextOut" : "display.minCash")}</span>}
                  <span className="tv-ladder-amount">{formatMoney(i18n.locale, entry.amount, money.currency)}</span>
                </li>
              )
            )}
          </ol>
        </section>
      )}
    </aside>
  );
});

/** The tournament is over: the winner, and the final places. */
function WinnerStage({ view }: { view: View }) {
  const i18n = useI18n();
  const { t } = i18n;
  const winner = view.ranking.find((row) => row.player === view.winner) ?? null;
  const money = view.money;
  const places = finalPlaces(view, FINAL_PLACES);
  return (
    <>
      <div className="tv-main">
        <header className="tv-top">
          <h1 className="tv-name">{view.config.name}</h1>
        </header>
        <section className="tv-winner">
          <p className="tv-winner-label">{t("display.winner")}</p>
          {/* Long names get a smaller size, so any name fits on one line. */}
          <p className="tv-winner-name" style={{ "--name-length": Math.max(8, winner?.name.length ?? 8) } as CSSProperties}>
            {winner?.name}
          </p>
          {money && winner?.prize !== undefined && <p className="tv-winner-prize">{formatMoney(i18n.locale, winner.prize, money.currency)}</p>}
        </section>
      </div>
      <aside className="tv-rail">
        <h2 className="tv-rail-title">{t("display.finalResults")}</h2>
        <ol className="tv-results">
          {places.map((row) => (
            <li key={row.player} className="tv-results-row" data-winner={row.player === view.winner || undefined}>
              <span className="tv-ladder-place">{row.placeTo !== null ? `${row.place}–${row.placeTo}` : row.place}</span>
              <span className="tv-results-name">{row.name}</span>
              {money && row.prize !== undefined && <span className="tv-ladder-amount">{formatMoney(i18n.locale, row.prize, money.currency)}</span>}
            </li>
          ))}
        </ol>
      </aside>
    </>
  );
}

interface DisplayProps {
  view: View;
  offsetMs: number;
  preview?: boolean;
  /** Invites a click: the browser keeps this window silent until one. */
  soundLocked?: boolean;
}

export default function DisplayScreen({ view, offsetMs, preview = false, soundLocked = false }: DisplayProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const engine = useEngine();
  const close = () => engine.closeCurrentWindow().catch((error: unknown) => console.error("Could not close the display", error));
  const exitVisible = useExitControl(!preview, close);
  const local = useClock(view, offsetMs);

  const { clock } = view;
  const state = displayState(view, local);
  const current = view.levels[clock.levelIndex] ?? null;
  const lastLevel = clock.next === null;
  const overtime = state === "overtime";
  const lastMinute = state === "running" && local.remainingMs <= LAST_MINUTE_MS;
  // Time left rounds up (00:01 until the very end); overtime counts whole seconds past it.
  const time = overtime ? `+${i18n.duration(Math.floor(local.overtimeMs / 1000) * 1000)}` : i18n.duration(local.remainingMs);
  const progress = clock.durationMs > 0 ? Math.min(1, Math.max(0, 1 - local.remainingMs / clock.durationMs)) : 0;
  const breakInMs = clock.nextBreakInMs === null || clock.isBreak || clock.next?.level.type === "break" ? null : Math.max(0, clock.nextBreakInMs - local.elapsedMs);
  const colorUp = current?.level.type === "break" ? current.level.colorUp : null;
  // During a break, the blinds that matter are the next level's.
  const blindsRow = clock.isBreak ? (clock.next?.level.type === "play" ? clock.next : null) : current;
  const upcoming: Array<{ label: string | null; parts: Part[] }> = [];
  if (!clock.isBreak && clock.next) upcoming.push({ label: t("display.next"), parts: levelParts(i18n, clock.next) });
  if (breakInMs !== null) upcoming.push({ label: t("display.breakIn"), parts: [{ text: i18n.duration(breakInMs), ticking: true }] });
  if (colorUp !== null) upcoming.push({ label: null, parts: [{ text: t("display.colorUp", { chip: i18n.number(colorUp) }) }] });
  if (overtime) upcoming.push({ label: null, parts: [{ text: t("display.structureEnded") }] });

  return (
    // The TV display stays dark whatever the director's theme: it faces a dim room.
    <div className={preview ? "tv-frame tv-frame--preview" : "tv-frame"} data-theme="dark">
      <div className="tv" data-state={state} data-break={(clock.isBreak && state !== "finished") || undefined} data-last-minute={lastMinute || undefined}>
        {exitVisible && (
          <button type="button" className="tv-exit" onClick={close}>
            {t("display.exit")} <kbd>{t("display.exitKey")}</kbd>
          </button>
        )}
        {state === "finished" ? (
          <WinnerStage view={view} />
        ) : (
          <>
            <div className="tv-main">
              <header className="tv-top">
                <h1 className="tv-name">{view.config.name}</h1>
                <Registration view={view} local={local} />
              </header>

              <section className="tv-clock">
                <div className="tv-level">
                  <h2 className="tv-level-name">{clock.isBreak ? t("display.break") : t("display.level", { n: clock.playLevel ?? 0 })}</h2>
                  <StateBadge state={state} lastLevel={lastLevel} />
                </div>
                <div className="tv-time" role="timer" aria-label={overtime ? t("display.timeOver") : t("display.timeLeft")} data-long={time.length > 5 || undefined}>
                  <Digits text={time} />
                </div>
                <div className="tv-progress" aria-hidden="true">
                  <span className="tv-progress-fill" style={{ transform: `scaleX(${overtime ? 1 : progress})` }} />
                </div>
                {blindsRow && blindsRow.level.type === "play" && (
                  <Blinds
                    label={clock.isBreak ? t("display.afterBreak", { n: blindsRow.playLevel ?? 0 }) : t("display.blinds")}
                    sb={blindsRow.level.sb}
                    bb={blindsRow.level.bb}
                    ante={blindsRow.level.ante}
                  />
                )}
                <Upcoming items={upcoming} />
              </section>

              {view.phase === "running" && <MoneyBand view={view} />}
            </div>
            <Rail view={view} />
          </>
        )}
        {soundLocked && (
          <p className="tv-sound-hint">
            <Icon name="volume" size={20} />
            {t("display.enableSound")}
          </p>
        )}
      </div>
    </div>
  );
}

/** The Display tab of the director window. */
export function DisplayPreview() {
  const { t } = useI18n();
  const engine = useEngine();
  const { view, offsetMs, report } = useTournament();
  return (
    <Section
      title={t("display.preview")}
      description={t("display.previewHint")}
      actions={
        <Button icon="external" onClick={() => void engine.openDisplayWindow(view.id).catch((error: unknown) => report(toEngineError(error)))}>
          {t("display.openWindow")}
        </Button>
      }
    >
      <div className="display-wrapper">
        <DisplayScreen view={view} offsetMs={offsetMs} preview />
      </div>
    </Section>
  );
}

function DisplayWindow({ id }: { id: string }) {
  const { t, error } = useI18n();
  const { view, offsetMs, loadError } = useTournamentView(id);
  const sound = useLevelSounds(view, offsetMs, "display");
  if (!view)
    return (
      <div className="tv-frame" data-theme="dark">
        <p className="tv-loading">{loadError ? error(loadError) : t("common.loading")}</p>
      </div>
    );
  return <DisplayScreen view={view} offsetMs={offsetMs} soundLocked={sound.needsUnlock} />;
}

/** `/display/:id`: the public display window. Read-only: it never dispatches. */
export function DisplayRoute() {
  const { id = "" } = useParams();
  // The desktop host may point an open display at another tournament: start over then.
  return <DisplayWindow key={id} id={id} />;
}
