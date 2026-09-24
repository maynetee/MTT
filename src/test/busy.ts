import { act } from "@testing-library/react";
import { vi } from "vitest";

/**
 * Makes `edit` happen right after the app renders a new view of the tournament and before React
 * runs that render's effects, as on a busy machine, where React runs effects in a later task
 * than the render. `change` stands for another window changing the tournament; `watch` is an
 * element whose text the new view changes (the header clock).
 *
 * Every reading of the clock advancing 10 ms makes React's scheduler yield between render and
 * effects. The new view arrives outside act() and outside any event, as in the app (jsdom can
 * leave `window.event` set after user-event, which would give the update a keystroke's priority).
 */
export async function editAsViewArrives({ watch, change, edit }: { watch: HTMLElement; change(): Promise<unknown>; edit(): void }): Promise<void> {
  await act(async () => {});
  const before = watch.textContent;
  const edited = new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      if (watch.textContent === before) return;
      observer.disconnect();
      edit();
      resolve();
    });
    observer.observe(watch, { subtree: true, characterData: true, childList: true });
  });

  const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const actEnvironment = scope.IS_REACT_ACT_ENVIRONMENT;
  let now = performance.now();
  const clock = vi.spyOn(performance, "now").mockImplementation(() => (now += 10));
  const noEvent = vi.spyOn(window, "event", "get").mockReturnValue(undefined);
  scope.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    await change();
    await edited;
  } finally {
    scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    noEvent.mockRestore();
    clock.mockRestore();
  }
  // Let the effects of that render run.
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}
