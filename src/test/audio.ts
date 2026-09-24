import { vi } from "vitest";
import { resetAudio } from "../app/sound/audio";
import type { SoundChannel, SoundMessage } from "../app/sound/channel";
import { setSoundChannelFactory } from "../app/sound/channel";
import { CUES, CUE_TONES, type Cue } from "../app/sound/tones";

class FakeParam {
  value = 0;
  setValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  connect(node: FakeNode) {
    this.outputs.push(node);
    return node;
  }
  disconnect() {
    this.outputs.length = 0;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = "sine";
  readonly frequency = new FakeParam();
  started: number | null = null;
  start(when = 0) {
    this.started = when;
  }
  stop() {}
}

/** Stands for `AudioContext`: records the graph that reaches the speakers. */
export class FakeAudioContext extends EventTarget {
  static locked = false;
  static readonly instances: FakeAudioContext[] = [];
  state: AudioContextState = FakeAudioContext.locked ? "suspended" : "running";
  currentTime = 0;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly oscillators: FakeOscillator[] = [];

  constructor() {
    super();
    FakeAudioContext.instances.push(this);
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  resume() {
    this.state = "running";
    this.dispatchEvent(new Event("statechange"));
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

function reaches(node: FakeNode, target: FakeNode): boolean {
  return node === target || node.outputs.some((output) => reaches(output, target));
}

/**
 * Installs a fake `AudioContext` (running unless `locked`). `voices()` lists the cues sent to
 * the speakers, in order: each voice is a gain on the destination, recognized by the note its
 * first oscillator plays.
 */
export function installFakeAudio({ locked = false }: { locked?: boolean } = {}) {
  FakeAudioContext.locked = locked;
  FakeAudioContext.instances.length = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  const voices = (): Cue[] =>
    FakeAudioContext.instances.flatMap((context) =>
      context.gains
        .filter((gain) => gain.outputs.includes(context.destination))
        .map((voice) => {
          const first = context.oscillators.find((oscillator) => reaches(oscillator, voice));
          const cue = CUES.find((candidate) => CUE_TONES[candidate][0].freq === first?.frequency.value);
          if (!cue) throw new Error(`unknown cue starting at ${first?.frequency.value} Hz`);
          return cue;
        })
    );
  return {
    voices,
    contexts: FakeAudioContext.instances,
    restore() {
      resetAudio();
      vi.unstubAllGlobals();
    }
  };
}

/**
 * Sound channels between windows rendered in the same test, delivering like a BroadcastChannel
 * (to every other open channel, asynchronously). `connected(false)` drops messages, like a
 * window that froze.
 */
export function installLocalSoundChannels() {
  const open = new Set<SoundChannel>();
  let delivering = true;
  const restore = setSoundChannelFactory(() => {
    const channel: SoundChannel = {
      post(message: SoundMessage) {
        if (!delivering) return;
        for (const other of open) {
          if (other !== channel) void Promise.resolve().then(() => open.has(other) && other.onmessage?.(message));
        }
      },
      onmessage: null,
      close() {
        open.delete(channel);
      }
    };
    open.add(channel);
    return channel;
  });
  return {
    restore,
    connected(value: boolean) {
      delivering = value;
    }
  };
}
