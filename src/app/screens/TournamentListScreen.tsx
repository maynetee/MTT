import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toEngineError, type PhaseName, type TournamentSummary } from "../../engine/types";
import { useI18n } from "../../i18n";
import { AppShell } from "../components/AppShell";
import { BrandMark } from "../components/BrandMark";
import { Button, ButtonLink, IconButton } from "../components/Button";
import { Section } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { TextInput } from "../components/Field";
import { Icon } from "../components/Icon";
import { Pill, type PillTone } from "../components/Pill";
import { SegmentedControl } from "../components/SegmentedControl";
import { Table } from "../components/Table";
import { useToast } from "../components/Toast";
import { useEngine } from "../EngineContext";
import { useTournamentList } from "../hooks/useTournamentList";
import { createSampleTournament } from "../sample/sampleTournament";
import { relativeTime } from "../utils/relativeTime";
import { byLastChange, copyName, duplicateTournament, filterTournaments, type PhaseFilter } from "../utils/tournamentList";

/** Set once the previous version's tournament was imported, so the import is not offered again. */
const LEGACY_IMPORTED_KEY = "mtt:legacy-imported";

const PHASE_TONES: Record<PhaseName, PillTone> = { setup: "neutral", running: "success", finished: "muted" };
const PHASES: readonly PhaseName[] = ["setup", "running", "finished"];

/** Above this many tournaments, the list gets a search field and a phase filter. */
export const FILTER_THRESHOLD = 8;
/** How often "5 minutes ago" is brought up to date. */
const RELATIVE_TIME_REFRESH_MS = 30_000;

/** The current time, updated every `intervalMs`. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

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
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [creatingSample, setCreatingSample] = useState(false);
  const [search, setSearch] = useState("");
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const now = useNow(RELATIVE_TIME_REFRESH_MS);
  const sorted = useMemo(() => (summaries ? byLastChange(summaries) : null), [summaries]);
  // Filters only apply while they are shown.
  const filtering = (sorted?.length ?? 0) > FILTER_THRESHOLD;
  const visible = sorted && filtering ? filterTournaments(sorted, search, phase) : sorted;

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

  const handleDuplicate = async (summary: TournamentSummary) => {
    setDuplicating(summary.id);
    try {
      const templates = { first: t("list.copyName", { name: "{name}" }), nth: t("list.copyNameN", { name: "{name}", n: "{n}" }) };
      const name = copyName(summary.name, sorted?.map((entry) => entry.name) ?? [], templates);
      const id = await duplicateTournament(engine, summary.id, name);
      toast.success(t("list.duplicated", { name }), {
        action: { label: t("list.open"), onAction: () => navigate(`/t/${encodeURIComponent(id)}`) }
      });
    } catch (thrown) {
      setError(toEngineError(thrown));
    } finally {
      setDuplicating(null);
    }
  };

  const handleSample = async () => {
    setCreatingSample(true);
    try {
      const id = await createSampleTournament(engine, t("sample.name"));
      navigate(`/t/${encodeURIComponent(id)}`);
    } catch (thrown) {
      setError(toEngineError(thrown));
      setCreatingSample(false);
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
  const offerImport = legacyAvailable && sorted?.length === 0 && !legacyImported();
  const create = (
    <ButtonLink variant="primary" icon="plus" to="/new">
      {t("list.create")}
    </ButtonLink>
  );
  const sample = (
    <Button icon="sparkles" onClick={() => void handleSample()} loading={creatingSample} title={t("sample.hint")}>
      {t("sample.try")}
    </Button>
  );

  return (
    <AppShell>
      <Section
        level={1}
        title={t("list.title")}
        flush={Boolean(sorted?.length)}
        actions={
          sorted?.length ? (
            <>
              {sample}
              {create}
            </>
          ) : offerImport ? (
            <Button onClick={() => void handleImport()} title={t("list.importLegacyHint")}>
              {t("list.importLegacy")}
            </Button>
          ) : undefined
        }
      >
        {sorted === null || visible === null ? (
          <p className="page-loading">{t("common.loading")}</p>
        ) : sorted.length === 0 ? (
          <EmptyState
            art={<BrandMark size={56} />}
            title={t("list.emptyTitle")}
            description={t("list.emptyDescription")}
            action={
              <span className="empty-state-buttons">
                {create}
                {sample}
              </span>
            }
          />
        ) : (
          <>
            {filtering && (
              <div className="list-toolbar">
                <span className="search-field">
                  <Icon name="search" size={16} className="search-field-icon" />
                  <TextInput
                    type="search"
                    placeholder={t("list.search")}
                    aria-label={t("list.search")}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </span>
                <SegmentedControl<PhaseFilter>
                  label={t("list.filter")}
                  value={phase}
                  onChange={setPhase}
                  segments={[
                    { value: "all", label: t("list.filterAll"), count: sorted.length },
                    ...PHASES.map((value) => ({
                      value,
                      label: t(`phase.${value}`),
                      count: sorted.filter((summary) => summary.phase === value).length
                    }))
                  ]}
                />
              </div>
            )}
            {visible.length === 0 ? (
              <p className="muted list-empty">{search.trim() ? t("list.noMatch", { search: search.trim() }) : t("list.noneInFilter")}</p>
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
                  {visible.map((summary) => (
                    <tr key={summary.id}>
                      <th scope="row" className="strong tournament-name">
                        {summary.name}
                      </th>
                      <td>
                        <Pill tone={PHASE_TONES[summary.phase]} dot={summary.phase === "running"}>
                          {t(`phase.${summary.phase}`)}
                        </Pill>
                      </td>
                      <td className="num">{i18n.number(summary.players)}</td>
                      <td className="num">{summary.phase === "running" ? i18n.number(summary.alive) : t("common.none")}</td>
                      <td className="muted">
                        <time dateTime={new Date(summary.updatedAtMs).toISOString()} title={i18n.dateTime(summary.updatedAtMs)}>
                          {relativeTime(summary.updatedAtMs, now, i18n.locale)}
                        </time>
                      </td>
                      <td className="actions">
                        <span className="row-actions">
                          <ButtonLink size="sm" to={`/t/${encodeURIComponent(summary.id)}`} aria-label={t("list.openNamed", { name: summary.name })}>
                            {t("list.open")}
                          </ButtonLink>
                          <IconButton
                            icon="copy"
                            size="sm"
                            label={t("list.duplicateNamed", { name: summary.name })}
                            hint={t("list.duplicateHint")}
                            tooltipAlign="end"
                            disabled={duplicating !== null}
                            onClick={() => void handleDuplicate(summary)}
                          />
                          <IconButton
                            icon="trash"
                            size="sm"
                            label={t("list.deleteNamed", { name: summary.name })}
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
          </>
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
