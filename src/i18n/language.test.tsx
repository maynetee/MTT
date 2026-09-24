import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, LANGUAGE_STORAGE_KEY, readLanguage, setLanguagePreference, systemLocale, useI18n, useLanguage } from "./index";

/** The browser's language list, as the system settings give it. */
function systemLanguages(languages: string[]) {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
}

function Heading() {
  const { t } = useI18n();
  return <h1>{t("list.title")}</h1>;
}

describe("language", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("follows the first language of the system the app speaks, English otherwise", () => {
    expect(systemLocale(["fr-FR", "en-US"])).toBe("fr");
    expect(systemLocale(["fr"])).toBe("fr");
    expect(systemLocale(["fr-CA"])).toBe("fr");
    expect(systemLocale(["de-DE", "fr-CH", "en"])).toBe("fr");
    expect(systemLocale(["en-GB", "fr-FR"])).toBe("en");
    expect(systemLocale(["de-DE", "es-ES"])).toBe("en");
    expect(systemLocale([])).toBe("en");
  });

  it("is English by default, French on a French system", () => {
    expect(readLanguage()).toEqual({ preference: "system", locale: "en", system: "en" });
    systemLanguages(["fr-BE", "nl-BE"]);
    expect(readLanguage()).toEqual({ preference: "system", locale: "fr", system: "fr" });
  });

  it("stores the choice on this device, over the system's", () => {
    systemLanguages(["fr-FR"]);
    setLanguagePreference("en");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(readLanguage()).toEqual({ preference: "en", locale: "en", system: "fr" });

    setLanguagePreference("system");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    expect(readLanguage().locale).toBe("fr");
  });

  it("ignores a stored value it does not know", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "tlh");
    expect(readLanguage()).toEqual({ preference: "system", locale: "en", system: "en" });
  });

  it("follows a change made in another window", () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current.locale).toBe("en");
    act(() => {
      // Another window wrote it: only a storage event tells this one.
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr");
      window.dispatchEvent(new StorageEvent("storage", { key: LANGUAGE_STORAGE_KEY }));
    });
    expect(result.current).toEqual({ preference: "fr", locale: "fr", system: "en" });
  });

  it("translates the page and sets <html lang>", () => {
    render(
      <I18nProvider>
        <Heading />
      </I18nProvider>
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Tournaments");
    expect(document.documentElement.lang).toBe("en");

    act(() => setLanguagePreference("fr"));
    expect(screen.getByRole("heading")).toHaveTextContent("Tournois");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("keeps a language given to the provider", () => {
    setLanguagePreference("fr");
    render(
      <I18nProvider locale="en">
        <Heading />
      </I18nProvider>
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Tournaments");
  });
});
