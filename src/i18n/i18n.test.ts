import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTranslate } from "./translate";
import { en } from "./en";
import { formatDuration, i18n, t } from "./index";

const bindingsDir = join(dirname(fileURLToPath(import.meta.url)), "../bindings");

/** `{ code, params }` variants of a generated ts-rs union, with their parameter names. */
function variants(file: string): Map<string, string[]> {
  const source = readFileSync(join(bindingsDir, file), "utf8");
  const found = new Map<string, string[]>();
  for (const match of source.matchAll(/\{ "code": "([A-Z_]+)"(?:, "params": \{([^}]*)\})? \}/g)) {
    const params = [...(match[2] ?? "").matchAll(/(\w+):/g)].map((param) => param[1]);
    found.set(match[1], params);
  }
  return found;
}

/** Parameters the UI derives from the raw ones (see displayParams in core.ts). */
function derived(params: string[]): string[] {
  const extra: string[] = [];
  for (const param of params) {
    if (param.endsWith("Ms")) extra.push(param.slice(0, -2));
    if (param === "index" || param === "level") extra.push("row");
    if (param === "level") extra.push("rows");
    if (param === "levelsLeft") extra.push("count");
  }
  return [...params, ...extra];
}

function placeholders(message: string | { one: string; other: string; zero?: string }): string[] {
  const texts = typeof message === "string" ? [message] : Object.values(message);
  return [...new Set(texts.flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))];
}

describe("error messages", () => {
  const domainErrors = variants("DomainError.ts");

  it("reads the error codes from the generated bindings", () => {
    expect(domainErrors.size).toBeGreaterThan(60);
    expect(domainErrors.get("SEAT_OCCUPIED")).toEqual(["table", "seat"]);
  });

  it.each([...domainErrors.keys(), "HOST_ERROR", "NOT_FOUND"])("has an English message for %s", (code) => {
    expect(en.errors).toHaveProperty(code);
  });

  it("only uses parameters the error carries", () => {
    const host = new Map([
      ["HOST_ERROR", ["message"]],
      ["NOT_FOUND", ["id"]]
    ]);
    for (const [code, message] of Object.entries(en.errors)) {
      const params = domainErrors.get(code) ?? host.get(code);
      expect(params, `${code} is not an error code`).toBeDefined();
      for (const name of placeholders(message)) {
        expect(derived(params!), `${code} uses {${name}}`).toContain(name);
      }
    }
  });

  it("has a message for every warning, with its parameters", () => {
    const warnings = variants("Warning.ts");
    expect(warnings.size).toBeGreaterThan(3);
    for (const [code, params] of warnings) {
      expect(en.warnings, code).toHaveProperty(code);
      for (const name of placeholders(en.warnings[code as keyof typeof en.warnings])) {
        expect(derived(params), `${code} uses {${name}}`).toContain(name);
      }
    }
  });

  it("formats params for display", () => {
    const names = (player: number) => (player === 7 ? "Łukasz" : undefined);
    expect(i18n.error({ code: "NAME_TAKEN", params: { player: 7 } }, names)).toBe("Łukasz is already registered.");
    expect(i18n.error({ code: "PLAYER_NOT_ACTIVE", params: { player: 9 } }, names)).toBe("#9 is not in play.");
    expect(i18n.error({ code: "INVALID_BLINDS", params: { index: 2 } })).toMatch(/^Row 3: /);
    expect(i18n.error({ code: "INVALID_TIME_ADJUSTMENT", params: { maxMs: 86_400_000 } })).toBe(
      "The clock can move by at most 24 hr at once."
    );
    expect(i18n.error({ code: "CONFIG_LOCKED", params: { field: "seatsPerTable" } })).toBe(
      "Seats per table cannot change once the tournament has started."
    );
    expect(i18n.error({ code: "LEVEL_OUT_OF_RANGE", params: { level: 9, max: 3 } })).toBe(
      "Row 10 does not exist: the structure has 4 rows."
    );
    expect(i18n.error({ code: "NOTHING_TO_UNDO" })).toBe("Nothing to undo.");
    expect(i18n.error({ code: "HOST_ERROR", params: { message: "disk full" } })).toBe("Something went wrong: disk full");
    expect(i18n.error({ code: "FROM_THE_FUTURE" } as never)).toBe("Something went wrong: FROM_THE_FUTURE");
  });

  it("formats warnings with plurals", () => {
    expect(i18n.warning({ code: "STRUCTURE_ENDING", params: { levelsLeft: 2 } })).toBe("Only 2 levels left in the structure.");
    expect(i18n.warning({ code: "STRUCTURE_ENDING", params: { levelsLeft: 1 } })).toBe("Only 1 level left in the structure.");
    expect(i18n.warning({ code: "STRUCTURE_ENDING", params: { levelsLeft: 0 } })).toBe("This is the last level of the structure.");
    expect(i18n.warning({ code: "ANTE_ABOVE_BIG_BLIND", params: { index: 0 } })).toMatch(/^Row 1: /);
  });
});

describe("t", () => {
  it("interpolates parameters and formats numbers", () => {
    expect(t("common.tableSeat", { table: 2, seat: 5 })).toBe("Table 2 Seat 5");
    expect(t("config.capacitySeats", { count: 1200 })).toBe("1,200 seats");
    expect(t("display.averageStackBb", { chips: "12,500", bb: "62.5" })).toBe("Average stack: 12,500 (62.5 BB)");
  });

  it("picks plural forms from the count", () => {
    expect(t("seating.players", { count: 1 })).toBe("1 player");
    expect(t("seating.players", { count: 0 })).toBe("0 players");
    expect(t("display.toMoney", { count: 3 })).toBe("3 eliminations to the money");
  });

  it("returns the key when a message is missing and keeps unknown placeholders", () => {
    const translate = createTranslate({ a: { b: "Hello {name}" } }, "en");
    expect(translate("a.c")).toBe("a.c");
    expect(translate("a")).toBe("a");
    expect(translate("a.b")).toBe("Hello {name}");
  });

  it("labels undoable actions with the players and table involved", () => {
    const label = { seq: 5, atMs: 0, table: null, kind: "players_busted", names: ["Ann", "Ben", "Cat"] };
    expect(i18n.action(label)).toBe("eliminate Ann, Ben, and Cat");
    expect(i18n.action({ ...label, kind: "table_broken", names: [], table: 3 })).toBe("break table 3");
    expect(i18n.action({ ...label, kind: "rebuy_added", names: [] })).toBe("rebuy_added");
  });
});

describe("formatting", () => {
  it("formats clock durations, rounding up to the second", () => {
    expect(formatDuration(754_000)).toBe("12:34");
    expect(formatDuration(753_001)).toBe("12:34");
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(-5)).toBe("00:00");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });

  it("formats numbers, big blinds, times and durations for the locale", () => {
    expect(i18n.number(1234567)).toBe("1,234,567");
    expect(i18n.bigBlinds(6250)).toBe("62.5");
    expect(i18n.bigBlinds(4000)).toBe("40");
    expect(i18n.durationWords(90 * 60_000)).toBe("90 min");
    expect(i18n.durationWords(2 * 3_600_000)).toBe("2 hr");
    expect(i18n.timeOfDay(new Date(2026, 0, 1, 21, 5).getTime())).toMatch(/^09:05\sPM$/);
  });
});
