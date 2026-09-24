import { describe, expect, it } from "vitest";
import type { Level } from "../../engine/types";
import { createTestEngine, tournamentInput } from "../../test/wasm";
import { PRESETS, PRESET_MIN_DURATION_MS, PRESET_SPEEDS, bigBlindAt, presetStructure, summarize } from "./presets";

const STACKS = [1_000, 1_500, 5_000, 10_000, 20_000, 25_000, 30_000, 50_000, 75_000, 100_000, 1_000_000];
const HOUR_MS = 3_600_000;

type Play = Extract<Level, { type: "play" }>;
const plays = (levels: Level[]) => levels.filter((level): level is Play => level.type === "play");

describe("structure presets", () => {
  it.each(PRESET_SPEEDS.flatMap((speed) => STACKS.map((stack) => [speed, stack] as const)))(
    "%s from a %i stack passes the core's validation without warnings",
    async (speed, stack) => {
      const structure = presetStructure(speed, stack);
      const engine = createTestEngine();
      const id = await engine.createTournament(
        tournamentInput({ startingStack: stack, lateReg: { type: "end_of_play_level", n: 6, throughBreak: true } }, structure)
      );
      const view = await engine.getView(id);
      expect(view.warnings).toEqual([]);
      expect(view.levels.map((row) => row.level)).toEqual(structure);
    }
  );

  it.each(PRESET_SPEEDS.flatMap((speed) => STACKS.map((stack) => [speed, stack] as const)))(
    "%s from a %i stack follows the rules of a good structure",
    (speed, stack) => {
      const spec = PRESETS[speed];
      const levels = presetStructure(speed, stack);
      const play = plays(levels);

      // Lasts ten hours, within the core's 200 levels, and never ends on a break.
      expect(summarize(levels).totalMs).toBeGreaterThanOrEqual(PRESET_MIN_DURATION_MS);
      expect(levels.length).toBeLessThanOrEqual(200);
      expect(levels.at(-1)!.type).toBe("play");
      // Starts at 100 to 200 big blinds (tiny stacks aside, where the ladder is coarse).
      const start = stack / play[0].bb;
      if (stack >= 10_000) expect(start).toBeGreaterThanOrEqual(100);
      if (stack >= 10_000) expect(start).toBeLessThanOrEqual(200);
      // Level durations, and blinds that always go up with the small blind half the big blind.
      for (const [index, level] of play.entries()) {
        expect(level.durationMs).toBe(spec.levelMinutes * 60_000);
        expect(level.sb * 2).toBe(level.bb);
        if (index > 0) expect(level.bb).toBeGreaterThan(play[index - 1].bb);
        expect(level.ante).toEqual(index + 1 >= spec.bbaFrom ? { type: "big_blind", amount: level.bb } : { type: "none" });
      }
      // Growth between 20 % and 100 % per level.
      for (let i = 1; i < play.length; i++) {
        expect(play[i].bb / play[i - 1].bb).toBeGreaterThanOrEqual(1.2);
        expect(play[i].bb / play[i - 1].bb).toBeLessThanOrEqual(2);
      }
      // A break about every two hours.
      let sinceBreak = 0;
      for (const level of levels) {
        if (level.type === "break") {
          expect(sinceBreak).toBeGreaterThanOrEqual(1.5 * HOUR_MS);
          expect(sinceBreak).toBeLessThanOrEqual(2 * HOUR_MS);
          sinceBreak = 0;
        } else sinceBreak += level.durationMs;
      }
      // A color-up only removes chips that no later level needs.
      levels.forEach((level, index) => {
        if (level.type !== "break" || level.colorUp === null) return;
        for (const later of plays(levels.slice(index))) {
          expect(later.sb % level.colorUp).toBe(0);
          expect(later.bb % level.colorUp).toBe(0);
        }
      });
    }
  );

  it("uses standard, chip-friendly blinds from a 20,000 stack", () => {
    const blinds = (speed: "turbo" | "regular" | "deepstack") =>
      plays(presetStructure(speed, 20_000))
        .slice(0, 8)
        .map((level) => `${level.sb}/${level.bb}`);
    expect(blinds("turbo")).toEqual(["100/200", "150/300", "200/400", "250/500", "300/600", "400/800", "500/1000", "600/1200"]);
    expect(blinds("regular")).toEqual(["75/150", "100/200", "150/300", "200/400", "250/500", "300/600", "400/800", "500/1000"]);
    expect(blinds("deepstack")).toEqual(["50/100", "75/150", "100/200", "150/300", "200/400", "250/500", "300/600", "400/800"]);
  });
});

describe("structure summary", () => {
  it("finds the level in progress after a given time, breaks included", () => {
    const levels = presetStructure("regular", 20_000);
    const summary = summarize(levels);
    // Six 20-minute levels, then a 15-minute break.
    expect(summary.at(0)).toMatchObject({ index: 0, playLevel: 1 });
    expect(summary.at(2 * HOUR_MS - 1)).toMatchObject({ index: 5, playLevel: 6 });
    expect(summary.at(2 * HOUR_MS)).toMatchObject({ index: 6, playLevel: null });
    expect(summary.at(4 * HOUR_MS)).toMatchObject({ playLevel: 12 });
    expect(summary.at(summary.totalMs)).toBeNull();
    // During the break, the next level's big blind.
    expect(bigBlindAt(levels, 6)).toBe(800);
    expect(summary.playLevels + summary.breaks).toBe(levels.length);
  });
});
