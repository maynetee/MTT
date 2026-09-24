import { cloneElement, Fragment, useMemo, type ReactElement } from "react";
import { useI18n } from "../../i18n";
import { Tooltip } from "../components/Tooltip";
import { ariaKeyShortcuts, currentPlatform, shortcutLabels, type KeyNames, type Platform, type ShortcutId } from "./shortcuts";

export interface ShortcutText {
  platform: Platform;
  /** Each combination of a shortcut, as keys to show (`⇧⌘Z`, `Ctrl+Y`). */
  labels(id: ShortcutId): string[];
  /** The combinations in one line, for a tooltip hint. */
  text(id: ShortcutId): string;
  /** The `aria-keyshortcuts` value. */
  aria(id: ShortcutId): string;
}

/** Platform-correct, translated key labels. */
export function useShortcutText(): ShortcutText {
  const { t } = useI18n();
  const platform = currentPlatform();
  return useMemo(() => {
    const names: KeyNames = {
      space: t("shortcuts.keys.space"),
      escape: t("shortcuts.keys.escape"),
      ctrl: t("shortcuts.keys.ctrl"),
      shift: t("shortcuts.keys.shift")
    };
    const labels = (id: ShortcutId) => shortcutLabels(id, platform, names);
    return {
      platform,
      labels,
      text: (id) => labels(id).join(` ${t("shortcuts.or")} `),
      aria: (id) => ariaKeyShortcuts(id, platform)
    };
  }, [t, platform]);
}

/** A shortcut's keys as <kbd> elements: `⌘Z`, or `Ctrl+Shift+Z or Ctrl+Y`. */
export function ShortcutKeys({ id }: { id: ShortcutId }) {
  const { t } = useI18n();
  const { labels } = useShortcutText();
  return (
    <span className="shortcut-keys">
      {labels(id).map((label, index) => (
        <Fragment key={label}>
          {index > 0 && <span className="shortcut-or"> {t("shortcuts.or")} </span>}
          <kbd>{label}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Tells what key does the same as a button: `aria-keyshortcuts` on the button, and a tooltip
 * with the keys on hover and keyboard focus.
 */
export function ShortcutTooltip({
  id,
  align,
  children
}: {
  id: ShortcutId;
  align?: "center" | "start" | "end";
  children: ReactElement<{ "aria-keyshortcuts"?: string; "aria-describedby"?: string }>;
}) {
  const { t } = useI18n();
  const { aria } = useShortcutText();
  return (
    <Tooltip
      align={align}
      content={
        <span className="tooltip-shortcut">
          {t("shortcuts.tooltip")} <ShortcutKeys id={id} />
        </span>
      }
    >
      {cloneElement(children, { "aria-keyshortcuts": aria(id) })}
    </Tooltip>
  );
}
