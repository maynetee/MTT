import { useEffect, useSyncExternalStore } from "react";
import { scheduleCue, type Cue } from "./tones";

/** `unavailable` without Web Audio; `locked` until the browser lets this window play sound. */
export type AudioState = "unavailable" | "locked" | "running";

type AudioContextClass = new () => AudioContext;

/** User gestures that let a page start audio (a mouse move does not count). */
const GESTURES = ["pointerdown", "mousedown", "touchend", "keydown"] as const;

let context: AudioContext | null = null;
/** Sound was asked for: the next gesture creates the context if it does not exist yet. */
let wanted = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function audioContextClass(): AudioContextClass | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function create(): AudioContext | null {
  const AudioContextClass = audioContextClass();
  if (!AudioContextClass) return null;
  try {
    context = new AudioContextClass();
  } catch {
    return null;
  }
  context.addEventListener("statechange", notify);
  notify();
  return context;
}

/**
 * Browsers start an AudioContext suspended until the user interacts with the page. Create or
 * resume it from inside the gesture handler (Safari requires that); the listeners stay armed
 * because the system may suspend the context again (sleep, audio device change).
 */
const unlock = () => {
  if (!context && wanted) create();
  if (context && context.state !== "running" && context.state !== "closed") {
    context.resume().then(notify, () => {});
  }
};

/**
 * The window's AudioContext, created on first use; null without Web Audio. Not `eager`: a page
 * nobody has interacted with yet waits for the first gesture instead (no console warning about
 * a context not allowed to start). The display is eager: nobody may ever click a TV, and some
 * hosts let it play anyway.
 */
export function ensureAudio(eager = true): AudioContext | null {
  if (context) return context;
  if (!wanted) {
    wanted = true;
    for (const type of GESTURES) window.addEventListener(type, unlock, { capture: true, passive: true });
  }
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (!eager && activation && !activation.hasBeenActive) return null;
  return create();
}

export function audioState(): AudioState {
  if (!context) return audioContextClass() ? "locked" : "unavailable";
  return context.state === "running" ? "running" : "locked";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether this window can play sound; asks for the context while `active` (see ensureAudio). */
export function useAudioState(active: boolean, eager = true): AudioState {
  useEffect(() => {
    if (active) ensureAudio(eager);
  }, [active, eager]);
  return useSyncExternalStore(subscribe, audioState, audioState);
}

/** Plays a cue if the window may play sound; returns whether it did. Never queues a locked cue. */
export function playCue(cue: Cue, volume: number): boolean {
  if (!context || context.state !== "running" || volume <= 0) return false;
  scheduleCue(context, cue, volume);
  return true;
}

/** For a click (a test button): unlocks the audio if needed, then plays. */
export function previewCue(cue: Cue, volume: number): void {
  const audio = ensureAudio();
  if (!audio) return;
  if (audio.state === "running") {
    playCue(cue, volume);
    return;
  }
  audio.resume().then(
    () => {
      notify();
      playCue(cue, volume);
    },
    () => {}
  );
}

/** Forgets the AudioContext, as if the window opened again; for tests. */
export function resetAudio(): void {
  for (const type of GESTURES) window.removeEventListener(type, unlock, { capture: true });
  context?.removeEventListener("statechange", notify);
  void context?.close().catch(() => {});
  context = null;
  wanted = false;
  notify();
}
