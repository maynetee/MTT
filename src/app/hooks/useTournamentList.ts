import { useCallback, useEffect, useRef, useState } from "react";
import { toEngineError, type EngineError, type TournamentSummary } from "../../engine/types";
import { useEngine } from "../EngineContext";

/** The tournament list, refreshed whenever any tournament changes (in any window or tab). */
export function useTournamentList() {
  const engine = useEngine();
  const [summaries, setSummaries] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState<EngineError | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const list = await engine.listTournaments();
      if (request === latest.current) setSummaries(list);
    } catch (thrown) {
      if (request === latest.current) setError(toEngineError(thrown));
    }
  }, [engine]);

  useEffect(() => {
    void refresh();
    return engine.subscribe(() => void refresh());
  }, [engine, refresh]);

  return { summaries, error, setError, refresh };
}
