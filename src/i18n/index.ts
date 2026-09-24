export { createI18n, formatDuration, getI18n, i18n, t, type I18n, type Locale, type MessageKey, type Params, type PlayerNames } from "./core";
export { I18nProvider, useI18n } from "./I18nProvider";
export {
  LANGUAGE_NAMES,
  LANGUAGE_PREFERENCES,
  LANGUAGE_STORAGE_KEY,
  LOCALES,
  readLanguage,
  setLanguagePreference,
  systemLocale,
  useLanguage,
  type LanguagePreference,
  type LanguageState
} from "./language";
