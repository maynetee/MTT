import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";

const SHOW_DELAY_MS = 350;

function isKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/**
 * Shows `content` under its child on hover (after a short delay) and on keyboard focus;
 * hides on Escape and on click. The content describes the child for assistive technology.
 */
export function Tooltip({
  content,
  children,
  align = "center",
  suppressed = false
}: {
  content: ReactNode;
  children: ReactElement<{ "aria-describedby"?: string }>;
  align?: "center" | "start" | "end";
  suppressed?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const show = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      className="tooltip-anchor"
      onMouseEnter={() => show(SHOW_DELAY_MS)}
      onMouseLeave={hide}
      onFocus={(event) => isKeyboardFocus(event.target) && show(0)}
      onBlur={hide}
      onMouseDown={hide}
    >
      {cloneElement(children, { "aria-describedby": id })}
      <span id={id} role="tooltip" className={`tooltip tooltip--${align}`} data-open={(open && !suppressed) || undefined}>
        {content}
      </span>
    </span>
  );
}
