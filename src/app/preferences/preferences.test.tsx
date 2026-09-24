import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeAudio } from "../../test/audio";
import { I18nProvider } from "../../i18n";
import { PreferencesMenu } from "./PreferencesMenu";
import { DEFAULT_PREFERENCES, PREFERENCES_STORAGE_KEY, parsePreferences, readPreferences, setPreferences, usePreferences } from "./preferences";

describe("preferences", () => {
  it("defaults to sound on, at 80 %, in the automatic window", () => {
    expect(readPreferences()).toEqual({ sound: true, volume: 0.8, soundOutput: "auto" });
  });

  it("keeps the default of each missing or invalid field", () => {
    expect(parsePreferences("not json")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences(JSON.stringify({ sound: false, volume: 7, soundOutput: "kitchen" }))).toEqual({
      sound: false,
      volume: 1,
      soundOutput: "auto"
    });
  });

  it("stores a change for every window of this device", () => {
    setPreferences({ volume: 0.3 });
    expect(JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)!)).toEqual({ sound: true, volume: 0.3, soundOutput: "auto" });
    expect(readPreferences().volume).toBe(0.3);
  });

  it("follows a change made in another window", () => {
    const { result } = renderHook(() => usePreferences());
    expect(result.current.sound).toBe(true);
    act(() => {
      // Another window wrote it: only a storage event tells this one.
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ sound: false }));
      window.dispatchEvent(new StorageEvent("storage", { key: PREFERENCES_STORAGE_KEY }));
    });
    expect(result.current.sound).toBe(false);
  });
});

describe("PreferencesMenu", () => {
  let audio: ReturnType<typeof installFakeAudio> | null = null;
  afterEach(() => {
    audio?.restore();
    audio = null;
  });

  function renderMenu() {
    return render(
      <I18nProvider>
        <button type="button">Elsewhere</button>
        <PreferencesMenu />
      </I18nProvider>
    );
  }

  it("turns the sound off and on, sets the volume and the window that plays", async () => {
    const user = userEvent.setup();
    renderMenu();
    const button = screen.getByRole("button", { name: "Preferences" });
    await user.click(button);
    expect(screen.getByRole("dialog", { name: "Preferences" })).toBeInTheDocument();

    const sound = screen.getByRole("checkbox", { name: /level sounds/i });
    expect(sound).toHaveFocus();
    await user.click(sound);
    expect(readPreferences().sound).toBe(false);
    expect(screen.getByRole("slider", { name: "Volume" })).toBeDisabled();
    await user.click(sound);

    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "45" } });
    expect(readPreferences().volume).toBe(0.45);
    expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuetext", "45%");

    await user.click(screen.getByRole("radio", { name: "The display window" }));
    expect(readPreferences().soundOutput).toBe("display");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("closes on a click outside", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Preferences" }));
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("plays a test chime at the chosen volume", async () => {
    audio = installFakeAudio({ locked: true });
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Preferences" }));
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(audio.voices()).toEqual(["levelChange"]);
  });
});
