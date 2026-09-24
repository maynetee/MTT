import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RankingRow } from "../../engine/types";
import { TauriEngine } from "../../engine/tauriEngine";
import { OBJECT_URL_REVOKE_DELAY_MS } from "../../engine/wasmEngine";
import { createTestEngine } from "../../test/wasm";
import { exportCSV, exportPDF, type RankingExport } from "./exports";

const rows: RankingRow[] = [
  { player: 1, name: "Łukasz", alive: true, seat: { table: 1, seat: 1 }, place: 1, placeTo: null, provisional: false, inMoney: true, entries: 1 },
  { player: 2, name: "=1+1", alive: false, seat: null, place: 2, placeTo: null, provisional: false, inMoney: true, entries: 1 }
];

const ranking = (tournamentName: string): RankingExport => ({ tournamentName, finished: true, winner: 1, rows });

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
  clearMocks();
});

describe("exportCSV (browser)", () => {
  it("downloads the escaped CSV under a sanitized name and revokes the URL only later", async () => {
    vi.useFakeTimers();
    const clicked: Array<{ download: string; href: string; attached: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href, attached: document.body.contains(this) });
    });

    await expect(exportCSV(createTestEngine(), ranking('Main Event: "Day 1/2"'))).resolves.toBe(true);

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

  it("rejects with a message ready for the user", async () => {
    createObjectURL.mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(exportCSV(createTestEngine(), ranking("Main Event"))).rejects.toThrow("CSV export failed: quota exceeded");
  });
});

describe("exportCSV (desktop)", () => {
  it("sends the bytes as the raw body of save_export, with the URL-encoded file name in a header", async () => {
    mockIPC(() => true);
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (...args: unknown[]) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = vi.spyOn(internals, "invoke");

    await expect(exportCSV(new TauriEngine(), ranking("Main Event: Día 1"))).resolves.toBe(true);

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

  it("resolves to false when the save dialog is cancelled", async () => {
    mockIPC(() => false);
    await expect(exportCSV(new TauriEngine(), ranking("Main Event"))).resolves.toBe(false);
  });
});

describe("exportPDF (browser)", () => {
  it("rejects with a message ready for the user when the fonts cannot load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(exportPDF(createTestEngine(), ranking("Main Event"))).rejects.toThrow(
      /^PDF export failed: Could not load the PDF font .*Inter-Regular.*\(HTTP 404\)$/
    );
  });
});
