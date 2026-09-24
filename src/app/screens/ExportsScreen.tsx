import { useState } from "react";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { Callout } from "../components/Callout";
import { Table } from "../components/Table";
import { useToast } from "../components/Toast";
import { useEngine } from "../EngineContext";
import { useTournament } from "../TournamentContext";
import { exportCSV, exportPDF, type RankingExport } from "../utils/exports";
import { formatPlace, rankingStatus } from "../utils/labels";

type Format = "CSV" | "PDF";

export default function ExportsScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const engine = useEngine();
  const toast = useToast();
  const { view } = useTournament();
  const [busy, setBusy] = useState<Format | null>(null);
  const finished = view.phase === "finished";
  const data: RankingExport = { tournamentName: view.config.name, finished, winner: view.winner, rows: view.ranking };
  const provisional = view.ranking.some((row) => row.provisional);

  const run = async (format: Format) => {
    setBusy(format);
    try {
      // Resolves to false when the director cancels the save dialog: nothing to say then.
      if (await (format === "CSV" ? exportCSV : exportPDF)(engine, data, i18n)) toast.success(t("toast.exported", { format }));
    } catch (error) {
      // An ExportError, whose message is already translated.
      toast.error(error instanceof Error ? error.message : t("exports.failed", { format, reason: String(error) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title={t("exports.title")}
      description={t("exports.hint")}
      flush
      actions={
        <>
          <Button icon="download" onClick={() => void run("PDF")} loading={busy === "PDF"}>
            {t("exports.pdf")}
          </Button>
          <Button variant="primary" icon="download" onClick={() => void run("CSV")} loading={busy === "CSV"}>
            {t("exports.csv")}
          </Button>
        </>
      }
    >
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
