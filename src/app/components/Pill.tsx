import type { ReactNode } from "react";

export type PillTone = "neutral" | "accent" | "success" | "danger" | "break" | "muted";

/**
 * A short status label, sized to its text (never stretched by a grid or flex parent).
 * `dot` adds a status dot, so state never relies on color alone: the text says it too.
 */
export function Pill({
  tone = "neutral",
  dot = false,
  pulse = false,
  title,
  className,
  children
}: {
  tone?: PillTone;
  dot?: boolean;
  /** A slow pulse on the dot, for a live state (off with reduced motion). */
  pulse?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={["pill", `pill--${tone}`, className ?? ""].filter(Boolean).join(" ")} title={title}>
      {dot && <span className={pulse ? "pill-dot pill-dot--pulse" : "pill-dot"} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Alias for places that read better as a badge (counts, markers). */
export const Badge = Pill;
