import type { Ante, Level } from "../../engine/types";

export type AnteType = Ante["type"];

/** One editable row of the structure editor; numbers as entered, minutes for durations. */
export interface LevelDraft {
  /** Stable React key, so that editing a row never remounts it. */
  rowId: number;
  isBreak: boolean;
  sb: number;
  bb: number;
  anteType: AnteType;
  ante: number;
  minutes: number;
  colorUp: number | null;
}

const MINUTE_MS = 60_000;
let nextRowId = 1_000_000;

/** A level as a draft row; rows loaded from a view use their index as key. */
export function toDraft(level: Level, rowId: number = nextRowId++): LevelDraft {
  if (level.type === "break") {
    return { rowId, isBreak: true, sb: 0, bb: 0, anteType: "none", ante: 0, minutes: level.durationMs / MINUTE_MS, colorUp: level.colorUp };
  }
  return {
    rowId,
    isBreak: false,
    sb: level.sb,
    bb: level.bb,
    anteType: level.ante.type,
    ante: level.ante.type === "none" ? 0 : level.ante.amount,
    minutes: level.durationMs / MINUTE_MS,
    colorUp: null
  };
}

/** Chips are integers; anything else entered is truncated (the core validates the rest). */
const chips = (value: number) => (Number.isFinite(value) ? Math.trunc(value) : 0);

export function fromDraft(draft: LevelDraft): Level {
  const durationMs = Number.isFinite(draft.minutes) ? Math.round(draft.minutes * MINUTE_MS) : 0;
  if (draft.isBreak) return { type: "break", durationMs, colorUp: draft.colorUp };
  const ante: Ante = draft.anteType === "none" ? { type: "none" } : { type: draft.anteType, amount: chips(draft.ante) };
  return { type: "play", sb: chips(draft.sb), bb: chips(draft.bb), ante, durationMs };
}

/** A new play level after `rows`: the blinds of the last play level, for the director to raise. */
export function newPlayDraft(rows: readonly LevelDraft[]): LevelDraft {
  const last = [...rows].reverse().find((row) => !row.isBreak);
  return {
    rowId: nextRowId++,
    isBreak: false,
    sb: last?.sb ?? 25,
    bb: last?.bb ?? 50,
    anteType: last?.anteType ?? "none",
    ante: last?.ante ?? 0,
    minutes: last?.minutes ?? 20,
    colorUp: null
  };
}

export function newBreakDraft(): LevelDraft {
  return { rowId: nextRowId++, isBreak: true, sb: 0, bb: 0, anteType: "none", ante: 0, minutes: 10, colorUp: null };
}

/** 1-based play-level numbers of the rows, breaks not counted; null for breaks. */
export function playNumbers(rows: readonly Pick<LevelDraft, "isBreak">[]): Array<number | null> {
  let n = 0;
  return rows.map((row) => (row.isBreak ? null : ++n));
}

/** Play-level number right before the first break (an add-on's usual moment), or null. */
export function firstBreakAfter(rows: readonly Pick<LevelDraft, "isBreak">[]): number | null {
  const numbers = playNumbers(rows);
  const index = rows.findIndex((row, i) => i > 0 && row.isBreak && !rows[i - 1].isBreak);
  return index > 0 ? numbers[index - 1] : null;
}

function play(sb: number, bb: number, bigBlindAnte = false): Level {
  return {
    type: "play",
    sb,
    bb,
    ante: bigBlindAnte ? { type: "big_blind", amount: bb } : { type: "none" },
    durationMs: 20 * MINUTE_MS
  };
}

function pause(minutes: number): Level {
  return { type: "break", durationMs: minutes * MINUTE_MS, colorUp: null };
}

/**
 * A full default structure (about nine hours) so the clock does not run out in a regular
 * event: 24 play levels of 20 minutes from 25/50 to 15,000/30,000, big blind ante from
 * level 4, a break every four levels.
 */
export function defaultStructure(): Level[] {
  return [
    play(25, 50),
    play(50, 100),
    play(75, 150),
    play(100, 200, true),
    pause(10),
    play(150, 300, true),
    play(200, 400, true),
    play(250, 500, true),
    play(300, 600, true),
    pause(10),
    play(400, 800, true),
    play(500, 1000, true),
    play(600, 1200, true),
    play(800, 1600, true),
    pause(15),
    play(1000, 2000, true),
    play(1200, 2400, true),
    play(1500, 3000, true),
    play(2000, 4000, true),
    pause(10),
    play(2500, 5000, true),
    play(3000, 6000, true),
    play(4000, 8000, true),
    play(5000, 10000, true),
    pause(10),
    play(6000, 12000, true),
    play(8000, 16000, true),
    play(10000, 20000, true),
    play(15000, 30000, true)
  ];
}
