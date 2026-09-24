import type { Engine } from "../../engine/types";

/**
 * Full screen for the window this page runs in: the Tauri window on the desktop (needs
 * `core:window:allow-is-fullscreen` and `allow-set-fullscreen` in its capability), the
 * Fullscreen API in a browser.
 */
async function tauriWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function toggleFullscreen(kind: Engine["kind"]): Promise<void> {
  if (kind === "tauri") {
    const window = await tauriWindow();
    await window.setFullscreen(!(await window.isFullscreen()));
    return;
  }
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen?.();
}

export async function exitFullscreen(kind: Engine["kind"]): Promise<void> {
  if (kind === "tauri") {
    const window = await tauriWindow();
    if (await window.isFullscreen()) await window.setFullscreen(false);
    return;
  }
  if (document.fullscreenElement) await document.exitFullscreen();
}
