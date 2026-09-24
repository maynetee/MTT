import { useCallback, useEffect, useMemo, useRef } from "react";
import { Outlet, useParams } from "react-router-dom";
import { toEngineError, type EngineError, type View } from "../../engine/types";
import { useI18n } from "../../i18n";
import { AppShell, PageTitle } from "../components/AppShell";
import { ButtonLink, Button, IconButton } from "../components/Button";
import { Callout } from "../components/Callout";
import { ClockPod } from "../components/ClockPod";
import { EmptyState } from "../components/EmptyState";
import { Pill } from "../components/Pill";
import { Tabs } from "../components/Tabs";
import { useToast } from "../components/Toast";
import { useTournamentView } from "../hooks/useTournamentView";
import { TAB_KEYS, useDirectorShortcuts, useShortcutText } from "../keyboard";
import { LevelSounds } from "../sound/LevelSounds";
import { dealAvailable, paysPrizes } from "../utils/payouts";
import { TournamentContext, type TournamentContextValue } from "../TournamentContext";
import { playerNames } from "../utils/view";

/** Live work first, then the setup and output screens. */
const TAB_GROUPS = [
  ["registration", "seating", "players", "moves", "clock", "payouts"],
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
  const toast = useToast();
  const names = useMemo(() => (view ? playerNames(view) : () => undefined), [view]);
  // The latest view, for actions that outlive the render that created them (a toast's Undo).
  const viewRef = useRef(view);
  viewRef.current = view;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Every rejected command is shown, translated, with player names.
  const report = useCallback((error: EngineError) => toast.error(i18n.error(error, names)), [toast, i18n, names]);

  const run = useCallback<TournamentContextValue["run"]>(
    async (command, onError) => {
      try {
        return await dispatch(command);
      } catch (thrown) {
        const engineError = toEngineError(thrown);
        report(engineError);
        onError?.(engineError);
        return null;
      }
    },
    [dispatch, report]
  );

  const undoIfLast = useCallback<TournamentContextValue["undoIfLast"]>(
    async (seq) => {
      if (!mounted.current || viewRef.current?.history.undo?.seq !== seq) {
        toast.show({ message: t("toast.undoStale") });
        return null;
      }
      return run({ type: "undo" });
    },
    [run, toast, t]
  );

  const base = `/t/${encodeURIComponent(id)}`;
  const tabGroups = TAB_GROUPS.map((group, index) =>
    // The deal calculator joins the live tabs once a deal is possible; a tournament without
    // prizes has no Payouts tab.
    (index === 0 && view && dealAvailable(view) ? [...group, "deal" as const] : group)
      .filter((tab) => tab !== "payouts" || !view || paysPrizes(view.config))
      .map((tab) => ({
        to: `${base}/${tab}`,
        label: t(`tabs.${tab}`)
      }))
  );
  // 1 to 9 open the tabs in the order they are shown.
  const tabs = tabGroups.flat();
  const shortcuts = useDirectorShortcuts({ id, view, run, report, tabs });
  const keys = useShortcutText();

  const context = useMemo<TournamentContextValue | null>(
    () => (view ? { id, view, offsetMs, run, undoIfLast, report, playerName: names } : null),
    [id, view, offsetMs, run, undoIfLast, report, names]
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
  const undoLabel = history.undo ? t("header.undoAction", { action: i18n.action(history.undo) }) : t("header.undo");
  const redoLabel = history.redo ? t("header.redoAction", { action: i18n.action(history.redo) }) : t("header.redo");
  const undoHint = [keys.text("undo"), history.undo?.kind === "clock_changed" ? t("header.clockUndoHint") : null]
    .filter(Boolean)
    .join("\n");
  const finishPending = view.warnings.some((warning) => warning.code === "FINISH_PENDING");

  return (
    <AppShell
      title={<PageTitle name={view.config.name} />}
      center={<ClockPod view={view} offsetMs={offsetMs} onStart={() => void run({ type: "start_clock" })} onPause={() => void run({ type: "pause_clock" })} />}
      actions={
        <>
          <span className="history-buttons">
            <IconButton
              icon="undo"
              label={undoLabel}
              hint={undoHint}
              aria-keyshortcuts={keys.aria("undo")}
              onClick={() => void run({ type: "undo" })}
              disabled={!history.undo}
            />
            <IconButton
              icon="redo"
              label={redoLabel}
              hint={keys.text("redo")}
              aria-keyshortcuts={keys.aria("redo")}
              onClick={() => void run({ type: "redo" })}
              disabled={!history.redo}
            />
          </span>
          <StatusPill view={view} />
          <IconButton
            icon="keyboard"
            label={t("shortcuts.title")}
            hint={keys.text("showShortcuts")}
            aria-keyshortcuts={keys.aria("showShortcuts")}
            tooltipAlign="end"
            onClick={shortcuts.openOverlay}
          />
        </>
      }
      nav={
        <Tabs
          label={t("app.sections")}
          groups={tabGroups.map((group) =>
            group.map((tab) => {
              const key = TAB_KEYS[tabs.indexOf(tab)];
              return key ? { ...tab, title: t("shortcuts.tabHint", { key }), keyShortcuts: key } : tab;
            })
          )}
        />
      }
    >
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
      <LevelSounds view={view} offsetMs={offsetMs} />
      <TournamentContext.Provider value={context}>
        <Outlet />
      </TournamentContext.Provider>
      {shortcuts.overlay}
    </AppShell>
  );
}
