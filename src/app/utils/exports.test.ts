import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RankingEntry } from "../types";
import { OBJECT_URL_REVOKE_DELAY_MS, exportCSV, exportPDF } from "./exports";

const entries: RankingEntry[] = [
  { place: 1, playerId: 1, playerName: "Łukasz", status: "active", eliminatedAt: null },
  { place: 2, playerId: 2, playerName: "=1+1", status: "eliminated", eliminatedAt: 1_000 }
];

function captureAppErrors() {
  const messages: string[] = [];
  const listener = (event: Event) => messages.push(String((event as CustomEvent).detail));
  window.addEventListener("app_error", listener);
  return { messages, stop: () => window.removeEventListener("app_error", listener) };
}

// jsdom implements neither createObjectURL nor revokeObjectURL.
const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

beforeEach(() => {
  createObjectURL.mockReset().mockReturnValue("blob:mtt-test");
  revokeObjectURL.mockReset();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("exportCSV (browser)", () => {
  it("downloads the escaped CSV under a sanitized name and revokes the URL only later", async () => {
    vi.useFakeTimers();
    const clicked: Array<{ download: string; href: string; attached: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href, attached: document.body.contains(this) });
    });

    await exportCSV(entries, 'Main Event: "Day 1/2"');

    expect(clicked).toEqual([{ download: "Main Event Day 1 2-ranking.csv", href: "blob:mtt-test", attached: true }]);
    expect(document.querySelector("a[download]")).toBeNull();

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe("Place,Player,Status\r\n1,Łukasz,Winner\r\n2,'=1+1,Eliminated\r\n");

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mtt-test");
  });

  it("reports a failure through the app_error event instead of rejecting", async () => {
    createObjectURL.mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const errors = captureAppErrors();

    await expect(exportCSV(entries, "Main Event")).resolves.toBeUndefined();

    errors.stop();
    expect(errors.messages).toEqual(["CSV export failed: quota exceeded"]);
  });
});

describe("exportCSV (desktop)", () => {
  it("sends the bytes as the raw body of save_export, with the URL-encoded file name in a header", async () => {
    const invoke = vi.fn(async (_cmd: string, _args: unknown, _options: unknown) => true);
    vi.stubGlobal("isTauri", true);
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });

    await exportCSV(entries, "Main Event: Día 1");

    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, body, options] = invoke.mock.calls[0];
    expect(command).toBe("save_export");
    expect(options).toEqual({ headers: { "x-file-name": "Main%20Event%20D%C3%ADa%201-ranking.csv" } });
    const bytes = body as Uint8Array;
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(3))).toBe(
      "Place,Player,Status\r\n1,Łukasz,Winner\r\n2,'=1+1,Eliminated\r\n"
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe("exportPDF (browser)", () => {
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
