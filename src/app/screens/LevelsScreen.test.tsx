import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { register, renderApp, withTournament } from "../../test/app";

async function runningAtLevel(index: number) {
  const { engine, id } = await withTournament();
  await register(engine, id, ["Ann", "Ben"]);
  await engine.dispatch(id, { type: "start_clock" });
  await engine.dispatch(id, { type: "jump_to", level: index });
  return { engine, id };
}

describe("LevelsScreen", () => {
  it("locks the levels already played while the tournament runs", async () => {
    const { engine, id } = await runningAtLevel(3);
    renderApp(engine, `/t/${id}/levels`);

    expect(await screen.findByLabelText("Level 1 SB")).toBeDisabled();
    expect(screen.getByLabelText("Level 2 BB")).toBeDisabled();
    expect(screen.getByLabelText("Break Minutes")).toBeDisabled();
    // The level in progress stays editable but cannot be removed.
    expect(screen.getByLabelText("Level 3 BB")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove level Level 3" })).toBeDisabled();
    expect(screen.getByLabelText("Level 4 BB")).toBeEnabled();
    expect(screen.getByLabelText("Level 3 BB").closest(".level-row")).toHaveAttribute("aria-current", "step");
  });

  it("saves structure changes with UpdateStructure, after confirmation during play", async () => {
    const user = userEvent.setup();
    const { engine, id } = await runningAtLevel(3);
    renderApp(engine, `/t/${id}/levels`);

    const bigBlind = await screen.findByLabelText("Level 4 BB");
    await user.clear(bigBlind);
    await user.type(bigBlind, "800");
    await user.click(screen.getByRole("button", { name: "Add level" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // The clock is running: the change is confirmed first, and Cancel keeps the draft.
    const dialog = screen.getByRole("alertdialog", { name: "Change the structure during play?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect((await engine.getView(id)).levels).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Save changes" }));

    await waitFor(async () => {
      const view = await engine.getView(id);
      expect(view.levels).toHaveLength(6);
      expect(view.levels[4].level).toMatchObject({ type: "play", sb: 300, bb: 800 });
      expect(view.history.undo?.kind).toBe("structure_updated");
    });
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByText("Structure saved")).toBeInTheDocument();
  });

  it("saves without confirmation before the start", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    renderApp(engine, `/t/${id}/levels`);

    await user.click(await screen.findByRole("button", { name: "Add break" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(async () => expect((await engine.getView(id)).levels).toHaveLength(6));
  });

  it("highlights the row the core rejects and keeps the draft", async () => {
    const user = userEvent.setup();
    const { engine, id } = await withTournament();
    renderApp(engine, `/t/${id}/levels`);

    const smallBlind = await screen.findByLabelText("Level 2 SB");
    await user.clear(smallBlind);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Row 2: the small blind must be more than 0");
    expect(screen.getByLabelText("Level 2 SB").closest(".level-row")).toHaveClass("invalid");
    expect(screen.getByLabelText("Level 2 SB")).toHaveValue("");
  });
});
