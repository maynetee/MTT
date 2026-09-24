import { useId, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  /** A count shown after the label, e.g. players in each filter. */
  count?: number;
}

/**
 * A small set of mutually exclusive choices shown side by side. Native radios underneath, so
 * arrow keys move between segments and screen readers announce "1 of 3".
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  segments,
  size = "md"
}: {
  /** Names the group for assistive technology. */
  label: string;
  value: T;
  onChange(value: T): void;
  segments: readonly Segment<T>[];
  size?: "sm" | "md";
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={`segmented segmented--${size}`}>
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <label key={segment.value} className={selected ? "segment is-selected" : "segment"}>
            <input type="radio" className="segment-input" name={name} value={segment.value} checked={selected} onChange={() => onChange(segment.value)} />
            {segment.icon && <Icon name={segment.icon} size={16} />}
            <span className="segment-label">{segment.label}</span>
            {segment.count !== undefined && <span className="segment-count">{segment.count}</span>}
          </label>
        );
      })}
    </div>
  );
}
