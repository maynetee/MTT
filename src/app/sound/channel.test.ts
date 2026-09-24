import { listen } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOUND_EVENT, openSoundChannel, tauriSoundChannel, type SoundMessage } from "./channel";

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

/** Lets the event plugin's promises settle. */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("the sound channel over Tauri events", () => {
  it("reaches the other windows, never the sender itself", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const director = tauriSoundChannel();
    const display = tauriSoundChannel();
    const toDirector: SoundMessage[] = [];
    const toDisplay: SoundMessage[] = [];
    director.onmessage = (message) => toDirector.push(message);
    display.onmessage = (message) => toDisplay.push(message);
    await settle();

    display.post({ type: "display", tournament: "t1", playing: true });
    director.post({ type: "query" });
    await settle();
    expect(toDirector).toEqual([{ type: "display", tournament: "t1", playing: true }]);
    expect(toDisplay).toEqual([{ type: "query" }]);

    // A closed window neither hears nor speaks.
    display.close();
    display.post({ type: "display_closed", tournament: "t1" });
    director.post({ type: "query" });
    await settle();
    expect(toDirector).toHaveLength(1);
    expect(toDisplay).toHaveLength(1);
  });

  it("is the channel of the desktop app, on its own event", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    vi.stubGlobal("isTauri", true);
    const events: unknown[] = [];
    await listen(SOUND_EVENT, (event) => events.push(event.payload));

    const channel = openSoundChannel()!;
    channel.post({ type: "played", key: "t1:3:levelChange" });
    await settle();
    expect(events).toEqual([{ sender: expect.any(String), message: { type: "played", key: "t1:3:levelChange" } }]);
    channel.close();
  });

  it("is a BroadcastChannel in the browser, without any Tauri call", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      return null;
    });
    const channel = openSoundChannel();
    channel?.post({ type: "query" });
    await settle();
    expect(calls).toEqual([]);
    channel?.close();
  });
});
