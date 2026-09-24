import type { View } from "../../engine/types";
import { useI18n } from "../../i18n";
import { useClock } from "../hooks/useClock";
import { anteLabel, blindsLabel } from "../utils/labels";
import { Button } from "./Button";

type PodState = "setup" | "running" | "paused" | "overtime" | "finished";

/**
 * The app icon's chip-clock as a live dial: the amber wedge is the part of the level already
 * played. Grey while paused, periwinkle during a break.
 */
export function ChipDial({ progress, size = 40 }: { progress: number; size?: number }) {
  const p = Math.min(1, Math.max(0, progress));
  const r = 12.5;
  const angle = p * 2 * Math.PI;
  const x = 20 + r * Math.sin(angle);
  const y = 20 - r * Math.cos(angle);
  const wedge =
    p >= 0.999 ? (
      <circle cx="20" cy="20" r={r} className="dial-wedge" />
    ) : p > 0.001 ? (
      <path d={`M20 20 L20 ${20 - r} A${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`} className="dial-wedge" />
    ) : null;
  return (
    <svg className="dial" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="19.5" className="dial-edge" />
      {/* Six edge inserts, as on the chip of the icon. */}
      <circle cx="20" cy="20" r="17.25" className="dial-inserts" strokeDasharray="6 12.06" transform="rotate(-100 20 20)" />
      <circle cx="20" cy="20" r="14.25" className="dial-face" />
      {wedge}
      {p > 0.001 && p < 0.999 && <line x1="20" y1="20" x2={x.toFixed(2)} y2={y.toFixed(2)} className="dial-hand" />}
      <circle cx="20" cy="20" r="2" className="dial-pin" />
    </svg>
  );
}

/**
 * The header's clock: level and blinds, time left and Start/Pause, always in view. Its own
 * component so that only it re-renders as the clock ticks; tabular digits and fixed widths
 * keep it from shifting.
 */
export function ClockPod({ view, offsetMs, onStart, onPause }: { view: View; offsetMs: number; onStart(): void; onPause(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const local = useClock(view, offsetMs);
  const { clock, phase } = view;
  const finished = phase === "finished";

  const state: PodState = finished ? "finished" : clock.running ? (local.overtimeMs > 0 ? "overtime" : "running") : phase === "setup" ? "setup" : "paused";
  const stateLabel = {
    setup: t("header.notStarted"),
    running: t("header.running"),
    paused: t("header.paused"),
    overtime: t("header.overtime"),
    finished: t("header.finished")
  }[state];

  const progress = finished ? 1 : clock.durationMs > 0 ? 1 - local.remainingMs / clock.durationMs : 0;
  const title = finished ? t("header.finished") : clock.isBreak ? t("clock.breakLabel") : t("clock.levelLabel", { n: clock.playLevel ?? 0 });

  let detail: string | null = null;
  if (!finished && !clock.isBreak && clock.sb !== null && clock.bb !== null) {
    detail = [blindsLabel(i18n, clock.sb, clock.bb), anteLabel(i18n, clock.ante)].filter(Boolean).join("  ");
  } else if (!finished && clock.isBreak && clock.next?.level.type === "play") {
    detail = `${t("clock.next")} ${blindsLabel(i18n, clock.next.level.sb, clock.next.level.bb)}`;
  } else if (finished && view.winner !== null) {
    detail = view.ranking.find((row) => row.player === view.winner)?.name ?? null;
  }

  return (
    <div className="clock-pod" role="group" aria-label={t("header.clock")} data-state={state} data-break={clock.isBreak || undefined}>
      <ChipDial progress={progress} />
      <div className="clock-pod-level">
        <span className="clock-pod-title">
          <span className="clock-pod-name">{title}</span>
          {!finished && <span className="clock-pod-state">{stateLabel}</span>}
        </span>
        {detail && <span className="clock-pod-detail">{detail}</span>}
      </div>
      {!finished && (
        <>
          <span className="clock-pod-time">{i18n.duration(local.remainingMs)}</span>
          {clock.running ? (
            <Button icon="pause" onClick={onPause} className="clock-pod-toggle">
              {t("header.pause")}
            </Button>
          ) : (
            <Button icon="play" variant="primary" onClick={onStart} className="clock-pod-toggle">
              {t("header.start")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
