import type { Ante, Level, RankingRow } from "../../engine/types";
import type { I18n } from "../../i18n";

/** `Ante 50`, `BBA 400`, or null without an ante. */
export function anteLabel(i18n: I18n, ante: Ante): string | null {
  if (ante.type === "none") return null;
  return i18n.t(ante.type === "classic" ? "clock.ante_classic" : "clock.ante_big_blind", { amount: i18n.number(ante.amount) });
}

export function blindsLabel(i18n: I18n, sb: number, bb: number): string {
  return i18n.t("clock.blinds", { sb: i18n.number(sb), bb: i18n.number(bb) });
}

/** `Level 3 · 200/400 · BBA 400`, or `Break · 10 min`. */
export function levelLabel(i18n: I18n, level: Level, playLevel: number | null): string {
  if (level.type === "break") {
    return `${i18n.t("clock.breakLabel")} · ${i18n.t("clock.minutes", { count: Math.round(level.durationMs / 60_000) })}`;
  }
  return [
    i18n.t("clock.levelLabel", { n: playLevel ?? 0 }),
    blindsLabel(i18n, level.sb, level.bb),
    anteLabel(i18n, level.ante)
  ]
    .filter(Boolean)
    .join(" · ");
}

/** `#3`, `#3–4` for a tie, `—` while in play. */
export function formatPlace(row: Pick<RankingRow, "place" | "placeTo">): string {
  if (row.place === null) return "—";
  return row.placeTo !== null ? `#${row.place}–${row.placeTo}` : `#${row.place}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local date and time as `YYYY-MM-DD HH:MM`, independent of the user's locale. */
export function formatTimestamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A ranking is only final once the tournament is finished; otherwise it is a dated snapshot. */
export function rankingTitle(i18n: I18n, finished: boolean, generatedAt: Date): string {
  return finished ? i18n.t("exports.finalRanking") : i18n.t("exports.rankingAt", { timestamp: formatTimestamp(generatedAt) });
}

/** `Winner`, `In play`, `Eliminated`, with the tie and provisional qualifiers. */
export function rankingStatus(i18n: I18n, row: RankingRow, winner: number | null): string {
  if (row.player === winner) return i18n.t("exports.statusWinner");
  if (row.alive) return i18n.t("exports.statusInPlay");
  const qualifiers = [
    row.placeTo !== null && row.place !== null ? i18n.t("exports.tie", { from: row.place, to: row.placeTo }) : null,
    row.provisional ? i18n.t("exports.provisional") : null
  ].filter(Boolean);
  const status = i18n.t("exports.statusEliminated");
  return qualifiers.length > 0 ? `${status} (${qualifiers.join(", ")})` : status;
}
