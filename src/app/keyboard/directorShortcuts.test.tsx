import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { register, renderApp, withTournament } from "../../test/app";

const MIN = 60_000;

function onPlatform(platform: "MacIntel" | "Win32") {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
}

/** Lets the engine's microtasks and React updates settle. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

/** A tournament with `players` registered, open at a director tab. */
async function open(tab: string, players: string[] = ["Ann", "Ben"]) {
  const { engine, id } = await withTournament();
  await register(engine, id, players);
  renderApp(engine, `/t/${id}/${tab}`);
  await screen.findByRole("navigation", { name: "Tournament sections" });
  return { engine, id, user: userEvent.setup(), view: () => engine.getView(id) };
}

describe("director shortcuts", () => {
  it("starts and pauses the clock with Space", async () => {
    const { user, view } = await open("clock");

    await user.keyboard(" ");
    expect(await screen.findAllByRole("button", { name: "Pause" })).not.toHaveLength(0);
    expect((await view()).clock.running).toBe(true);
    expect((await view()).phase).toBe("running");

    await user.keyboard(" ");
    expect(await screen.findAllByRole("button", { name: "Start" })).not.toHaveLength(0);
    expect((await view()).clock.running).toBe(false);
  });

  it("changes level, adds and removes a minute and jumps to the break", async () => {
    const { user, view } = await open("clock");

    await user.keyboard("n");
    expect((await view()).clock.levelIndex).toBe(1);
    await user.keyboard("p");
    expect((await view()).clock.levelIndex).toBe(0);

    await user.keyboard("+");
    expect((await view()).clock.remainingMs).toBe(21 * MIN);
    await user.keyboard("=");
    expect((await view()).clock.remainingMs).toBe(22 * MIN);
    await user.keyboard("-");
    expect((await view()).clock.remainingMs).toBe(21 * MIN);

    // 100/200, 150/300, then the break.
    await user.keyboard("b");
    expect((await view()).clock).toMatchObject({ levelIndex: 2, isBreak: true });
    await settle();
  });

  it("undoes with Ctrl+Z and redoes with Ctrl+Shift+Z or Ctrl+Y on Windows and Linux", async () => {
    onPlatform("Win32");
    const { user, view } = await open("players");

    await user.keyboard("{Meta>}z{/Meta}");
    expect((await view()).counts.unique).toBe(2);
    await user.keyboard("{Control>}z{/Control}");
    expect((await view()).counts.unique).toBe(1);
    await user.keyboard("{Control>}y{/Control}");
    expect((await view()).counts.unique).toBe(2);
    await user.keyboard("{Control>}z{/Control}");
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect((await view()).counts.unique).toBe(2);
    await settle();
  });

  it("undoes with ⌘Z and redoes with ⇧⌘Z on macOS, where Ctrl+Z and Ctrl+Y do nothing", async () => {
    onPlatform("MacIntel");
    const { user, view } = await open("players");

    await user.keyboard("{Control>}z{/Control}");
    expect((await view()).counts.unique).toBe(2);
    await user.keyboard("{Meta>}z{/Meta}");
    expect((await view()).counts.unique).toBe(1);
    await user.keyboard("{Control>}y{/Control}");
    expect((await view()).counts.unique).toBe(1);
    await user.keyboard("{Meta>}{Shift>}z{/Shift}{/Meta}");
    expect((await view()).counts.unique).toBe(2);
    await settle();
  });

  it("switches tabs with 1 to 9", async () => {
    const { user } = await open("clock");

    await user.keyboard("3");
    await waitFor(() => expect(screen.getByRole("link", { name: "Players" })).toHaveAttribute("aria-current", "page"));
    await user.keyboard("9");
    await waitFor(() => expect(screen.getByRole("link", { name: "Display" })).toHaveAttribute("aria-current", "page"));
    await user.keyboard("1");
    await waitFor(() => expect(screen.getByRole("link", { name: "Registration" })).toHaveAttribute("aria-current", "page"));
  });

  it("opens the display window of this tournament with D", async () => {
    const { engine, id } = await withTournament();
    const openDisplay = vi.spyOn(engine, "openDisplayWindow").mockResolvedValue();
    renderApp(engine, `/t/${id}/players`);
    await screen.findByRole("heading", { name: "Players" });

    await userEvent.setup().keyboard("d");
    expect(openDisplay).toHaveBeenCalledWith(id);
  });

  describe("full screen in a browser", () => {
    const root = document.documentElement;
    afterEach(() => {
      delete (root as Partial<HTMLElement>).requestFullscreen;
      delete (document as Partial<Document>).exitFullscreen;
      delete (document as Partial<{ fullscreenElement: unknown }>).fullscreenElement;
    });

    it("toggles with F and leaves with Esc", async () => {
      const request = vi.fn().mockResolvedValue(undefined);
      const exit = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(root, "requestFullscreen", { value: request, configurable: true });
      Object.defineProperty(document, "exitFullscreen", { value: exit, configurable: true });
      const { user } = await open("clock");

      await user.keyboard("f");
      expect(request).toHaveBeenCalledTimes(1);

      Object.defineProperty(document, "fullscreenElement", { value: root, configurable: true });
      await user.keyboard("f");
      expect(exit).toHaveBeenCalledTimes(1);
      await user.keyboard("{Escape}");
      expect(exit).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  it("does nothing while typing in a field", async () => {
    const { user, view } = await open("registration");
    const name = screen.getByPlaceholderText("Player name");

    await user.type(name, "n 1+b?");
    expect(name).toHaveValue("n 1+b?");
    await user.keyboard("{Control>}z{/Control}");
    const current = await view();
    expect(current.clock).toMatchObject({ levelIndex: 0, running: false, remainingMs: 20 * MIN });
    expect(current.counts.unique).toBe(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registration" })).toHaveAttribute("aria-current", "page");
  });

  it("does nothing behind a dialog, and Esc closes it", async () => {
    const { user, view } = await open("clock");

    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    await user.keyboard("n");
    await user.keyboard("b");
    expect((await view()).clock).toMatchObject({ levelIndex: 0, running: false });

    await user.keyboard("{Escape}");
    expect(dialog).not.toBeInTheDocument();
    await user.keyboard("n");
    expect((await view()).clock.levelIndex).toBe(1);
    await settle();
  });

  it("leaves Space to a focused button", async () => {
    const { user, view } = await open("clock");
    screen.getByRole("button", { name: "Next break" }).focus();

    await user.keyboard(" ");
    await waitFor(async () => expect((await view()).clock.levelIndex).toBe(2));
    expect((await view()).clock.running).toBe(false);
  });

  it("still starts the clock with Space right after a tab was clicked", async () => {
    const { user, view } = await open("players");

    await user.click(screen.getByRole("link", { name: "Clock" }));
    expect(screen.getByRole("link", { name: "Clock" })).toHaveFocus();
    await user.keyboard(" ");
    expect((await view()).clock.running).toBe(true);
    await settle();
  });

  it("lists every shortcut, grouped, with the keys of the platform", async () => {
    onPlatform("MacIntel");
    const { user } = await open("clock");

    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    for (const group of ["Clock", "Undo and redo", "Tabs and windows"]) {
      expect(within(dialog).getByRole("heading", { name: group })).toBeInTheDocument();
    }
    const row = (action: string) => within(dialog).getByText(action).closest(".shortcut-row") as HTMLElement;
    expect(row("Start or pause the clock")).toHaveTextContent("Space");
    expect(row("Undo the last action")).toHaveTextContent("⌘Z");
    expect(row("Redo")).toHaveTextContent("⇧⌘Z");
    expect(row("Go to a tab")).toHaveTextContent("1 Registration · 2 Seating");
    expect(row("Go to a tab")).toHaveTextContent("1–9");
    expect(row("Show these shortcuts")).toHaveTextContent("?");
  });

  it("uses Ctrl in the list outside macOS", async () => {
    onPlatform("Win32");
    const { user } = await open("clock");

    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    const redo = within(dialog).getByText("Redo").closest(".shortcut-row") as HTMLElement;
    expect(redo).toHaveTextContent("Ctrl+Shift+Z or Ctrl+Y");
    expect(within(dialog).queryByText(/⌘/)).not.toBeInTheDocument();
  });

  it("shows the keys on the buttons and tabs they stand for", async () => {
    onPlatform("Win32");
    await open("clock");

    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toHaveAttribute("aria-keyshortcuts", "N");
    expect(next).toHaveAccessibleDescription("Shortcut N");
    for (const start of screen.getAllByRole("button", { name: "Start" })) {
      expect(start).toHaveAttribute("aria-keyshortcuts", "Space");
    }
    expect(screen.getByRole("button", { name: "+1:00" })).toHaveAttribute("aria-keyshortcuts", "Plus =");
    expect(screen.getByRole("button", { name: "Next break" })).toHaveAttribute("aria-keyshortcuts", "B");
    expect(screen.getByRole("button", { name: "Undo register Ben" })).toHaveAttribute("aria-keyshortcuts", "Control+Z");
    expect(screen.getByRole("button", { name: "Redo" })).toHaveAttribute("aria-keyshortcuts", "Shift+Control+Z Control+Y");
    expect(screen.getByRole("link", { name: "Registration" })).toHaveAttribute("aria-keyshortcuts", "1");
    expect(screen.getByRole("link", { name: "Display" })).toHaveAttribute("aria-keyshortcuts", "9");
    // Only the first nine tabs get a number key.
    expect(screen.getByRole("link", { name: "Exports" })).not.toHaveAttribute("aria-keyshortcuts");
  });
});
