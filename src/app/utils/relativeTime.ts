const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Past this, "now" becomes a number of minutes, and so on up the units. */
const STEPS: ReadonlyArray<[limit: number, unit: Intl.RelativeTimeFormatUnit, size: number]> = [
  [45 * SECOND, "second", Infinity],
  [45 * MINUTE, "minute", MINUTE],
  [22 * HOUR, "hour", HOUR],
  [6 * DAY, "day", DAY],
  [4 * WEEK, "week", WEEK],
  [11 * MONTH, "month", MONTH],
  [Infinity, "year", YEAR]
];

const formatters = new Map<string, Intl.RelativeTimeFormat>();

/**
 * `ms` relative to `nowMs` in words for the locale: "now", "5 minutes ago", "yesterday",
 * "last week". Anything within 45 seconds, or slightly ahead (another clock), is "now".
 */
export function relativeTime(ms: number, nowMs: number, locale: string): string {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    formatters.set(locale, formatter);
  }
  const diff = ms - nowMs;
  const [, unit, size] = STEPS.find(([limit]) => Math.abs(diff) < limit)!;
  if (size === Infinity) return formatter.format(0, "second");
  return formatter.format(Math.round(diff / size), unit);
}
