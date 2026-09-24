import type { Level } from "../../engine/types";
import { useI18n } from "../../i18n";
import { levelLabel } from "../utils/labels";
import { PRESETS, PRESET_SPEEDS, bigBlindAt, summarize, type PresetSpeed } from "../utils/presets";
import { Button } from "./Button";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** Times of the preview: the start, then after two and four hours of play. */
const MARKS_MS = [0, 2 * HOUR_MS, 4 * HOUR_MS];

/** Turbo, Regular and Deepstack, generated from the starting stack. */
export function StructurePresets({ startingStack, onPick }: { startingStack: number; onPick(speed: PresetSpeed): void }) {
  const { t } = useI18n();
  const usable = Number.isFinite(startingStack) && startingStack > 0;
  return (
    <div className="structure-presets" role="group" aria-label={t("presets.title")}>
      <span className="structure-presets-label">{t("presets.title")}</span>
      {PRESET_SPEEDS.map((speed) => (
        <Button key={speed} size="sm" onClick={() => onPick(speed)} disabled={!usable} title={usable ? undefined : t("presets.needsStack")}>
          {t(`presets.${speed}`)}
          <span className="structure-presets-detail">{t("presets.levelMinutes", { minutes: PRESETS[speed].levelMinutes })}</span>
        </Button>
      ))}
    </div>
  );
}

/**
 * What the structure gives: its total duration, and the level in progress at the start and
 * after two and four hours, with the starting stack (the average stack before anyone busts)
 * in big blinds.
 */
export function StructurePreview({ levels, startingStack }: { levels: readonly Level[]; startingStack: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  const summary = summarize(levels);
  const duration = (ms: number) => {
    const minutes = Math.round(ms / MINUTE_MS);
    return t("presets.duration", { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, "0") });
  };
  const inBigBlinds = (bb: number | null) =>
    bb && Number.isFinite(startingStack) && startingStack > 0 ? t("presets.stackInBb", { bb: i18n.bigBlinds(Math.round((startingStack * 100) / bb)) }) : null;

  return (
    <div className="structure-preview">
      <dl className="structure-preview-facts">
        <div>
          <dt>{t("presets.total")}</dt>
          <dd>{duration(summary.totalMs)}</dd>
        </div>
        <div>
          <dt>{t("presets.levels")}</dt>
          <dd>
            {t("presets.levelsCount", { count: summary.playLevels })} · {t("presets.breaksCount", { count: summary.breaks })}
          </dd>
        </div>
        {MARKS_MS.map((ms) => {
          const at = summary.at(ms);
          const stack = at ? inBigBlinds(bigBlindAt(levels, at.index)) : null;
          return (
            <div key={ms}>
              <dt>{ms === 0 ? t("presets.atStart") : t("presets.after", { hours: ms / HOUR_MS })}</dt>
              <dd>
                {at ? levelLabel(i18n, at.level, at.playLevel) : t("presets.over")}
                {stack && <span className="structure-preview-bb">{t(ms === 0 ? "presets.averageStack" : "presets.startingStack", { stack })}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
