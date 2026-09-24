import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

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

/** The BroadcastChannel of the browser, between tabs of the same origin. */
export const SOUND_CHANNEL_NAME = "mtt-sound";
/**
 * The Tauri event of the desktop app, between its windows (a BroadcastChannel may not cross
 * webviews). Emitting it needs `core:event:allow-emit` in both windows' capabilities.
 */
export const SOUND_EVENT = "level_sound_channel";

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

/** What travels in the Tauri event: who sent it, so a window skips its own messages. */
interface Envelope {
  sender: string;
  message: SoundMessage;
}

/**
 * A channel over the desktop app's events. An event reaches every window, the sender's own
 * listeners included: each channel tags what it sends and ignores its own messages, like a
 * BroadcastChannel. Messages sent before the listener is registered (a few milliseconds after
 * opening) are missed; the display repeats its announcement anyway.
 */
export function tauriSoundChannel(): SoundChannel {
  const sender = Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) => part.toString(36)).join("");
  let closed = false;
  let unlisten: (() => void) | null = null;
  const channel: SoundChannel = {
    post(message) {
      if (closed) return;
      emit(SOUND_EVENT, { sender, message } satisfies Envelope).catch((error: unknown) => console.error("Could not reach the other windows", error));
    },
    onmessage: null,
    close() {
      closed = true;
      unlisten?.();
      unlisten = null;
    }
  };
  listen<Envelope>(SOUND_EVENT, ({ payload }) => {
    if (closed || payload?.sender === sender || !isSoundMessage(payload?.message)) return;
    channel.onmessage?.(payload.message);
  })
    .then((stop) => {
      // The window may be going away: nothing to do if the host no longer answers (typed
      // void, the unlisten function returns a promise).
      const quietly = () => {
        Promise.resolve()
          .then(() => stop())
          .catch(() => {});
      };
      if (closed) quietly();
      else unlisten = quietly;
    })
    .catch((error: unknown) => console.error("Could not listen to the other windows", error));
  return channel;
}

/** Tauri events in the desktop app, a BroadcastChannel in the browser. */
function defaultChannel(): SoundChannel | null {
  return isTauri() ? tauriSoundChannel() : broadcastChannel();
}

let factory: () => SoundChannel | null = defaultChannel;

/** A channel to the other windows of this device, or null where there is none. */
export function openSoundChannel(): SoundChannel | null {
  return factory();
}

/** Replaces the default channel (tests: windows rendered side by side); returns the undo. */
export function setSoundChannelFactory(next: () => SoundChannel | null): () => void {
  const previous = factory;
  factory = next;
  return () => {
    factory = previous;
  };
}
