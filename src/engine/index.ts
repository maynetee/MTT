import { isTauri } from "@tauri-apps/api/core";
import { TauriEngine } from "./tauriEngine";
import type { Engine } from "./types";

export * from "./types";

let engine: Promise<Engine> | null = null;

/**
 * The engine for this window: the desktop commands inside Tauri, otherwise mtt-core compiled
 * to WebAssembly. The WASM engine is imported dynamically so the desktop app never loads the
 * wasm module and the main chunk stays small.
 */
export function getEngine(): Promise<Engine> {
  engine ??= isTauri()
    ? Promise.resolve(new TauriEngine())
    : import("./wasmEngine").then(({ loadWasmEngine }) => loadWasmEngine());
  return engine;
}
