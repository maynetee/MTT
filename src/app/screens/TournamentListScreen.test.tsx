import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";
import App from "../App";
import { Providers, register, renderApp } from "../../test/app";
import { createTestEngine, pause, play, tournamentInput } from "../../test/wasm";
import { FILTER_THRESHOLD } from "./TournamentListScreen";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** An engine whose clock runs `offset` behind the real one, to date changes in the past. */
function engineInThePast() {
  let offset = 0;
  const engine = createTestEngine({ now: () => Date.now() - offset });
  return { engine, at: (ago: number) => (offset = ago) };
}

const rowNames = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getByRole("rowheader").textContent);

describe("tournament list", () => {
  it("shows the most recently changed first, with phase, players and when it changed", async () => {
    const { engine, at } = engineInThePast();
    at(3 * DAY);
    await engine.createTournament(tournamentInput({ name: "Old Monday" }));
    at(2 * HOUR);
    const running = await engine.createTournament(tournamentInput({ name: "Friday" }));
    await register(engine, running, ["Łukasz", "Zoë", "Søren"]);
    await engine.dispatch(running, { type: "start_clock" });
    await engine.dispatch(running, { type: "bust_players", busts: [{ player: 1 }] });
    at(0);
    await engine.createTournament(tournamentInput({ name: "Next week" }));
    renderApp(engine, "/");

    await screen.findByRole("table", { name: "Tournaments" });
    expect(rowNames()).toEqual(["Next week", "Friday", "Old Monday"]);
    const friday = screen.getByRole("row", { name: /Friday/ });
    expect(within(friday).getByText("In progress")).toBeInTheDocument();
    expect(within(friday).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["3", "2", "2 hours ago"]));
    expect(within(screen.getByRole("row", { name: /Old Monday/ })).getByText("3 days ago")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Next week/ })).getByText("now")).toHaveAttribute("dateTime");
  });

  it("duplicates a tournament: same settings and structure, a new name, no players", async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    const structure = [play(100, 200), pause(15), play(200, 400, 30)];
    const source = await engine.createTournament(tournamentInput({ name: "Friday", maxTables: 3, startingStack: 25_000 }, structure));
    await register(engine, source, ["Aoife", "Mei-Lin"]);
    renderApp(engine, "/");

    await user.click(await screen.findByRole("button", { name: "Duplicate Friday" }));
    const toast = await screen.findByText("“Friday (copy)” created");
    expect(rowNames()).toEqual(["Friday (copy)", "Friday"]);

    const [copy] = await engine.listTournaments();
    const view = await engine.getView(copy.id);
    const original = await engine.getView(source);
    expect(view.config).toEqual({ ...original.config, name: "Friday (copy)" });
    expect(view.levels.map((row) => row.level)).toEqual(structure);
    expect(view.counts.unique).toBe(0);

    // A second copy gets a number; the toast opens the copy.
    await user.click(screen.getByRole("button", { name: "Duplicate Friday" }));
    expect(await screen.findByText("“Friday (copy 2)” created")).toBeInTheDocument();
    await user.click(within(toast.closest(".toast") as HTMLElement).getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("heading", { name: "Friday (copy)", level: 1 })).toBeInTheDocument();
  });

  it(`offers a search and a phase filter above ${FILTER_THRESHOLD} tournaments`, async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    for (let i = 1; i <= FILTER_THRESHOLD; i++) await engine.createTournament(tournamentInput({ name: `Weekly #${i}` }));
    const { unmount } = renderApp(engine, "/");
    await screen.findByRole("table", { name: "Tournaments" });
    expect(screen.queryByRole("searchbox", { name: "Search tournaments" })).not.toBeInTheDocument();
    unmount();

    const zoe = await engine.createTournament(tournamentInput({ name: "Zoë's Birthday" }));
    await register(engine, zoe, ["Ngozi", "José"]);
    await engine.dispatch(zoe, { type: "start_clock" });
    renderApp(engine, "/");

    const search = await screen.findByRole("searchbox", { name: "Search tournaments" });
    await user.type(search, "zoe");
    expect(rowNames()).toEqual(["Zoë's Birthday"]);

    await user.clear(search);
    const filter = screen.getByRole("radiogroup", { name: "Show" });
    await user.click(within(filter).getByRole("radio", { name: /In progress/ }));
    expect(rowNames()).toEqual(["Zoë's Birthday"]);
    await user.click(within(filter).getByRole("radio", { name: /Setup/ }));
    expect(rowNames()).toHaveLength(FILTER_THRESHOLD);
    await user.click(within(filter).getByRole("radio", { name: /Finished/ }));
    expect(screen.getByText("No tournament in this list.")).toBeInTheDocument();

    await user.click(within(filter).getByRole("radio", { name: /All/ }));
    await user.type(search, "sunday");
    expect(screen.getByText("No tournament matches “sunday”.")).toBeInTheDocument();
  });
});

describe("the display window", () => {
  it("follows when pointed at another tournament", async () => {
    const engine = createTestEngine();
    const friday = await engine.createTournament(tournamentInput({ name: "Friday" }));
    const saturday = await engine.createTournament(tournamentInput({ name: "Saturday" }));
    let go: (path: string) => void = () => {};
    function Navigator() {
      go = useNavigate();
      return null;
    }
    render(
      <Providers engine={engine}>
        <MemoryRouter initialEntries={[`/display/${friday}`]}>
          <App />
          <Navigator />
        </MemoryRouter>
      </Providers>
    );
    expect(await screen.findByRole("heading", { name: "Friday" })).toBeInTheDocument();

    // What the host does when the director opens the display of another tournament.
    act(() => go(`/display/${saturday}`));
    expect(await screen.findByRole("heading", { name: "Saturday" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Friday" })).not.toBeInTheDocument();
  });
});
