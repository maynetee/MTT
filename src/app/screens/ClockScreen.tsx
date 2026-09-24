import { useI18n } from "../../i18n";
import { useClock } from "../hooks/useClock";
import { useTournament } from "../TournamentContext";
import { levelLabel } from "../utils/labels";

const MINUTE_MS = 60_000;

export default function ClockScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const { view, offsetMs, run } = useTournament();
  const local = useClock(view, offsetMs);
  const { clock, levels } = view;
  const current = levels[clock.levelIndex];
  const finished = view.phase === "finished";
  const since = (ms: number) => Math.max(0, ms - local.elapsedMs);
  const clockWarnings = view.warnings.filter((warning) => warning.code === "STRUCTURE_ENDING" || warning.code === "STRUCTURE_EXHAUSTED");

  return (
    <div className="clock-screen">
      <div className="card">
        <div className="clock-grid">
          <div>
            <div className="stat-label">{t("clock.remaining")}</div>
            <div className="clock-time">{i18n.duration(local.remainingMs)}</div>
            {local.overtimeMs > 0 && <div className="warning-text">{t("clock.overtime", { duration: i18n.duration(local.overtimeMs) })}</div>}
          </div>
          <div>
            <div className="stat-label">{t("clock.current")}</div>
            <div className="clock-level">{current ? levelLabel(i18n, current.level, current.playLevel) : t("common.none")}</div>
          </div>
          <div>
            <div className="stat-label">{t("clock.next")}</div>
            <div className="clock-level">{clock.next ? levelLabel(i18n, clock.next.level, clock.next.playLevel) : t("common.none")}</div>
          </div>
        </div>

        {!finished && (
          <div className="button-row">
            {clock.running ? (
              <button className="btn primary" onClick={() => void run({ type: "pause_clock" })}>
                {t("header.pause")}
              </button>
            ) : (
              <button className="btn primary" onClick={() => void run({ type: "start_clock" })}>
                {t("header.start")}
              </button>
            )}
            <button className="btn" onClick={() => void run({ type: "prev_level" })}>
              {t("clock.previous")}
            </button>
            <button className="btn" onClick={() => void run({ type: "next_level" })}>
              {t("clock.nextLevel")}
            </button>
            <button className="btn" onClick={() => void run({ type: "adjust_time", deltaMs: -MINUTE_MS })}>
              {t("clock.minusMinute")}
            </button>
            <button className="btn" onClick={() => void run({ type: "adjust_time", deltaMs: MINUTE_MS })}>
              {t("clock.plusMinute")}
            </button>
            <button className="btn" onClick={() => void run({ type: "jump_to_next_break" })}>
              {t("clock.nextBreak")}
            </button>
          </div>
        )}

        <div className="muted">
          {[
            clock.nextBreakInMs !== null ? t("clock.nextBreakIn", { duration: i18n.duration(since(clock.nextBreakInMs)) }) : t("clock.noBreakLeft"),
            t("clock.structureEndsIn", { duration: i18n.duration(since(clock.structureEndsInMs)) })
          ].join(" · ")}
        </div>
        {clockWarnings.map((warning) => (
          <div key={warning.code} className="warning-banner" role="status">
            {i18n.warning(warning)}
          </div>
        ))}
      </div>

      <div className="card">
        <h3>{t("clock.schedule")}</h3>
        <div className="list">
          {clock.schedule.map((boundary) => {
            const row = levels[boundary.levelIndex];
            return (
              <div key={boundary.levelIndex} className="list-row">
                <span>{row ? levelLabel(i18n, row.level, row.playLevel) : t("common.none")}</span>
                <span className="muted">
                  {boundary.startsAtMs !== null
                    ? t("clock.startsAt", { time: i18n.timeOfDay(boundary.startsAtMs - offsetMs) })
                    : t("clock.startsIn", { duration: i18n.duration(boundary.startsInMs) })}
                </span>
              </div>
            );
          })}
          <div className="list-row">
            <span>{t("clock.endOfStructure")}</span>
            <span className="muted">
              {clock.running
                ? t("clock.startsAt", { time: i18n.timeOfDay(view.generatedAtMs + clock.structureEndsInMs - offsetMs) })
                : t("clock.startsIn", { duration: i18n.duration(clock.structureEndsInMs) })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
