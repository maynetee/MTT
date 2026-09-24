import { afterEach, describe, expect, it } from "vitest";
import { ariaKeyShortcuts, matchShortcut, shortcutAllowed, shortcutLabels, SHORTCUTS, type Platform, type ShortcutId } from "./shortcuts";

type Press = Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">>;

const press = (key: string, modifiers: Press = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers });
const matched = (key: string, platform: Platform, modifiers: Press = {}) => matchShortcut(press(key, modifiers), platform)?.id ?? null;

const names = { space: "Space", escape: "Esc", ctrl: "Ctrl", shift: "Shift" };

describe("matchShortcut", () => {
  it.each<[string, Press, ShortcutId]>([
    [" ", {}, "toggleClock"],
    ["n", {}, "nextLevel"],
    ["p", {}, "previousLevel"],
    ["+", { shiftKey: true }, "addMinute"],
    ["=", {}, "addMinute"],
    ["-", {}, "subtractMinute"],
    ["b", {}, "nextBreak"],
    ["d", {}, "openDisplay"],
    ["f", {}, "toggleFullscreen"],
    ["Escape", {}, "escape"],
    ["?", { shiftKey: true }, "showShortcuts"],
    ["1", {}, "switchTab"],
    ["9", {}, "switchTab"]
  ])("maps %j to its shortcut on every platform", (key, modifiers, id) => {
    expect(matched(key, "mac", modifiers)).toBe(id);
    expect(matched(key, "other", modifiers)).toBe(id);
  });

  it("reads letters whatever the Caps Lock state", () => {
    expect(matched("N", "other")).toBe("nextLevel");
  });

  it("tells which tab a digit opens, Shift included (digits are shifted on AZERTY keyboards)", () => {
    expect(matchShortcut(press("6", { shiftKey: true }), "other")).toEqual({ id: "switchTab", combo: { key: "6" } });
    expect(matched("0", "other")).toBeNull();
  });

  it("leaves letters with Shift, Alt, Ctrl or ⌘ to the browser", () => {
    for (const modifiers of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      expect(matched("n", "mac", modifiers)).toBeNull();
      expect(matched("n", "other", modifiers)).toBeNull();
    }
    // Find, reload and friends stay native.
    expect(matched("f", "mac", { metaKey: true })).toBeNull();
    expect(matched("f", "other", { ctrlKey: true })).toBeNull();
    expect(matched(" ", "other", { shiftKey: true })).toBeNull();
  });

  it("undoes with ⌘Z on macOS and Ctrl+Z elsewhere", () => {
    expect(matched("z", "mac", { metaKey: true })).toBe("undo");
    expect(matched("z", "mac", { ctrlKey: true })).toBeNull();
    expect(matched("z", "other", { ctrlKey: true })).toBe("undo");
    expect(matched("z", "other", { metaKey: true })).toBeNull();
    expect(matched("z", "other")).toBeNull();
  });

  it("redoes with Shift and the platform modifier, and with Ctrl+Y outside macOS", () => {
    expect(matched("Z", "mac", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(matched("z", "mac", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(matched("y", "mac", { metaKey: true })).toBeNull();
    expect(matched("y", "mac", { ctrlKey: true })).toBeNull();
    expect(matched("Z", "other", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(matched("y", "other", { ctrlKey: true })).toBe("redo");
    expect(matched("y", "other", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(matched("z", "other", { ctrlKey: true, altKey: true })).toBeNull();
  });
});

describe("shortcut labels", () => {
  it("uses ⌘ and ⇧ on macOS and Ctrl and Shift elsewhere", () => {
    expect(shortcutLabels("undo", "mac", names)).toEqual(["⌘Z"]);
    expect(shortcutLabels("redo", "mac", names)).toEqual(["⇧⌘Z"]);
    expect(shortcutLabels("undo", "other", names)).toEqual(["Ctrl+Z"]);
    expect(shortcutLabels("redo", "other", names)).toEqual(["Ctrl+Shift+Z", "Ctrl+Y"]);
  });

  it("names keys in words where they have no character", () => {
    expect(shortcutLabels("toggleClock", "mac", names)).toEqual(["Space"]);
    expect(shortcutLabels("escape", "other", { ...names, escape: "Échap" })).toEqual(["Échap"]);
    expect(shortcutLabels("subtractMinute", "other", names)).toEqual(["−"]);
    expect(shortcutLabels("addMinute", "other", names)).toEqual(["+", "="]);
    expect(shortcutLabels("switchTab", "other", names)).toEqual(["1–9"]);
  });

  it("gives aria-keyshortcuts values", () => {
    expect(ariaKeyShortcuts("undo", "mac")).toBe("Meta+Z");
    expect(ariaKeyShortcuts("redo", "mac")).toBe("Shift+Meta+Z");
    expect(ariaKeyShortcuts("undo", "other")).toBe("Control+Z");
    expect(ariaKeyShortcuts("redo", "other")).toBe("Shift+Control+Z Control+Y");
    expect(ariaKeyShortcuts("addMinute", "other")).toBe("Plus =");
    expect(ariaKeyShortcuts("toggleClock", "other")).toBe("Space");
  });

  it("puts every shortcut in a group", () => {
    expect(new Set(SHORTCUTS.map((definition) => definition.id)).size).toBe(SHORTCUTS.length);
    expect(SHORTCUTS.every((definition) => ["clock", "history", "window"].includes(definition.group))).toBe(true);
  });
});

describe("shortcutAllowed", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function keydown(key: string, target: HTMLElement = document.body, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, "target", { value: target });
    return event;
  }

  const next = { id: "nextLevel", combo: { key: "N" } } as const;
  const space = { id: "toggleClock", combo: { key: "Space" } } as const;
  const escape = { id: "escape", combo: { key: "Escape" } } as const;

  function add(html: string): HTMLElement {
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    return container.firstElementChild as HTMLElement;
  }

  it("runs on the page", () => {
    expect(shortcutAllowed(keydown("n"), next)).toBe(true);
    expect(shortcutAllowed(keydown(" "), space)).toBe(true);
  });

  it("stands aside while typing in a field", () => {
    const input = add(`<input type="text" />`);
    expect(shortcutAllowed(keydown("n", input), next)).toBe(false);
    const editable = add(`<div contenteditable="true"></div>`);
    expect(shortcutAllowed(keydown("n", editable), next)).toBe(false);
    input.focus();
    expect(shortcutAllowed(keydown("n"), next)).toBe(false);
  });

  it("still works from a checkbox or a radio button, but leaves Space to them", () => {
    const checkbox = add(`<input type="checkbox" />`);
    expect(shortcutAllowed(keydown("n", checkbox), next)).toBe(true);
    expect(shortcutAllowed(keydown(" ", checkbox), space)).toBe(false);
  });

  it("leaves Space to a focused button, but not to a link (Space does not follow links)", () => {
    const button = add(`<button type="button"><span>Go</span></button>`);
    expect(shortcutAllowed(keydown(" ", button.querySelector("span")!), space)).toBe(false);
    expect(shortcutAllowed(keydown("n", button), next)).toBe(true);
    const link = add(`<a href="#/x">x</a>`);
    expect(shortcutAllowed(keydown(" ", link), space)).toBe(true);
  });

  it("only lets Esc through while a dialog is open", () => {
    add(`<div role="dialog" aria-modal="true"></div>`);
    expect(shortcutAllowed(keydown("n"), next)).toBe(false);
    expect(shortcutAllowed(keydown("Escape"), escape)).toBe(true);
  });

  it("ignores key repeat and keys already handled", () => {
    expect(shortcutAllowed(keydown("n", document.body, { repeat: true }), next)).toBe(false);
    const handled = keydown("n");
    handled.preventDefault();
    expect(shortcutAllowed(handled, next)).toBe(false);
  });
});
