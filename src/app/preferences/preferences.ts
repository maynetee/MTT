import { useSyncExternalStore } from "react";

/** Which window plays the level sounds; see `soundPlaysHere` in ../sound/rules.ts. */
export type SoundOutput = "auto" | "control" | "display";
export const SOUND_OUTPUTS: readonly SoundOutput[] = ["auto", "control", "display"];

/**
 * Settings of this device, not of a tournament: they live in localStorage, so every window of
 * the app on this computer shares them (the display follows a change made in the director's
 * window at once).
 */
export interface Preferences {
  /** Level sounds and the one-minute warning. */
  sound: boolean;
  /** From 0 to 1. */
  volume: number;
  soundOutput: SoundOutput;
}

export const DEFAULT_PREFERENCES: Preferences = { sound: true, volume: 0.8, soundOutput: "auto" };
export const PREFERENCES_STORAGE_KEY = "mtt:preferences";

/** Stored preferences, field by field: a missing or invalid field keeps its default. */
export function parsePreferences(raw: string | null): Preferences {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) stored = parsed as Record<string, unknown>;
  } catch {
    // Unreadable: the defaults.
  }
  const { sound, volume, soundOutput } = stored;
  return {
    sound: typeof sound === "boolean" ? sound : DEFAULT_PREFERENCES.sound,
    volume: typeof volume === "number" && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_PREFERENCES.volume,
    soundOutput: (SOUND_OUTPUTS as readonly unknown[]).includes(soundOutput) ? (soundOutput as SoundOutput) : DEFAULT_PREFERENCES.soundOutput
  };
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
  } catch {
    return null;
  }
}

// Storage unavailable (private mode, blocked): the choices last until the window closes.
let fallback: string | null = null;
let cached: { raw: string | null; value: Preferences } | null = null;
const listeners = new Set<() => void>();

function snapshot(): Preferences {
  const raw = readRaw() ?? fallback;
  if (cached?.raw !== raw) cached = { raw, value: parsePreferences(raw) };
  return cached.value;
}

export function readPreferences(): Preferences {
  return snapshot();
}

/** Stores a change; every window of this device picks it up. */
export function setPreferences(patch: Partial<Preferences>): void {
  const raw = JSON.stringify({ ...snapshot(), ...patch });
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, raw);
  } catch {
    fallback = raw;
  }
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key === PREFERENCES_STORAGE_KEY || event.key === null) listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** This device's preferences; re-renders when they change here or in another window. */
export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
