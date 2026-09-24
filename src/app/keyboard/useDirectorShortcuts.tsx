import { useCallback, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toEngineError, type Command, type EngineError, type View } from "../../engine/types";
import { useEngine } from "../EngineContext";
import { exitFullscreen, toggleFullscreen } from "./fullscreen";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { useShortcuts } from "./useShortcuts";

const MINUTE_MS = 60_000;

export interface DirectorTab {
  to: string;
  label: string;
}

export interface DirectorShortcutOptions {
  id: string;
  /** Null while loading: no shortcut is active then. */
  view: View | null;
  /** Runs a command and reports its error (the director shell's `run`). */
  run(command: Command): Promise<unknown>;
  report(error: EngineError): void;
  /** The tabs in keyboard order: 1 opens the first. */
  tabs: readonly DirectorTab[];
}

function logFullscreenError(error: unknown) {
  console.error("Could not change full screen", error);
}

/**
 * The director window's shortcuts (clock, undo and redo, tabs, display, full screen) and
 * the overlay that lists them. Returns the overlay to render and a way to open it.
 */
export function useDirectorShortcuts({ id, view, run, report, tabs }: DirectorShortcutOptions): { overlay: ReactNode; openOverlay(): void } {
  const engine = useEngine();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Handlers read the latest view: the clock may have been started from a button meanwhile.
  const viewRef = useRef(view);
  viewRef.current = view;
  const command = (value: Command) => () => void run(value);

  useShortcuts(
    {
      toggleClock: () => {
        const current = viewRef.current;
        if (current) void run({ type: current.clock.running ? "pause_clock" : "start_clock" });
      },
      nextLevel: command({ type: "next_level" }),
      previousLevel: command({ type: "prev_level" }),
      addMinute: command({ type: "adjust_time", deltaMs: MINUTE_MS }),
      subtractMinute: command({ type: "adjust_time", deltaMs: -MINUTE_MS }),
      nextBreak: command({ type: "jump_to_next_break" }),
      undo: command({ type: "undo" }),
      redo: command({ type: "redo" }),
      switchTab: ({ combo }) => {
        const tab = tabs[Number(combo.key) - 1];
        if (tab) navigate(tab.to);
      },
      openDisplay: () => void engine.openDisplayWindow(id).catch((error: unknown) => report(toEngineError(error))),
      toggleFullscreen: () => void toggleFullscreen(engine.kind).catch(logFullscreenError),
      escape: () => void exitFullscreen(engine.kind).catch(logFullscreenError),
      showShortcuts: () => setOpen(true)
    },
    view !== null
  );

  const close = useCallback(() => setOpen(false), []);
  const openOverlay = useCallback(() => setOpen(true), []);
  const overlay = <ShortcutsOverlay open={open} onClose={close} tabs={tabs.map((tab) => tab.label)} />;
  return { overlay, openOverlay };
}
