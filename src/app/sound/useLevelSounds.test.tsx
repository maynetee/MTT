import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Level } from "../../engine/types";
import type { WasmEngine } from "../../engine/wasmEngine";
import { installFakeAudio, installLocalSoundChannels } from "../../test/audio";
import { Providers, register } from "../../test/app";
import { MIN, createTestEngine, pause, play, tournamentInput } from "../../test/wasm";
import { useTournamentView } from "../hooks/useTournamentView";
import { setPreferences } from "../preferences/preferences";
import type { WindowRole } from "./cues";
import { PRESENCE_TIMEOUT_MS, useLevelSounds } from "./useLevelSounds";

const T0 = 1_700_000_000_000;

/** A window of the app, reduced to its level sounds. */
function SoundWindow({ id, role }: { id: string; role: WindowRole }) {
  const { view, offsetMs } = useTournamentView(id);
  const { playsHere, needsUnlock } = useLevelSounds(view, offsetMs, role);
  return <p>{`${role} ${playsHere ? "plays" : "silent"}${needsUnlock ? ", locked" : ""}`}</p>;
}

function open(engine: WasmEngine, id: string, role: WindowRole) {
  return render(
    <Providers engine={engine}>
      <SoundWindow id={id} role={role} />
    </Providers>
  );
}

/** Lets pending engine calls, channel messages and React updates settle. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTime(ms));
  await settle();
}

async function started(structure: Level[] = [play(100, 200), play(200, 400), pause(10), play(300, 600)]) {
  const engine = createTestEngine();
  const id = await engine.createTournament(tournamentInput({ maxTables: 1 }, structure));
  await register(engine, id, ["Ann", "Ben", "Cid"]);
  await engine.dispatch(id, { type: "start_clock" });
  return { engine, id };
}

let audio: ReturnType<typeof installFakeAudio>;
let channels: ReturnType<typeof installLocalSoundChannels>;

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  channels = installLocalSoundChannels();
});

afterEach(() => {
  audio.restore();
  channels.restore();
  vi.useRealTimers();
});

describe("level sounds", () => {
  it("plays each cue once, when the clock reaches it", async () => {
    audio = installFakeAudio();
    const { engine, id } = await started();
    open(engine, id, "control");
    await settle();

    // [moment, cue]: 20-minute levels, then a 10-minute break.
    const moments = [
      [19 * MIN, "oneMinute"],
      [20 * MIN, "levelChange"],
      [39 * MIN, "oneMinute"],
      [40 * MIN, "breakStart"],
      [49 * MIN, "oneMinute"],
      [50 * MIN, "breakEnd"]
    ] as const;
    let elapsed = 0;
    const heard: string[] = [];
    for (const [at, cue] of moments) {
      await advance(at - elapsed - 1);
      expect(audio.voices()).toEqual(heard);
      await advance(1);
      heard.push(cue);
      expect(audio.voices()).toEqual(heard);
      elapsed = at;
      if (cue !== "oneMinute") {
        // The view is refetched 25 ms after a level change (a fake clock only lets it arrive
        // once the timers stop, so stop them there).
        await advance(25);
        elapsed += 25;
      }
    }
    // The refetches at each level change never repeated a cue.
    await advance(5 * MIN);
    expect(audio.voices()).toEqual(heard);
  });

  it("plays nothing on load, even with less than a minute left", async () => {
    audio = installFakeAudio();
    const { engine, id } = await started();
    vi.advanceTimersByTime(19 * MIN + 30_000);
    open(engine, id, "control");
    await settle();
    expect(audio.voices()).toEqual([]);

    await advance(29_999);
    expect(audio.voices()).toEqual([]);
    await advance(1);
    expect(audio.voices()).toEqual(["levelChange"]);
  });

  it("does not replay a cue after an undo or a refetch", async () => {
    audio = installFakeAudio();
    const { engine, id } = await started();
    open(engine, id, "control");
    await settle();
    await advance(19 * MIN);
    expect(audio.voices()).toEqual(["oneMinute"]);

    // Time added then undone: the last minute comes around again, silently.
    await act(async () => {
      await engine.dispatch(id, { type: "adjust_time", deltaMs: MIN });
    });
    await settle();
    await advance(MIN);
    await act(async () => {
      await engine.dispatch(id, { type: "undo" });
    });
    await settle();
    expect(audio.voices()).toEqual(["oneMinute"]);
  });

  it("stays silent through commands: a pause, a jump, a time change", async () => {
    audio = installFakeAudio();
    const { engine, id } = await started();
    open(engine, id, "control");
    await settle();
    for (const command of [{ type: "next_level" }, { type: "set_remaining", ms: 30_000 }, { type: "pause_clock" }] as const) {
      await act(async () => {
        await engine.dispatch(id, command);
      });
      await settle();
    }
    await advance(30 * MIN);
    expect(audio.voices()).toEqual([]);
  });

  it("has no one-minute warning in a level shorter than a minute", async () => {
    audio = installFakeAudio();
    const short: Level = { type: "play", sb: 100, bb: 200, ante: { type: "none" }, durationMs: 45_000 };
    const { engine, id } = await started([short, play(200, 400)]);
    open(engine, id, "control");
    await settle();
    await advance(44_999);
    expect(audio.voices()).toEqual([]);
    await advance(1);
    expect(audio.voices()).toEqual(["levelChange"]);
  });

  it("plays nothing when the sound is off", async () => {
    audio = installFakeAudio();
    setPreferences({ sound: false });
    const { engine, id } = await started();
    open(engine, id, "control");
    await settle();
    await advance(60 * MIN);
    expect(audio.voices()).toEqual([]);
    // Not even an AudioContext.
    expect(audio.contexts).toHaveLength(0);
  });

  it("creates the director's audio on a first click, not before", async () => {
    audio = installFakeAudio({ locked: true });
    Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: false }, configurable: true });
    try {
      const { engine, id } = await started();
      open(engine, id, "control");
      await settle();
      expect(audio.contexts).toHaveLength(0);
      expect(screen.getByText("control plays, locked")).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "a" });
      await settle();
      expect(audio.contexts).toHaveLength(1);
      expect(screen.getByText("control plays")).toBeInTheDocument();
      await advance(19 * MIN);
      expect(audio.voices()).toEqual(["oneMinute"]);
    } finally {
      delete (navigator as { userActivation?: unknown }).userActivation;
    }
  });

  it("plays at the chosen volume", async () => {
    audio = installFakeAudio();
    setPreferences({ volume: 0.5 });
    const { engine, id } = await started();
    open(engine, id, "control");
    await settle();
    await advance(19 * MIN);
    const [context] = audio.contexts;
    const voice = context.gains.find((gain) => gain.outputs.includes(context.destination))!;
    expect(voice.gain.value).toBe(0.25);
  });
});

describe("level sounds with a display window open", () => {
  it("plays on the display only (auto)", async () => {
    audio = installFakeAudio();
    const { engine, id } = await started();
    open(engine, id, "control");
    open(engine, id, "display");
    await settle();

    expect(screen.getByText("control silent")).toBeInTheDocument();
    expect(screen.getByText("display plays")).toBeInTheDocument();

    await advance(19 * MIN);
    await advance(MIN);
    expect(audio.voices()).toEqual(["oneMinute", "levelChange"]);
  });

  it("plays on the director's window until the display's sound is enabled by a click", async () => {
    audio = installFakeAudio({ locked: true });
    const { engine, id } = await started();
    open(engine, id, "control");
    open(engine, id, "display");
    await settle();
    expect(screen.getByText("control plays, locked")).toBeInTheDocument();
    expect(screen.getByText("display plays, locked")).toBeInTheDocument();

    // A click enables the sound (in a test, both windows share one AudioContext).
    fireEvent.pointerDown(window);
    await settle();
    expect(screen.getByText("control silent")).toBeInTheDocument();
    expect(screen.getByText("display plays")).toBeInTheDocument();
    await advance(19 * MIN);
    expect(audio.voices()).toEqual(["oneMinute"]);
  });

  it("goes back to the director's window when the display closes", async () => {
    audio = installFakeAudio();
    const { engine, id } = await started();
    open(engine, id, "control");
    const display = open(engine, id, "display");
    await settle();
    display.unmount();
    await settle();
    expect(screen.getByText("control plays")).toBeInTheDocument();

    await advance(19 * MIN);
    expect(audio.voices()).toEqual(["oneMinute"]);
  });

  it("goes back to the director's window when the display stops answering", async () => {
    audio = installFakeAudio();
    const { engine, id } = await started();
    open(engine, id, "control");
    const display = open(engine, id, "display");
    await settle();
    expect(screen.getByText("control silent")).toBeInTheDocument();

    // The display window freezes: no more announcements, no goodbye.
    channels.connected(false);
    display.unmount();
    channels.connected(true);
    await advance(PRESENCE_TIMEOUT_MS - 1);
    expect(screen.getByText("control silent")).toBeInTheDocument();
    await advance(1);
    expect(screen.getByText("control plays")).toBeInTheDocument();
    await advance(19 * MIN);
    expect(audio.voices()).toEqual(["oneMinute"]);
  });

  it.each(["control", "display"] as const)("plays on the %s window only when chosen", async (output) => {
    audio = installFakeAudio();
    setPreferences({ soundOutput: output });
    const { engine, id } = await started();
    const director = open(engine, id, "control");
    const display = open(engine, id, "display");
    await settle();
    // Only the chosen window keeps its schedule: close the other one and nothing changes.
    (output === "control" ? display : director).unmount();
    await settle();
    await advance(19 * MIN);
    expect(audio.voices()).toEqual(["oneMinute"]);
  });

  it("never plays twice with both windows open, whatever the choice", async () => {
    for (const output of ["auto", "control", "display"] as const) {
      audio = installFakeAudio();
      setPreferences({ soundOutput: output });
      const { engine, id } = await started();
      const director = open(engine, id, "control");
      const display = open(engine, id, "display");
      await settle();
      await advance(19 * MIN);
      expect(audio.voices(), output).toEqual(["oneMinute"]);
      director.unmount();
      display.unmount();
      audio.restore();
      vi.setSystemTime(T0);
    }
  });

  it("asks for a click on the display, and the click enables the sound", async () => {
    audio = installFakeAudio({ locked: true });
    const { engine, id } = await started();
    open(engine, id, "display");
    await settle();
    expect(screen.getByText("display plays, locked")).toBeInTheDocument();

    fireEvent.pointerDown(window);
    await settle();
    expect(screen.getByText("display plays")).toBeInTheDocument();
    await advance(19 * MIN);
    expect(audio.voices()).toEqual(["oneMinute"]);
  });
});
