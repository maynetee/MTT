import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toEngineError, type PhaseName, type TournamentSummary } from "../../engine/types";
import { useI18n } from "../../i18n";
import { AppShell } from "../components/AppShell";
import { BrandMark } from "../components/BrandMark";
import { Button, ButtonLink, IconButton } from "../components/Button";
import { Section } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Pill, type PillTone } from "../components/Pill";
import { Table } from "../components/Table";
import { useToast } from "../components/Toast";
import { useEngine } from "../EngineContext";
import { useTournamentList } from "../hooks/useTournamentList";

/** Set once the previous version's tournament was imported, so the import is not offered again. */
const LEGACY_IMPORTED_KEY = "mtt:legacy-imported";

const PHASE_TONES: Record<PhaseName, PillTone> = { setup: "neutral", running: "success", finished: "muted" };

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
  const toast = useToast();
  const { summaries, error, setError } = useTournamentList();
  const [confirming, setConfirming] = useState<TournamentSummary | null>(null);
  const [legacyAvailable, setLegacyAvailable] = useState(false);

  // Engine errors are shown as toasts, translated.
  useEffect(() => {
    if (!error) return;
    toast.error(i18n.error(error));
    setError(null);
  }, [error, setError, toast, i18n]);

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
      toast.success(t("toast.deleted", { name: summary.name }));
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

  // The host keeps reporting the old data after an import: offer it on a fresh install only.
  const offerImport = legacyAvailable && summaries?.length === 0 && !legacyImported();
  const create = (
    <ButtonLink variant="primary" icon="plus" to="/new">
      {t("list.create")}
    </ButtonLink>
  );

  return (
    <AppShell>
      <Section
        level={1}
        title={t("list.title")}
        flush={Boolean(summaries?.length)}
        actions={
          summaries?.length ? (
            create
          ) : offerImport ? (
            <Button onClick={() => void handleImport()} title={t("list.importLegacyHint")}>
              {t("list.importLegacy")}
            </Button>
          ) : undefined
        }
      >
        {summaries === null ? (
          <p className="page-loading">{t("common.loading")}</p>
        ) : summaries.length === 0 ? (
          <EmptyState art={<BrandMark size={56} />} title={t("list.emptyTitle")} description={t("list.emptyDescription")} action={create} />
        ) : (
          <Table caption={t("list.title")}>
            <thead>
              <tr>
                <th scope="col">{t("list.name")}</th>
                <th scope="col">{t("list.status")}</th>
                <th scope="col" className="num">
                  {t("list.playersColumn")}
                </th>
                <th scope="col" className="num">
                  {t("list.aliveColumn")}
                </th>
                <th scope="col">{t("list.updatedColumn")}</th>
                <th scope="col" className="actions">
                  <span className="visually-hidden">{t("list.open")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((summary) => (
                <tr key={summary.id}>
                  <th scope="row" className="strong tournament-name">
                    {summary.name}
                  </th>
                  <td>
                    <Pill tone={PHASE_TONES[summary.phase]} dot={summary.phase === "running"}>
                      {t(`phase.${summary.phase}`)}
                    </Pill>
                  </td>
                  <td className="num">{summary.players}</td>
                  <td className="num">{summary.phase === "running" ? summary.alive : t("common.none")}</td>
                  <td className="muted">{i18n.dateTime(summary.updatedAtMs)}</td>
                  <td className="actions">
                    <span className="row-actions">
                      <ButtonLink size="sm" to={`/t/${encodeURIComponent(summary.id)}`} aria-label={`${t("list.open")} ${summary.name}`}>
                        {t("list.open")}
                      </ButtonLink>
                      <IconButton
                        icon="trash"
                        size="sm"
                        label={`${t("list.delete")} ${summary.name}`}
                        tooltipAlign="end"
                        onClick={() => setConfirming(summary)}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      <ConfirmDialog
        open={confirming !== null}
        tone="danger"
        title={t("list.deleteTitle", { name: confirming?.name ?? "" })}
        message={t("list.deleteMessage")}
        confirmLabel={t("list.deleteConfirm")}
        // A tournament that has started has results worth a second look: type its name.
        confirmText={confirming && confirming.phase !== "setup" ? confirming.name : undefined}
        onCancel={() => setConfirming(null)}
        onConfirm={() => (confirming ? handleDelete(confirming) : undefined)}
      />
    </AppShell>
  );
}
