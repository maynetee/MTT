import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toEngineError, type Config, type EngineError } from "../../engine/types";
import { useI18n } from "../../i18n";
import { AppShell } from "../components/AppShell";
import { ConfigFields, LateRegFields, sanitizeConfig } from "../components/ConfigForm";
import { ErrorBanner } from "../components/ErrorBanner";
import { StructureEditor } from "../components/StructureEditor";
import { useEngine } from "../EngineContext";
import { defaultStructure, fromDraft, newBreakDraft, newPlayDraft, toDraft, type LevelDraft } from "../utils/structure";

export function defaultConfig(): Config {
  return {
    name: "MTT",
    seatsPerTable: 9,
    maxTables: 8,
    finalTableSize: null,
    balanceTrigger: 2,
    breakOrder: [],
    startingStack: 20_000,
    placesPaid: 9,
    lateReg: { type: "end_of_play_level", n: 8, throughBreak: true },
    payout: {}
  };
}

/** Row a structure error points at, to highlight it. */
export function errorRow(error: EngineError | null): number | null {
  if (!error || !("params" in error)) return null;
  const params = error.params as Record<string, unknown>;
  return typeof params.index === "number" ? params.index : null;
}

export default function SetupScreen() {
  const { t, error: describe } = useI18n();
  const engine = useEngine();
  const navigate = useNavigate();
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [rows, setRows] = useState<LevelDraft[]>(() => defaultStructure().map((level) => toDraft(level)));
  const [error, setError] = useState<EngineError | null>(null);
  const [creating, setCreating] = useState(false);
  const invalidRow = errorRow(error);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const id = await engine.createTournament({ config: sanitizeConfig(config), structure: rows.map(fromDraft) });
      navigate(`/t/${encodeURIComponent(id)}/registration`);
    } catch (thrown) {
      setError(toEngineError(thrown));
      setCreating(false);
    }
  };

  return (
    <AppShell title={<Link to="/">{t("app.allTournaments")}</Link>}>
      <main className="page setup">
        {error && <ErrorBanner message={describe(error)} onDismiss={() => setError(null)} />}
        <div className="card">
          <h2>{t("setup.title")}</h2>
          <ConfigFields config={config} onChange={setConfig} />
        </div>

        <div className="card">
          <h3>{t("config.lateReg.title")}</h3>
          <LateRegFields config={config} onChange={setConfig} />
        </div>

        <div className="card">
          <div className="card-header">
            <h3>{t("structure.title")}</h3>
            <div className="button-row">
              <button className="btn" onClick={() => setRows([...rows, newPlayDraft(rows)])}>
                {t("structure.addLevel")}
              </button>
              <button className="btn" onClick={() => setRows([...rows, newBreakDraft()])}>
                {t("structure.addBreak")}
              </button>
            </div>
          </div>
          <StructureEditor rows={rows} onChange={setRows} invalidRows={invalidRow === null ? undefined : new Set([invalidRow])} />
        </div>

        <div className="actions">
          <button className="btn primary" onClick={handleCreate} disabled={creating}>
            {t("setup.create")}
          </button>
        </div>
      </main>
    </AppShell>
  );
}
