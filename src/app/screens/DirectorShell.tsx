import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import { toEngineError, type Command, type EngineError, type View } from "../../engine/types";
import { useI18n } from "../../i18n";
import { AppShell, PageTitle } from "../components/AppShell";
import { ButtonLink, Button, IconButton } from "../components/Button";
import { Callout } from "../components/Callout";
import { ClockPod } from "../components/ClockPod";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pill } from "../components/Pill";
import { Tabs } from "../components/Tabs";
import { useTournamentView } from "../hooks/useTournamentView";
import { TournamentContext, type TournamentContextValue } from "../TournamentContext";
import { isEditableTarget, isMac } from "../utils/keyboard";
import { playerNames } from "../utils/view";

/** Live work first, then the setup and output screens. */
const TAB_GROUPS = [
  ["registration", "seating", "players", "moves", "clock"],
  ["levels", "settings", "display", "exports"]
] as const;

/** `/t/:id/*`: one director shell per tournament id. */
export function DirectorRoute() {
  const { id = "" } = useParams();
  return <DirectorShell key={id} id={id} />;
}

/** The one status that matters most at the desk: setup, late registration, or finished. */
function StatusPill({ view }: { view: View }) {
  const { t } = useI18n();
  if (view.phase === "setup") return <Pill tone="neutral">{t("phase.setup")}</Pill>;
  if (view.phase === "finished") return <Pill tone="neutral">{t("phase.finished")}</Pill>;
  return view.registration.open ? (
    <Pill tone="success" dot>
      {t("header.lateRegOpen")}
    </Pill>
  ) : (
    <Pill tone="muted">{t("header.lateRegClosed")}</Pill>
  );
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

  // Undo/redo shortcuts, except while typing in a field (native text undo wins there) or
  // while a dialog asks for a decision.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
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
      <AppShell>
        {loadError ? (
          <EmptyState
            icon="alert"
            title={i18n.error(loadError)}
            action={
              <ButtonLink to="/" icon="chevronLeft">
                {t("app.notFoundAction")}
              </ButtonLink>
            }
          />
        ) : (
          <p className="page-loading">{t("common.loading")}</p>
        )}
      </AppShell>
    );
  }

  const { history } = view;
  const mac = isMac();
  const undoLabel = history.undo ? t("header.undoAction", { action: i18n.action(history.undo) }) : t("header.undo");
  const redoLabel = history.redo ? t("header.redoAction", { action: i18n.action(history.redo) }) : t("header.redo");
  const undoHint = [mac ? t("header.undoKeysMac") : t("header.undoKeys"), history.undo?.kind === "clock_changed" ? t("header.clockUndoHint") : null]
    .filter(Boolean)
    .join("\n");
  const finishPending = view.warnings.some((warning) => warning.code === "FINISH_PENDING");
  const base = `/t/${encodeURIComponent(id)}`;

  return (
    <AppShell
      title={<PageTitle name={view.config.name} />}
      center={<ClockPod view={view} offsetMs={offsetMs} onStart={() => void run({ type: "start_clock" })} onPause={() => void run({ type: "pause_clock" })} />}
      actions={
        <>
          <span className="history-buttons">
            <IconButton icon="undo" label={undoLabel} hint={undoHint} onClick={() => void run({ type: "undo" })} disabled={!history.undo} />
            <IconButton
              icon="redo"
              label={redoLabel}
              hint={mac ? t("header.redoKeysMac") : t("header.redoKeys")}
              onClick={() => void run({ type: "redo" })}
              disabled={!history.redo}
            />
          </span>
          <StatusPill view={view} />
        </>
      }
      nav={<Tabs label={t("app.sections")} groups={TAB_GROUPS.map((group) => group.map((tab) => ({ to: `${base}/${tab}`, label: t(`tabs.${tab}`) })))} />}
    >
      {error && <ErrorBanner message={i18n.error(error, names)} onDismiss={() => setError(null)} />}
      {finishPending && (
        <Callout
          tone="warning"
          role="status"
          action={
            <Button variant="primary" size="sm" onClick={() => void run({ type: "close_registration" })}>
              {t("players.finishPending")}
            </Button>
          }
        >
          {i18n.warning({ code: "FINISH_PENDING" })}
        </Callout>
      )}
      <TournamentContext.Provider value={context}>
        <Outlet />
      </TournamentContext.Provider>
    </AppShell>
  );
}
