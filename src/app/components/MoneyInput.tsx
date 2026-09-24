import { forwardRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import type { Currency } from "../../bindings/Currency";
import { useI18n } from "../../i18n";
import { currencySymbol, decimalSeparator, parseMoney, sanitizeMoneyText, toInputText } from "../utils/money";
import { useFieldProps } from "./Field";

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "size">;

interface DecimalInputProps extends NativeProps {
  /** An integer count of `10^-exponent` units (cents, basis points); `null` (or NaN) while empty. */
  value: number | null;
  onChange(value: number | null): void;
  /** Decimals the director may type. */
  exponent: number;
  /** Shown inside the field, before or after the number. */
  symbol: string;
  symbolBefore: boolean;
  /** The decimal separator shown: "." in English, "," in French (both can be typed). */
  separator: string;
  /** Width in characters, for inputs sized to their content; fills its container otherwise. */
  digits?: number;
}

function same(a: number | null, b: number | null): boolean {
  return a === b || (a !== null && b !== null && Number.isNaN(a) && Number.isNaN(b));
}

/**
 * A decimal typed by the director ("12.50") handed over as an integer (1250), converted
 * through strings so no unit is ever lost to floating point. Accepts a dot or a comma and at
 * most `exponent` decimals; the unit symbol sits inside the field.
 */
const DecimalInput = forwardRef<HTMLInputElement, DecimalInputProps>(function DecimalInput(
  { value, onChange, exponent, symbol, symbolBefore, separator, digits, className, style, onBlur, ...rest },
  ref
) {
  const props = useFieldProps(rest);
  const current = value === null || Number.isNaN(value) ? null : value;
  // What is typed, and the value it was typed for (like NumberInput): "12." survives a re-render.
  // A change of language rewrites it with the new separator.
  const [draft, setDraft] = useState(() => ({ text: toInputText(current, exponent, separator), value: current, exponent, separator }));
  if (!same(draft.value, current) || draft.exponent !== exponent || draft.separator !== separator) {
    const keep = draft.exponent === exponent && draft.separator === separator && same(parseMoney(draft.text, exponent), current);
    setDraft({ text: keep ? draft.text : toInputText(current, exponent, separator), value: current, exponent, separator });
  }

  const commit = (text: string) => {
    const next = parseMoney(text, exponent);
    setDraft({ text, value: next, exponent, separator });
    if (!same(next, current)) onChange(next);
  };

  const wrapperStyle = { ...style, "--symbol-chars": symbol.length, ...(digits ? { "--digits": digits } : {}) } as CSSProperties;

  return (
    <span
      className={["money-input", symbolBefore ? "money-input--before" : "money-input--after", digits ? "money-input--sized" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={wrapperStyle}
    >
      <input
        ref={ref}
        type="text"
        inputMode={exponent > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        spellCheck={false}
        className="input money-input-control"
        value={draft.text}
        onChange={(event) => commit(sanitizeMoneyText(event.target.value, exponent, separator))}
        onBlur={(event) => {
          // "12.5" becomes "12.50" once the director moves on.
          const text = toInputText(current, exponent, separator);
          if (draft.text !== text) setDraft({ text, value: current, exponent, separator });
          onBlur?.(event);
        }}
        {...props}
      />
      <span className="money-input-symbol" aria-hidden="true">
        {symbol}
      </span>
    </span>
  );
});

export interface MoneyInputProps extends Omit<DecimalInputProps, "exponent" | "symbol" | "symbolBefore" | "separator"> {
  currency: Currency;
}

/** An amount typed in major units ("12.50") and handed over in minor units (1250). */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput({ currency, ...rest }, ref) {
  const { locale } = useI18n();
  const { symbol, before } = currencySymbol(locale, currency);
  return (
    <DecimalInput ref={ref} exponent={currency.exponent} symbol={symbol} symbolBefore={before} separator={decimalSeparator(locale)} {...rest} />
  );
});

/** A percentage typed with up to two decimals ("12.5") and handed over in basis points (1250). */
export const PercentInput = forwardRef<HTMLInputElement, Omit<DecimalInputProps, "exponent" | "symbol" | "symbolBefore" | "separator">>(
  function PercentInput(props, ref) {
    const { locale } = useI18n();
    return <DecimalInput ref={ref} exponent={2} symbol="%" symbolBefore={false} separator={decimalSeparator(locale)} {...props} />;
  }
);
