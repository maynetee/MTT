import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createI18n, i18n as english, type I18n, type Locale } from "./core";

const I18nContext = createContext<I18n>(english);

export function I18nProvider({ locale = "en", children }: { locale?: Locale; children: ReactNode }) {
  const value = useMemo(() => (locale === english.locale ? english : createI18n(locale)), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Translation and locale-aware formatting for the current language. */
export function useI18n(): I18n {
  return useContext(I18nContext);
}
