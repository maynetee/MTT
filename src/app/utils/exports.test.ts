import { afterEach, describe, expect, it, vi } from "vitest";
import type { RankingEntry } from "../types";
import { exportPDF } from "./exports";

const entries: RankingEntry[] = [
  { place: 1, playerId: 1, playerName: "Łukasz", status: "active", eliminatedAt: null },
  { place: 2, playerId: 2, playerName: "Дмитрий", status: "eliminated", eliminatedAt: 1_000 }
];

function captureAppErrors() {
  const messages: string[] = [];
  const listener = (event: Event) => messages.push(String((event as CustomEvent).detail));
  window.addEventListener("app_error", listener);
  return { messages, stop: () => window.removeEventListener("app_error", listener) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exportPDF", () => {
  it("reports a failure through the app_error event instead of rejecting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const errors = captureAppErrors();

    await expect(exportPDF(entries, { tournamentName: "Main Event", finished: true })).resolves.toBeUndefined();

    errors.stop();
    expect(errors.messages).toHaveLength(1);
    expect(errors.messages[0]).toMatch(/^PDF export failed: Could not load the PDF font .*Inter-Regular.*\(HTTP 404\)$/);
  });
});
