import { invoke, isTauri, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import type { LevelDraft, MoveSuggestion, Seat, StateSnapshot, TournamentConfig } from "./types";
import {
  adjustClockLocal,
  balanceSuggestionsLocal,
  closeTableLocal,
  createTournamentLocal,
  eliminatePlayerLocal,
  getStateLocal,
  movePlayerLocal,
  nextLevelLocal,
  openDisplayWindowLocal,
  pauseClockLocal,
  previousLevelLocal,
  registerPlayerAtSeatLocal,
  registerPlayerLocal,
  revivePlayerAtSeatLocal,
  resetTournamentLocal,
  startClockLocal,
  tickClockLocal,
  triggerNextBreakLocal,
  undoLastEventLocal,
  updateItmLocal,
  updateLevelsLocal
} from "./demoStore";

/** Whether the app runs in the desktop shell; otherwise it runs in demo mode in a browser. */
export function isTauriAvailable() {
  return isTauri();
}

/** Surfaces an error to the user through the app's error banner. */
export function emitAppError(message: string) {
  window.dispatchEvent(new CustomEvent("app_error", { detail: message }));
}

function runDemo<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    emitAppError(String(error));
    throw error;
  }
}

async function invokeTauri<T>(command: string, payload?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  if (!isTauriAvailable()) {
    throw new Error("Tauri IPC unavailable. Run the app via `npm run tauri dev` (not in a browser tab).");
  }
  return invoke<T>(command, payload, options);
}

/** Header carrying the URL-encoded suggested file name (EXPORT_FILE_NAME_HEADER in commands.rs). */
const EXPORT_FILE_NAME_HEADER = "x-file-name";

/**
 * Desktop only: asks where to save an export with the native save dialog, then writes it.
 * The bytes travel as the raw IPC body. Resolves to false when the user cancels the dialog.
 */
export async function saveExport(fileName: string, content: Uint8Array): Promise<boolean> {
  return invokeTauri("save_export", content, {
    headers: { [EXPORT_FILE_NAME_HEADER]: encodeURIComponent(fileName) }
  });
}

export async function getState(): Promise<StateSnapshot> {
  if (!isTauriAvailable()) return getStateLocal();
  return invokeTauri("get_state");
}

export async function createTournament(config: TournamentConfig, levels: LevelDraft[]): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => createTournamentLocal(config, levels));
  return invokeTauri("create_tournament", { config, levels });
}

export async function resetTournament(): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => resetTournamentLocal());
  return invokeTauri("reset_tournament");
}

export async function registerPlayer(name: string, strategy: "random" | "balanced"): Promise<Seat> {
  if (!isTauriAvailable()) return runDemo(() => registerPlayerLocal(name, strategy));
  return invokeTauri("register_player", { name, strategy });
}

export async function registerPlayerAtSeat(name: string, tableNo: number, seatNo: number): Promise<Seat> {
  if (!isTauriAvailable()) return runDemo(() => registerPlayerAtSeatLocal(name, tableNo, seatNo));
  return invokeTauri("register_player_at_seat", { name, tableNo, seatNo });
}

export async function revivePlayerAtSeat(playerId: number, tableNo: number, seatNo: number): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => revivePlayerAtSeatLocal(playerId, tableNo, seatNo));
  return invokeTauri("revive_player_at_seat", { playerId, tableNo, seatNo });
}

export async function eliminatePlayer(playerId: number): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => eliminatePlayerLocal(playerId));
  return invokeTauri("eliminate_player", { playerId });
}

export async function movePlayer(playerId: number, toSeatId: number): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => movePlayerLocal(playerId, toSeatId));
  return invokeTauri("move_player", { playerId, toSeatId });
}

export async function balanceSuggestions(): Promise<MoveSuggestion[]> {
  if (!isTauriAvailable()) return balanceSuggestionsLocal();
  return invokeTauri("balance_suggestions");
}

export async function closeTable(tableId: number): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => closeTableLocal(tableId));
  return invokeTauri("close_table", { tableId });
}

export async function startClock(): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => startClockLocal());
  return invokeTauri("clock_start");
}

export async function pauseClock(): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => pauseClockLocal());
  return invokeTauri("clock_pause");
}

export async function nextLevel(): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => nextLevelLocal());
  return invokeTauri("clock_next");
}

export async function previousLevel(): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => previousLevelLocal());
  return invokeTauri("clock_prev");
}

export async function adjustClock(seconds: number): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => adjustClockLocal(seconds));
  return invokeTauri("clock_adjust", { seconds });
}

export async function triggerNextBreak(): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => triggerNextBreakLocal());
  return invokeTauri("clock_trigger_break");
}

export async function updateItmCount(newCount: number): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => updateItmLocal(newCount));
  return invokeTauri("update_itm", { newCount });
}

export async function updateLevels(levels: LevelDraft[]): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => updateLevelsLocal(levels));
  return invokeTauri("update_levels", { levels });
}

export async function undoLastEvent(): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => undoLastEventLocal());
  return invokeTauri("undo_last_event");
}

export async function openDisplayWindow(): Promise<void> {
  if (!isTauriAvailable()) return runDemo(() => openDisplayWindowLocal());
  return invokeTauri("open_display_window");
}

export function tickClockIfDemo() {
  if (!isTauriAvailable()) tickClockLocal();
}
