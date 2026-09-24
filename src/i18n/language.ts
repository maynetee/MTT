import { useSyncExternalStore } from "react";

/** The languages of the app. */
export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

/** What the director chose: follow the system, or a fixed language. */
export type LanguagePreference = "system" | Locale;
export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ["system", "en", "fr"];
export const LANGUAGE_STORAGE_KEY = "mtt:language";

/** Each language's own name, the same whatever the language of the page. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", fr: "Français" };

export interface LanguageState {
  preference: LanguagePreference;
  /** The language the pages use. */
  locale: Locale;
  /** The language the system asks for (what `system` gives). */
  system: Locale;
}

function isPreference(value: unknown): value is LanguagePreference {
  return typeof value === "string" && (LANGUAGE_PREFERENCES as readonly string[]).includes(value);
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

/**
 * The first of the user's languages that the app speaks (`fr-CA` gives French), English when
 * none is: a German system with French second gets French, one with English second English.
 */
export function systemLocale(languages: readonly string[] = browserLanguages()): Locale {
  for (const tag of languages) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    const match = LOCALES.find((locale) => locale === language);
    if (match) return match;
  }
  return "en";
}

// Storage unavailable (private mode, blocked): the choice lasts until the window closes.
let fallback: string | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

let cached: LanguageState | null = null;
const listeners = new Set<() => void>();

function snapshot(): LanguageState {
  const raw = readRaw() ?? fallback;
  const preference = isPreference(raw) ? raw : "system";
  const system = systemLocale();
  if (cached?.preference !== preference || cached.system !== system) {
    cached = { preference, system, locale: preference === "system" ? system : preference };
  }
  return cached;
}

/** The stored preference and the language it gives. */
export function readLanguage(): LanguageState {
  return snapshot();
}

/** Stores the choice on this device; every open window follows it. */
export function setLanguagePreference(preference: LanguagePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    else window.localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    fallback = preference === "system" ? null : preference;
  }
  notify();
}

function notify() {
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) notify();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    // Another window of this device changed it, or the system's languages changed.
    window.addEventListener("storage", onStorage);
    window.addEventListener("languagechange", notify);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("languagechange", notify);
    }
  };
}

/** The language preference of this device; re-renders when it changes here or in another window. */
export function useLanguage(): LanguageState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
