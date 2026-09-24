import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { register, renderApp } from "../test/app";
import { MIN, MemoryStorage, createTestEngine, tournamentInput } from "../test/wasm";

const T0 = 1_700_000_000_000;

function contents(storage: Storage): Record<string, string | null> {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!);
  return Object.fromEntries(keys.map((key) => [key, storage.getItem(key)]));
}

/** Lets pending engine calls and React updates settle (the engine resolves in microtasks). */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

// In the browser the clock is a timestamp in the saved log: only a director's command writes.
// Timers (the countdown, the refetch at each level end, the display's scrolling) only read.
describe("one clock owner in the browser", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not change the stored log when a second engine opens the same storage and time passes", async () => {
    vi.useFakeTimers({ now: T0 });
    const storage = new MemoryStorage();
    const director = createTestEngine({ storage });
    const id = await director.createTournament(tournamentInput({ maxTables: 1 }));
    await register(director, id, ["Ann", "Ben", "Cid"]);
    await director.dispatch(id, { type: "start_clock" });
    const saved = contents(storage);
    const setItem = vi.spyOn(storage, "setItem");
    const removeItem = vi.spyOn(storage, "removeItem");

    // Another tab: its own engine on the same storage, showing the display.
    const display = createTestEngine({ storage });
    renderApp(director, `/t/${id}/clock`);
    renderApp(display, `/display/${id}`);
    await settle();

    // Past every level end and the break, into overtime.
    for (let minute = 0; minute < 120; minute++) {
      await act(async () => vi.advanceTimersByTime(MIN));
      await settle();
    }

    const [shown, owned] = await Promise.all([display.getView(id), director.getView(id)]);
    expect(shown.clock.levelIndex).toBe(4);
    expect(shown.clock.overtimeMs).toBe(30 * MIN);
    expect(shown.clock).toEqual(owned.clock);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(contents(storage)).toEqual(saved);
  });
});
