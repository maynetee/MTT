import { useCallback, useEffect, useRef, useState } from "react";
import { toEngineError, type Command, type EngineError, type View } from "../../engine/types";
import { useEngine } from "../EngineContext";

/** Refetch this long after `recomputeAtMs`, so the host is past the boundary. */
const RECOMPUTE_MARGIN_MS = 25;
const MAX_TIMEOUT_MS = 2_147_483_647;

interface State {
  view: View | null;
  /** Host clock minus local clock, measured when the view arrived. */
  offsetMs: number;
  /** Why the tournament could not be loaded (e.g. deleted in another window). */
  loadError: EngineError | null;
}

/**
 * The tournament's view, kept fresh: refetched on `tournament_changed` for this id and when
 * the view goes stale (`clock.recomputeAtMs`: level change or registration close). Responses
 * are applied in request order, so a slow refetch never overwrites a newer view.
 */
export function useTournamentView(id: string) {
  const engine = useEngine();
  const [state, setState] = useState<State>({ view: null, offsetMs: 0, loadError: null });
  const issued = useRef(0);
  const applied = useRef(0);

  /** Applies a view unless a newer request was applied; `sentAt` is the local request time. */
  const receive = useCallback((request: number, view: View, sentAt: number) => {
    if (request < applied.current) return;
    applied.current = request;
    // The host generated the view between sending and receiving: assume halfway (NTP style).
    const offsetMs = view.generatedAtMs - (sentAt + Date.now()) / 2;
    setState({ view, offsetMs, loadError: null });
  }, []);

  const refresh = useCallback(async () => {
    const request = ++issued.current;
    const sentAt = Date.now();
    try {
      receive(request, await engine.getView(id), sentAt);
    } catch (thrown) {
      if (request < applied.current) return;
      applied.current = request;
      setState((previous) => ({ ...previous, loadError: toEngineError(thrown) }));
    }
  }, [engine, id, receive]);

  /** Runs a command; resolves to the new view, or rejects with an `EngineError`. */
  const dispatch = useCallback(
    async (command: Command): Promise<View> => {
      const request = ++issued.current;
      const sentAt = Date.now();
      try {
        const view = await engine.dispatch(id, command);
        receive(request, view, sentAt);
        return view;
      } catch (thrown) {
        throw toEngineError(thrown);
      }
    },
    [engine, id, receive]
  );

  useEffect(() => {
    void refresh();
    return engine.subscribe((changed) => {
      if (changed === id) void refresh();
    });
  }, [engine, id, refresh]);

  const recomputeAtMs = state.view?.clock.recomputeAtMs ?? null;
  useEffect(() => {
    if (recomputeAtMs === null) return;
    const localAt = recomputeAtMs - state.offsetMs;
    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, localAt - Date.now()) + RECOMPUTE_MARGIN_MS);
    const timer = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(timer);
  }, [recomputeAtMs, state.offsetMs, state.view, refresh]);

  return { ...state, refresh, dispatch };
}
