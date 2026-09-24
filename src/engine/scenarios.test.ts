// @vitest-environment node
//
// Runs the core's JSON scenarios (crates/mtt-core/tests/scenarios) through the WebAssembly
// build, with the semantics of the Rust runner (crates/mtt-core/tests/scenarios.rs): same
// creation context, same per-step seeds, same partial view matching, plus the view-level
// invariants and a replay check. Both builds passing the same expectations shows they agree.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WasmTournament } from "../wasm/pkg/mtt_wasm.js";
import { initWasm } from "../test/wasm";
import type { Command, EngineError, NewTournament, View } from "./types";

interface Step {
  atMs: number;
  cmd: Command;
  expect?: "ok" | { error: string };
  view?: unknown;
}

interface Scenario {
  name: string;
  seed: number;
  tournament: NewTournament;
  steps: Step[];
  checks?: Array<{ nowMs: number; view: unknown }>;
}

const scenarioDir = join(dirname(fileURLToPath(import.meta.url)), "../../crates/mtt-core/tests/scenarios");
const files = readdirSync(scenarioDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

const U64 = (1n << 64n) - 1n;

/** `mtt_core::rng::mix_seed` (SplitMix64 finalizer). */
export function mixSeed(x: bigint): bigint {
  let z = (x + 0x9e3779b97f4a7c15n) & U64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64;
  return z ^ (z >> 31n);
}

/** Objects match on the expected keys, arrays element by element with the same length. */
function partialMatch(expected: unknown, actual: unknown, path: string): string | null {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path}: expected an array, got ${JSON.stringify(actual)}`;
    if (expected.length !== actual.length) {
      return `${path}: expected ${expected.length} items, got ${actual.length}: ${JSON.stringify(actual)}`;
    }
    for (let i = 0; i < expected.length; i++) {
      const error = partialMatch(expected[i], actual[i], `${path}[${i}]`);
      if (error) return error;
    }
    return null;
  }
  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
      return `${path}: expected an object, got ${JSON.stringify(actual)}`;
    }
    for (const [key, value] of Object.entries(expected)) {
      if (!(key in actual)) return `${path}.${key}: missing`;
      const error = partialMatch(value, (actual as Record<string, unknown>)[key], `${path}.${key}`);
      if (error) return error;
    }
    return null;
  }
  return expected === actual ? null : `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

/** The invariants of `check_invariants` that the view alone can show. */
function checkInvariants(view: View, label: string) {
  const { alive, busted, unique } = view.counts;
  expect(alive + busted, `${label}: counts`).toBe(unique);

  const seated = new Set<number>();
  for (const table of view.tables) {
    const occupied = table.seats.filter((seat) => seat.player !== null);
    if (table.status !== "open") expect(occupied, `${label}: table ${table.table} is not open`).toHaveLength(0);
    expect(occupied.length, `${label}: table ${table.table} count`).toBe(table.players);
    for (const seat of occupied) {
      expect(seated.has(seat.player!), `${label}: player ${seat.player} seated twice`).toBe(false);
      seated.add(seat.player!);
    }
  }
  expect(seated.size, `${label}: alive players missing from tables`).toBe(alive);

  // Busted places cover exactly [alive + 1, N], ties spanning their width.
  const places = view.ranking
    .filter((row) => !row.alive)
    .map((row) => [row.place!, row.placeTo ?? row.place!] as const)
    .sort((a, b) => a[0] - b[0]);
  let next = alive + 1;
  for (let i = 0; i < places.length; ) {
    const [place, placeTo] = places[i];
    expect(place, `${label}: places have a gap or overlap`).toBe(next);
    const width = placeTo - place + 1;
    expect(places.slice(i, i + width).every(([p, q]) => p === place && q === placeTo), `${label}: tie width`).toBe(true);
    next = placeTo + 1;
    i += width;
  }
  expect(next, `${label}: places do not reach N`).toBe(unique + 1);
  if (view.phase === "finished") {
    expect(view.ranking.find((row) => row.player === view.winner)?.place, `${label}: winner`).toBe(1);
  }
}

function run(scenario: Scenario) {
  const seed = BigInt(scenario.seed);
  const { config, structure } = scenario.tournament;
  const tournament = WasmTournament.create(scenario.tournament.id, JSON.stringify({ config, structure }), 0, seed.toString());
  try {
    scenario.steps.forEach((step, i) => {
      const label = `${scenario.name} step ${i} (${JSON.stringify(step.cmd)})`;
      const stepSeed = mixSeed(seed ^ BigInt(i)).toString();
      let error: EngineError | null = null;
      try {
        tournament.dispatch(JSON.stringify(step.cmd), step.atMs, stepSeed);
      } catch (thrown) {
        error = JSON.parse(String(thrown)) as EngineError;
      }
      if (step.expect && step.expect !== "ok") {
        expect(error?.code, `${label}: expected an error`).toBe(step.expect.error);
      } else {
        expect(error, `${label}: rejected`).toBeNull();
      }
      const view = JSON.parse(tournament.view(step.atMs)) as View;
      checkInvariants(view, label);
      if (step.view !== undefined) {
        expect(partialMatch(step.view, view, "view"), label).toBeNull();
      }
    });
    for (const check of scenario.checks ?? []) {
      const view = JSON.parse(tournament.view(check.nowMs)) as View;
      expect(partialMatch(check.view, view, "view"), `${scenario.name} check at ${check.nowMs}`).toBeNull();
    }

    const saved = tournament.to_saved();
    const reloaded = WasmTournament.from_saved(saved);
    try {
      expect(reloaded.to_saved(), `${scenario.name}: replay differs`).toBe(saved);
      const lastAt = scenario.steps.at(-1)?.atMs ?? 0;
      expect(reloaded.view(lastAt)).toBe(tournament.view(lastAt));
    } finally {
      reloaded.free();
    }
  } finally {
    tournament.free();
  }
}

describe("core scenarios through the WASM build", () => {
  initWasm();

  it("finds the scenarios", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("derives step seeds like the Rust runner", () => {
    // SplitMix64 reference values.
    expect(mixSeed(0n)).toBe(0xe220a8397b1dcdafn);
    expect(mixSeed(1n)).toBe(0x910a2dec89025cc1n);
  });

  it("draws the same seats as the native build for the same seeds", () => {
    // Mirrors `seeded_seat_draws_are_reproducible` in crates/mtt-wasm/src/lib.rs (native).
    const input = {
      config: { name: "Friday", seatsPerTable: 9, maxTables: 2, startingStack: 10000, placesPaid: 2 },
      structure: [
        { type: "play", sb: 25, bb: 50, durationMs: 1_200_000 },
        { type: "break", durationMs: 600_000 },
        { type: "play", sb: 50, bb: 100, durationMs: 1_200_000 }
      ]
    };
    const t0 = 1_700_000_000_000;
    const tournament = WasmTournament.create("t-1", JSON.stringify(input), t0, "7");
    try {
      for (let i = 1n; i <= 12n; i++) {
        tournament.dispatch(JSON.stringify({ type: "register", name: `P${i}` }), t0 + 1000, (U64 - i).toString());
      }
      const view = JSON.parse(tournament.view(t0)) as View;
      expect(view.ranking.map((row) => `${row.name}@${row.seat!.table}.${row.seat!.seat}`)).toEqual([
        "P2@1.1", "P7@1.2", "P9@1.3", "P4@1.4", "P1@1.5", "P3@1.6", "P5@1.7", "P8@1.8",
        "P6@1.9", "P11@2.1", "P12@2.4", "P10@2.9"
      ]);
    } finally {
      tournament.free();
    }
  });

  it.each(files)("%s", (file) => {
    const scenario = JSON.parse(readFileSync(join(scenarioDir, file), "utf8")) as Scenario;
    expect(Number.isSafeInteger(scenario.seed)).toBe(true);
    run(scenario);
  });
});
