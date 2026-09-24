import type { Level } from "../../engine/types";
import { useI18n, type I18n } from "../../i18n";
import { Button } from "../components/Button";
import { Card, Section } from "../components/Card";
import { Callout } from "../components/Callout";
import { Pill } from "../components/Pill";
import { Table } from "../components/Table";
import { useClock } from "../hooks/useClock";
import { useTournament } from "../TournamentContext";
import { anteLabel, blindsLabel } from "../utils/labels";

const MINUTE_MS = 60_000;

function levelName(i18n: I18n, level: Level, playLevel: number | null): string {
  return level.type === "break" ? i18n.t("clock.breakLabel") : i18n.t("clock.levelLabel", { n: playLevel ?? 0 });
}

function levelBlinds(i18n: I18n, level: Level): string {
  if (level.type === "break") return i18n.t("common.none");
  return [blindsLabel(i18n, level.sb, level.bb), anteLabel(i18n, level.ante)].filter(Boolean).join("  ");
}

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
  const state = finished ? "finished" : clock.running ? "running" : view.phase === "setup" ? "setup" : "paused";

  return (
    <div className="clock-layout">
      <Card className="clock-hero" data-state={state} data-break={clock.isBreak || undefined}>
        <div className="clock-hero-main">
          <div className="clock-hero-head">
            <h2 className="clock-hero-level">{current ? levelName(i18n, current.level, current.playLevel) : t("common.none")}</h2>
            {state === "running" && (
              <Pill tone="success" dot pulse>
                {t("header.running")}
              </Pill>
            )}
            {state === "paused" && (
              <Pill tone="danger" dot>
                {t("header.paused")}
              </Pill>
            )}
            {state === "setup" && <Pill tone="neutral">{t("header.notStarted")}</Pill>}
            {state === "finished" && <Pill tone="neutral">{t("header.finished")}</Pill>}
          </div>
          <p className="clock-time">{i18n.duration(local.remainingMs)}</p>
          {local.overtimeMs > 0 && <p className="clock-overtime">{t("clock.overtime", { duration: i18n.duration(local.overtimeMs) })}</p>}
          <p className="clock-hero-blinds">{current && current.level.type === "play" ? levelBlinds(i18n, current.level) : " "}</p>
        </div>

        <dl className="clock-facts">
          <div>
            <dt>{t("clock.next")}</dt>
            <dd>
              {clock.next
                ? `${levelName(i18n, clock.next.level, clock.next.playLevel)}  ${clock.next.level.type === "play" ? levelBlinds(i18n, clock.next.level) : t("clock.minutes", { count: Math.round(clock.next.level.durationMs / MINUTE_MS) })}`
                : t("clock.none")}
            </dd>
          </div>
          <div>
            <dt>{t("clock.breakIn")}</dt>
            <dd>{clock.nextBreakInMs !== null ? i18n.duration(since(clock.nextBreakInMs)) : t("clock.noBreakLeft")}</dd>
          </div>
          <div>
            <dt>{t("clock.endsIn")}</dt>
            <dd>{i18n.duration(since(clock.structureEndsInMs))}</dd>
          </div>
        </dl>

        {!finished && (
          <div className="clock-controls">
            {clock.running ? (
              <Button size="lg" icon="pause" onClick={() => void run({ type: "pause_clock" })}>
                {t("header.pause")}
              </Button>
            ) : (
              <Button size="lg" variant="primary" icon="play" onClick={() => void run({ type: "start_clock" })}>
                {t("header.start")}
              </Button>
            )}
            <span className="clock-controls-group">
              <Button icon="skipBack" onClick={() => void run({ type: "prev_level" })}>
                {t("clock.previous")}
              </Button>
              <Button icon="skipForward" onClick={() => void run({ type: "next_level" })}>
                {t("clock.nextLevel")}
              </Button>
            </span>
            <span className="clock-controls-group">
              <Button onClick={() => void run({ type: "adjust_time", deltaMs: -MINUTE_MS })}>{t("clock.minusMinute")}</Button>
              <Button onClick={() => void run({ type: "adjust_time", deltaMs: MINUTE_MS })}>{t("clock.plusMinute")}</Button>
            </span>
            <Button icon="coffee" onClick={() => void run({ type: "jump_to_next_break" })}>
              {t("clock.nextBreak")}
            </Button>
          </div>
        )}

        {clockWarnings.map((warning) => (
          <Callout key={warning.code} tone="warning" role="status">
            {i18n.warning(warning)}
          </Callout>
        ))}
      </Card>

      <Section title={t("clock.schedule")} flush>
        <Table caption={t("clock.schedule")} density="compact">
          <thead>
            <tr>
              <th scope="col">{t("structure.level")}</th>
              <th scope="col">{t("clock.blindsLabel")}</th>
              <th scope="col" className="num">
                {t("structure.minutes")}
              </th>
              <th scope="col" className="num">
                {t("clock.starts")}
              </th>
            </tr>
          </thead>
          <tbody>
            {clock.schedule.map((boundary) => {
              const row = levels[boundary.levelIndex];
              const isBreak = row?.level.type === "break";
              return (
                <tr key={boundary.levelIndex} className={isBreak ? "is-break" : undefined}>
                  <th scope="row" className="strong">
                    {row ? levelName(i18n, row.level, row.playLevel) : t("common.none")}
                  </th>
                  <td>{row ? levelBlinds(i18n, row.level) : t("common.none")}</td>
                  <td className="num muted">{row ? Math.round(row.level.durationMs / MINUTE_MS) : t("common.none")}</td>
                  <td className="num">
                    {boundary.startsAtMs !== null
                      ? t("clock.startsAt", { time: i18n.timeOfDay(boundary.startsAtMs - offsetMs) })
                      : t("clock.startsIn", { duration: i18n.duration(boundary.startsInMs) })}
                  </td>
                </tr>
              );
            })}
            <tr>
              <th scope="row" className="strong">
                {t("clock.endOfStructure")}
              </th>
              <td />
              <td />
              <td className="num">
                {clock.running
                  ? t("clock.startsAt", { time: i18n.timeOfDay(view.generatedAtMs + clock.structureEndsInMs - offsetMs) })
                  : t("clock.startsIn", { duration: i18n.duration(clock.structureEndsInMs) })}
              </td>
            </tr>
          </tbody>
        </Table>
      </Section>
    </div>
  );
}
