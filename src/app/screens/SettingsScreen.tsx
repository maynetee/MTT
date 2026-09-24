import { useState } from "react";
import type { Config } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { ConfigFields, LateRegFields, sanitizeConfig } from "../components/ConfigForm";
import { MoneyFields, type ConfigLocks } from "../components/MoneyFields";
import { PurchaseFields } from "../components/PurchaseFields";
import { useToast } from "../components/Toast";
import { useTournament } from "../TournamentContext";
import { firstBreakAfter } from "../utils/structure";

/** Tournament settings (UpdateConfig): places paid, tables, late registration... */
export default function SettingsScreen() {
  const { t } = useI18n();
  const { view, run } = useTournament();
  // The director's edits, null until the first one: until then the form follows the saved
  // settings. Derived during render, never copied in an effect, which runs after the render
  // and could overwrite an edit made in between with the settings of an older render.
  const [draft, setDraft] = useState<Config | null>(null);
  const config = draft ?? view.config;
  const dirty = draft !== null;
  const toast = useToast();
  const started = view.phase !== "setup";
  const finished = view.phase === "finished";
  const locks: ConfigLocks = { started, registered: view.counts.unique > 0, payoutsLocked: view.money?.locked ?? false };

  const edit = (next: Config) => {
    setDraft(next);
  };

  const save = async () => {
    if (await run({ type: "update_config", config: sanitizeConfig(config) })) {
      setDraft(null);
      toast.success(t("toast.settingsSaved"));
    }
  };

  return (
    <>
      <div className="setup-grid">
        <div className="stack">
          <Section title={t("settings.title")} description={started ? t("config.lockedHint") : t("settings.hint")}>
            <ConfigFields config={config} onChange={edit} locks={locks} />
          </Section>
          <Section title={t("money.section")} description={t("money.sectionHint")}>
            <MoneyFields config={config} onChange={edit} locks={locks} />
          </Section>
        </div>
        <div className="stack">
          <Section title={t("config.lateReg.title")} description={t("config.lateReg.hint")}>
            <LateRegFields config={config} onChange={edit} />
          </Section>
        </div>
      </div>
      <Section title={t("purchases.section")} description={t("purchases.sectionHint")}>
        <PurchaseFields
          config={config}
          onChange={edit}
          firstBreakAfter={firstBreakAfter(view.levels.map((row) => ({ isBreak: row.level.type === "break" })))}
        />
      </Section>
      {dirty && !finished && (
        <div className="action-bar">
          <span className="action-bar-note">{t("settings.unsaved")}</span>
          <Button variant="ghost" onClick={() => setDraft(null)}>
            {t("levels.discard")}
          </Button>
          <Button variant="primary" icon="check" onClick={() => void save()}>
            {t("settings.save")}
          </Button>
        </div>
      )}
    </>
  );
}
