import { useEffect, useState } from "react";
import type { Config } from "../../engine/types";
import { useI18n } from "../../i18n";
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
    <div className="settings">
      <div className="card">
        <div className="card-header">
          <h2>{t("settings.title")}</h2>
          {!finished && (
            <div className="button-row">
              {dirty && (
                <button className="btn" onClick={() => setDirty(false)}>
                  {t("levels.discard")}
                </button>
              )}
              <button className="btn primary" onClick={() => void save()} disabled={!dirty}>
                {t("settings.save")}
              </button>
            </div>
          )}
        </div>
        <ConfigFields config={config} onChange={edit} started={started} />
        {started && <div className="muted">{t("config.lockedHint")}</div>}
      </div>
      <div className="card">
        <h3>{t("config.lateReg.title")}</h3>
        <LateRegFields config={config} onChange={edit} />
      </div>
    </div>
  );
}
