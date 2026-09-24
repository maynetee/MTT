import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClockView, View } from "../../engine/types";
import { CLOCK_TICK_MS, localClock, useClock } from "./useClock";

const T0 = 1_700_000_000_000;

function clock(overrides: Partial<ClockView>): ClockView {
  return {
    levelIndex: 0,
    playLevel: 1,
    isBreak: false,
    running: true,
    sb: 100,
    bb: 200,
    ante: { type: "none" },
    durationMs: 1_200_000,
    remainingMs: 600_000,
    endsAtMs: T0 + 600_000,
    overtimeMs: 0,
    next: { index: 1, playLevel: 2, level: { type: "play", sb: 150, bb: 300, ante: { type: "none" }, durationMs: 1_200_000 } },
    nextBreakInMs: null,
    schedule: [],
    structureEndsInMs: 1_800_000,
    recomputeAtMs: T0 + 600_000,
    ...overrides
  };
}

const view = (overrides: Partial<ClockView>, generatedAtMs = T0) => ({ generatedAtMs, clock: clock(overrides) }) as View;

describe("localClock", () => {
  it("counts down to endsAtMs while running", () => {
    expect(localClock(clock({}), T0, T0 + 1_500)).toEqual({ remainingMs: 598_500, overtimeMs: 0, elapsedMs: 1_500 });
    expect(localClock(clock({}), T0, T0 + 700_000).remainingMs).toBe(0);
  });

  it("keeps the view's remaining time while paused", () => {
    const paused = clock({ running: false, endsAtMs: null, remainingMs: 42_000 });
    expect(localClock(paused, T0, T0 + 60_000)).toEqual({ remainingMs: 42_000, overtimeMs: 0, elapsedMs: 0 });
  });

  it("counts overtime past the end of the last level", () => {
    const last = clock({ next: null, remainingMs: 0, endsAtMs: T0 - 5_000, overtimeMs: 5_000 });
    expect(localClock(last, T0, T0 + 1_000)).toMatchObject({ remainingMs: 0, overtimeMs: 6_000 });
  });
});

describe("useClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks every 250 ms while running and corrects the host clock offset", () => {
    vi.useFakeTimers({ now: T0 });
    // The host clock is 2 s ahead of this window's.
    const { result } = renderHook(() => useClock(view({}, T0 + 2_000), 2_000));
    expect(result.current.remainingMs).toBe(598_000);

    act(() => vi.advanceTimersByTime(CLOCK_TICK_MS));
    expect(result.current.remainingMs).toBe(598_000 - CLOCK_TICK_MS);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.remainingMs).toBe(588_000 - CLOCK_TICK_MS);
  });

  it("does not tick while paused", () => {
    vi.useFakeTimers({ now: T0 });
    let renders = 0;
    renderHook(() => {
      renders++;
      return useClock(view({ running: false, endsAtMs: null }), 0);
    });
    const before = renders;
    act(() => vi.advanceTimersByTime(10_000));
    expect(renders).toBe(before);
  });
});
