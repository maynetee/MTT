import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TauriEngine } from "./tauriEngine";
import type { DealRequest, EngineError } from "./types";

type Internals = { invoke: (cmd: string, args: unknown, options?: unknown) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

async function rejection(promise: Promise<unknown>): Promise<EngineError> {
  try {
    await promise;
  } catch (error) {
    return error as EngineError;
  }
  throw new Error("expected a rejection");
}

describe("TauriEngine", () => {
  it("calls the host commands with camelCase arguments", async () => {
    const calls: Array<[string, unknown]> = [];
    mockIPC((cmd, args) => {
      calls.push([cmd, args]);
      switch (cmd) {
        case "list_tournaments":
          return [{ id: "t1", name: "Friday", phase: "setup", createdAtMs: 1, updatedAtMs: 2, players: 0, alive: 0 }];
        case "create_tournament":
          return "t2";
        case "get_view":
        case "dispatch":
          return { id: (args as { id: string }).id };
        case "legacy_import_status":
          return { available: true };
        case "import_legacy":
          return "t3";
        default:
          return null;
      }
    });
    const engine = new TauriEngine();
    const input = { config: { name: "Friday" }, structure: [] } as never;

    expect(await engine.listTournaments()).toHaveLength(1);
    expect(await engine.createTournament(input)).toBe("t2");
    await engine.deleteTournament("t1");
    expect(await engine.getView("t1")).toEqual({ id: "t1" });
    expect(await engine.dispatch("t1", { type: "undo" })).toEqual({ id: "t1" });
    await engine.openDisplayWindow("t1");
    expect(await engine.legacyImportStatus()).toEqual({ available: true });
    expect(await engine.importLegacy()).toBe("t3");

    expect(calls).toEqual([
      ["list_tournaments", {}],
      ["create_tournament", { input }],
      ["delete_tournament", { id: "t1" }],
      ["get_view", { id: "t1" }],
      ["dispatch", { id: "t1", command: { type: "undo" } }],
      ["open_display_window", { id: "t1" }],
      ["legacy_import_status", {}],
      ["import_legacy", {}]
    ]);
  });

  it("passes the host's error objects through and wraps anything else as HOST_ERROR", async () => {
    mockIPC((cmd) => {
      if (cmd === "dispatch") throw { code: "SEAT_OCCUPIED", params: { table: 2, seat: 5 } };
      if (cmd === "get_view") throw { code: "NOT_FOUND", params: { id: "gone" } };
      throw "Command list_tournaments not allowed by ACL";
    });
    const engine = new TauriEngine();

    expect(await rejection(engine.dispatch("t1", { type: "start_clock" }))).toEqual({
      code: "SEAT_OCCUPIED",
      params: { table: 2, seat: 5 }
    });
    expect(await rejection(engine.getView("gone"))).toEqual({ code: "NOT_FOUND", params: { id: "gone" } });
    expect(await rejection(engine.listTournaments())).toEqual({
      code: "HOST_ERROR",
      params: { message: "Command list_tournaments not allowed by ACL" }
    });
  });

  it("asks quote_deal for a deal quote and passes its domain errors through", async () => {
    const calls: Array<[string, unknown]> = [];
    const quote = { icm: [38393, 32750, 28857], chipChop: [40000, 32000, 28000], playFor: 0 };
    mockIPC((cmd, args) => {
      calls.push([cmd, args]);
      const { request } = args as { request: DealRequest };
      if (request.prizes.length > request.stacks.length) throw { code: "INVALID_ICM_INPUT" };
      return quote;
    });
    const engine = new TauriEngine();
    const valid: DealRequest = { stacks: [5000, 3000, 2000], prizes: [50000, 30000, 20000] };
    const invalid: DealRequest = { stacks: [100], prizes: [60, 40], playFor: 10 };

    expect(await engine.quoteDeal(valid)).toEqual(quote);
    expect(await rejection(engine.quoteDeal(invalid))).toEqual({ code: "INVALID_ICM_INPUT" });
    expect(calls).toEqual([
      ["quote_deal", { request: valid }],
      ["quote_deal", { request: invalid }]
    ]);
  });

  it("forwards tournament_changed events until unsubscribed", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const engine = new TauriEngine();
    const listener = vi.fn();

    const unsubscribe = engine.subscribe(listener);
    await vi.waitFor(async () => {
      await emit("tournament_changed", { id: "t1" });
      expect(listener).toHaveBeenCalledWith("t1");
    });
    const calls = listener.mock.calls.length;

    unsubscribe();
    await emit("tournament_changed", { id: "t1" });
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it("sends an export as the raw body of save_export, with the URL-encoded file name in a header", async () => {
    mockIPC(() => true);
    const invoke = vi.spyOn(internals(), "invoke");
    const bytes = new TextEncoder().encode("Place,Player\r\n");

    const saved = await new TauriEngine().saveExport({
      fileName: "Main Event: Día 1-ranking.csv",
      bytes,
      mimeType: "text/csv;charset=utf-8"
    });

    expect(saved).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, body, options] = invoke.mock.calls[0];
    expect(command).toBe("save_export");
    expect(body).toBe(bytes);
    expect(options).toEqual({ headers: { "x-file-name": "Main%20Event%3A%20D%C3%ADa%201-ranking.csv" } });
  });
});

describe("getEngine", () => {
  it("uses the Tauri engine inside the desktop shell without loading the wasm engine", async () => {
    vi.resetModules();
    const loaded = vi.fn();
    vi.doMock("./wasmEngine", () => {
      loaded();
      return {};
    });
    vi.stubGlobal("isTauri", true);

    const { getEngine } = await import("./index");
    const engine = await getEngine();

    expect(engine.kind).toBe("tauri");
    expect(loaded).not.toHaveBeenCalled();
    vi.doUnmock("./wasmEngine");
  });

  it("loads the wasm engine in a browser", async () => {
    vi.resetModules();
    const fake = { kind: "wasm" };
    vi.doMock("./wasmEngine", () => ({ loadWasmEngine: async () => fake }));

    const { getEngine } = await import("./index");

    expect(await getEngine()).toBe(fake);
    expect(await getEngine()).toBe(fake);
    vi.doUnmock("./wasmEngine");
  });
});
