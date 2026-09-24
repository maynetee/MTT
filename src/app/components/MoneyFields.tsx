import type { Config } from "../../engine/types";
import type { MoneyConfig } from "../../bindings/MoneyConfig";
import { useI18n } from "../../i18n";
import { CURRENCY_CODES, DEFAULT_CURRENCY, currencyExponent, currencyName, currencyOf, majorUnit, moneyFormatter, rescale } from "../utils/money";
import { paysPrizes } from "../utils/payouts";
import { Checkbox, Field, Select } from "./Field";
import { MoneyInput } from "./MoneyInput";

/** What the core no longer lets the director change, to disable those fields with a reason. */
export interface ConfigLocks {
  /** Seats per table, starting stack and buy-in: fixed once the tournament has started. */
  started: boolean;
  /** Money tracking and the currency's decimals: fixed once a player has registered (and paid). */
  registered: boolean;
  /** Places paid, payouts, rounding unit and minimum cash: fixed while the payouts are locked. */
  payoutsLocked: boolean;
}

export const NO_LOCKS: ConfigLocks = { started: false, registered: false, payoutsLocked: false };

/** A buy-in of 100 in the currency's units, payouts rounded to whole units. */
export function defaultMoney(code: string = DEFAULT_CURRENCY): MoneyConfig {
  const currency = currencyOf(code);
  const unit = majorUnit(currency.exponent);
  return { currency, buyIn: { prize: 100 * unit, fee: 0 }, roundingUnit: unit };
}

/** Turns money tracking off: purchases become free (a price needs money tracking). */
function withoutMoney(config: Config): Config {
  const { money: _money, ...rest } = config;
  const free = <T extends { prize: number; fee: number }>(purchase: T | undefined) => purchase && { ...purchase, prize: 0, fee: 0 };
  const payout = config.payout.amounts?.type === "custom_amounts" ? { ...config.payout, amounts: undefined } : config.payout;
  return { ...rest, payout, reentry: free(config.reentry), rebuy: free(config.rebuy), addon: free(config.addon) };
}

/**
 * Switches currency. Before anyone has paid, the currency comes with its usual decimals and the
 * amounts stay as typed (100 EUR becomes 100 USD, not 10000 JPY). Once someone has paid
 * (`keepExponent`), amounts are recorded in minor units of the current exponent: only the code
 * changes, so EUR 100.50 becomes JPY 100.50, nothing converted or rounded away.
 */
export function withCurrency(config: Config, code: string, keepExponent = false): Config {
  const money = config.money;
  if (!money) return config;
  if (keepExponent) return { ...config, money: { ...money, currency: { code, exponent: money.currency.exponent } } };
  const currency = currencyOf(code);
  const scale = (amount: number) => rescale(amount, money.currency.exponent, currency.exponent);
  const optional = (amount: number | undefined) => (amount === undefined ? undefined : scale(amount));
  const scalePrice = <T extends { prize: number; fee: number }>(price: T): T => ({ ...price, prize: scale(price.prize), fee: scale(price.fee) });
  const price = <T extends { prize: number; fee: number }>(purchase: T | undefined) => purchase && scalePrice(purchase);
  const amounts = config.payout.amounts;
  return {
    ...config,
    money: {
      currency,
      buyIn: scalePrice(money.buyIn),
      guarantee: optional(money.guarantee),
      roundingUnit: Math.max(1, scale(money.roundingUnit)),
      minCash: optional(money.minCash)
    },
    payout: amounts?.type === "custom_amounts" ? { ...config.payout, amounts: { ...amounts, amounts: amounts.amounts.map(scale) } } : config.payout,
    reentry: price(config.reentry),
    rebuy: price(config.rebuy),
    addon: price(config.addon)
  };
}

/** NaN while empty (like the other numeric fields): the core then gets 0 or a clear error. */
const amount = (value: number | null) => (value === null ? Number.NaN : value);
/** An optional amount: empty means none. */
const optionalAmount = (value: number | null) => (value === null ? undefined : value);

interface Props {
  config: Config;
  onChange(config: Config): void;
  locks?: ConfigLocks;
}

/**
 * Money tracking, off by default (a free or home game needs none): currency, buy-in split
 * between the prize pool and the house fee, guarantee, and, when the tournament pays prizes,
 * payout rounding and minimum cash.
 */
export function MoneyFields({ config, onChange, locks = NO_LOCKS }: Props) {
  const { t, locale } = useI18n();
  const money = config.money;
  const setMoney = (changes: Partial<MoneyConfig>) => money && onChange({ ...config, money: { ...money, ...changes } });
  const codes: string[] = [...CURRENCY_CODES];
  if (money && !codes.includes(money.currency.code)) codes.unshift(money.currency.code);
  const format = money ? moneyFormatter(locale, money.currency) : null;
  const total = money && Number.isFinite(money.buyIn.prize) && Number.isFinite(money.buyIn.fee) ? money.buyIn.prize + money.buyIn.fee : null;
  const payoutHint = locks.payoutsLocked ? t("money.payoutsLockedHint") : undefined;
  // Once someone has paid, a new currency relabels the amounts, in the decimals they were recorded with.
  const currencyHint = !money || !locks.registered
    ? undefined
    : money.currency.exponent === currencyExponent(money.currency.code)
      ? t("money.currencyRelabel")
      : t("money.currencyDecimals", { count: money.currency.exponent });

  return (
    <div className="stack">
      <Checkbox
        label={t("money.track")}
        description={locks.registered ? t("money.trackLocked") : t("money.trackHint")}
        checked={money !== undefined}
        disabled={locks.registered}
        onChange={(event) => onChange(event.target.checked ? { ...config, money: defaultMoney() } : withoutMoney(config))}
      />
      {money && format && (
        <div className="form-grid">
          <Field label={t("money.currency")} hint={currencyHint} className="span-2">
            <Select value={money.currency.code} onChange={(event) => onChange(withCurrency(config, event.target.value, locks.registered))}>
              {codes.map((code) => (
                <option key={code} value={code}>
                  {t("money.currencyOption", { code, name: currencyName(code, locale) })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("money.buyIn")} hint={locks.started ? t("money.buyInLocked") : t("money.buyInHint")}>
            <MoneyInput
              currency={money.currency}
              value={money.buyIn.prize}
              disabled={locks.started}
              onChange={(value) => setMoney({ buyIn: { ...money.buyIn, prize: amount(value) } })}
            />
          </Field>
          <Field label={t("money.fee")} hint={t("money.feeHint")}>
            <MoneyInput
              currency={money.currency}
              value={money.buyIn.fee}
              disabled={locks.started}
              onChange={(value) => setMoney({ buyIn: { ...money.buyIn, fee: amount(value) } })}
            />
          </Field>
          <div className="readout" aria-live="polite">
            <span className="readout-label">{t("money.playerPays")}</span>
            <span className="readout-value">{total === null ? t("common.none") : format(total, { whole: true })}</span>
          </div>
          <Field label={t("money.guarantee")} hint={t("money.guaranteeHint")}>
            <MoneyInput
              currency={money.currency}
              value={money.guarantee ?? null}
              placeholder={t("money.none")}
              onChange={(value) => setMoney({ guarantee: optionalAmount(value) })}
            />
          </Field>
          {paysPrizes(config) && (
            <>
              <Field label={t("money.roundingUnit")} hint={payoutHint ?? t("money.roundingUnitHint")}>
                <MoneyInput
                  currency={money.currency}
                  value={money.roundingUnit}
                  disabled={locks.payoutsLocked}
                  onChange={(value) => setMoney({ roundingUnit: amount(value) })}
                />
              </Field>
              <Field label={t("money.minCash")} hint={payoutHint ?? t("money.minCashHint")}>
                <MoneyInput
                  currency={money.currency}
                  value={money.minCash ?? null}
                  placeholder={t("money.none")}
                  disabled={locks.payoutsLocked}
                  onChange={(value) => setMoney({ minCash: optionalAmount(value) })}
                />
              </Field>
            </>
          )}
        </div>
      )}
    </div>
  );
}
