import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type CalloutTone = "info" | "warning" | "danger" | "success" | "break";

const ICONS: Record<CalloutTone, IconName> = { info: "info", warning: "alert", danger: "alert", success: "checkCircle", break: "coffee" };

/** A message that stays on the page while it applies (a warning from the core, a hint). */
export function Callout({
  tone = "info",
  role,
  action,
  className,
  children
}: {
  tone?: CalloutTone;
  role?: "status" | "alert";
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["callout", `callout--${tone}`, className ?? ""].filter(Boolean).join(" ")} role={role}>
      <Icon name={ICONS[tone]} size={18} className="callout-icon" />
      <div className="callout-body">{children}</div>
      {action && <div className="callout-action">{action}</div>}
    </div>
  );
}
