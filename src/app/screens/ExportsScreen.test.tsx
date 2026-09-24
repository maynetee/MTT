import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
