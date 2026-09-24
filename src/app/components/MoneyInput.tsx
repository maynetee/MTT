import { forwardRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import type { Currency } from "../../bindings/Currency";
import { useI18n } from "../../i18n";
import { currencySymbol, parseMoney, sanitizeMoneyText, toInputText } from "../utils/money";
import { useFieldProps } from "./Field";

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "size">;

export interface MoneyInputProps extends NativeProps {
  /** Minor units (cents); `null` (or NaN) while empty. */
  value: number | null;
  onChange(value: number | null): void;
  currency: Currency;
  /** Width in characters, for inputs sized to their content; fills its container otherwise. */
  digits?: number;
}

function same(a: number | null, b: number | null): boolean {
  return a === b || (a !== null && b !== null && Number.isNaN(a) && Number.isNaN(b));
}

/**
 * An amount typed in major units ("12.50") and handed over in minor units (1250), converted
 * through strings so no cent is ever lost to floating point. Accepts a dot or a comma, at most
 * the currency's decimals; the currency symbol sits inside the field.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, currency, digits, className, style, onBlur, ...rest },
  ref
) {
  const { locale } = useI18n();
  const props = useFieldProps(rest);
  const current = value === null || Number.isNaN(value) ? null : value;
  const { exponent } = currency;
  // What is typed, and the value it was typed for (like NumberInput): "12." survives a re-render.
  const [draft, setDraft] = useState(() => ({ text: toInputText(current, exponent), value: current, exponent }));
  if (!same(draft.value, current) || draft.exponent !== exponent) {
    const keep = draft.exponent === exponent && same(parseMoney(draft.text, exponent), current);
    setDraft({ text: keep ? draft.text : toInputText(current, exponent), value: current, exponent });
  }

  const commit = (text: string) => {
    const next = parseMoney(text, exponent);
    setDraft({ text, value: next, exponent });
    if (!same(next, current)) onChange(next);
  };

  const { symbol, before } = currencySymbol(locale, currency);
  const wrapperStyle = { ...style, "--symbol-chars": symbol.length, ...(digits ? { "--digits": digits } : {}) } as CSSProperties;

  return (
    <span
      className={["money-input", before ? "money-input--before" : "money-input--after", digits ? "money-input--sized" : "", className ?? ""]
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
        onChange={(event) => commit(sanitizeMoneyText(event.target.value, exponent))}
        onBlur={(event) => {
          // "12.5" becomes "12.50" once the director moves on.
          const text = toInputText(current, exponent);
          if (draft.text !== text) setDraft({ text, value: current, exponent });
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
