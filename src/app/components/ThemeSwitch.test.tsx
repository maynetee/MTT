import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n";
import { THEME_STORAGE_KEY, resetTheme } from "../theme";
import { ThemeSwitch } from "./ThemeSwitch";

function renderSwitch() {
  return render(
    <I18nProvider>
      <ThemeSwitch />
    </I18nProvider>
  );
}

describe("ThemeSwitch", () => {
  afterEach(() => resetTheme());

  it("stores the chosen theme and restores it in a new window", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSwitch();

    await user.click(screen.getByRole("button", { name: "Theme: Match system" }));
    const menu = screen.getByRole("menu", { name: "Theme" });
    expect(screen.getByRole("menuitemradio", { name: "Match system" })).toHaveAttribute("aria-checked", "true");
    expect(menu).toBeInTheDocument();

    await user.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Theme: Dark" })).toHaveFocus();
    unmount();

    // A new window reads the stored choice.
    resetTheme();
    renderSwitch();
    expect(screen.getByRole("button", { name: "Theme: Dark" })).toBeInTheDocument();
  });

  it("is keyboard operable and goes back to the system theme", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    renderSwitch();

    screen.getByRole("button", { name: "Theme: Light" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "Light" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{Enter}");

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Theme: Match system" })).toHaveFocus();
  });

  it("closes on Escape without changing the theme", async () => {
    const user = userEvent.setup();
    renderSwitch();
    await user.click(screen.getByRole("button", { name: "Theme: Match system" }));
    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
