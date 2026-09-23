import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { StateSnapshot } from "../types";
import { getState, isTauriAvailable, tickClockIfDemo } from "../api";

export function useTournament() {
  const [state, setState] = useState<StateSnapshot>({
    tournament: null,
    players: [],
    tables: [],
    seats: [],
    levels: []
  });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await getState();
      setState(snapshot);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    const unlistenPromises = [
      listen("state_updated", () => refresh()),
      listen<string>("app_error", (event) => setError(event.payload))
    ];

    return () => {
      unlistenPromises.forEach(async (promise) => {
        const unlisten = await promise;
        unlisten();
      });
    };
  }, [refresh]);

  useEffect(() => {
    if (isTauriAvailable()) return;
    const interval = setInterval(() => tickClockIfDemo(), 1000);
    const handler = () => refresh();
    window.addEventListener("state_updated", handler);
    return () => {
      clearInterval(interval);
      window.removeEventListener("state_updated", handler);
    };
  }, [refresh]);

  // Front-end errors (demo mode, exports) are dispatched as window events in both modes.
  useEffect(() => {
    const errorHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail) setError(String(detail));
    };
    window.addEventListener("app_error", errorHandler);
    return () => window.removeEventListener("app_error", errorHandler);
  }, []);

  return { state, error, setError, refresh };
}
