import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import App from "../app/App";
import { EngineProvider } from "../app/EngineContext";
import type { Engine, Level, NewTournamentInput, SeatRef, View } from "../engine/types";
import type { WasmEngine } from "../engine/wasmEngine";
import { I18nProvider } from "../i18n";
import { createTestEngine, tournamentInput } from "./wasm";

export function Providers({ engine, children }: { engine: Engine; children: ReactNode }) {
  return (
    <I18nProvider>
      <EngineProvider engine={engine}>{children}</EngineProvider>
    </I18nProvider>
  );
}

/** Renders the whole app at `path` against `engine`; several can run side by side, like windows. */
export function renderApp(engine: Engine, path: string) {
  return render(
    <Providers engine={engine}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </Providers>
  );
}

/** A real WASM engine with one tournament of `tables` tables of `seats` seats. */
export async function withTournament(
  options: { tables?: number; seats?: number; placesPaid?: number; structure?: Level[]; config?: Partial<NewTournamentInput["config"]> } = {}
): Promise<{ engine: WasmEngine; id: string }> {
  const engine = createTestEngine();
  const id = await engine.createTournament(
    tournamentInput({ maxTables: options.tables ?? 2, seatsPerTable: options.seats ?? 9, placesPaid: options.placesPaid ?? 3, ...options.config }, options.structure)
  );
  return { engine, id };
}

/** Registers players, at a forced seat when given as `[name, table, seat]`. */
export async function register(engine: Engine, id: string, players: Array<string | [string, number, number]>): Promise<View> {
  let view = await engine.getView(id);
  for (const player of players) {
    const [name, seat]: [string, SeatRef | undefined] = typeof player === "string" ? [player, undefined] : [player[0], { table: player[1], seat: player[2] }];
    view = await engine.dispatch(id, { type: "register", name, ...(seat ? { seat } : {}) });
  }
  return view;
}

export function playerId(view: View, name: string): number {
  const row = view.ranking.find((candidate) => candidate.name === name);
  if (!row) throw new Error(`no player named ${name}`);
  return row.player;
}
