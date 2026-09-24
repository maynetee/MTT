import { useEffect, useReducer } from "react";
import type { ClockView, View } from "../../engine/types";

export const CLOCK_TICK_MS = 250;

export interface LocalClock {
  remainingMs: number;
  /** Time past the end of the last level. */
  overtimeMs: number;
  /** Clock time elapsed since the view was generated (0 while paused). */
  elapsedMs: number;
}

/** The clock at `hostNowMs`, from a view generated at `generatedAtMs`. Pure. */
export function localClock(clock: ClockView, generatedAtMs: number, hostNowMs: number): LocalClock {
  if (!clock.running || clock.endsAtMs === null) {
    return { remainingMs: clock.remainingMs, overtimeMs: clock.overtimeMs, elapsedMs: 0 };
  }
  return {
    remainingMs: Math.max(0, clock.endsAtMs - hostNowMs),
    overtimeMs: clock.next === null ? Math.max(0, hostNowMs - clock.endsAtMs) : 0,
    elapsedMs: Math.max(0, hostNowMs - generatedAtMs)
  };
}

/**
 * Counts down locally from `view.clock.endsAtMs` while running (from `remainingMs` when
 * paused), re-rendering every 250 ms. `offsetMs` (host clock minus local clock) corrects the
 * skew between the host that generated the view and this window. Nothing is written per tick.
 */
export function useClock(view: View | null, offsetMs: number): LocalClock {
  const running = view?.clock.running ?? false;
  const [, tick] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(tick, CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [running]);

  if (!view) return { remainingMs: 0, overtimeMs: 0, elapsedMs: 0 };
  return localClock(view.clock, view.generatedAtMs, Date.now() + offsetMs);
}
