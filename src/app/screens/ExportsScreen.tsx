import { useState } from "react";
import { useI18n } from "../../i18n";
import { ErrorBanner } from "../components/ErrorBanner";
import { useEngine } from "../EngineContext";
import { useTournament } from "../TournamentContext";
import { exportCSV, exportPDF, type RankingExport } from "../utils/exports";
import { formatPlace, rankingStatus } from "../utils/labels";

export default function ExportsScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const engine = useEngine();
  const { view } = useTournament();
  const [failure, setFailure] = useState<string | null>(null);
  const finished = view.phase === "finished";
  const data: RankingExport = { tournamentName: view.config.name, finished, winner: view.winner, rows: view.ranking };
  const provisional = view.ranking.some((row) => row.provisional);

  const run = (exporter: typeof exportCSV) => {
    setFailure(null);
    exporter(engine, data, i18n).catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)));
  };

  return (
    <div className="card">
      {failure && <ErrorBanner message={failure} onDismiss={() => setFailure(null)} />}
      <div className="card-header">
        <h2>{t("exports.title")}</h2>
        <div className="button-row">
          <button className="btn primary" onClick={() => run(exportCSV)}>
            {t("exports.csv")}
          </button>
          <button className="btn" onClick={() => run(exportPDF)}>
            {t("exports.pdf")}
          </button>
        </div>
      </div>
      {finished && <div className="muted">{t("exports.finalRanking")}</div>}
      {provisional && <div className="muted">{t("exports.provisionalHint")}</div>}

      <div className="list">
        {view.ranking.map((row) => (
          <div key={row.player} className="list-row">
            <span className="pill">{formatPlace(row)}</span>
            <span>{row.name}</span>
            <span className="muted">{rankingStatus(i18n, row, view.winner)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
