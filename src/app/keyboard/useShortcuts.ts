import { useEffect, useRef } from "react";
import { currentPlatform, matchShortcut, shortcutAllowed, type ShortcutId, type ShortcutMatch } from "./shortcuts";

export type ShortcutHandlers = Partial<Record<ShortcutId, (match: ShortcutMatch) => void>>;

/**
 * Global keyboard shortcuts for the window. Only shortcuts with a handler are taken (their
 * default action is prevented); the platform is read on each key press. See
 * `shortcutAllowed` for when they stand aside.
 */
export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const match = matchShortcut(event, currentPlatform());
      if (!match) return;
      const handler = handlersRef.current[match.id];
      if (!handler || !shortcutAllowed(event, match)) return;
      event.preventDefault();
      handler(match);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
