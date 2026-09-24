import { useEffect, useState } from "react";
import type { EngineError } from "../../engine/types";
import { useI18n } from "../../i18n";
import { StructureEditor } from "../components/StructureEditor";
import { useTournament } from "../TournamentContext";
import { fromDraft, newBreakDraft, newPlayDraft, toDraft, type LevelDraft } from "../utils/structure";
import { errorRow } from "./SetupScreen";

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
    <div className="card">
      <div className="card-header">
        <h3>{t("levels.title")}</h3>
        {!finished && (
          <div className="button-row">
            <button className="btn" onClick={() => void run({ type: "next_level" })} disabled={!started} title={t("levels.skipHint")}>
              {t("levels.skip")}
            </button>
            <button className="btn" onClick={() => edit([...rows, newPlayDraft(rows)])}>
              {t("structure.addLevel")}
            </button>
            <button className="btn" onClick={() => edit([...rows, newBreakDraft()])}>
              {t("structure.addBreak")}
            </button>
            {dirty && (
              <>
                <button className="btn" onClick={discard}>
                  {t("levels.discard")}
                </button>
                <button className="btn primary" onClick={() => void save()}>
                  {t("levels.save")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {started && <div className="muted">{t("levels.pastLocked")}</div>}
      {structureWarnings.map((warning, index) => (
        <div key={index} className="warning-banner" role="status">
          {i18n.warning(warning)}
        </div>
      ))}
      <div className="levels-scroll">
        <StructureEditor
          rows={rows}
          onChange={edit}
          lockedBefore={finished ? rows.length : (currentIndex ?? 0)}
          currentIndex={currentIndex}
          invalidRows={invalidRows}
        />
      </div>
    </div>
  );
}
