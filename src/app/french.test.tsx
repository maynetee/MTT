import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LANGUAGE_STORAGE_KEY } from "../i18n";
import { register, renderApp, withTournament } from "../test/app";
import { createTestEngine, play, tournamentInput } from "../test/wasm";

/** Intl writes French thousands with narrow no-break spaces; messages put no-break spaces before ":". */
const NNBSP = String.fromCharCode(0x202f);
const NBSP = String.fromCharCode(0xa0);

/** The browser's language list, as the system settings give it. */
function systemLanguages(languages: string[]) {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
}

/** Lets pending engine calls and React updates settle (the engine resolves in microtasks). */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("in French", () => {
  it("shows the tournament list on a French system", async () => {
    systemLanguages(["fr-FR", "en-US"]);
    const engine = createTestEngine();
    await engine.createTournament(tournamentInput({ name: "Deepstack du vendredi" }));
    renderApp(engine, "/");

    expect(await screen.findByRole("heading", { name: "Tournois" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Dernière modification" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir Deepstack du vendredi" })).toBeInTheDocument();
    expect(screen.getByText("Préparation")).toBeInTheDocument();
    expect(screen.getByText("maintenant")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nouveau tournoi" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("fr");
    expect(document.title).toBe("MTT Directeur de tournoi");
  });

  it("registers players and translates the core's errors", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr");
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    renderApp(engine, `/t/${id}/registration`);

    await user.click(await screen.findByRole("checkbox", { name: "Choisir le siège" }));
    const table = screen.getByLabelText("Table");
    await user.clear(table);
    await user.type(table, "2");
    const seat = screen.getByLabelText("Siège");
    await user.clear(seat);
    await user.type(seat, "7");
    await user.type(screen.getByPlaceholderText("Nom du joueur"), "Élodie Marchand{Enter}");

    const ticket = await screen.findByRole("status");
    expect(within(ticket).getByText("Inscrit")).toBeInTheDocument();
    expect(within(ticket).getByText("Table 2, siège 7")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "T2 S7" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Nom du joueur"), "Søren Kjær{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Le siège 7 de la table 2 est occupé.");
    expect(screen.getByRole("button", { name: `Annuler${NBSP}: inscrire Élodie Marchand` })).toBeInTheDocument();
  });

  it("shows the display with French numbers", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr");
    const engine = createTestEngine();
    const id = await engine.createTournament(
      tournamentInput({ maxTables: 1, startingStack: 12_345 }, [play(1000, 2000, 20, { type: "big_blind", amount: 2000 }), play(1500, 3000)])
    );
    await register(engine, id, ["Ann", "Ben", "Cat"]);
    await engine.dispatch(id, { type: "start_clock" });
    renderApp(engine, `/display/${id}`);
    await settle();

    expect(await screen.findByRole("heading", { name: "Niveau 1" })).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "Temps restant du niveau" })).toBeInTheDocument();
    expect(screen.getByText("Blindes")).toBeInTheDocument();
    // Queries read any space as a plain one: the exact text says which space it is.
    expect(screen.getByText("1 000/2 000").textContent).toBe(`1${NNBSP}000/2${NNBSP}000`);
    expect(screen.getByText("BBA 2 000").textContent).toBe(`BBA 2${NNBSP}000`);
    expect(screen.getByText("Tapis moyen")).toBeInTheDocument();
    expect(screen.getByText("12 345").textContent).toBe(`12${NNBSP}345`);
    expect(screen.getByText("6,2 BB")).toBeInTheDocument();
    expect(screen.getByText("37 035").textContent).toBe(`37${NNBSP}035`);
    expect(screen.getByText("sur 3 entrées")).toBeInTheDocument();
    expect(document.title).toBe("MTT Affichage");
  });

  it("switches language from the preferences, for every window of this device", async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    const first = renderApp(engine, "/");
    expect(await screen.findByRole("heading", { name: "Tournaments" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preferences" }));
    expect(screen.getByRole("radio", { name: "Match system (English)" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Français" }));
    expect(await screen.findByRole("heading", { name: "Tournois" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Langue" })).toBeInTheDocument();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("fr");
    first.unmount();

    // Kept for the next start.
    renderApp(engine, "/");
    expect(await screen.findByRole("heading", { name: "Tournois" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Préférences" }));
    await user.click(screen.getByRole("radio", { name: "English" }));
    expect(await screen.findByRole("heading", { name: "Tournaments" })).toBeInTheDocument();
  });

  it("switches an open display when another window changes the language", async () => {
    const { engine, id } = await withTournament();
    await register(engine, id, ["Ann", "Ben"]);
    await engine.dispatch(id, { type: "start_clock" });
    renderApp(engine, `/display/${id}`);
    expect(await screen.findByRole("heading", { name: "Level 1" })).toBeInTheDocument();

    act(() => {
      // The director's window wrote it: only a storage event tells the display.
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr");
      window.dispatchEvent(new StorageEvent("storage", { key: LANGUAGE_STORAGE_KEY }));
    });
    expect(screen.getByRole("heading", { name: "Niveau 1" })).toBeInTheDocument();
    expect(screen.getByText("Tapis moyen")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("fr");
    expect(document.title).toBe("MTT Affichage");
  });
});
