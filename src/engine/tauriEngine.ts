import { invoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  toEngineError,
  type Command,
  type DealQuote,
  type DealRequest,
  type Engine,
  type ExportFile,
  type NewTournamentInput,
  type TournamentSummary,
  type View
} from "./types";

/** Emitted by the desktop host after every create, delete, dispatch and import. */
export const TOURNAMENT_CHANGED = "tournament_changed";

/** Header carrying the URL-encoded suggested file name of `save_export`. */
export const EXPORT_FILE_NAME_HEADER = "x-file-name";

async function call<T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  try {
    return await invoke<T>(command, args, options);
  } catch (error) {
    throw toEngineError(error);
  }
}

/** Desktop host: every call is a Tauri command running mtt-core in the Rust process. */
export class TauriEngine implements Engine {
  readonly kind = "tauri";

  listTournaments(): Promise<TournamentSummary[]> {
    return call("list_tournaments");
  }

  createTournament(input: NewTournamentInput): Promise<string> {
    return call("create_tournament", { input });
  }

  async deleteTournament(id: string): Promise<void> {
    await call<null>("delete_tournament", { id });
  }

  getView(id: string): Promise<View> {
    return call("get_view", { id });
  }

  dispatch(id: string, command: Command): Promise<View> {
    return call("dispatch", { id, command });
  }

  quoteDeal(request: DealRequest): Promise<DealQuote> {
    return call("quote_deal", { request });
  }

  subscribe(listener: (id: string) => void): () => void {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<{ id: string }>(TOURNAMENT_CHANGED, (event) => {
      if (active) listener(event.payload.id);
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error: unknown) => console.error("Could not listen to tournament changes", error));
    return () => {
      active = false;
      unlisten?.();
    };
  }

  async openDisplayWindow(id: string): Promise<void> {
    await call<null>("open_display_window", { id });
  }

  async closeCurrentWindow(): Promise<void> {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().close();
  }

  /** The bytes travel as the raw IPC body, the file name in a header. */
  saveExport({ fileName, bytes }: ExportFile): Promise<boolean> {
    return call("save_export", bytes, {
      headers: { [EXPORT_FILE_NAME_HEADER]: encodeURIComponent(fileName) }
    });
  }

  legacyImportStatus(): Promise<{ available: boolean }> {
    return call("legacy_import_status");
  }

  importLegacy(): Promise<string> {
    return call("import_legacy");
  }
}
