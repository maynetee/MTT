import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Button, IconButton } from "./Button";
import { Icon, type IconName } from "./Icon";

export type ToastTone = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  onAction(): void;
}

export interface ToastOptions {
  message: ReactNode;
  tone?: ToastTone;
  action?: ToastAction;
  /** Milliseconds before it goes away; `null` keeps it until dismissed. */
  duration?: number | null;
}

interface ToastEntry extends Required<Pick<ToastOptions, "message" | "tone">> {
  id: number;
  action?: ToastAction;
  duration: number | null;
}

export interface Toaster {
  show(options: ToastOptions): number;
  success(message: ReactNode, options?: Omit<ToastOptions, "message" | "tone">): number;
  error(message: ReactNode, options?: Omit<ToastOptions, "message" | "tone">): number;
  dismiss(id: number): void;
}

/** At most this many toasts on screen; the others wait their turn. */
export const MAX_VISIBLE_TOASTS = 3;
export const TOAST_DURATION_MS = 5_000;
/** Errors and toasts with an action stay longer: the director may be busy with a player. */
export const TOAST_LONG_DURATION_MS = 10_000;

const ToastContext = createContext<Toaster | null>(null);

const ICONS: Record<ToastTone, IconName> = { info: "info", success: "checkCircle", error: "alert" };

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss(id: number): void }) {
  const { t } = useI18n();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);

  // Counts down while visible; hovering or focusing the toast pauses the countdown.
  useEffect(() => {
    if (paused || remaining.current === null) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      if (remaining.current !== null) remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused, toast.id, onDismiss]);

  return (
    <li
      className={`toast toast--${toast.tone}`}
      role={toast.tone === "error" ? "alert" : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <Icon name={ICONS[toast.tone]} size={18} className="toast-icon" />
      <div className="toast-message">{toast.message}</div>
      {toast.action && (
        <Button
          size="sm"
          variant="secondary"
          className="toast-action"
          onClick={() => {
            onDismiss(toast.id);
            toast.action!.onAction();
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton icon="close" size="sm" label={t("toast.dismiss")} hint={false} className="toast-close" onClick={() => onDismiss(toast.id)} />
    </li>
  );
}

/** Provides `useToast()` and renders the toasts, newest at the bottom, in a live region. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const toaster = useMemo<Toaster>(() => {
    const show = ({ message, tone = "info", action, duration }: ToastOptions) => {
      const id = nextId.current++;
      const fallback = tone === "error" || action ? TOAST_LONG_DURATION_MS : TOAST_DURATION_MS;
      setToasts((current) => [...current, { id, message, tone, action, duration: duration === undefined ? fallback : duration }]);
      return id;
    };
    return {
      show,
      success: (message, options) => show({ ...options, message, tone: "success" }),
      error: (message, options) => show({ ...options, message, tone: "error" }),
      dismiss
    };
  }, [dismiss]);

  const visible = toasts.slice(0, MAX_VISIBLE_TOASTS);

  return (
    <ToastContext.Provider value={toaster}>
      {children}
      <section className="toast-region" aria-label={t("toast.region")}>
        <ol className="toast-list" aria-live="polite" aria-relevant="additions text">
          {visible.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): Toaster {
  const toaster = useContext(ToastContext);
  if (!toaster) throw new Error("useToast() needs a <ToastProvider>");
  return toaster;
}
