/** Messages between the windows of this device about who plays the level sounds. */
export type SoundMessage =
  /** A display window for `tournament` is open; `playing`: it plays the sounds. */
  | { type: "display"; tournament: string; playing: boolean }
  /** That display window closed. */
  | { type: "display_closed"; tournament: string }
  /** A director's window asks the open displays to announce themselves. */
  | { type: "query" }
  /** A window played this cue: the others skip it (two director tabs, say). */
  | { type: "played"; key: string };

export interface SoundChannel {
  post(message: SoundMessage): void;
  /** Messages from the other windows (never this channel's own). */
  onmessage: ((message: SoundMessage) => void) | null;
  close(): void;
}

export const SOUND_CHANNEL_NAME = "mtt-sound";

function isSoundMessage(data: unknown): data is SoundMessage {
  return typeof data === "object" && data !== null && typeof (data as { type?: unknown }).type === "string";
}

function broadcastChannel(): SoundChannel | null {
  if (typeof BroadcastChannel !== "function") return null;
  const channel = new BroadcastChannel(SOUND_CHANNEL_NAME);
  const wrapper: SoundChannel = {
    post: (message) => channel.postMessage(message),
    onmessage: null,
    close: () => channel.close()
  };
  channel.onmessage = (event: MessageEvent) => {
    if (isSoundMessage(event.data)) wrapper.onmessage?.(event.data);
  };
  return wrapper;
}

let factory: () => SoundChannel | null = broadcastChannel;

/** A channel to the other windows of this device, or null where the browser has none. */
export function openSoundChannel(): SoundChannel | null {
  return factory();
}

/** Replaces the BroadcastChannel (tests: windows rendered side by side); returns the undo. */
export function setSoundChannelFactory(next: () => SoundChannel | null): () => void {
  const previous = factory;
  factory = next;
  return () => {
    factory = previous;
  };
}
