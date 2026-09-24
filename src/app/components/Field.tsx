import { createContext, forwardRef, useContext, useId, type AriaAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Icon } from "./Icon";

interface FieldControl {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

type ControlAria = Pick<AriaAttributes, "aria-describedby" | "aria-invalid"> & { id?: string };

/** Wires a control to the enclosing Field: id for the label, hint and error descriptions. */
export function useFieldProps<T extends ControlAria>(props: T): T {
  const field = useContext(FieldContext);
  if (!field) return props;
  const describedBy = [field.describedBy, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  return {
    ...props,
    id: props.id ?? field.id,
    "aria-describedby": describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid || undefined)
  };
}

export interface FieldProps {
  label: ReactNode;
  /** Help under the control. */
  hint?: ReactNode;
  /** Replaces nothing: shown under the hint and marks the control invalid. */
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  /** For a control with an id of its own. */
  htmlFor?: string;
}

/** Label, control, hint and error, associated for assistive technology. */
export function Field({ label, hint, error, children, className, htmlFor }: FieldProps) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={["field", error ? "field--invalid" : "", className ?? ""].filter(Boolean).join(" ")}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>{children}</FieldContext.Provider>
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={errorId}>
          <Icon name="alert" size={14} />
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** `lg` for the one field a screen is about (the player name at registration). */
  inputSize?: "md" | "lg";
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({ className, inputSize = "md", type = "text", ...props }, ref) {
  const wired = useFieldProps(props);
  return <input ref={ref} type={type} className={["input", `input--${inputSize}`, className ?? ""].filter(Boolean).join(" ")} {...wired} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  const wired = useFieldProps(props);
  return (
    <span className={["select", className ?? ""].filter(Boolean).join(" ")}>
      <select ref={ref} className="select-control" {...wired}>
        {children}
      </select>
      <Icon name="chevronDown" size={16} className="select-chevron" />
    </span>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  /** Keeps the label for assistive technology only (e.g. in a table row). */
  hideLabel?: boolean;
  description?: ReactNode;
}

/** A checkbox with its label right next to it; the whole label toggles it. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, hideLabel = false, description, className, ...props }, ref) {
  return (
    <label className={["checkbox", props.disabled ? "is-disabled" : "", className ?? ""].filter(Boolean).join(" ")}>
      <span className="checkbox-box">
        <input ref={ref} type="checkbox" className="checkbox-input" {...props} />
        <Icon name="check" size={14} className="checkbox-mark" />
      </span>
      <span className={hideLabel ? "visually-hidden" : "checkbox-text"}>
        <span className="checkbox-label">{label}</span>
        {description && <span className="checkbox-description">{description}</span>}
      </span>
    </label>
  );
});

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Controls on the same line, after the label (e.g. a number the option needs). */
  inline?: ReactNode;
  /** Controls under the option, aligned with its label. */
  nested?: ReactNode;
  disabled?: boolean;
}

/** Radio buttons in a fieldset; each option can carry its own inline and nested controls. */
export function RadioGroup<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  hideLegend = false
}: {
  legend: ReactNode;
  name: string;
  value: T;
  onChange(value: T): void;
  options: readonly RadioOption<T>[];
  hideLegend?: boolean;
}) {
  return (
    <fieldset className="radio-group">
      <legend className={hideLegend ? "visually-hidden" : "radio-legend"}>{legend}</legend>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <div key={option.value} className={["radio-option", checked ? "is-checked" : ""].filter(Boolean).join(" ")}>
            <label className="radio">
              <input
                type="radio"
                className="radio-input"
                name={name}
                value={option.value}
                checked={checked}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
              />
              <span className="radio-label">{option.label}</span>
            </label>
            {option.inline && <span className="radio-inline">{option.inline}</span>}
            {option.nested && <div className="radio-nested">{option.nested}</div>}
          </div>
        );
      })}
    </fieldset>
  );
}
