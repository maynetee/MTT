import { useEffect, useRef, useState } from "react";
import type { View } from "../../engine/types";
import { usePreferences } from "../preferences/preferences";
import { playCue, useAudioState } from "./audio";
import { openSoundChannel, type SoundChannel } from "./channel";
import { soundPlaysHere, upcomingCues, type ScheduledCue, type WindowRole } from "./cues";

/** An open display repeats its announcement this often... */
export const PRESENCE_INTERVAL_MS = 2_000;
/** ...and counts as closed after this long without one (a window that closed without a word). */
export const PRESENCE_TIMEOUT_MS = 5_000;
/** A cue this late (a computer waking up, a throttled background tab) is skipped. */
export const MAX_CUE_DELAY_MS = 10_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface LevelSounds {
  /** This window is the one that plays the sounds. */
  playsHere: boolean;
  /** It should play but the browser has not allowed sound yet: a click in the window will. */
  needsUnlock: boolean;
}

/**
 * Plays the level cues of `view`'s tournament in this window, when it is the window that should
 * (see `soundPlaysHere`). Cues follow the local countdown, like the clock on screen: a timer
 * fires at each moment the running clock reaches, and nothing is ever written. A cue sounds at
 * most once per (tournament, level index, cue), so a refetch, an undo or a reload never repeats
 * or replays one.
 */
export function useLevelSounds(view: View | null, offsetMs: number, role: WindowRole): LevelSounds {
  const preferences = usePreferences();
  const tournament = view?.id ?? null;
  const channelRef = useRef<SoundChannel | null>(null);
  const [canAnnounce, setCanAnnounce] = useState(false);
  const [displayPlaying, setDisplayPlaying] = useState(false);

  const wants = preferences.sound && soundPlaysHere(role, preferences.soundOutput, { displayPlaying, canAnnounce });
  // The director's window waits for a first click to create its audio; the display tries at once.
  const audio = useAudioState(wants, role === "display");
  const playing = wants && audio === "running";

  // The latest values, for timers and messages.
  const latest = useRef({ playing, volume: preferences.volume });
  latest.current = { playing, volume: preferences.volume };
  const played = useRef(new Set<string>());

  useEffect(() => {
    if (tournament === null) return;
    const channel = openSoundChannel();
    channelRef.current = channel;
    setCanAnnounce(channel !== null);
    if (!channel) return;

    // Display windows heard from, by tournament, with when (only those that play).
    const heard = new Map<string, number>();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const recount = () => {
      const last = heard.get(tournament);
      setDisplayPlaying(last !== undefined && Date.now() - last < PRESENCE_TIMEOUT_MS);
    };
    const announce = () => channel.post({ type: "display", tournament, playing: latest.current.playing });
    const closed = () => channel.post({ type: "display_closed", tournament });

    channel.onmessage = (message) => {
      if (message.type === "played") {
        played.current.add(message.key);
      } else if (message.type === "query") {
        if (role === "display") announce();
      } else if (role === "control") {
        if (message.type === "display" && message.playing) heard.set(message.tournament, Date.now());
        else heard.delete(message.tournament);
        clearTimeout(expiry);
        expiry = setTimeout(recount, PRESENCE_TIMEOUT_MS);
        recount();
      }
    };

    let heartbeat: ReturnType<typeof setInterval> | undefined;
    if (role === "display") {
      announce();
      heartbeat = setInterval(announce, PRESENCE_INTERVAL_MS);
      window.addEventListener("pagehide", closed);
    } else {
      channel.post({ type: "query" });
    }
    return () => {
      clearInterval(heartbeat);
      clearTimeout(expiry);
      if (role === "display") {
        window.removeEventListener("pagehide", closed);
        closed();
      }
      channel.onmessage = null;
      channel.close();
      channelRef.current = null;
      setDisplayPlaying(false);
    };
  }, [role, tournament]);

  // A display tells the director's window at once when it starts or stops playing.
  useEffect(() => {
    if (role === "display" && tournament !== null) channelRef.current?.post({ type: "display", tournament, playing });
  }, [role, tournament, playing]);

  // Cues of the schedule in force that have not fired yet.
  const pending = useRef<ScheduledCue[]>([]);

  useEffect(() => {
    if (!view) return;
    const fire = (scheduled: ScheduledCue) => {
      pending.current = pending.current.filter((cue) => cue !== scheduled);
      if (played.current.has(scheduled.key)) return;
      played.current.add(scheduled.key);
      if (Date.now() + offsetMs - scheduled.atMs > MAX_CUE_DELAY_MS) return;
      const { playing, volume } = latest.current;
      if (playing && playCue(scheduled.cue, volume)) channelRef.current?.post({ type: "played", key: scheduled.key });
    };

    // A new view can arrive just after a moment the previous one was counting down to (the
    // refetch at a level change, a command sent right then): that moment was reached.
    const hostNow = Date.now() + offsetMs;
    for (const cue of pending.current) if (cue.atMs <= hostNow) fire(cue);

    pending.current = upcomingCues(view, hostNow).filter((cue) => !played.current.has(cue.key));
    const timers = pending.current.map((cue) =>
      setTimeout(() => fire(cue), Math.min(MAX_TIMEOUT_MS, Math.max(0, cue.atMs - offsetMs - Date.now())))
    );
    return () => timers.forEach(clearTimeout);
  }, [view, offsetMs]);

  return { playsHere: wants, needsUnlock: wants && audio === "locked" };
}
