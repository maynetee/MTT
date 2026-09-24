import { useEffect, useState } from "react";
import type { EngineError } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { Callout } from "../components/Callout";
import { StructureEditor } from "../components/StructureEditor";
import { useTournament } from "../TournamentContext";
import { fromDraft, toDraft, type LevelDraft } from "../utils/structure";
import { errorRow, StructureActions } from "./SetupScreen";

export default function LevelsScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const { view, run } = useTournament();
  const [rows, setRows] = useState<LevelDraft[]>(() => view.levels.map((row) => toDraft(row.level, row.index)));
  const [dirty, setDirty] = useState(false);
  const [rejectedRow, setRejectedRow] = useState<number | null>(null);

  // Follow the tournament's structure until the director starts editing.
  useEffect(() => {
    if (!dirty) setRows(view.levels.map((row) => toDraft(row.level, row.index)));
  }, [view.levels, dirty]);

  const started = view.phase !== "setup";
  const currentIndex = started ? view.clock.levelIndex : null;
  const finished = view.phase === "finished";
  const structureWarnings = view.warnings.filter((warning) => warning.code === "ANTE_ABOVE_BIG_BLIND" || warning.code === "BLINDS_DECREASE");
  const invalidRows = new Set<number>(structureWarnings.map((warning) => ("params" in warning ? warning.params.index : -1)));
  if (rejectedRow !== null) invalidRows.add(rejectedRow);

  const edit = (next: LevelDraft[]) => {
    setRows(next);
    setDirty(true);
  };

  const save = async () => {
    const saved = await run({ type: "update_structure", levels: rows.map(fromDraft) }, (error: EngineError) => setRejectedRow(errorRow(error)));
    if (saved) {
      setDirty(false);
      setRejectedRow(null);
    }
  };

  const discard = () => {
    setDirty(false);
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
          <Button variant="primary" icon="check" onClick={() => void save()}>
            {t("levels.save")}
          </Button>
        </div>
      )}
    </>
  );
}
