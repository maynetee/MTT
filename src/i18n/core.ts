import type { ActionLabel } from "../bindings/ActionLabel";
import type { Warning } from "../bindings/Warning";
import type { EngineError } from "../engine/types";
import { en } from "./en";
import { createTranslate, lookup, type MessageKeys, type MessageTree, type Params } from "./translate";

export type { Params } from "./translate";

export type Locale = "en";
export type MessageKey = MessageKeys<typeof en>;

const dictionaries: Record<Locale, MessageTree> = { en };

/** Resolves a player id to a name, for messages about players. */
export type PlayerNames = (player: number) => string | undefined;

/** Clock-style duration: `12:34`, or `1:02:03` from one hour. Rounds up to the second. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface I18n {
  locale: Locale;
  t(key: MessageKey, params?: Params): string;
  /** For keys built at runtime (error codes, event kinds); returns the key when missing. */
  tDynamic(key: string, params?: Params): string;
  has(key: string): boolean;
  number(value: number): string;
  duration(ms: number): string;
  /** `90 min`, `2 hr`: a duration in words, for messages. */
  durationWords(ms: number): string;
  timeOfDay(ms: number): string;
  dateTime(ms: number): string;
  /** Average stack in big blinds, from the view's value times 100. */
  bigBlinds(x100: number): string;
  list(items: readonly string[]): string;
  error(error: EngineError, names?: PlayerNames): string;
  warning(warning: Warning): string;
  action(label: ActionLabel): string;
}

export function createI18n(locale: Locale = "en"): I18n {
  const tree = dictionaries[locale];
  const translate = createTranslate(tree, locale);
  const numbers = new Intl.NumberFormat(locale);
  const bb = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const times = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const lists = new Intl.ListFormat(locale, { type: "conjunction" });
  const unit = (value: number, name: "hour" | "minute" | "second") =>
    new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "short", maximumFractionDigits: 1 }).format(value);

  const durationWords = (ms: number) => {
    if (ms >= 3_600_000 && ms % 3_600_000 === 0) return unit(ms / 3_600_000, "hour");
    if (ms >= 60_000) return unit(Math.round(ms / 6_000) / 10, "minute");
    return unit(Math.round(ms / 1000), "second");
  };

  /** Adds derived, display-ready parameters to an error's or warning's raw params. */
  const displayParams = (raw: Record<string, unknown>, names?: PlayerNames): Params => {
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "number" || typeof value === "string") params[key] = value;
      if (typeof value === "number" && key.endsWith("Ms")) params[key.slice(0, -2)] = durationWords(value);
    }
    // Structure indexes are 0-based; the UI numbers rows from 1.
    if (typeof raw.index === "number") params.row = raw.index + 1;
    if (typeof raw.level === "number") params.row = raw.level + 1;
    if (typeof raw.level === "number" && typeof raw.max === "number") params.rows = raw.max + 1;
    if (typeof raw.player === "number") params.player = names?.(raw.player) ?? `#${raw.player}`;
    if (typeof raw.field === "string" && lookup(tree, `config.${raw.field}`)) {
      params.field = translate(`config.${raw.field}`);
    }
    if (typeof raw.levelsLeft === "number") params.count = raw.levelsLeft;
    return params;
  };

  return {
    locale,
    t: (key, params) => translate(key, params),
    tDynamic: (key, params) => translate(key, params),
    has: (key) => lookup(tree, key) !== undefined,
    number: (value) => numbers.format(value),
    duration: formatDuration,
    durationWords,
    timeOfDay: (ms) => times.format(new Date(ms)),
    dateTime: (ms) => dates.format(new Date(ms)),
    bigBlinds: (x100) => bb.format(x100 / 100),
    list: (items) => lists.format(items),
    error(error, names) {
      const key = `errors.${error.code}`;
      const params = "params" in error ? displayParams(error.params as Record<string, unknown>, names) : {};
      if (lookup(tree, key) === undefined) return translate("errors.HOST_ERROR", { message: error.code });
      return translate(key, params);
    },
    warning(warning) {
      const params = "params" in warning ? displayParams(warning.params as Record<string, unknown>) : {};
      return translate(`warnings.${warning.code}`, params);
    },
    action(label) {
      const key = lookup(tree, `actions.${label.kind}`) ? `actions.${label.kind}` : "actions.unknown";
      return translate(key, { kind: label.kind, names: lists.format(label.names), table: label.table ?? undefined });
    }
  };
}

/** English strings for code outside React (exports). */
export const i18n = createI18n("en");
export const t = i18n.t;
