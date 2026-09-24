import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, initTheme, readThemePreference, resetTheme, resolveTheme, setThemePreference } from "./theme";

function mockSystem(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: dark && query.includes("dark"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  );
}

describe("theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetTheme();
  });

  it("follows the system until a theme is chosen", () => {
    mockSystem(true);
    initTheme();
    expect(readThemePreference()).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(resolveTheme("system")).toBe("dark");
  });

  it("stores the chosen theme and applies it to the document", () => {
    mockSystem(true);
    setThemePreference("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    // A new window starts with the stored choice.
    resetTheme();
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themePreference).toBe("light");

    setThemePreference("system");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores an unknown stored value", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readThemePreference()).toBe("system");
  });
});
