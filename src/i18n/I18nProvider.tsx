import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { getI18n, i18n as english, type I18n } from "./core";
import { useLanguage, type Locale } from "./language";

const I18nContext = createContext<I18n>(english);

/**
 * Translations and formats for the language of this device (see ./language.ts), or for
 * `locale` when given. Keeps `<html lang>` in step, so assistive technology reads the page
 * in the right language.
 */
export function I18nProvider({ locale, children }: { locale?: Locale; children: ReactNode }) {
  const language = useLanguage();
  const active = locale ?? language.locale;
  const value = useMemo(() => getI18n(active), [active]);
  useEffect(() => {
    document.documentElement.lang = active;
  }, [active]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Translation and locale-aware formatting for the current language. */
export function useI18n(): I18n {
  return useContext(I18nContext);
}
