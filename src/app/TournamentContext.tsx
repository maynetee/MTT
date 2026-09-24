import { createContext, useContext } from "react";
import type { Command, EngineError, View } from "../engine/types";

export interface TournamentContextValue {
  id: string;
  view: View;
  /** Host clock minus local clock (see useTournamentView). */
  offsetMs: number;
  /**
   * Runs a command. Resolves to the new view, or to null after showing the error in the
   * banner; `onError` lets a screen also react to it (e.g. highlight a structure row).
   */
  run(command: Command, onError?: (error: EngineError) => void): Promise<View | null>;
  /** Shows an error in the banner. */
  report(error: EngineError): void;
  /** The name of a player of this tournament, for messages. */
  playerName(player: number): string | undefined;
}

export const TournamentContext = createContext<TournamentContextValue | null>(null);

/** The tournament a director tab shows; provided by DirectorShell. */
export function useTournament(): TournamentContextValue {
  const value = useContext(TournamentContext);
  if (!value) throw new Error("useTournament() needs a <TournamentContext.Provider>");
  return value;
}
