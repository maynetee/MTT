import type { Config, Deadline } from "../../engine/types";
import { useI18n } from "../../i18n";

const MINUTE_MS = 60_000;

/** Integer input value: NaN while empty, so the core rejects it instead of reading 0. */
const integer = (value: string) => (value === "" ? Number.NaN : Math.trunc(Number(value)));
const shown = (value: number | null) => (value === null || Number.isNaN(value) ? "" : value);

/** Fits a number entered in a form into the core's integer type, so the core validates it. */
function fit(value: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), max) : 0;
}

/** The config as sent to the core: empty or out-of-range numbers become values it rejects with a clear error. */
export function sanitizeConfig(config: Config): Config {
  const U8 = 255;
  const U16 = 65_535;
  const lateReg: Deadline =
    config.lateReg.type === "end_of_play_level"
      ? { ...config.lateReg, n: fit(config.lateReg.n, U16) }
      : config.lateReg.type === "elapsed"
        ? { type: "elapsed", ms: fit(config.lateReg.ms, Number.MAX_SAFE_INTEGER) }
        : config.lateReg;
  return {
    ...config,
    seatsPerTable: fit(config.seatsPerTable, U8),
    maxTables: fit(config.maxTables, U16),
    finalTableSize: config.finalTableSize === null ? null : fit(config.finalTableSize, U8),
    balanceTrigger: fit(config.balanceTrigger, U8),
    startingStack: fit(config.startingStack, Number.MAX_SAFE_INTEGER),
    placesPaid: fit(config.placesPaid, U16),
    lateReg
  };
}

interface Props {
  config: Config;
  onChange(config: Config): void;
  /** Once started, seats per table and the starting stack cannot change. */
  started?: boolean;
}

/** Name, tables and seats, places paid, starting stack and balancing settings. */
export function ConfigFields({ config, onChange, started = false }: Props) {
  const { t } = useI18n();
  const set = (changes: Partial<Config>) => onChange({ ...config, ...changes });
  const capacity = (config.seatsPerTable || 0) * (config.maxTables || 0);

  return (
    <>
      <div className="grid-2">
        <label>
          {t("config.name")}
          <input value={config.name} onChange={(event) => set({ name: event.target.value })} />
        </label>
        <label>
          {t("config.placesPaid")}
          <input type="number" min={1} value={shown(config.placesPaid)} onChange={(event) => set({ placesPaid: integer(event.target.value) })} />
        </label>
        <label>
          {t("config.maxTables")}
          <input type="number" min={1} value={shown(config.maxTables)} onChange={(event) => set({ maxTables: integer(event.target.value) })} />
        </label>
        <label title={started ? t("config.lockedHint") : undefined}>
          {t("config.seatsPerTable")}
          <input
            type="number"
            min={2}
            max={12}
            value={shown(config.seatsPerTable)}
            onChange={(event) => set({ seatsPerTable: integer(event.target.value) })}
            disabled={started}
          />
        </label>
        <label title={started ? t("config.lockedHint") : undefined}>
          {t("config.startingStack")}
          <input
            type="number"
            min={1}
            value={shown(config.startingStack)}
            onChange={(event) => set({ startingStack: integer(event.target.value) })}
            disabled={started}
          />
        </label>
        <label>
          {t("config.finalTableSize")}
          <input
            type="number"
            min={2}
            placeholder={t("config.finalTableSizeHint")}
            value={shown(config.finalTableSize)}
            onChange={(event) => set({ finalTableSize: event.target.value === "" ? null : integer(event.target.value) })}
          />
        </label>
        <label>
          {t("config.balanceTrigger")}
          <input
            type="number"
            min={2}
            value={shown(config.balanceTrigger)}
            onChange={(event) => set({ balanceTrigger: integer(event.target.value) })}
          />
        </label>
      </div>
      <div className="pill">{t("config.capacity", { count: capacity })}</div>
    </>
  );
}

type Mode = Deadline["type"];

/** When late registration closes: end of a play level, a play time, or by hand. */
export function LateRegFields({ config, onChange }: Props) {
  const { t } = useI18n();
  const deadline = config.lateReg;
  const set = (lateReg: Deadline) => onChange({ ...config, lateReg });
  // Remember the values of the other modes while switching.
  const level = deadline.type === "end_of_play_level" ? deadline : { n: 6, throughBreak: true };
  const minutes = deadline.type === "elapsed" ? deadline.ms / MINUTE_MS : 120;

  const choose = (mode: Mode) => {
    if (mode === "end_of_play_level") set({ type: mode, n: level.n, throughBreak: level.throughBreak });
    else if (mode === "elapsed") set({ type: mode, ms: Math.round(minutes * MINUTE_MS) });
    else set({ type: "manual" });
  };

  return (
    <div className="late-reg">
      <label className="toggle">
        <input type="radio" name="late-reg" checked={deadline.type === "end_of_play_level"} onChange={() => choose("end_of_play_level")} />
        {t("config.lateReg.endOfLevel")}
        <input
          type="number"
          min={1}
          className="small-input"
          aria-label={t("config.lateReg.endOfLevel")}
          value={shown(level.n)}
          onChange={(event) => set({ type: "end_of_play_level", n: integer(event.target.value), throughBreak: level.throughBreak })}
          disabled={deadline.type !== "end_of_play_level"}
        />
      </label>
      <label className="toggle nested">
        <input
          type="checkbox"
          checked={level.throughBreak}
          onChange={(event) => set({ type: "end_of_play_level", n: level.n, throughBreak: event.target.checked })}
          disabled={deadline.type !== "end_of_play_level"}
        />
        {t("config.lateReg.throughBreak")}
      </label>
      <label className="toggle">
        <input type="radio" name="late-reg" checked={deadline.type === "elapsed"} onChange={() => choose("elapsed")} />
        {t("config.lateReg.elapsed")}
        <input
          type="number"
          min={1}
          className="small-input"
          aria-label={t("config.lateReg.elapsed")}
          value={shown(minutes)}
          onChange={(event) => set({ type: "elapsed", ms: Math.round(integer(event.target.value) * MINUTE_MS) })}
          disabled={deadline.type !== "elapsed"}
        />
        {t("config.lateReg.minutes")}
      </label>
      <label className="toggle">
        <input type="radio" name="late-reg" checked={deadline.type === "manual"} onChange={() => choose("manual")} />
        {t("config.lateReg.manual")}
      </label>
    </div>
  );
}
