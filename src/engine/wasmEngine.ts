import init, { WasmTournament } from "../wasm/pkg/mtt_wasm.js";
import wasmUrl from "../wasm/pkg/mtt_wasm_bg.wasm?url";
import {
  hostError,
  notFound,
  toEngineError,
  type Command,
  type Engine,
  type ExportFile,
  type NewTournamentInput,
  type TournamentSummary,
  type View
} from "./types";

/** localStorage keys: the tournament list, then one saved log per tournament. */
export const INDEX_KEY = "mtt:v2:index";
export const tournamentKey = (id: string) => `mtt:v2:t:${id}`;
/** Tabs of the same origin tell each other about changes on this channel. */
export const CHANNEL_NAME = "mtt";
export const TOURNAMENT_CHANGED = "tournament_changed";
/** Delay before releasing a download's object URL (the value FileSaver.js uses). */
export const OBJECT_URL_REVOKE_DELAY_MS = 40_000;

/** A summary plus a revision number, bumped on every write, to spot changes made by other tabs. */
interface IndexEntry extends TournamentSummary {
  rev: number;
}

export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

export interface WasmEngineOptions {
  storage?: Storage;
  /** `null` disables cross-tab notifications. Defaults to a `BroadcastChannel`. */
  channel?: ChannelLike | null;
  /**
   * Where `storage` events arrive (`window` by default when `storage` is localStorage).
   * Another tab's write can reach this tab's localStorage after its broadcast message.
   */
  storageEvents?: EventTarget | null;
  /** Wall clock in ms. */
  now?: () => number;
  /** A random u64 as a decimal string. */
  seed?: () => string;
  newId?: () => string;
}

/** A fresh random u64 from the browser's CSPRNG, as a decimal string (a JS number holds 53 bits). */
export function randomSeed(): string {
  const [high, low] = crypto.getRandomValues(new Uint32Array(2));
  return ((BigInt(high) << 32n) | BigInt(low)).toString();
}

/** A UUID v4, without requiring a secure context like `crypto.randomUUID` does. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defaultChannel(): ChannelLike | null {
  return typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
}

function isChangeMessage(data: unknown): data is { type: string; id: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === TOURNAMENT_CHANGED &&
    typeof (data as { id?: unknown }).id === "string"
  );
}

/** Runs a call into the wasm module, turning its thrown JSON strings into `EngineError`s. */
function wasmCall<T>(call: () => T): T {
  try {
    return call();
  } catch (error) {
    throw toEngineError(error);
  }
}

function summaryOf(entry: IndexEntry): TournamentSummary {
  const { rev: _rev, ...summary } = entry;
  return summary;
}

function parseIndex(raw: string | null): IndexEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IndexEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Browser host: mtt-core compiled to WebAssembly, one `WasmTournament` per open tournament,
 * saved logs in localStorage. Only the tab that dispatches writes; other tabs (the display)
 * reload from storage when told on the broadcast channel or when the stored revision moved.
 * No timer ever writes: the clock is a timestamp in the log.
 */
export class WasmEngine implements Engine {
  readonly kind = "wasm";
  private readonly storage: Storage;
  private readonly channel: ChannelLike | null;
  private readonly storageEvents: EventTarget | null;
  private readonly now: () => number;
  private readonly seed: () => string;
  private readonly newId: () => string;
  private readonly cache = new Map<string, { tournament: WasmTournament; rev: number }>();
  private readonly listeners = new Set<(id: string) => void>();
  /** Stored revision last announced to listeners for a change made by another tab (-1: deleted). */
  private readonly announced = new Map<string, number>();

  constructor(options: WasmEngineOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.channel = options.channel === undefined ? defaultChannel() : options.channel;
    const usesLocalStorage = typeof window !== "undefined" && this.storage === window.localStorage;
    this.storageEvents = options.storageEvents === undefined ? (usesLocalStorage ? window : null) : options.storageEvents;
    this.now = options.now ?? Date.now;
    this.seed = options.seed ?? randomSeed;
    this.newId = options.newId ?? randomId;
    if (this.channel) {
      this.channel.onmessage = (event) => {
        if (isChangeMessage(event.data)) this.remoteChange(event.data.id);
      };
    }
    this.storageEvents?.addEventListener("storage", this.onStorage);
  }

  /**
   * Another tab rewrote the index. Its broadcast message may have arrived before the write
   * was visible here: announce the tournaments whose stored revision moved.
   */
  private readonly onStorage = (event: Event) => {
    const { key, oldValue, newValue } = event as StorageEvent;
    if (key === null) {
      for (const id of this.cache.keys()) this.remoteChange(id);
      return;
    }
    if (key !== INDEX_KEY) return;
    const ids = new Set([...parseIndex(oldValue), ...parseIndex(newValue)].map((entry) => entry.id));
    for (const id of ids) this.remoteChange(id);
  };

  /** Tells listeners about another tab's change once, as soon as the stored revision shows it. */
  private remoteChange(id: string): void {
    const rev = this.readIndex().find((entry) => entry.id === id)?.rev ?? -1;
    const last = this.announced.get(id);
    if (last !== undefined && (rev === last || (rev !== -1 && rev < last))) return;
    this.announced.set(id, rev);
    this.emit(id);
  }

  async listTournaments(): Promise<TournamentSummary[]> {
    return this.readIndex()
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .map(summaryOf);
  }

  async createTournament(input: NewTournamentInput): Promise<string> {
    const id = this.newId();
    const now = this.now();
    const tournament = wasmCall(() => WasmTournament.create(id, JSON.stringify(input), now, this.seed()));
    const view = JSON.parse(tournament.view(now)) as View;
    const entry: IndexEntry = { ...this.summarize(view, now, now), rev: 1 };
    try {
      this.write(id, tournament.to_saved(), entry);
    } catch (error) {
      tournament.free();
      throw error;
    }
    this.cache.set(id, { tournament, rev: entry.rev });
    this.changed(id);
    return id;
  }

  async deleteTournament(id: string): Promise<void> {
    const index = this.readIndex();
    if (!index.some((entry) => entry.id === id)) throw notFound(id);
    this.evict(id);
    this.storage.removeItem(tournamentKey(id));
    this.writeIndex(index.filter((entry) => entry.id !== id));
    this.changed(id);
  }

  async getView(id: string): Promise<View> {
    const { tournament } = this.load(id);
    return JSON.parse(tournament.view(this.now())) as View;
  }

  async dispatch(id: string, command: Command): Promise<View> {
    const { tournament, entry } = this.load(id);
    const now = this.now();
    // On error the core leaves the aggregate unchanged.
    wasmCall(() => tournament.dispatch(JSON.stringify(command), now, this.seed()));
    const view = JSON.parse(tournament.view(now)) as View;
    const next: IndexEntry = { ...this.summarize(view, entry.createdAtMs, now), rev: entry.rev + 1 };
    try {
      this.write(id, tournament.to_saved(), next);
    } catch (error) {
      // Drop the unsaved change: the next access reloads the last saved log.
      this.evict(id);
      throw error;
    }
    this.cache.set(id, { tournament, rev: next.rev });
    this.changed(id);
    return view;
  }

  subscribe(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async openDisplayWindow(id: string): Promise<void> {
    window.open(`#/display/${encodeURIComponent(id)}`, `mtt-display-${id}`);
  }

  async closeCurrentWindow(): Promise<void> {
    window.close();
  }

  async saveExport({ fileName, bytes, mimeType }: ExportFile): Promise<boolean> {
    const blob = new Blob([bytes.slice().buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking synchronously after click() can cancel the download before the browser has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
    return true;
  }

  async legacyImportStatus(): Promise<{ available: boolean }> {
    return { available: false };
  }

  async importLegacy(): Promise<string> {
    throw hostError("Importing from the previous version is only available in the desktop app.");
  }

  /** Stops listening to other tabs and frees every loaded tournament. */
  dispose(): void {
    this.channel?.close();
    this.storageEvents?.removeEventListener("storage", this.onStorage);
    for (const id of [...this.cache.keys()]) this.evict(id);
    this.listeners.clear();
  }

  /** The tournament as stored, reloaded when another tab wrote a newer revision. */
  private load(id: string): { tournament: WasmTournament; entry: IndexEntry } {
    const entry = this.readIndex().find((candidate) => candidate.id === id);
    if (!entry) {
      this.evict(id);
      throw notFound(id);
    }
    const cached = this.cache.get(id);
    if (cached && cached.rev === entry.rev) return { tournament: cached.tournament, entry };
    const saved = this.storage.getItem(tournamentKey(id));
    if (saved === null) throw notFound(id);
    this.evict(id);
    const tournament = wasmCall(() => WasmTournament.from_saved(saved));
    this.cache.set(id, { tournament, rev: entry.rev });
    return { tournament, entry };
  }

  private summarize(view: View, createdAtMs: number, updatedAtMs: number): TournamentSummary {
    return {
      id: view.id,
      name: view.config.name,
      phase: view.phase,
      createdAtMs,
      updatedAtMs,
      players: view.counts.unique,
      alive: view.counts.alive
    };
  }

  private readIndex(): IndexEntry[] {
    return parseIndex(this.storage.getItem(INDEX_KEY));
  }

  private writeIndex(index: IndexEntry[]): void {
    this.storage.setItem(INDEX_KEY, JSON.stringify(index));
  }

  /**
   * Saves the log, then the index entry that makes the new revision visible. On failure
   * (storage full) the previous log is put back, so storage never runs ahead of the index.
   */
  private write(id: string, saved: string, entry: IndexEntry): void {
    const key = tournamentKey(id);
    const previous = this.storage.getItem(key);
    try {
      this.storage.setItem(key, saved);
      const index = this.readIndex().filter((candidate) => candidate.id !== id);
      this.writeIndex([...index, entry]);
    } catch (error) {
      try {
        if (previous === null) this.storage.removeItem(key);
        else this.storage.setItem(key, previous);
      } catch {
        // Keep reporting the original failure.
      }
      throw hostError(`Could not save the tournament: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private evict(id: string): void {
    this.cache.get(id)?.tournament.free();
    this.cache.delete(id);
  }

  /** Tells this tab's listeners and the other tabs. */
  private changed(id: string): void {
    this.channel?.postMessage({ type: TOURNAMENT_CHANGED, id });
    this.emit(id);
  }

  /** Listeners run after the current call returns, like a host event. */
  private emit(id: string): void {
    queueMicrotask(() => {
      for (const listener of [...this.listeners]) listener(id);
    });
  }
}

let ready: Promise<unknown> | null = null;

/** Downloads and instantiates the wasm module once, then builds an engine. */
export async function loadWasmEngine(options?: WasmEngineOptions): Promise<WasmEngine> {
  ready ??= init({ module_or_path: wasmUrl });
  await ready;
  return new WasmEngine(options);
}
