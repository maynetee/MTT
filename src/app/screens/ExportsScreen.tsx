import { useState } from "react";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { Callout } from "../components/Callout";
import { ErrorBanner } from "../components/ErrorBanner";
import { Table } from "../components/Table";
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
    <Section
      title={t("exports.title")}
      description={t("exports.hint")}
      flush
      actions={
        <>
          <Button icon="download" onClick={() => run(exportPDF)}>
            {t("exports.pdf")}
          </Button>
          <Button variant="primary" icon="download" onClick={() => run(exportCSV)}>
            {t("exports.csv")}
          </Button>
        </>
      }
    >
      {failure && <ErrorBanner message={failure} onDismiss={() => setFailure(null)} />}
      {finished ? <Callout tone="success">{t("exports.finalRanking")}</Callout> : provisional && <Callout>{t("exports.provisionalHint")}</Callout>}
      <Table caption={t("exports.title")} density="compact">
        <thead>
          <tr>
            <th scope="col" className="num place-col">
              {t("exports.place")}
            </th>
            <th scope="col">{t("exports.player")}</th>
            <th scope="col">{t("exports.status")}</th>
          </tr>
        </thead>
        <tbody>
          {view.ranking.map((row) => (
            <tr key={row.player}>
              <td className="num place">{formatPlace(row)}</td>
              <th scope="row" className="strong">
                {row.name}
              </th>
              <td>{rankingStatus(i18n, row, view.winner)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}
