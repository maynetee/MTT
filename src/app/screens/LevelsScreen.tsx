import { useMemo, useState } from "react";
import type { EngineError } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { Callout } from "../components/Callout";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StructureEditor } from "../components/StructureEditor";
import { useToast } from "../components/Toast";
import { useTournament } from "../TournamentContext";
import { fromDraft, toDraft, type LevelDraft } from "../utils/structure";
import { errorRow, StructureActions } from "./SetupScreen";

export default function LevelsScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const { view, run } = useTournament();
  // The director's edits, null until the first one: until then the rows follow the tournament.
  // Derived during render, never copied in an effect: an effect runs after the render, and
  // could overwrite an edit made in between with the structure of an older render.
  const [draft, setDraft] = useState<LevelDraft[] | null>(null);
  const saved = useMemo(() => view.levels.map((row) => toDraft(row.level, row.index)), [view.levels]);
  const rows = draft ?? saved;
  const dirty = draft !== null;
  const [rejectedRow, setRejectedRow] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  const started = view.phase !== "setup";
  const currentIndex = started ? view.clock.levelIndex : null;
  const finished = view.phase === "finished";
  const structureWarnings = view.warnings.filter((warning) => warning.code === "ANTE_ABOVE_BIG_BLIND" || warning.code === "BLINDS_DECREASE");
  const invalidRows = new Set<number>(structureWarnings.map((warning) => ("params" in warning ? warning.params.index : -1)));
  if (rejectedRow !== null) invalidRows.add(rejectedRow);

  const edit = (next: LevelDraft[]) => setDraft(next);

  const save = async () => {
    setConfirming(false);
    const updated = await run({ type: "update_structure", levels: rows.map(fromDraft) }, (error: EngineError) => setRejectedRow(errorRow(error)));
    if (updated) {
      setDraft(null);
      setRejectedRow(null);
      toast.success(t("toast.structureSaved"));
    }
  };
  // During play the clock keeps running on the new structure: ask first.
  const requestSave = () => (view.phase === "running" ? setConfirming(true) : void save());

  const discard = () => {
    setDraft(null);
    setRejectedRow(null);
  };

  return (
    <>
      <Section
        title={t("levels.title")}
        description={started ? t("levels.pastLocked") : undefined}
        flush
        actions={
          !finished && (
            <Button icon="skipForward" onClick={() => void run({ type: "next_level" })} disabled={!started} title={t("levels.skipHint")}>
              {t("levels.skip")}
            </Button>
          )
        }
      >
        {structureWarnings.map((warning, index) => (
          <Callout key={index} tone="warning" role="status">
            {i18n.warning(warning)}
          </Callout>
        ))}
        <StructureEditor
          rows={rows}
          onChange={edit}
          lockedBefore={finished ? rows.length : (currentIndex ?? 0)}
          currentIndex={currentIndex}
          invalidRows={invalidRows}
        />
        {!finished && <StructureActions rows={rows} onChange={edit} />}
      </Section>
      {dirty && (
        <div className="action-bar">
          <span className="action-bar-note">{t("levels.unsaved")}</span>
          <Button variant="ghost" onClick={discard}>
            {t("levels.discard")}
          </Button>
          <Button variant="primary" icon="check" onClick={requestSave}>
            {t("levels.save")}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title={t("levels.confirmTitle")}
        message={t("levels.confirmMessage")}
        confirmLabel={t("levels.save")}
        onCancel={() => setConfirming(false)}
        onConfirm={save}
      />
    </>
  );
}
