import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toEngineError, type TournamentSummary } from "../../engine/types";
import { useI18n } from "../../i18n";
import { AppShell } from "../components/AppShell";
import { ConfirmBar, ErrorBanner } from "../components/ErrorBanner";
import { useEngine } from "../EngineContext";
import { useTournamentList } from "../hooks/useTournamentList";

/** Set once the previous version's tournament was imported, so the import is not offered again. */
const LEGACY_IMPORTED_KEY = "mtt:legacy-imported";

function legacyImported(): boolean {
  try {
    return window.localStorage.getItem(LEGACY_IMPORTED_KEY) !== null;
  } catch {
    return false;
  }
}

export default function TournamentListScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const engine = useEngine();
  const navigate = useNavigate();
  const { summaries, error, setError } = useTournamentList();
  const [confirming, setConfirming] = useState<TournamentSummary | null>(null);
  const [legacyAvailable, setLegacyAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    engine
      .legacyImportStatus()
      .then((status) => active && setLegacyAvailable(status.available))
      .catch(() => active && setLegacyAvailable(false));
    return () => {
      active = false;
    };
  }, [engine]);

  const handleDelete = async (summary: TournamentSummary) => {
    setConfirming(null);
    try {
      await engine.deleteTournament(summary.id);
    } catch (thrown) {
      setError(toEngineError(thrown));
    }
  };

  const handleImport = async () => {
    try {
      const id = await engine.importLegacy();
      try {
        window.localStorage.setItem(LEGACY_IMPORTED_KEY, id);
      } catch {
        // Only hides the offer; a non-empty list hides it too.
      }
      navigate(`/t/${encodeURIComponent(id)}`);
    } catch (thrown) {
      setError(toEngineError(thrown));
    }
  };

  return (
    <AppShell>
      <main className="page tournament-list">
        {error && <ErrorBanner message={i18n.error(error)} onDismiss={() => setError(null)} />}
        {confirming && (
          <ConfirmBar
            message={t("list.confirmDelete", { name: confirming.name })}
            confirmLabel={t("list.delete")}
            onCancel={() => setConfirming(null)}
            onConfirm={() => void handleDelete(confirming)}
          />
        )}
        <div className="card">
          <div className="card-header">
            <h2>{t("list.title")}</h2>
            <div className="button-row">
              {/* The host keeps reporting the old data after an import: offer it on a fresh install only. */}
              {legacyAvailable && summaries?.length === 0 && !legacyImported() && (
                <button className="btn" onClick={() => void handleImport()} title={t("list.importLegacyHint")}>
                  {t("list.importLegacy")}
                </button>
              )}
              <Link className="btn primary" to="/new">
                {t("list.create")}
              </Link>
            </div>
          </div>
          {summaries === null ? (
            <div className="muted">{t("common.loading")}</div>
          ) : summaries.length === 0 ? (
            <div className="muted">{t("list.empty")}</div>
          ) : (
            <div className="list">
              {summaries.map((summary) => (
                <div key={summary.id} className="list-row">
                  <div>
                    <div className="list-title">{summary.name}</div>
                    <div className="list-subtitle">
                      {[
                        t("list.players", { count: summary.players }),
                        summary.phase === "running" ? t("list.alive", { count: summary.alive }) : null,
                        t("list.updated", { time: i18n.dateTime(summary.updatedAtMs) })
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="button-row">
                    <span className="pill">{t(`phase.${summary.phase}`)}</span>
                    <Link className="btn" to={`/t/${encodeURIComponent(summary.id)}`} aria-label={`${t("list.open")} ${summary.name}`}>
                      {t("list.open")}
                    </Link>
                    <button className="btn" onClick={() => setConfirming(summary)} aria-label={`${t("list.delete")} ${summary.name}`}>
                      {t("list.delete")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
