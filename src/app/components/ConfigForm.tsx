import { useId } from "react";
import type { Config, Deadline } from "../../engine/types";
import type { MoneyConfig } from "../../bindings/MoneyConfig";
import type { Purchase } from "../../bindings/Purchase";
import type { PurchaseWindow } from "../../bindings/PurchaseWindow";
import { useI18n } from "../../i18n";
import { Checkbox, Field, RadioGroup, TextInput, type RadioOption } from "./Field";
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

function sanitizeDeadline(deadline: Deadline): Deadline {
  if (deadline.type === "end_of_play_level") return { ...deadline, n: fit(deadline.n, 65_535) };
  if (deadline.type === "elapsed") return { type: "elapsed", ms: fit(deadline.ms, Number.MAX_SAFE_INTEGER) };
  return deadline;
}

function sanitizePurchase(purchase: Purchase | undefined): Purchase | undefined {
  if (!purchase) return undefined;
  const window: PurchaseWindow | undefined =
    purchase.window?.type === "break_after"
      ? { type: "break_after", n: fit(purchase.window.n, 65_535) }
      : purchase.window && { type: "until", deadline: sanitizeDeadline(purchase.window.deadline) };
  return {
    prize: fit(purchase.prize, MAX_AMOUNT),
    fee: fit(purchase.fee, MAX_AMOUNT),
    stack: fit(purchase.stack, MAX_AMOUNT),
    // Empty: unlimited.
    max: purchase.max === undefined || Number.isNaN(purchase.max) ? undefined : fit(purchase.max, 255),
    window
  };
}

/** The config as sent to the core: empty or out-of-range numbers become values it rejects with a clear error. */
export function sanitizeConfig(config: Config): Config {
  const U8 = 255;
  const U16 = 65_535;
  const lateReg = sanitizeDeadline(config.lateReg);
  return {
    ...config,
    seatsPerTable: fit(config.seatsPerTable, U8),
    maxTables: fit(config.maxTables, U16),
    finalTableSize: config.finalTableSize === null ? null : fit(config.finalTableSize, U8),
    balanceTrigger: fit(config.balanceTrigger, U8),
    startingStack: fit(config.startingStack, Number.MAX_SAFE_INTEGER),
    placesPaid: fit(config.placesPaid, U16),
    lateReg,
    money: sanitizeMoney(config.money),
    reentry: sanitizePurchase(config.reentry),
    rebuy: sanitizePurchase(config.rebuy),
    addon: sanitizePurchase(config.addon)
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

/** A late registration deadline, or when a purchase window closes (`break_after`: during one break). */
export type WindowChoice = Deadline | { type: "break_after"; n: number };
type Mode = WindowChoice["type"];

export interface DeadlineFieldsProps {
  legend: string;
  value: WindowChoice;
  onChange(value: WindowChoice): void;
  /** Label of the `manual` option (late registration: until closed by hand). */
  manualLabel: string;
  /** Offers "during the break after play level n" (add-ons). */
  breakAfter?: boolean;
  /** Prefixes the labels of the numbers, when several of these share a page. */
  labelPrefix?: string;
  disabled?: boolean;
}

/**
 * When something closes on its own: at the end of a play level (optionally through the break
 * that follows), after a set time of play, or by hand. Shared by late registration and the
 * re-entry, rebuy and add-on windows.
 */
export function DeadlineFields({ legend, value, onChange, manualLabel, breakAfter = false, labelPrefix, disabled = false }: DeadlineFieldsProps) {
  const { t } = useI18n();
  const name = useId();
  const label = (text: string) => (labelPrefix ? `${labelPrefix}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);
  // Remember the values of the other modes while switching.
  const level = value.type === "end_of_play_level" ? value : { n: value.type === "break_after" ? value.n : 6, throughBreak: true };
  const minutes = value.type === "elapsed" ? value.ms / MINUTE_MS : 120;
  const breakLevel = value.type === "break_after" ? value.n : value.type === "end_of_play_level" ? value.n : 4;

  const choose = (mode: Mode) => {
    if (mode === "end_of_play_level") onChange({ type: mode, n: level.n, throughBreak: level.throughBreak });
    else if (mode === "elapsed") onChange({ type: mode, ms: Math.round(minutes * MINUTE_MS) });
    else if (mode === "break_after") onChange({ type: mode, n: breakLevel });
    else onChange({ type: "manual" });
  };

  const options: RadioOption<Mode>[] = [
    {
      value: "end_of_play_level",
      label: t("config.lateReg.endOfLevel"),
      disabled,
      inline: (
        <NumberInput
          digits={3}
          min={1}
          aria-label={label(t("config.lateReg.endOfLevel"))}
          value={level.n}
          onChange={(n) => onChange({ type: "end_of_play_level", n: integer(n), throughBreak: level.throughBreak })}
          disabled={disabled || value.type !== "end_of_play_level"}
        />
      ),
      nested: (
        <Checkbox
          label={t("config.lateReg.throughBreak")}
          aria-label={labelPrefix ? label(t("config.lateReg.throughBreak")) : undefined}
          checked={level.throughBreak}
          onChange={(event) => onChange({ type: "end_of_play_level", n: level.n, throughBreak: event.target.checked })}
          disabled={disabled || value.type !== "end_of_play_level"}
        />
      )
    },
    {
      value: "elapsed",
      label: t("config.lateReg.elapsed"),
      disabled,
      inline: (
        <>
          <NumberInput
            digits={4}
            min={1}
            step={15}
            aria-label={label(t("config.lateReg.elapsed"))}
            value={minutes}
            onChange={(n) => onChange({ type: "elapsed", ms: Math.round(integer(n) * MINUTE_MS) })}
            disabled={disabled || value.type !== "elapsed"}
          />
          {t("config.lateReg.minutes")}
        </>
      )
    }
  ];
  if (breakAfter) {
    options.push({
      value: "break_after",
      label: t("purchases.breakAfter"),
      disabled,
      inline: (
        <NumberInput
          digits={3}
          min={1}
          aria-label={label(t("purchases.breakAfter"))}
          value={breakLevel}
          onChange={(n) => onChange({ type: "break_after", n: integer(n) })}
          disabled={disabled || value.type !== "break_after"}
        />
      )
    });
  }
  options.push({ value: "manual", label: manualLabel, disabled });

  return <RadioGroup<Mode> legend={legend} hideLegend name={name} value={value.type} onChange={choose} options={options} />;
}

/** When late registration closes: end of a play level, a play time, or by hand. */
export function LateRegFields({ config, onChange }: Props) {
  const { t } = useI18n();
  return (
    <DeadlineFields
      legend={t("config.lateReg.title")}
      value={config.lateReg}
      manualLabel={t("config.lateReg.manual")}
      onChange={(lateReg) => lateReg.type !== "break_after" && onChange({ ...config, lateReg })}
    />
  );
}
