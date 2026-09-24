import { forwardRef, useState, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent } from "react";
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
  /** Accepts one decimal separator (e.g. minutes). */
  allowDecimal?: boolean;
  /** Width in digits, for inputs sized to their content; fills its container otherwise. */
  digits?: number;
}

const MAX_LENGTH = 15;

function toText(value: number | null): string {
  return value === null || Number.isNaN(value) ? "" : String(value);
}

function parse(text: string): number | null {
  if (text === "" || text === ".") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function same(a: number | null, b: number | null): boolean {
  return a === b || (a !== null && b !== null && Number.isNaN(a) && Number.isNaN(b));
}

/** Keeps digits (and one decimal point when allowed): letters and signs never reach the value. */
function sanitize(raw: string, allowDecimal: boolean): string {
  let seenPoint = false;
  let text = "";
  for (const char of raw.replace(",", allowDecimal ? "." : "")) {
    if (char >= "0" && char <= "9") text += char;
    else if (char === "." && allowDecimal && !seenPoint) {
      seenPoint = true;
      text += char;
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
  const current = value === null || Number.isNaN(value) ? null : value;
  // What is typed, and the value it was typed for: the text survives re-renders that bring
  // the same value back ("12." stays "12."), and follows the value when it changes elsewhere.
  const [draft, setDraft] = useState(() => ({ text: toText(current), value: current }));
  if (!same(draft.value, current)) {
    setDraft({ text: same(parse(draft.text), current) ? draft.text : toText(current), value: current });
  }

  const commit = (text: string) => {
    const next = parse(text);
    setDraft({ text, value: next });
    if (!same(next, current)) onChange(next);
  };

  const clamp = (next: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? 0, next));

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || props.disabled || props.readOnly) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = (event.key === "ArrowUp" ? step : -step) * (event.shiftKey ? 10 : 1);
    commit(toText(clamp((current ?? min ?? 0) + delta)));
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
      onChange={(event) => commit(sanitize(event.target.value, allowDecimal))}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        // "007" becomes "7" once the director moves on.
        if (draft.text !== toText(current)) setDraft({ text: toText(current), value: current });
        onBlur?.(event);
      }}
      {...props}
    />
  );
});
