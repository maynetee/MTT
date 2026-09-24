import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toEngineError, type Config, type EngineError } from "../../engine/types";
import { useI18n } from "../../i18n";
import { AppShell, PageTitle } from "../components/AppShell";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { ConfigFields, LateRegFields, sanitizeConfig } from "../components/ConfigForm";
import { MoneyFields } from "../components/MoneyFields";
import { PurchaseFields } from "../components/PurchaseFields";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StructureEditor } from "../components/StructureEditor";
import { StructurePresets, StructurePreview } from "../components/StructurePresets";
import { useToast } from "../components/Toast";
import { useEngine } from "../EngineContext";
import { presetStructure, type PresetSpeed } from "../utils/presets";
import { defaultStructure, firstBreakAfter, fromDraft, newBreakDraft, newPlayDraft, toDraft, type LevelDraft } from "../utils/structure";

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
  const i18n = useI18n();
  const { t, error: describe } = i18n;
  const engine = useEngine();
  const toast = useToast();
  const navigate = useNavigate();
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [rows, setRows] = useState<LevelDraft[]>(() => defaultStructure().map((level) => toDraft(level)));
  // Levels edited by hand since the last preset: replacing them asks first.
  const [edited, setEdited] = useState(false);
  const [replacing, setReplacing] = useState<PresetSpeed | null>(null);
  const levels = rows.map(fromDraft);

  const editRows = (next: LevelDraft[]) => {
    setRows(next);
    setEdited(true);
  };
  const applyPreset = (speed: PresetSpeed) => {
    setRows(presetStructure(speed, config.startingStack).map((level) => toDraft(level)));
    setEdited(false);
    setReplacing(null);
    setError(null);
  };
  const pickPreset = (speed: PresetSpeed) => (edited ? setReplacing(speed) : applyPreset(speed));
  const [error, setError] = useState<EngineError | null>(null);
  const [creating, setCreating] = useState(false);
  const invalidRow = errorRow(error);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const id = await engine.createTournament({ config: sanitizeConfig(config), structure: levels });
      navigate(`/t/${encodeURIComponent(id)}/registration`);
    } catch (thrown) {
      const engineError = toEngineError(thrown);
      // The message as a toast; the structure row it points at stays highlighted.
      toast.error(describe(engineError));
      setError(engineError);
      setCreating(false);
    }
  };

  return (
    <AppShell title={<PageTitle name={t("setup.title")} />}>
      <div className="setup-grid">
        <div className="stack">
          <Section title={t("config.section")} description={t("config.sectionHint")}>
            <ConfigFields config={config} onChange={setConfig} />
          </Section>
          <Section title={t("money.section")} description={t("money.sectionHint")}>
            <MoneyFields config={config} onChange={setConfig} />
          </Section>
        </div>
        <div className="stack">
          <Section title={t("config.lateReg.title")} description={t("config.lateReg.hint")}>
            <LateRegFields config={config} onChange={setConfig} />
          </Section>
        </div>
      </div>

      <Section title={t("purchases.section")} description={t("purchases.sectionHint")}>
        <PurchaseFields config={config} onChange={setConfig} firstBreakAfter={firstBreakAfter(rows)} />
      </Section>

      <Section title={t("structure.title")} flush actions={<StructurePresets startingStack={config.startingStack} onPick={pickPreset} />}>
        <StructurePreview levels={levels} startingStack={config.startingStack} />
        <StructureEditor rows={rows} onChange={editRows} invalidRows={invalidRow === null ? undefined : new Set([invalidRow])} />
        <StructureActions rows={rows} onChange={editRows} />
      </Section>
      <ConfirmDialog
        open={replacing !== null}
        title={t("presets.replaceTitle")}
        message={replacing && t("presets.replaceMessage", { preset: t(`presets.${replacing}`), stack: i18n.number(config.startingStack) })}
        confirmLabel={t("presets.replace")}
        onCancel={() => setReplacing(null)}
        onConfirm={() => {
          if (replacing) applyPreset(replacing);
        }}
      />

      <div className="action-bar">
        <Button variant="primary" size="lg" icon="check" onClick={() => void handleCreate()} loading={creating}>
          {t("setup.create")}
        </Button>
      </div>
    </AppShell>
  );
}
