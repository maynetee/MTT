import type { Config, Deadline } from "../../engine/types";
import type { MoneyConfig } from "../../bindings/MoneyConfig";
import { useI18n } from "../../i18n";
import { Checkbox, Field, RadioGroup, TextInput } from "./Field";
import { NO_LOCKS, type ConfigLocks } from "./MoneyFields";
import { NumberInput } from "./NumberInput";

const MINUTE_MS = 60_000;

/** NaN while empty, so the core rejects it instead of reading 0. */
const integer = (value: number | null) => (value === null ? Number.NaN : Math.trunc(value));

/** Fits a number entered in a form into the core's integer type, so the core validates it. */
function fit(value: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), max) : 0;
}

const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;

/** An optional amount: empty (NaN) means none. */
function optional(value: number | undefined): number | undefined {
  return value === undefined || Number.isNaN(value) ? undefined : fit(value, MAX_AMOUNT);
}

function sanitizeMoney(money: MoneyConfig | undefined): MoneyConfig | undefined {
  if (!money) return undefined;
  return {
    currency: money.currency,
    buyIn: { prize: fit(money.buyIn.prize, MAX_AMOUNT), fee: fit(money.buyIn.fee, MAX_AMOUNT) },
    guarantee: optional(money.guarantee),
    roundingUnit: fit(money.roundingUnit, MAX_AMOUNT),
    minCash: optional(money.minCash)
  };
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
    lateReg,
    money: sanitizeMoney(config.money)
  };
}

interface Props {
  config: Config;
  onChange(config: Config): void;
  /** What can no longer change (seats per table and the starting stack once started...). */
  locks?: ConfigLocks;
}

/** Name, tables and seats, places paid, starting stack and balancing settings. */
export function ConfigFields({ config, onChange, locks = NO_LOCKS }: Props) {
  const { t } = useI18n();
  const set = (changes: Partial<Config>) => onChange({ ...config, ...changes });
  const capacity = (config.seatsPerTable || 0) * (config.maxTables || 0);
  const started = locks.started;
  const locked = started ? t("config.lockedHint") : undefined;
  const placesHint = locks.payoutsLocked ? t("money.payoutsLockedHint") : undefined;

  return (
    <div className="form-grid">
      <Field label={t("config.name")} className="span-2">
        <TextInput value={config.name} onChange={(event) => set({ name: event.target.value })} />
      </Field>
      <Field label={t("config.startingStack")}>
        <NumberInput
          min={1}
          step={1000}
          value={config.startingStack}
          onChange={(value) => set({ startingStack: integer(value) })}
          disabled={started}
          title={locked}
        />
      </Field>
      <Field label={t("config.placesPaid")} hint={placesHint}>
        <NumberInput
          min={1}
          value={config.placesPaid}
          onChange={(value) => set({ placesPaid: integer(value) })}
          disabled={locks.payoutsLocked}
        />
      </Field>
      <Field label={t("config.maxTables")}>
        <NumberInput min={1} value={config.maxTables} onChange={(value) => set({ maxTables: integer(value) })} />
      </Field>
      <Field label={t("config.seatsPerTable")}>
        <NumberInput
          min={2}
          max={12}
          value={config.seatsPerTable}
          onChange={(value) => set({ seatsPerTable: integer(value) })}
          disabled={started}
          title={locked}
        />
      </Field>
      <div className="readout" aria-live="polite">
        <span className="readout-label">{t("config.capacity")}</span>
        <span className="readout-value">{t("config.capacitySeats", { count: capacity })}</span>
      </div>
      <Field label={t("config.finalTableSize")} hint={t("config.finalTableSizeHint")}>
        <NumberInput
          min={2}
          max={12}
          placeholder={Number.isFinite(config.seatsPerTable) ? String(config.seatsPerTable) : undefined}
          value={config.finalTableSize}
          onChange={(value) => set({ finalTableSize: value === null ? null : integer(value) })}
        />
      </Field>
      <Field label={t("config.balanceTrigger")} hint={t("config.balanceTriggerHint")} className="span-2">
        <NumberInput digits={3} min={2} value={config.balanceTrigger} onChange={(value) => set({ balanceTrigger: integer(value) })} />
      </Field>
    </div>
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
    <RadioGroup<Mode>
      legend={t("config.lateReg.title")}
      hideLegend
      name="late-reg"
      value={deadline.type}
      onChange={choose}
      options={[
        {
          value: "end_of_play_level",
          label: t("config.lateReg.endOfLevel"),
          inline: (
            <NumberInput
              digits={3}
              min={1}
              aria-label={t("config.lateReg.endOfLevel")}
              value={level.n}
              onChange={(value) => set({ type: "end_of_play_level", n: integer(value), throughBreak: level.throughBreak })}
              disabled={deadline.type !== "end_of_play_level"}
            />
          ),
          nested: (
            <Checkbox
              label={t("config.lateReg.throughBreak")}
              checked={level.throughBreak}
              onChange={(event) => set({ type: "end_of_play_level", n: level.n, throughBreak: event.target.checked })}
              disabled={deadline.type !== "end_of_play_level"}
            />
          )
        },
        {
          value: "elapsed",
          label: t("config.lateReg.elapsed"),
          inline: (
            <>
              <NumberInput
                digits={4}
                min={1}
                step={15}
                aria-label={t("config.lateReg.elapsed")}
                value={minutes}
                onChange={(value) => set({ type: "elapsed", ms: Math.round(integer(value) * MINUTE_MS) })}
                disabled={deadline.type !== "elapsed"}
              />
              {t("config.lateReg.minutes")}
            </>
          )
        },
        { value: "manual", label: t("config.lateReg.manual") }
      ]}
    />
  );
}
