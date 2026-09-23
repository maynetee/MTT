import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createDemoTournament, renderApp } from "../../test/demo";
import { getStateLocal, registerPlayerAtSeatLocal } from "../demoStore";

type User = ReturnType<typeof userEvent.setup>;

// Table 1 Seat 1 stays taken, so the old hard-coded revive seat is never free.
function seatPlayers() {
  createDemoTournament(2, 2);
  registerPlayerAtSeatLocal("Bob", 1, 1);
  registerPlayerAtSeatLocal("Alice", 1, 2);
  registerPlayerAtSeatLocal("Carol", 2, 1);
}

async function eliminateAndPick(user: User, name: string) {
  const row = (await screen.findByText(name)).closest(".list-row") as HTMLElement;
  await user.click(within(row).getByRole("button", { name: "Eliminate" }));
  await screen.findByRole("option", { name });
  await user.selectOptions(screen.getByLabelText("Player"), name);
}

describe("PlayersScreen revive", () => {
  it("revives an eliminated player at the first free seat by default", async () => {
    seatPlayers();
    const user = userEvent.setup();
    renderApp("/players");

    await eliminateAndPick(user, "Alice");
    expect(screen.getByLabelText("Seat")).toHaveDisplayValue("Table 1 Seat 2");
    await user.click(screen.getByRole("button", { name: "Revive Player" }));

    await waitFor(() => {
      const state = getStateLocal();
      const alice = state.players.find((player) => player.name === "Alice")!;
      expect(alice.status).toBe("active");
      expect(state.seats.find((seat) => seat.playerId === alice.id)).toMatchObject({ tableId: 1, seatNo: 2 });
    });
    expect(screen.queryByText(/Seat is not available/)).not.toBeInTheDocument();
  });

  it("keeps Revive disabled while no seat is selected", async () => {
    seatPlayers();
    const user = userEvent.setup();
    renderApp("/players");

    await eliminateAndPick(user, "Alice");
    await user.selectOptions(screen.getByLabelText("Seat"), "Select seat");

    expect(screen.getByLabelText("Seat")).toHaveDisplayValue("Select seat");
    expect(screen.getByRole("button", { name: "Revive Player" })).toBeDisabled();
  });

  it("follows the first free seat and clears a chosen seat once it is taken", async () => {
    seatPlayers();
    const user = userEvent.setup();
    renderApp("/players");

    await eliminateAndPick(user, "Alice");
    await act(async () => registerPlayerAtSeatLocal("Dave", 1, 2));
    expect(screen.getByLabelText("Seat")).toHaveDisplayValue("Table 2 Seat 2");

    await user.selectOptions(screen.getByLabelText("Seat"), "Table 2 Seat 2");
    await act(async () => registerPlayerAtSeatLocal("Erin", 2, 2));
    expect(screen.getByLabelText("Seat")).toHaveDisplayValue("Select seat");
    expect(screen.getByRole("button", { name: "Revive Player" })).toBeDisabled();
  });
});
