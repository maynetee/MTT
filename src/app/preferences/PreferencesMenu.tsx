import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { LANGUAGE_NAMES, LANGUAGE_PREFERENCES, setLanguagePreference, useI18n, useLanguage, type LanguagePreference } from "../../i18n";
import { Button, IconButton } from "../components/Button";
import { Checkbox, RadioGroup } from "../components/Field";
import { previewCue } from "../sound/audio";
import { SOUND_OUTPUTS, setPreferences, usePreferences } from "./preferences";

/**
 * Header control for this device's preferences (level sounds and language): a button that
 * opens a small non-modal panel. Esc, a click outside or tabbing away closes it.
 */
export function PreferencesMenu() {
  const i18n = useI18n();
  const { t } = i18n;
  const preferences = usePreferences();
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const volumeId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onBlur = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && !panelRef.current?.contains(next) && !buttonRef.current?.contains(next)) setOpen(false);
  };

  const percent = Math.round(preferences.volume * 100);
  const volume = i18n.percent(percent / 100);
  return (
    <span className="menu-anchor">
      <IconButton
        ref={buttonRef}
        icon={preferences.sound ? "volume" : "volumeOff"}
        label={t("preferences.label")}
        hint={preferences.sound ? t("preferences.soundOn") : t("preferences.soundOff")}
        tooltipAlign="end"
        tooltipSuppressed={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-labelledby={titleId} className="menu preferences" onKeyDown={onKeyDown} onBlur={onBlur}>
          <div className="preferences-head">
            <h2 id={titleId} className="preferences-title">
              {t("preferences.title")}
            </h2>
            <p className="preferences-hint">{t("preferences.hint")}</p>
          </div>
          <Checkbox
            label={t("preferences.sound")}
            description={t("preferences.soundDescription")}
            checked={preferences.sound}
            onChange={(event) => setPreferences({ sound: event.target.checked })}
          />
          <div className="preferences-volume">
            <label htmlFor={volumeId} className="preferences-label">
              {t("preferences.volume")}
            </label>
            <input
              id={volumeId}
              type="range"
              className="preferences-range"
              min={0}
              max={100}
              step={5}
              value={percent}
              disabled={!preferences.sound}
              aria-valuetext={volume}
              onChange={(event) => setPreferences({ volume: Number(event.target.value) / 100 })}
            />
            <span className="preferences-percent" aria-hidden="true">
              {volume}
            </span>
            <Button size="sm" icon="play" disabled={!preferences.sound} onClick={() => previewCue("levelChange", preferences.volume)}>
              {t("preferences.test")}
            </Button>
          </div>
          <RadioGroup
            legend={t("preferences.output")}
            name={`${panelId}-output`}
            value={preferences.soundOutput}
            onChange={(soundOutput) => setPreferences({ soundOutput })}
            options={SOUND_OUTPUTS.map((output) => ({
              value: output,
              label: t(`preferences.output_${output}`),
              disabled: !preferences.sound,
              nested: output === "auto" ? <span className="preferences-hint">{t("preferences.output_autoHint")}</span> : undefined
            }))}
          />
          <RadioGroup<LanguagePreference>
            legend={t("preferences.language")}
            name={`${panelId}-language`}
            value={language.preference}
            onChange={setLanguagePreference}
            options={LANGUAGE_PREFERENCES.map((preference) => ({
              value: preference,
              // Each language in its own name, so a director who cannot read this one finds theirs.
              label:
                preference === "system" ? (
                  t("preferences.languageSystem", { language: LANGUAGE_NAMES[language.system] })
                ) : (
                  <span lang={preference}>{LANGUAGE_NAMES[preference]}</span>
                )
            }))}
          />
        </div>
      )}
    </span>
  );
}
