import type { Level } from "../../engine/types";

/**
 * Structure presets generated from the starting stack, and the summary the setup screen
 * previews for any structure (total duration, level in progress after 2 and 4 hours).
 */

export type PresetSpeed = "turbo" | "regular" | "deepstack";

export const PRESET_SPEEDS: readonly PresetSpeed[] = ["turbo", "regular", "deepstack"];

interface PresetSpec {
  levelMinutes: number;
  /** Starting stack in big blinds aimed at (100 to 200). */
  stackInBb: number;
  /** First play level with a big blind ante. */
  bbaFrom: number;
  breakMinutes: number;
}

export const PRESETS: Record<PresetSpeed, PresetSpec> = {
  turbo: { levelMinutes: 10, stackInBb: 100, bbaFrom: 1, breakMinutes: 10 },
  regular: { levelMinutes: 20, stackInBb: 150, bbaFrom: 2, breakMinutes: 15 },
  deepstack: { levelMinutes: 30, stackInBb: 200, bbaFrom: 2, breakMinutes: 15 }
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** A preset lasts at least this long, so the clock never runs out mid-event. */
export const PRESET_MIN_DURATION_MS = 10 * HOUR_MS;
/** A break about every two hours of play. */
const BREAK_EVERY_MS = 2 * HOUR_MS;
/** Starting big blind between 1/200 and 1/100 of the stack. */
const MIN_STACK_IN_BB = 100;
const MAX_STACK_IN_BB = 200;

/** Small blinds, low to high: the usual 25-chip steps, then 1-1.2-1.5-2-2.5-3-4-5-6-8 per decade. */
const LOW_SMALL_BLINDS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 800];
const DECADE = [1_000, 1_200, 1_500, 2_000, 2_500, 3_000, 4_000, 5_000, 6_000, 8_000];

function smallBlind(step: number): number {
  if (step < LOW_SMALL_BLINDS.length) return LOW_SMALL_BLINDS[step];
  const rest = step - LOW_SMALL_BLINDS.length;
  return DECADE[rest % DECADE.length] * 10 ** Math.floor(rest / DECADE.length);
}

/** Chip denominations, low to high, for the color-ups. */
const DENOMINATIONS = [1, 5, 25, 100, 500, 1_000, 5_000, 25_000, 100_000, 500_000, 1_000_000, 5_000_000, 25_000_000];

/** The largest chip every amount is a multiple of. */
function smallestChip(amounts: readonly number[]): number {
  return [...DENOMINATIONS].reverse().find((chip) => amounts.every((amount) => amount % chip === 0)) ?? 1;
}

/** Ladder step of the first small blind: a starting stack of 100 to 200 big blinds, nearest to the aim. */
function firstStep(stack: number, stackInBb: number): number {
  const target = stack / stackInBb / 2;
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let step = 0; smallBlind(step) <= stack; step++) {
    const sb = smallBlind(step);
    const inRange = stack / (2 * sb) >= MIN_STACK_IN_BB && stack / (2 * sb) <= MAX_STACK_IN_BB;
    // Out of range only when no ladder value fits (odd stacks); then the closest one.
    const score = Math.abs(Math.log(sb / target)) + (inRange ? 0 : 10);
    if (score < bestScore) {
      best = step;
      bestScore = score;
    }
  }
  return best;
}

/**
 * A full structure for `speed` from `startingStack`: standard blind steps from a big blind of
 * about 1/100 to 1/200 of the stack, big blind ante from level 1 or 2, a break every two hours
 * (with a color-up once the smallest chips are no longer needed), and at least ten hours long.
 */
export function presetStructure(speed: PresetSpeed, startingStack: number): Level[] {
  const spec = PRESETS[speed];
  const levelMs = spec.levelMinutes * MINUTE_MS;
  const breakMs = spec.breakMinutes * MINUTE_MS;
  const levelsPerBreak = Math.max(1, Math.round(BREAK_EVERY_MS / levelMs));
  const start = firstStep(startingStack, spec.stackInBb);

  // Play levels until the structure, breaks included, lasts long enough.
  const blinds: number[] = [];
  let total = 0;
  while (total < PRESET_MIN_DURATION_MS) {
    // A break before every `levelsPerBreak`-th level but the first.
    if (blinds.length > 0 && blinds.length % levelsPerBreak === 0) total += breakMs;
    blinds.push(smallBlind(start + blinds.length));
    total += levelMs;
  }

  const levels: Level[] = [];
  let chip = smallestChip(blinds.slice(0, levelsPerBreak).flatMap((sb) => [sb, 2 * sb]));
  blinds.forEach((sb, index) => {
    const n = index + 1;
    const bb = 2 * sb;
    levels.push({ type: "play", sb, bb, ante: n >= spec.bbaFrom ? { type: "big_blind", amount: bb } : { type: "none" }, durationMs: levelMs });
    if (n % levelsPerBreak === 0 && n < blinds.length) {
      const needed = smallestChip(blinds.slice(n).flatMap((later) => [later, 2 * later]));
      levels.push({ type: "break", durationMs: breakMs, colorUp: needed > chip ? needed : null });
      chip = Math.max(chip, needed);
    }
  });
  return levels;
}

export interface LevelAt {
  index: number;
  playLevel: number | null;
  level: Level;
}

export interface StructureSummary {
  totalMs: number;
  playLevels: number;
  breaks: number;
  /** The first play level, for the starting stack in big blinds. */
  first: Extract<Level, { type: "play" }> | null;
  /** The level in progress after `ms` of play (breaks included), or null once the structure is over. */
  at(ms: number): LevelAt | null;
}

export function summarize(levels: readonly Level[]): StructureSummary {
  const durations = levels.map((level) => (Number.isFinite(level.durationMs) && level.durationMs > 0 ? level.durationMs : 0));
  const numbers: Array<number | null> = [];
  let n = 0;
  for (const level of levels) numbers.push(level.type === "play" ? ++n : null);
  return {
    totalMs: durations.reduce((sum, ms) => sum + ms, 0),
    playLevels: n,
    breaks: levels.length - n,
    first: levels.find((level): level is Extract<Level, { type: "play" }> => level.type === "play") ?? null,
    at(ms) {
      let end = 0;
      for (let index = 0; index < levels.length; index++) {
        end += durations[index];
        if (ms < end) return { index, playLevel: numbers[index], level: levels[index] };
      }
      return null;
    }
  };
}

/** The big blind in force at a level: during a break, the next play level's. */
export function bigBlindAt(levels: readonly Level[], index: number): number | null {
  for (let i = index; i < levels.length; i++) {
    const level = levels[i];
    if (level.type === "play") return level.bb;
  }
  return null;
}
