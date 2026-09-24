import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import { exitFullscreen, toggleFullscreen } from "./fullscreen";

afterEach(() => clearMocks());

/** The Tauri window commands, on a window that starts out of full screen. */
function desktopWindow() {
  mockWindows("main");
  const state = { fullscreen: false, calls: [] as string[] };
  mockIPC((cmd, args) => {
    state.calls.push(cmd);
    if (cmd === "plugin:window|is_fullscreen") return state.fullscreen;
    if (cmd === "plugin:window|set_fullscreen") {
      state.fullscreen = (args as { value: boolean }).value;
      return null;
    }
    throw new Error(`unexpected command ${cmd}`);
  });
  return state;
}

describe("full screen on the desktop", () => {
  it("toggles the current window", async () => {
    const window = desktopWindow();
    await toggleFullscreen("tauri");
    expect(window.fullscreen).toBe(true);
    await toggleFullscreen("tauri");
    expect(window.fullscreen).toBe(false);
  });

  it("leaves full screen, and does nothing when not in full screen", async () => {
    const window = desktopWindow();
    await exitFullscreen("tauri");
    expect(window.calls).toEqual(["plugin:window|is_fullscreen"]);

    window.fullscreen = true;
    await exitFullscreen("tauri");
    expect(window.fullscreen).toBe(false);
  });
});
