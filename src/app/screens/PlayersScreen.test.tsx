import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { View } from "../../engine/types";
import { playerId, register, renderApp, withTournament } from "../../test/app";

type User = ReturnType<typeof userEvent.setup>;

// Table 1 Seat 1 stays taken, so a hard-coded revive seat would never be free.
async function seatPlayers() {
  const { engine, id } = await withTournament({ tables: 2, seats: 2 });
  await register(engine, id, [
    ["Bob", 1, 1],
    ["Alice", 1, 2],
    ["Carol", 2, 1]
  ]);
  await engine.dispatch(id, { type: "start_clock" });
  return { engine, id };
}

async function eliminateAndPick(user: User, name: string) {
  await user.click(await screen.findByRole("button", { name: `Eliminate ${name}` }));
  await screen.findByRole("option", { name });
  await user.selectOptions(screen.getByLabelText("Player"), name);
}

function row(name: string) {
  return screen.getByRole("rowheader", { name }).closest("tr") as HTMLElement;
}

describe("PlayersScreen revive", () => {
  it("revives an eliminated player at the first free seat by default", async () => {
    const { engine, id } = await seatPlayers();
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    await eliminateAndPick(user, "Alice");
    expect(screen.getByLabelText("Seat")).toHaveDisplayValue("Table 1 Seat 2");
    await user.click(screen.getByRole("button", { name: "Revive player" }));

    await waitFor(async () => {
      const alice = (await engine.getView(id)).ranking.find((candidate) => candidate.name === "Alice")!;
      expect(alice).toMatchObject({ alive: true, seat: { table: 1, seat: 2 } });
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps Revive disabled while no seat is selected", async () => {
    const { engine, id } = await seatPlayers();
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    await eliminateAndPick(user, "Alice");
    await user.selectOptions(screen.getByLabelText("Seat"), "Select seat");

    expect(screen.getByLabelText("Seat")).toHaveDisplayValue("Select seat");
    expect(screen.getByRole("button", { name: "Revive player" })).toBeDisabled();
  });

  it("follows the first free seat and clears a chosen seat once it is taken", async () => {
    const { engine, id } = await seatPlayers();
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    await eliminateAndPick(user, "Alice");
    // Another window registers players while the director is choosing.
    await act(async () => {
      await register(engine, id, [["Dave", 1, 2]]);
    });
    await waitFor(() => expect(screen.getByLabelText("Seat")).toHaveDisplayValue("Table 2 Seat 2"));

    await user.selectOptions(screen.getByLabelText("Seat"), "Table 2 Seat 2");
    await act(async () => {
      await register(engine, id, [["Erin", 2, 2]]);
    });
    await waitFor(() => expect(screen.getByLabelText("Seat")).toHaveDisplayValue("Select seat"));
    expect(screen.getByRole("button", { name: "Revive player" })).toBeDisabled();
  });
});

describe("PlayersScreen eliminations", () => {
  async function fourPlayers() {
    const { engine, id } = await withTournament({ tables: 1, seats: 9 });
    await register(engine, id, ["Ann", "Ben", "Cat", "Dan"]);
    await engine.dispatch(id, { type: "start_clock" });
    return { engine, id };
  }

  const places = (view: View) => Object.fromEntries(view.ranking.filter((r) => !r.alive).map((r) => [r.name, [r.place, r.placeTo]]));

  it("eliminates several players in the same hand, ranked by starting stack", async () => {
    const { engine, id } = await fourPlayers();
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    await user.click(await screen.findByRole("button", { name: "Eliminated in the same hand…" }));
    expect(screen.queryByRole("button", { name: /^Eliminate Ann$/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select Ann" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Ben" }));
    await user.type(screen.getByLabelText("Starting stack Ann"), "3000");
    await user.type(screen.getByLabelText("Starting stack Ben"), "8000");
    await user.click(screen.getByRole("button", { name: "Eliminate 2 players" }));

    await waitFor(async () => expect(places(await engine.getView(id))).toEqual({ Ben: [3, null], Ann: [4, null] }));
    expect(within(row("Ben")).getByText("#3")).toBeInTheDocument();
    expect(within(row("Ben")).getByText("Eliminated")).toBeInTheDocument();
    expect(within(row("Ann")).getByText("#4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo eliminate Ann and Ben" })).toBeInTheDocument();
  });

  it("ties players eliminated in the same hand without stacks", async () => {
    const { engine, id } = await fourPlayers();
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    await user.click(await screen.findByRole("button", { name: "Eliminated in the same hand…" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Cat" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Dan" }));
    await user.click(screen.getByRole("button", { name: "Eliminate 2 players" }));

    expect(await within(row("Cat")).findByText("#3–4")).toBeInTheDocument();
    expect(within(row("Dan")).getByText("#3–4")).toBeInTheDocument();
  });

  it("explains that every stack or none is needed", async () => {
    const { engine, id } = await fourPlayers();
    const user = userEvent.setup();
    renderApp(engine, `/t/${id}/players`);

    await user.click(await screen.findByRole("button", { name: "Eliminated in the same hand…" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Ann" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Ben" }));
    await user.type(screen.getByLabelText("Starting stack Ann"), "3000");
    await user.click(screen.getByRole("button", { name: "Eliminate 2 players" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the starting stack of every player eliminated in this hand, or none of them for a tie.");
    expect((await engine.getView(id)).counts.alive).toBe(4);
    // The selection stays, to fix the stacks.
    expect(screen.getByRole("checkbox", { name: "Select Ann" })).toBeChecked();
  });

  it("offers no elimination before the start or once the tournament is finished", async () => {
    const { engine, id } = await withTournament({ tables: 1 });
    const view = await register(engine, id, ["Ann", "Ben"]);
    const { unmount } = renderApp(engine, `/t/${id}/players`);
    expect(await screen.findByRole("rowheader", { name: "Ann" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Eliminate/ })).not.toBeInTheDocument();
    unmount();

    await engine.dispatch(id, { type: "start_clock" });
    await engine.dispatch(id, { type: "close_registration" });
    await engine.dispatch(id, { type: "bust_players", busts: [{ player: playerId(view, "Ben") }] });
    renderApp(engine, `/t/${id}/players`);

    expect(await screen.findByText("Ann won the tournament.")).toBeInTheDocument();
    expect(within(row("Ann")).getByText("Winner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Eliminate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revive player" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });
});
