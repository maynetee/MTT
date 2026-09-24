import type { Currency } from "../../bindings/Currency";

/**
 * Money in the UI. The core counts money as integers of minor units (cents); the director
 * types major units ("12.50"). Conversions go through strings, never through floating
 * point, so 0.1 + 0.2 stays 30 cents and large amounts keep every digit.
 */

/** Largest amount the core accepts (JavaScript's safe integer range). */
export const MAX_MONEY = Number.MAX_SAFE_INTEGER;
/** Digits an amount may have when typed: 15 digits always fit in the safe range. */
export const MAX_MONEY_DIGITS = 15;

/** Currencies offered in the picker: the ones poker rooms use most, then alphabetical. */
export const CURRENCY_CODES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "CAD",
  "AUD",
  "AED",
  "ARS",
  "BRL",
  "CLP",
  "CNY",
  "COP",
  "CZK",
  "DKK",
  "HKD",
  "HUF",
  "ILS",
  "INR",
  "ISK",
  "JPY",
  "KRW",
  "MAD",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PHP",
  "PLN",
  "RON",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "TWD",
  "UAH",
  "ZAR"
] as const;

export const DEFAULT_CURRENCY = "EUR";

/** Minor-unit digits of a currency, as `Intl` formats it (EUR: 2, JPY: 0, KWD: 3). */
export function currencyExponent(code: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function currencyOf(code: string): Currency {
  return { code, exponent: currencyExponent(code) };
}

const currencyNames = new Map<string, Intl.DisplayNames | null>();

/** "Euro", or the code itself when the runtime has no name for it. */
export function currencyName(code: string, locale: string): string {
  if (!currencyNames.has(locale)) {
    try {
      currencyNames.set(locale, new Intl.DisplayNames([locale], { type: "currency" }));
    } catch {
      currencyNames.set(locale, null);
    }
  }
  try {
    return currencyNames.get(locale)?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** One unit of the currency in minor units (EUR: 100 cents). */
export function majorUnit(exponent: number): number {
  return 10 ** exponent;
}

/**
 * Parses what the director typed ("12.5", "12,50", "1200") into minor units. Returns null
 * for an empty field, a malformed amount, more decimals than the currency has, or an amount
 * beyond the safe range.
 */
export function parseMoney(text: string, exponent: number): number | null {
  const match = /^(\d*)(?:[.,](\d*))?$/.exec(text.trim());
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  if (fraction.length > exponent) return null;
  const digits = `${whole}${fraction.padEnd(exponent, "0")}`.replace(/^0+(?=\d)/, "");
  const value = BigInt(digits);
  return value > BigInt(MAX_MONEY) ? null : Number(value);
}

/** Minor units as a plain decimal string in major units: 1250 -> "12.50", JPY 500 -> "500". */
export function toDecimal(amount: number, exponent: number): string {
  const digits = String(Math.abs(Math.trunc(amount))).padStart(exponent + 1, "0");
  const sign = amount < 0 ? "-" : "";
  if (exponent === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/** What a money field shows for an amount: "110" for a whole amount, "12.50" otherwise. */
export function toInputText(amount: number | null, exponent: number): string {
  if (amount === null || !Number.isFinite(amount)) return "";
  const text = toDecimal(amount, exponent);
  return amount % majorUnit(exponent) === 0 ? text.replace(/\.0+$/, "") : text;
}

/** Keeps what can be part of an amount: digits and one separator, `exponent` decimals at most. */
export function sanitizeMoneyText(raw: string, exponent: number): string {
  let text = "";
  let separator = false;
  let decimals = 0;
  let digits = 0;
  for (const char of raw) {
    if (char >= "0" && char <= "9") {
      if (separator && decimals >= exponent) continue;
      if (digits >= MAX_MONEY_DIGITS) continue;
      if (separator) decimals += 1;
      digits += 1;
      text += char;
    } else if ((char === "." || char === ",") && exponent > 0 && !separator) {
      separator = true;
      text += ".";
    }
  }
  return text;
}

export interface MoneyFormatOptions {
  /** Drops the decimals of a whole amount ("€110" rather than "€110.00"). */
  whole?: boolean;
}

/** Formats minor units of `currency` for display, exactly (the amount goes to Intl as a string). */
export type MoneyFormatter = (amount: number, options?: MoneyFormatOptions) => string;

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, currency: Currency, whole: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency.code}|${currency.exponent}|${whole}`;
  let format = formatters.get(key);
  if (!format) {
    const options: Intl.NumberFormatOptions & { trailingZeroDisplay?: string } = {
      style: "currency",
      currency: currency.code,
      minimumFractionDigits: currency.exponent,
      maximumFractionDigits: currency.exponent,
      ...(whole ? { trailingZeroDisplay: "stripIfInteger" } : {})
    };
    try {
      format = new Intl.NumberFormat(locale, options);
    } catch {
      // A code Intl does not know: a plain number followed by the code.
      format = new Intl.NumberFormat(locale, { minimumFractionDigits: currency.exponent, maximumFractionDigits: currency.exponent });
    }
    formatters.set(key, format);
  }
  return format;
}

export function moneyFormatter(locale: string, currency: Currency): MoneyFormatter {
  return (amount, options = {}) => {
    const format = numberFormat(locale, currency, options.whole ?? false);
    // Intl reads a decimal string exactly (a number would round beyond 2^53 / 10^exponent).
    const text = format.format(toDecimal(amount, currency.exponent) as unknown as number);
    return format.resolvedOptions().style === "currency" ? text : `${text} ${currency.code}`;
  };
}

/** The currency's symbol and whether it comes before the amount, for input adornments. */
export function currencySymbol(locale: string, currency: Currency): { symbol: string; before: boolean } {
  try {
    const parts = new Intl.NumberFormat(locale, { style: "currency", currency: currency.code }).formatToParts(1);
    const index = parts.findIndex((part) => part.type === "currency");
    const integer = parts.findIndex((part) => part.type === "integer");
    return { symbol: parts[index]?.value ?? currency.code, before: index < integer };
  } catch {
    return { symbol: currency.code, before: false };
  }
}

/** Basis points as a percentage for display: 2500 -> "25%", 1234 -> "12.34%". */
export function formatBps(bps: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(bps / 10_000);
}

/** Share of `part` in `total` in basis points, rounded, for "% of pool" columns. */
export function shareBps(part: number, total: number): number {
  return total > 0 ? Math.round((part * 10_000) / total) : 0;
}

/**
 * Re-expresses minor units when the currency changes, keeping the major amount the director
 * typed (EUR 100.00 -> JPY 100): decimals the new currency lacks are dropped.
 */
export function rescale(amount: number, from: number, to: number): number {
  if (!Number.isFinite(amount) || from === to) return amount;
  return to > from ? Math.min(MAX_MONEY, amount * majorUnit(to - from)) : Math.trunc(amount / majorUnit(from - to));
}
