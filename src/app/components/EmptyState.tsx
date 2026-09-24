import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** What an empty screen is for, and the action that fills it. */
export function EmptyState({
  icon,
  art,
  title,
  description,
  action
}: {
  icon?: IconName;
  /** A picture instead of the icon. */
  art?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {art}
      {icon && !art && (
        <span className="empty-state-icon">
          <Icon name={icon} size={22} />
        </span>
      )}
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-description">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
