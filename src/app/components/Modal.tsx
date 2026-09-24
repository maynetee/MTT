import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { IconButton } from "./Button";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.closest("[inert]"));
}

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  /** Read out with the title when the dialog opens. */
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** `alertdialog` for confirmations that interrupt the director. */
  role?: "dialog" | "alertdialog";
  /** Focused on open; the first focusable element of the body otherwise. */
  initialFocus?: RefObject<HTMLElement | null>;
  size?: "sm" | "md";
  tone?: "default" | "danger";
}

/**
 * A modal dialog: rendered over the page, focus kept inside (Tab and Shift+Tab wrap), Esc
 * or the close button closes it, and focus goes back to where it was when it closes.
 */
export function Modal({ open, onClose, title, description, children, footer, role = "dialog", initialFocus, size = "sm", tone = "default" }: ModalProps) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = initialFocus?.current ?? focusables(dialog.querySelector(".modal-body") ?? dialog)[0] ?? focusables(dialog)[0] ?? dialog;
    target.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(dialog);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    // Focus that escapes (a click on the backdrop, another window) comes back in.
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) (focusables(dialog)[0] ?? dialog).focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
    // Focus moves once per opening, not when the caller re-renders.
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="modal-layer">
      <div className="modal-backdrop" aria-hidden="true" onMouseDown={() => onCloseRef.current()} />
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`modal modal--${size} modal--${tone}`}
      >
        <header className="modal-header">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <IconButton icon="close" label={t("common.close")} hint={false} size="sm" onClick={() => onCloseRef.current()} className="modal-close" />
        </header>
        <div className="modal-body">
          {description && (
            <div id={descriptionId} className="modal-description">
              {description}
            </div>
          )}
          {children}
        </div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
