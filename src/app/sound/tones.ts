/** The moments the clock announces. */
export type Cue = "levelChange" | "oneMinute" | "breakStart" | "breakEnd";
export const CUES: readonly Cue[] = ["levelChange", "oneMinute", "breakStart", "breakEnd"];

export interface Tone {
  /** Fundamental, in Hz. */
  freq: number;
  /** Start, in seconds after the cue starts. */
  at: number;
  /** Time for the tone to die away, in seconds. */
  length: number;
  /** Peak level, before the volume. */
  level: number;
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;
const E6 = 1318.51;

/**
 * Generated tones, no audio files. Each cue has its own shape so the room tells them apart
 * without looking: a rising chime for new blinds, two short pips for the last minute, a
 * falling arpeggio into the break and a rising call back to the tables. Every cue starts on a
 * different note.
 */
export const CUE_TONES: Readonly<Record<Cue, readonly Tone[]>> = {
  levelChange: [
    { freq: E5, at: 0, length: 0.9, level: 0.5 },
    { freq: A5, at: 0.16, length: 0.9, level: 0.5 },
    { freq: E6, at: 0.32, length: 1.4, level: 0.45 }
  ],
  oneMinute: [
    { freq: A5, at: 0, length: 0.16, level: 0.4 },
    { freq: A5, at: 0.24, length: 0.16, level: 0.4 }
  ],
  breakStart: [
    { freq: C6, at: 0, length: 0.7, level: 0.45 },
    { freq: G5, at: 0.22, length: 0.7, level: 0.45 },
    { freq: E5, at: 0.44, length: 0.7, level: 0.45 },
    { freq: C5, at: 0.66, length: 1.6, level: 0.5 }
  ],
  breakEnd: [
    { freq: C5, at: 0, length: 0.5, level: 0.45 },
    { freq: E5, at: 0.14, length: 0.5, level: 0.45 },
    { freq: G5, at: 0.28, length: 0.5, level: 0.45 },
    { freq: C6, at: 0.42, length: 0.6, level: 0.45 },
    { freq: C6, at: 0.9, length: 1.5, level: 0.5 }
  ]
};

/** A soft octave on top of each tone, for a bell rather than a buzzer. */
const OVERTONE_LEVEL = 0.18;
const ATTACK_S = 0.008;
const SILENCE = 0.0001;

/**
 * Schedules a cue on `context`, starting now. `volume` (0 to 1) is squared so the slider feels
 * even to the ear.
 */
export function scheduleCue(context: BaseAudioContext, cue: Cue, volume: number): void {
  const start = context.currentTime + 0.02;
  const voice = context.createGain();
  voice.gain.value = Math.min(1, Math.max(0, volume)) ** 2;
  voice.connect(context.destination);
  for (const tone of CUE_TONES[cue]) {
    const at = start + tone.at;
    const stop = at + tone.length;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(SILENCE, at);
    envelope.gain.linearRampToValueAtTime(tone.level, at + ATTACK_S);
    envelope.gain.exponentialRampToValueAtTime(SILENCE, stop);
    envelope.connect(voice);
    for (const [ratio, level, type] of [
      [1, 1, "triangle"],
      [2, OVERTONE_LEVEL, "sine"]
    ] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(tone.freq * ratio, at);
      if (level === 1) {
        oscillator.connect(envelope);
      } else {
        const overtone = context.createGain();
        overtone.gain.value = level;
        oscillator.connect(overtone);
        overtone.connect(envelope);
      }
      // Stopped sources release their nodes: nothing to clean up afterwards.
      oscillator.start(at);
      oscillator.stop(stop + 0.05);
    }
  }
}
