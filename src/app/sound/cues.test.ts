import { describe, expect, it } from "vitest";
import type { Level } from "../../engine/types";
import { register } from "../../test/app";
import { MIN, createTestEngine, pause, play, tournamentInput } from "../../test/wasm";
import { soundPlaysHere, upcomingCues } from "./cues";

const T0 = 1_700_000_000_000;

async function tournament(structure: Level[]) {
  let now = T0;
  const engine = createTestEngine({ now: () => now });
  const id = await engine.createTournament(tournamentInput({ maxTables: 1 }, structure));
  await register(engine, id, ["Ann", "Ben", "Cid"]);
  return {
    id,
    advance: (ms: number) => (now += ms),
    now: () => now,
    run: (command: Parameters<typeof engine.dispatch>[1]) => engine.dispatch(id, command),
    view: () => engine.getView(id)
  };
}

describe("upcomingCues", () => {
  it("announces the last minute and the end of a running level", async () => {
    const t = await tournament([play(100, 200), play(200, 400), pause(10), play(300, 600)]);
    expect(upcomingCues(await t.view(), t.now())).toEqual([]);

    await t.run({ type: "start_clock" });
    expect(upcomingCues(await t.view(), t.now())).toEqual([
      { cue: "oneMinute", key: `${t.id}:0:oneMinute`, atMs: T0 + 19 * MIN },
      { cue: "levelChange", key: `${t.id}:0:levelChange`, atMs: T0 + 20 * MIN }
    ]);

    await t.run({ type: "next_level" });
    expect(upcomingCues(await t.view(), t.now()).map((cue) => cue.cue)).toEqual(["oneMinute", "breakStart"]);
    await t.run({ type: "next_level" });
    expect(upcomingCues(await t.view(), t.now()).map((cue) => cue.cue)).toEqual(["oneMinute", "breakEnd"]);
    // The end of the last level: overtime starts.
    await t.run({ type: "next_level" });
    expect(upcomingCues(await t.view(), t.now()).map((cue) => cue.cue)).toEqual(["oneMinute", "levelChange"]);
  });

  it("leaves out a moment already past and says nothing while paused", async () => {
    const t = await tournament([play(100, 200), play(200, 400)]);
    await t.run({ type: "start_clock" });
    t.advance(19 * MIN + 30_000);
    expect(upcomingCues(await t.view(), t.now()).map((cue) => cue.cue)).toEqual(["levelChange"]);

    await t.run({ type: "pause_clock" });
    expect(upcomingCues(await t.view(), t.now())).toEqual([]);
  });

  it("has no one-minute warning in a level of a minute or less", async () => {
    const short: Level = { type: "play", sb: 100, bb: 200, ante: { type: "none" }, durationMs: 45_000 };
    const t = await tournament([short, { ...short, durationMs: MIN }, play(200, 400)]);
    await t.run({ type: "start_clock" });
    expect(upcomingCues(await t.view(), t.now()).map((cue) => cue.cue)).toEqual(["levelChange"]);
    await t.run({ type: "next_level" });
    expect(upcomingCues(await t.view(), t.now()).map((cue) => cue.cue)).toEqual(["levelChange"]);
  });

  it("counts a level from its duration, not from a time added to it", async () => {
    const t = await tournament([play(100, 200), play(200, 400)]);
    await t.run({ type: "start_clock" });
    await t.run({ type: "set_remaining", ms: 30_000 });
    expect(upcomingCues(await t.view(), t.now()).map((cue) => cue.cue)).toEqual(["levelChange"]);
    await t.run({ type: "set_remaining", ms: 5 * MIN });
    const cues = upcomingCues(await t.view(), t.now());
    expect(cues[0]).toEqual({ cue: "oneMinute", key: `${t.id}:0:oneMinute`, atMs: t.now() + 4 * MIN });
  });
});

describe("soundPlaysHere", () => {
  const cases = [
    // output, display playing, can announce: [control plays, display plays]
    ["control", false, true, [true, false]],
    ["control", true, true, [true, false]],
    ["display", false, true, [false, true]],
    ["display", false, false, [false, true]],
    ["auto", false, true, [true, true]],
    ["auto", true, true, [false, true]],
    ["auto", false, false, [true, false]]
  ] as const;

  it.each(cases)("output %s, display playing %s, channel %s", (output, displayPlaying, canAnnounce, [control, display]) => {
    expect(soundPlaysHere("control", output, { displayPlaying, canAnnounce })).toBe(control);
    expect(soundPlaysHere("display", output, { displayPlaying, canAnnounce })).toBe(display);
  });
});
