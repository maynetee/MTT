import type { ClockView, View } from "../../engine/types";
import type { SoundOutput } from "../preferences/preferences";
import type { Cue } from "./tones";

export const ONE_MINUTE_MS = 60_000;

/** A cue due at `atMs` on the host clock. */
export interface ScheduledCue {
  cue: Cue;
  /** One sound per (tournament, level index, cue), whatever refetches, undos or windows. */
  key: string;
  atMs: number;
}

export function cueKey(tournament: string, levelIndex: number, cue: Cue): string {
  return `${tournament}:${levelIndex}:${cue}`;
}

/** What the end of the current level sounds like, from what comes next. */
export function boundaryCue(clock: ClockView): Cue {
  const nextIsBreak = clock.next?.level.type === "break";
  if (nextIsBreak) return "breakStart";
  if (clock.isBreak && clock.next) return "breakEnd";
  // Play to play, and the end of the last level (overtime starts).
  return "levelChange";
}

/**
 * The cues still ahead in the running level: one minute left (only in levels longer than a
 * minute, and only if that moment is still to come) and the end of the level. Only what the
 * clock will reach by itself: a paused clock, a jump or a time change never sounds, and a
 * window that opens late never plays what it missed.
 */
export function upcomingCues(view: View, hostNowMs: number): ScheduledCue[] {
  const { clock } = view;
  if (view.phase !== "running" || !clock.running || clock.endsAtMs === null) return [];
  const cues: ScheduledCue[] = [];
  const oneMinuteAt = clock.endsAtMs - ONE_MINUTE_MS;
  if (clock.durationMs > ONE_MINUTE_MS && oneMinuteAt > hostNowMs) {
    cues.push({ cue: "oneMinute", key: cueKey(view.id, clock.levelIndex, "oneMinute"), atMs: oneMinuteAt });
  }
  if (clock.endsAtMs > hostNowMs) {
    const cue = boundaryCue(clock);
    cues.push({ cue, key: cueKey(view.id, clock.levelIndex, cue), atMs: clock.endsAtMs });
  }
  return cues;
}

/** The director's window, or the public display. */
export type WindowRole = "control" | "display";

/**
 * Whether this window plays the level sounds. Exactly one kind of window plays, so the room
 * never hears a cue twice:
 * - `control`: the director's window; the display stays silent.
 * - `display`: the display window; the director's window stays silent, even with no display.
 * - `auto` (default): the display window while one is open for this tournament and able to
 *   play (the browser unlocks its sound on a first click there); otherwise the director's
 *   window. The display announces itself on a BroadcastChannel; where there is none, the
 *   display cannot be heard from, so it stays silent and the director's window plays.
 */
export function soundPlaysHere(
  role: WindowRole,
  output: SoundOutput,
  { displayPlaying, canAnnounce }: { displayPlaying: boolean; canAnnounce: boolean }
): boolean {
  if (output === "control") return role === "control";
  if (output === "display") return role === "display";
  return role === "display" ? canAnnounce : !displayPlaying;
}
