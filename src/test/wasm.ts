import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSync } from "../wasm/pkg/mtt_wasm.js";
import { WasmEngine, type WasmEngineOptions } from "../engine/wasmEngine";
import type { Ante, Level, NewTournamentInput } from "../engine/types";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "../wasm/pkg");
let initialized = false;

/** Instantiates the real mtt-wasm build from disk (tests cannot fetch it). */
export function initWasm(): void {
  if (initialized) return;
  initSync({ module: readFileSync(join(pkgDir, "mtt_wasm_bg.wasm")) });
  initialized = true;
}

/** An in-memory `Storage`, shared by engines that stand for tabs of the same origin. */
export class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }
}

/** A real WasmEngine over in-memory storage, without cross-tab messages unless given a channel. */
export function createTestEngine(options: WasmEngineOptions = {}): WasmEngine {
  initWasm();
  return new WasmEngine({ storage: new MemoryStorage(), channel: null, ...options });
}

export const MIN = 60_000;

export function play(sb: number, bb: number, minutes = 20, ante: Ante = { type: "none" }): Level {
  return { type: "play", sb, bb, ante, durationMs: minutes * MIN };
}

export function pause(minutes = 10): Level {
  return { type: "break", durationMs: minutes * MIN, colorUp: null };
}

/** 100/200, 150/300, break, 200/400 BBA 400, 300/600: 20-minute levels. */
export function shortStructure(): Level[] {
  return [play(100, 200), play(150, 300), pause(10), play(200, 400, 20, { type: "big_blind", amount: 400 }), play(300, 600)];
}

/** A small tournament: 2 tables of 9, 3 places paid, manual late registration. */
export function tournamentInput(
  config: Partial<NewTournamentInput["config"]> = {},
  structure: Level[] = shortStructure()
): NewTournamentInput {
  return {
    config: {
      name: "Test event",
      seatsPerTable: 9,
      maxTables: 2,
      finalTableSize: null,
      balanceTrigger: 2,
      breakOrder: [],
      startingStack: 10_000,
      placesPaid: 3,
      lateReg: { type: "manual" },
      payout: {},
      ...config
    },
    structure
  };
}
