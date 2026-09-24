import { isEditableTarget, isMac } from "../utils/keyboard";

/** ⌘ and ⇧ symbols on macOS, Ctrl+ and Shift+ elsewhere. */
export type Platform = "mac" | "other";

export function currentPlatform(): Platform {
  return isMac() ? "mac" : "other";
}

export type ShortcutId =
  | "toggleClock"
  | "nextLevel"
  | "previousLevel"
  | "addMinute"
  | "subtractMinute"
  | "nextBreak"
  | "undo"
  | "redo"
  | "switchTab"
  | "openDisplay"
  | "toggleFullscreen"
  | "escape"
  | "showShortcuts";

export type ShortcutGroup = "clock" | "history" | "window";

/**
 * One key combination. `key` is a `KeyboardEvent.key` value (letters in upper case) or a
 * named key (`Space`, `Escape`). `mod` is ⌘ on macOS and Ctrl elsewhere.
 */
export interface KeyCombo {
  key: string;
  mod?: boolean;
  shift?: boolean;
}

export interface ShortcutDefinition {
  id: ShortcutId;
  group: ShortcutGroup;
  /** Every combination that triggers it on this platform. */
  combos(platform: Platform): KeyCombo[];
  /** What the shortcuts overlay shows, when not the combinations themselves (tabs: 1–9). */
  display?: KeyCombo[];
}

export const TAB_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

const single =
  (...keys: string[]) =>
  (): KeyCombo[] =>
    keys.map((key) => ({ key }));

/** Every shortcut of the director window, in the order the overlay lists them. */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { id: "toggleClock", group: "clock", combos: single("Space") },
  { id: "nextLevel", group: "clock", combos: single("N") },
  { id: "previousLevel", group: "clock", combos: single("P") },
  { id: "addMinute", group: "clock", combos: single("+", "=") },
  { id: "subtractMinute", group: "clock", combos: single("-") },
  { id: "nextBreak", group: "clock", combos: single("B") },
  { id: "undo", group: "history", combos: () => [{ key: "Z", mod: true }] },
  {
    id: "redo",
    group: "history",
    // Ctrl+Y is the Windows and Linux habit; on macOS ⌘Y opens the history in most apps.
    combos: (platform) => (platform === "mac" ? [{ key: "Z", mod: true, shift: true }] : [{ key: "Z", mod: true, shift: true }, { key: "Y", mod: true }])
  },
  { id: "switchTab", group: "window", combos: single(...TAB_KEYS), display: [{ key: "1–9" }] },
  { id: "openDisplay", group: "window", combos: single("D") },
  { id: "toggleFullscreen", group: "window", combos: single("F") },
  { id: "escape", group: "window", combos: single("Escape") },
  { id: "showShortcuts", group: "window", combos: single("?") }
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["clock", "history", "window"];

export function shortcut(id: ShortcutId): ShortcutDefinition {
  const found = SHORTCUTS.find((definition) => definition.id === id);
  if (!found) throw new Error(`unknown shortcut ${id}`);
  return found;
}

export interface ShortcutMatch {
  id: ShortcutId;
  combo: KeyCombo;
}

type KeyEventLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

const NAMED_KEYS: Record<string, string[]> = { Space: [" ", "Spacebar"], Escape: ["Escape", "Esc"] };

/**
 * Symbols and digits sit on shifted keys on some layouts (`+` on US keyboards, digits on
 * French ones), so Shift does not matter for them. Letters and named keys need the exact
 * Shift state.
 */
function shiftSensitive(key: string): boolean {
  return /^[A-Z]$/.test(key) || key in NAMED_KEYS;
}

function comboMatches(event: KeyEventLike, combo: KeyCombo, platform: Platform): boolean {
  const mod = platform === "mac" ? event.metaKey : event.ctrlKey;
  const otherMod = platform === "mac" ? event.ctrlKey : event.metaKey;
  if (event.altKey || otherMod || mod !== Boolean(combo.mod)) return false;
  if (shiftSensitive(combo.key) && event.shiftKey !== Boolean(combo.shift)) return false;
  const named = NAMED_KEYS[combo.key];
  if (named) return named.includes(event.key);
  return event.key.length === 1 && event.key.toUpperCase() === combo.key;
}

/** The shortcut a key press stands for on `platform`, if any. */
export function matchShortcut(event: KeyEventLike, platform: Platform): ShortcutMatch | null {
  for (const definition of SHORTCUTS) {
    const combo = definition.combos(platform).find((candidate) => comboMatches(event, candidate, platform));
    if (combo) return { id: definition.id, combo };
  }
  return null;
}

/** Controls that Space activates. Not links: Space only scrolls there (a tab just clicked). */
const INTERACTIVE = [
  "button",
  "summary",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='option']"
].join(",");

/** Inputs where a key press types nothing: shortcuts still apply there (Space excepted). */
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement && NON_TEXT_INPUTS.has(target.type)) return false;
  return isEditableTarget(target);
}

/** Space on a focused control activates it: that wins over the clock. */
function activatesOnSpace(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE) !== null;
}

/**
 * Whether a matched shortcut may run: never while typing in a field (native editing wins,
 * text undo included), never behind a dialog except Esc, never on key repeat (holding a key
 * must not record a burst of commands), and Space leaves focused controls alone.
 */
export function shortcutAllowed(event: KeyboardEvent, match: ShortcutMatch): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat) return false;
  if (isTyping(event.target) || isTyping(document.activeElement)) return false;
  if (match.id !== "escape" && document.querySelector('[aria-modal="true"]')) return false;
  if (match.id === "toggleClock" && (activatesOnSpace(event.target) || activatesOnSpace(document.activeElement))) return false;
  return true;
}

/** Key names for `aria-keyshortcuts` (UI Events key values; `+` is the separator). */
function ariaKey(key: string): string {
  return key === "+" ? "Plus" : key;
}

export function ariaCombo(combo: KeyCombo, platform: Platform): string {
  return [combo.shift && "Shift", combo.mod && (platform === "mac" ? "Meta" : "Control"), ariaKey(combo.key)].filter(Boolean).join("+");
}

/** The `aria-keyshortcuts` value of a shortcut, every combination included. */
export function ariaKeyShortcuts(id: ShortcutId, platform: Platform): string {
  return shortcut(id)
    .combos(platform)
    .map((combo) => ariaCombo(combo, platform))
    .join(" ");
}

/** Localized names of the keys that are words. */
export interface KeyNames {
  space: string;
  escape: string;
  ctrl: string;
  shift: string;
}

function keyLabel(key: string, names: KeyNames): string {
  if (key === "Space") return names.space;
  if (key === "Escape") return names.escape;
  if (key === "-") return "−";
  return key;
}

/** `⇧⌘Z` on macOS, `Ctrl+Shift+Z` elsewhere. */
export function formatCombo(combo: KeyCombo, platform: Platform, names: KeyNames): string {
  const key = keyLabel(combo.key, names);
  if (platform === "mac") return `${combo.shift ? "⇧" : ""}${combo.mod ? "⌘" : ""}${key}`;
  return [combo.mod && names.ctrl, combo.shift && names.shift, key].filter(Boolean).join("+");
}

/** The labels of a shortcut's combinations, as the overlay and the tooltips show them. */
export function shortcutLabels(id: ShortcutId, platform: Platform, names: KeyNames): string[] {
  const definition = shortcut(id);
  return (definition.display ?? definition.combos(platform)).map((combo) => formatCombo(combo, platform, names));
}
