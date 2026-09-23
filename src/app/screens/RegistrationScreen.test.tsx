import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createDemoTournament, renderApp } from "../../test/demo";
import { closeTableLocal, eliminatePlayerLocal, getStateLocal, registerPlayerLocal } from "../demoStore";

describe("RegistrationScreen", () => {
  it("shows the empty seats at open tables as seats left", async () => {
    createDemoTournament(2, 3);
    registerPlayerLocal("Alice", "balanced");
    registerPlayerLocal("Bob", "balanced");
    registerPlayerLocal("Carol", "balanced");
    const alice = getStateLocal().players.find((player) => player.name === "Alice")!;
    eliminatePlayerLocal(alice.id);
    closeTableLocal(1);

    renderApp("/");

    const label = await screen.findByText("Seats left");
    expect(label.previousElementSibling).toHaveTextContent(/^1$/);
  });

  it("shows a failed registration in the error banner", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    createDemoTournament(2, 3);
    registerPlayerLocal("Alice", "balanced");
    const user = userEvent.setup();

    renderApp("/");
    await user.type(await screen.findByPlaceholderText("Player name"), "Alice{Enter}");

    expect(await screen.findAllByText("Error: This player name already exists")).toHaveLength(1);
  });
});
