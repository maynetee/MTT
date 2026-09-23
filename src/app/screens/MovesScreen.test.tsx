import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createDemoTournament, renderApp } from "../../test/demo";
import { registerPlayerAtSeatLocal } from "../demoStore";

describe("MovesScreen manual move", () => {
  it("disables Move again when a select goes back to its placeholder", async () => {
    createDemoTournament(2, 2);
    registerPlayerAtSeatLocal("Bob", 1, 1);
    const user = userEvent.setup();
    renderApp("/moves");

    await screen.findByRole("option", { name: "Bob" });
    const move = screen.getByRole("button", { name: "Move" });
    await user.selectOptions(screen.getByLabelText("Player"), "Bob");
    await user.selectOptions(screen.getByLabelText("Seat"), "Table 2 Seat 1");
    expect(move).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("Player"), "Select player");
    expect(move).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Player"), "Bob");
    await user.selectOptions(screen.getByLabelText("Seat"), "Select seat");
    expect(move).toBeDisabled();
  });
});
