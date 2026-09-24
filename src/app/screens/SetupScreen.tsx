import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toEngineError, type Config, type EngineError } from "../../engine/types";
import { useI18n } from "../../i18n";
import { AppShell, PageTitle } from "../components/AppShell";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
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

/** Add level / Add break, under the structure where the new row appears. */
export function StructureActions({ rows, onChange }: { rows: LevelDraft[]; onChange(rows: LevelDraft[]): void }) {
  const { t } = useI18n();
  return (
    <div className="structure-actions">
      <Button icon="plus" onClick={() => onChange([...rows, newPlayDraft(rows)])}>
        {t("structure.addLevel")}
      </Button>
      <Button icon="coffee" onClick={() => onChange([...rows, newBreakDraft()])}>
        {t("structure.addBreak")}
      </Button>
    </div>
  );
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
    <AppShell title={<PageTitle name={t("setup.title")} />}>
      {error && <ErrorBanner message={describe(error)} onDismiss={() => setError(null)} />}
      <div className="setup-grid">
        <Section title={t("config.section")} description={t("config.sectionHint")}>
          <ConfigFields config={config} onChange={setConfig} />
        </Section>
        <Section title={t("config.lateReg.title")} description={t("config.lateReg.hint")}>
          <LateRegFields config={config} onChange={setConfig} />
        </Section>
      </div>

      <Section title={t("structure.title")} flush>
        <StructureEditor rows={rows} onChange={setRows} invalidRows={invalidRow === null ? undefined : new Set([invalidRow])} />
        <StructureActions rows={rows} onChange={setRows} />
      </Section>

      <div className="action-bar">
        <Button variant="primary" size="lg" icon="check" onClick={() => void handleCreate()} loading={creating}>
          {t("setup.create")}
        </Button>
      </div>
    </AppShell>
  );
}
