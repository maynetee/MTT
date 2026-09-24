import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { toEngineError, type Command, type EngineError } from "../../engine/types";
import { useI18n } from "../../i18n";
import { AppShell } from "../components/AppShell";
import { ErrorBanner } from "../components/ErrorBanner";
import { useTournamentView } from "../hooks/useTournamentView";
import { TournamentContext, type TournamentContextValue } from "../TournamentContext";
import { isEditableTarget } from "../utils/keyboard";
import { playerNames } from "../utils/view";

const TABS = ["levels", "registration", "seating", "players", "moves", "clock", "display", "exports", "settings"] as const;

/** `/t/:id/*`: one director shell per tournament id. */
export function DirectorRoute() {
  const { id = "" } = useParams();
  return <DirectorShell key={id} id={id} />;
}

export default function DirectorShell({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { view, offsetMs, loadError, dispatch } = useTournamentView(id);
  const [error, setError] = useState<EngineError | null>(null);
  const names = useMemo(() => (view ? playerNames(view) : () => undefined), [view]);

  const run = useCallback<TournamentContextValue["run"]>(
    async (command, onError) => {
      try {
        const next = await dispatch(command);
        setError(null);
        return next;
      } catch (thrown) {
        const engineError = toEngineError(thrown);
        setError(engineError);
        onError?.(engineError);
        return null;
      }
    },
    [dispatch]
  );

  // Undo/redo shortcuts, except while typing in a field (native text undo wins there).
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const command: Command | null =
        key === "z" ? (event.shiftKey ? { type: "redo" } : { type: "undo" }) : key === "y" && event.ctrlKey ? { type: "redo" } : null;
      if (!command) return;
      event.preventDefault();
      void runRef.current(command);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const context = useMemo<TournamentContextValue | null>(
    () => (view ? { id, view, offsetMs, run, report: setError, playerName: names } : null),
    [id, view, offsetMs, run, names]
  );

  if (!view || !context) {
    return (
      <AppShell title={<Link to="/">{t("app.allTournaments")}</Link>}>
        <main className="page">
          <div className="card">{loadError ? i18n.error(loadError) : t("common.loading")}</div>
        </main>
      </AppShell>
    );
  }

  const { history, phase } = view;
  const running = view.clock.running;
  const undoLabel = history.undo ? t("header.undoAction", { action: i18n.action(history.undo) }) : t("header.undo");
  const redoLabel = history.redo ? t("header.redoAction", { action: i18n.action(history.redo) }) : t("header.redo");
  const undoHint = [
    t("header.shortcuts", { key: undoLabel }),
    history.undo?.kind === "clock_changed" ? t("header.clockUndoHint") : null
  ]
    .filter(Boolean)
    .join("\n");
  const finishPending = view.warnings.some((warning) => warning.code === "FINISH_PENDING");

  return (
    <AppShell
      title={
        <div className="header-title">
          <Link to="/">{t("app.allTournaments")}</Link>
          <strong>{view.config.name}</strong>
        </div>
      }
      center={
        phase !== "finished" && (
          <button
            className={`btn clock-toggle ${running ? "running" : "paused"}`}
            onClick={() => void run(running ? { type: "pause_clock" } : { type: "start_clock" })}
          >
            {running ? t("header.pause") : t("header.start")}
          </button>
        )
      }
      actions={
        <>
          <button className="btn" onClick={() => void run({ type: "undo" })} disabled={!history.undo} title={undoHint}>
            {undoLabel}
          </button>
          <button className="btn" onClick={() => void run({ type: "redo" })} disabled={!history.redo} title={redoLabel}>
            {redoLabel}
          </button>
        </>
      }
      status={<div className="status-pill">{t(`phase.${phase}`).toUpperCase()}</div>}
    >
      {error && <ErrorBanner message={i18n.error(error, names)} onDismiss={() => setError(null)} />}
      {finishPending && (
        <div className="warning-banner" role="status">
          <span>{i18n.warning({ code: "FINISH_PENDING" })}</span>
          <button className="btn" onClick={() => void run({ type: "close_registration" })}>
            {t("players.finishPending")}
          </button>
        </div>
      )}
      <nav className="tabs">
        {TABS.map((tab) => (
          <NavLink key={tab} to={`/t/${encodeURIComponent(id)}/${tab}`} className={({ isActive }) => (isActive ? "tab active" : "tab")}>
            {t(`tabs.${tab}`)}
          </NavLink>
        ))}
      </nav>
      <main className="page">
        <TournamentContext.Provider value={context}>
          <Outlet />
        </TournamentContext.Provider>
      </main>
    </AppShell>
  );
}
