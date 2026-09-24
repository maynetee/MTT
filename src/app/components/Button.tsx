import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { Icon, type IconName } from "./Icon";
import { Tooltip } from "./Tooltip";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonLookProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An icon before the label. */
  icon?: IconName;
  /** Stretches to the width of its container. */
  block?: boolean;
}

export function buttonClass({ variant = "secondary", size = "md", block = false }: ButtonLookProps, extra?: string): string {
  return ["button", `button--${variant}`, `button--${size}`, block ? "button--block" : "", extra ?? ""].filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonLookProps {
  /** Shows a spinner and blocks clicks while an action runs. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, block, loading = false, disabled, className, children, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass({ variant, size, block }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={size === "lg" ? 20 : 18} />}
      {children !== undefined && children !== null && <span className="button-label">{children}</span>}
    </button>
  );
});

/** A router link that looks like a button. */
export function ButtonLink({ variant, size, icon, block, className, children, ...rest }: LinkProps & ButtonLookProps & { children: ReactNode }) {
  return (
    <Link className={buttonClass({ variant, size, block }, className)} {...rest}>
      {icon && <Icon name={icon} size={size === "lg" ? 20 : 18} />}
      <span className="button-label">{children}</span>
    </Link>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** The accessible name, also shown as a tooltip. */
  label: string;
  /** Extra tooltip lines (e.g. a keyboard shortcut); `false` hides the tooltip. */
  hint?: ReactNode | false;
  variant?: ButtonVariant;
  size?: ButtonSize;
  tooltipAlign?: "center" | "start" | "end";
  /** Keeps the tooltip closed (e.g. while the button's own menu is open). */
  tooltipSuppressed?: boolean;
}

/** A square icon-only button; its label is the accessible name and the tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, hint, variant = "ghost", size = "md", tooltipAlign, tooltipSuppressed = false, className, type = "button", ...rest },
  ref
) {
  const button = (
    <button ref={ref} type={type} aria-label={label} className={buttonClass({ variant, size }, `button--icon ${className ?? ""}`)} {...rest}>
      <Icon name={icon} size={size === "sm" ? 16 : 18} />
    </button>
  );
  if (hint === false) return button;
  return (
    <Tooltip
      align={tooltipAlign}
      suppressed={tooltipSuppressed}
      content={
        <>
          {/* Already the accessible name: only the hint describes the button. */}
          <span className="tooltip-title" aria-hidden="true">
            {label}
          </span>
          {hint && <span className="tooltip-hint">{hint}</span>}
        </>
      }
    >
      {button}
    </Tooltip>
  );
});
