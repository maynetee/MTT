import { useEffect, useState } from "react";
import type { Config } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { ConfigFields, LateRegFields, sanitizeConfig } from "../components/ConfigForm";
import { useTournament } from "../TournamentContext";

/** Tournament settings (UpdateConfig): places paid, tables, late registration... */
export default function SettingsScreen() {
  const { t } = useI18n();
  const { view, run } = useTournament();
  const [config, setConfig] = useState<Config>(view.config);
  const [dirty, setDirty] = useState(false);
  const started = view.phase !== "setup";
  const finished = view.phase === "finished";

  // Follow the saved settings until the director starts editing.
  useEffect(() => {
    if (!dirty) setConfig(view.config);
  }, [view.config, dirty]);

  const edit = (next: Config) => {
    setConfig(next);
    setDirty(true);
  };

  const save = async () => {
    if (await run({ type: "update_config", config: sanitizeConfig(config) })) setDirty(false);
  };

  return (
    <>
      <div className="setup-grid">
        <Section title={t("settings.title")} description={started ? t("config.lockedHint") : t("settings.hint")}>
          <ConfigFields config={config} onChange={edit} started={started} />
        </Section>
        <Section title={t("config.lateReg.title")} description={t("config.lateReg.hint")}>
          <LateRegFields config={config} onChange={edit} />
        </Section>
      </div>
      {dirty && !finished && (
        <div className="action-bar">
          <span className="action-bar-note">{t("settings.unsaved")}</span>
          <Button variant="ghost" onClick={() => setDirty(false)}>
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
