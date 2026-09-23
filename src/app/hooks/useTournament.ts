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
    const errorHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail) setError(String(detail));
    };
    window.addEventListener("state_updated", handler);
    window.addEventListener("app_error", errorHandler as EventListener);
    return () => {
      clearInterval(interval);
      window.removeEventListener("state_updated", handler);
      window.removeEventListener("app_error", errorHandler as EventListener);
    };
  }, [refresh]);

  return { state, error, setError, refresh };
}
