import { useSyncExternalStore } from "react";

/** What the director chose: follow the system, or a fixed theme. */
export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];
export const THEME_STORAGE_KEY = "mtt:theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
}

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** The stored preference; `system` when none is stored or storage is unavailable. */
export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function systemTheme(): Theme {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? systemTheme() : preference;
}

let state: ThemeState | null = null;
const listeners = new Set<() => void>();

function stateFor(preference: ThemePreference): ThemeState {
  return { preference, theme: resolveTheme(preference) };
}

function snapshot(): ThemeState {
  state ??= stateFor(readThemePreference());
  return state;
}

function apply(next: ThemeState) {
  state = next;
  const root = document.documentElement;
  root.dataset.theme = next.theme;
  root.dataset.themePreference = next.preference;
  listeners.forEach((listener) => listener());
}

let watchingSystem = false;

/** Applies the stored theme to <html> and follows system changes; call before the first render. */
export function initTheme(): void {
  apply(stateFor(readThemePreference()));
  if (watchingSystem || typeof window.matchMedia !== "function") return;
  watchingSystem = true;
  window.matchMedia(DARK_QUERY).addEventListener?.("change", () => {
    const { preference } = snapshot();
    if (preference === "system") apply(stateFor(preference));
  });
}

/** Stores and applies a preference. Per device: it belongs to the screen, not the tournament. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable: the choice lasts until the window closes.
  }
  apply(stateFor(preference));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current preference and resolved theme; re-renders when either changes. */
export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Forgets the cached state, as if the app started again; for tests. */
export function resetTheme(): void {
  state = null;
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
}
