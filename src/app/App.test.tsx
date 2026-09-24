import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { register, renderApp, withTournament } from "../test/app";
import { createTestEngine, tournamentInput } from "../test/wasm";

// A player in the registration list (the name alone also shows in the seat ticket).
const alice = { name: "Alice" };

describe("App", () => {
  it("opens on the tournament list, in demo mode in a browser", async () => {
    renderApp(createTestEngine(), "/");
    expect(await screen.findByRole("heading", { name: "Tournaments" })).toBeInTheDocument();
    expect(screen.getByText("No tournament yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New tournament" })).toBeInTheDocument();
    expect(screen.getByText("DEMO")).toBeInTheDocument();
  });

  it("titles the director's window and the display window", async () => {
    const { engine, id } = await withTournament();
    const director = renderApp(engine, "/");
    await screen.findByRole("heading", { name: "Tournaments" });
    expect(document.title).toBe("MTT Tournament Director");
    director.unmount();

    renderApp(engine, `/display/${id}`);
    await screen.findByRole("timer");
    expect(document.title).toBe("MTT Display");
  });

  it("creates a tournament with the default structure and opens its registration", async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    renderApp(engine, "/");

    await user.click(await screen.findByRole("link", { name: "New tournament" }));
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Sunday Major");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    expect(await screen.findByRole("heading", { name: "Register player" })).toBeInTheDocument();
    const [summary] = await engine.listTournaments();
    expect(summary).toMatchObject({ name: "Sunday Major", phase: "setup" });
    const view = await engine.getView(summary.id);
    expect(view.levels.filter((row) => row.level.type === "play").length).toBeGreaterThanOrEqual(20);
    expect(view.levels.some((row) => row.level.type === "break")).toBe(true);
  });

  it("shows the core's validation error for an invalid structure row", async () => {
    const user = userEvent.setup();
    renderApp(createTestEngine(), "/new");

    const bigBlind = await screen.findByLabelText("Level 2 BB");
    await user.clear(bigBlind);
    await user.type(bigBlind, "10");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Row 2: the small blind must be more than 0 and the big blind at least the small blind.");
    expect(bigBlind.closest(".level-row")).toHaveClass("invalid");
  });

  it("deletes a tournament after confirmation", async () => {
    const user = userEvent.setup();
    const { engine } = await withTournament();
    renderApp(engine, "/");

    await user.click(await screen.findByRole("button", { name: "Delete Test event" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete “Test event”?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete tournament" }));

    expect(await screen.findByText("No tournament yet")).toBeInTheDocument();
    expect(await engine.listTournaments()).toEqual([]);
  });

  it("ignores the undo shortcut while typing in a field", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    renderApp(engine, `/t/${id}/registration`);

    const nameInput = await screen.findByPlaceholderText("Player name");
    await user.type(nameInput, "Alice{Enter}");
    expect(await screen.findByRole("cell", alice)).toBeInTheDocument();

    await user.type(nameInput, "Bo");
    await user.keyboard("{Meta>}z{/Meta}");
    expect(screen.getByRole("cell", alice)).toBeInTheDocument();

    await user.click(document.body);
    expect(document.body).toHaveFocus();
    await user.keyboard("{Meta>}z{/Meta}");
    await waitFor(() => expect(screen.queryByRole("cell", alice)).not.toBeInTheDocument());

    // Shift+Cmd+Z redoes.
    await user.keyboard("{Meta>}{Shift>}z{/Shift}{/Meta}");
    expect(await screen.findByRole("cell", alice)).toBeInTheDocument();
  });

  it("labels Undo and Redo with the action from the history", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    await register(engine, id, ["Alice", "Bob"]);
    renderApp(engine, `/t/${id}/registration`);

    await user.click(await screen.findByRole("button", { name: "Undo register Bob" }));
    expect(await screen.findByRole("button", { name: "Redo register Bob" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo register Alice" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Redo register Bob" }));
    expect(await screen.findByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("asks for the name before deleting a tournament that has started", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "start_clock" });
    renderApp(engine, "/");

    await user.click(await screen.findByRole("button", { name: "Delete Test event" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete “Test event”?" });
    const confirm = within(dialog).getByRole("button", { name: "Delete tournament" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Type “Test event” to confirm"), "Test event");
    await user.click(confirm);

    expect(await screen.findByText("“Test event” deleted")).toBeInTheDocument();
    expect(await engine.listTournaments()).toEqual([]);
  });

  it("shows a rejected command's translated error as a toast", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    await register(engine, id, ["Alice"]);
    renderApp(engine, `/t/${id}/registration`);

    await user.type(await screen.findByPlaceholderText("Player name"), "alice{Enter}");

    const notifications = screen.getByRole("region", { name: "Notifications" });
    expect(await within(notifications).findByRole("alert")).toHaveTextContent("Alice is already registered.");
    expect(screen.getByPlaceholderText("Player name")).toHaveValue("alice");
  });

  it("offers the previous version's tournament on an empty list, once", async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    vi.spyOn(engine, "legacyImportStatus").mockResolvedValue({ available: true });
    vi.spyOn(engine, "importLegacy").mockImplementation(() => engine.createTournament(tournamentInput({ name: "Imported" })));
    const { unmount } = renderApp(engine, "/");

    await user.click(await screen.findByRole("button", { name: "Import from the previous version" }));
    expect(await screen.findByRole("heading", { name: "Register player" })).toBeInTheDocument();
    unmount();

    // The host still reports the old data: the offer does not come back.
    await engine.deleteTournament((await engine.listTournaments())[0].id);
    renderApp(engine, "/");
    expect(await screen.findByText("No tournament yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import from the previous version" })).not.toBeInTheDocument();
  });

  it("lets keyboard users skip the header", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    renderApp(engine, `/t/${id}/players`);
    await screen.findByRole("heading", { name: "Players" });

    await user.tab();
    expect(screen.getByRole("button", { name: "Skip to content" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("shows when a tournament no longer exists", async () => {
    renderApp(createTestEngine(), "/t/missing/players");
    expect(await screen.findByText("This tournament does not exist anymore.")).toBeInTheDocument();
  });
});
