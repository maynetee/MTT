import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LANGUAGE_STORAGE_KEY } from "../../i18n";
import { playerId, register, renderApp, withTournament } from "../../test/app";

/** The ranking's body rows, cell by cell: place, player, status. */
function rows() {
  const [, ...body] = within(screen.getByRole("table", { name: "Exports" })).getAllByRole("row");
  return body.map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent));
}

async function fourPlayers() {
  const { engine, id } = await withTournament({ tables: 1 });
  const view = await register(engine, id, [
    ["Anna", 1, 1],
    ["Łukasz", 1, 2],
    ["Bob", 1, 3],
    ["Chloé", 1, 4]
  ]);
  await engine.dispatch(id, { type: "start_clock" });
  const bust = (...names: string[]) => engine.dispatch(id, { type: "bust_players", busts: names.map((name) => ({ player: playerId(view, name) })) });
  return { engine, id, bust };
}

describe("ExportsScreen", () => {
  it("shows players in play first without a place, then eliminated players by finishing place", async () => {
    const { engine, id, bust } = await fourPlayers();
    await engine.dispatch(id, { type: "close_registration" });
    await bust("Chloé");
    await bust("Bob");
    renderApp(engine, `/t/${id}/exports`);

    await screen.findByText("Anna");
    expect(rows()).toEqual([
      ["—", "Anna", "In play"],
      ["—", "Łukasz", "In play"],
      ["#3", "Bob", "Eliminated"],
      ["#4", "Chloé", "Eliminated"]
    ]);
  });

  it("marks ties and provisional places while registration is open", async () => {
    const { engine, id, bust } = await fourPlayers();
    await bust("Bob", "Chloé");
    renderApp(engine, `/t/${id}/exports`);

    await screen.findByText("Anna");
    expect(rows().slice(2)).toEqual([
      ["#3–4", "Bob", "Eliminated (tie 3–4, provisional)"],
      ["#3–4", "Chloé", "Eliminated (tie 3–4, provisional)"]
    ]);
    expect(screen.getByText("Places are provisional while registration is open.")).toBeInTheDocument();
  });

  it("shows the winner first once the tournament is finished", async () => {
    const { engine, id, bust } = await fourPlayers();
    await engine.dispatch(id, { type: "close_registration" });
    await bust("Chloé");
    await bust("Bob");
    await bust("Anna");
    renderApp(engine, `/t/${id}/exports`);

    await screen.findByText("Anna");
    expect(rows()).toEqual([
      ["#1", "Łukasz", "Winner"],
      ["#2", "Anna", "Eliminated"],
      ["#3", "Bob", "Eliminated"],
      ["#4", "Chloé", "Eliminated"]
    ]);
    expect(screen.getByText("Final ranking")).toBeInTheDocument();
  });

  it("ranks and exports in French", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr");
    const user = userEvent.setup();
    const { engine, id, bust } = await fourPlayers();
    await engine.dispatch(id, { type: "close_registration" });
    await bust("Bob", "Chloé");
    await bust("Anna");
    const save = vi.spyOn(engine, "saveExport").mockResolvedValue(true);
    renderApp(engine, `/t/${id}/exports`);

    await screen.findByText("Anna");
    expect(rows()).toEqual([
      ["1er", "Łukasz", "Vainqueur"],
      ["2e", "Anna", "Éliminé"],
      ["3e–4e", "Bob", "Éliminé (ex æquo 3e–4e)"],
      ["3e–4e", "Chloé", "Éliminé (ex æquo 3e–4e)"]
    ]);
    expect(screen.getByText("Classement final")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Exporter en CSV" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [{ fileName, bytes }] = save.mock.calls[0];
    expect(fileName).toBe("Test event-classement.csv");
    expect(new TextDecoder().decode(bytes).split("\r\n")[0]).toBe("Place,Joueur,État");
    expect(await screen.findByText("Classement exporté en CSV")).toBeInTheDocument();
  });

  it("exports the ranking as CSV through the engine", async () => {
    const user = userEvent.setup();
    const { engine, id, bust } = await fourPlayers();
    await bust("Chloé");
    const save = vi.spyOn(engine, "saveExport").mockResolvedValue(true);
    renderApp(engine, `/t/${id}/exports`);

    await user.click(await screen.findByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [{ fileName, bytes, mimeType }] = save.mock.calls[0];
    expect(fileName).toBe("Test event-ranking.csv");
    expect(mimeType).toBe("text/csv;charset=utf-8");
    expect(new TextDecoder().decode(bytes)).toBe(
      "Place,Player,Status\r\n,Anna,In play\r\n,Łukasz,In play\r\n,Bob,In play\r\n4,Chloé,Eliminated (provisional)\r\n"
    );
  });

  it("adds the prizes to the ranking and its exports when money is tracked", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament({
      tables: 1,
      placesPaid: 2,
      config: { money: { currency: { code: "EUR", exponent: 2 }, buyIn: { prize: 5_000, fee: 500 }, roundingUnit: 100 } }
    });
    const view = await register(engine, id, ["Anna", "Bob", "Chloé"]);
    await engine.dispatch(id, { type: "start_clock" });
    await engine.dispatch(id, { type: "close_registration" });
    await engine.dispatch(id, { type: "bust_players", busts: [{ player: playerId(view, "Chloé") }] });
    await engine.dispatch(id, { type: "bust_players", busts: [{ player: playerId(view, "Bob") }] });
    const save = vi.spyOn(engine, "saveExport").mockResolvedValue(true);
    renderApp(engine, `/t/${id}/exports`);

    await screen.findByRole("table", { name: "Exports" });
    // Two places paid out of EUR 150 on the default curve (65 %), rounded to whole euros.
    expect(rows()).toEqual([
      ["#1", "Anna", "Winner", "€98.00"],
      ["#2", "Bob", "Eliminated", "€52.00"],
      ["#3", "Chloé", "Eliminated", ""]
    ]);
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(new TextDecoder().decode(save.mock.calls[0][0].bytes)).toBe(
      "Place,Player,Status,Prize (EUR)\r\n1,Anna,Winner,98.00\r\n2,Bob,Eliminated,52.00\r\n3,Chloé,Eliminated,\r\n"
    );
  });

  it("shows an export failure", async () => {
    const user = userEvent.setup();
    const { engine, id } = await fourPlayers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(engine, "saveExport").mockRejectedValue({ code: "HOST_ERROR", params: { message: "disk full" } });
    renderApp(engine, `/t/${id}/exports`);

    await user.click(await screen.findByRole("button", { name: "Export CSV" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("CSV export failed: Something went wrong: disk full");
  });
});
