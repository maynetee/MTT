import { forwardRef, useState, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import { decimalSeparator } from "../utils/money";
import { useFieldProps } from "./Field";

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max" | "step" | "size">;

export interface NumberInputProps extends NativeProps {
  /** `null` (or NaN) while empty. */
  value: number | null;
  onChange(value: number | null): void;
  min?: number;
  max?: number;
  /** Arrow keys add or remove this much (ten times with Shift). */
  step?: number;
  /** Accepts one decimal separator (e.g. minutes), shown as the language writes it ("," in French). */
  allowDecimal?: boolean;
  /** Width in digits, for inputs sized to their content; fills its container otherwise. */
  digits?: number;
}

const MAX_LENGTH = 15;

function toText(value: number | null, separator: string): string {
  return value === null || Number.isNaN(value) ? "" : String(value).replace(".", separator);
}

function parse(text: string): number | null {
  const normalized = text.replace(",", ".");
  if (normalized === "" || normalized === ".") return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function same(a: number | null, b: number | null): boolean {
  return a === b || (a !== null && b !== null && Number.isNaN(a) && Number.isNaN(b));
}

/**
 * Keeps digits (and one decimal separator when allowed, a dot or a comma typed as `separator`):
 * letters and signs never reach the value.
 */
function sanitize(raw: string, allowDecimal: boolean, separator: string): string {
  let seenPoint = false;
  let text = "";
  for (const char of raw) {
    if (char >= "0" && char <= "9") text += char;
    else if ((char === "." || char === ",") && allowDecimal && !seenPoint) {
      seenPoint = true;
      text += separator;
    }
  }
  return text.slice(0, MAX_LENGTH);
}

/**
 * A text field for non-negative numbers. Unlike `<input type="number">` it never hides digits
 * behind spinners, never changes on scroll, and can be empty while typing (the value is then
 * null, so the core rejects it with a clear message instead of reading 0). Arrow keys step.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onChange, min, max, step = 1, allowDecimal = false, digits, className, style, onKeyDown, onBlur, ...rest },
  ref
) {
  const props = useFieldProps(rest);
  const { locale } = useI18n();
  const separator = allowDecimal ? decimalSeparator(locale) : ".";
  const current = value === null || Number.isNaN(value) ? null : value;
  // What is typed, and the value it was typed for: the text survives re-renders that bring
  // the same value back ("12." stays "12."), and follows the value when it changes elsewhere
  // (or the language, for its decimal separator).
  const [draft, setDraft] = useState(() => ({ text: toText(current, separator), value: current, separator }));
  if (!same(draft.value, current) || draft.separator !== separator) {
    const keep = draft.separator === separator && same(parse(draft.text), current);
    setDraft({ text: keep ? draft.text : toText(current, separator), value: current, separator });
  }

  const commit = (text: string) => {
    const next = parse(text);
    setDraft({ text, value: next, separator });
    if (!same(next, current)) onChange(next);
  };

  const clamp = (next: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? 0, next));

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || props.disabled || props.readOnly) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = (event.key === "ArrowUp" ? step : -step) * (event.shiftKey ? 10 : 1);
    commit(toText(clamp((current ?? min ?? 0) + delta), separator));
  };

  const widthStyle = digits ? ({ ...style, "--digits": digits } as CSSProperties) : style;

  return (
    <input
      ref={ref}
      type="text"
      role="spinbutton"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      autoComplete="off"
      spellCheck={false}
      aria-valuenow={current ?? undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      className={["input", "number-input", digits ? "number-input--sized" : "", className ?? ""].filter(Boolean).join(" ")}
      style={widthStyle}
      value={draft.text}
      onChange={(event) => commit(sanitize(event.target.value, allowDecimal, separator))}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        // "007" becomes "7" once the director moves on.
        if (draft.text !== toText(current, separator)) setDraft({ text: toText(current, separator), value: current, separator });
        onBlur?.(event);
      }}
      {...props}
    />
  );
});
