import { screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByLabelText("Break Mins")).toBeDisabled();
    // The level in progress stays editable but cannot be removed.
    expect(screen.getByLabelText("Level 3 BB")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove level Level 3" })).toBeDisabled();
    expect(screen.getByLabelText("Level 4 BB")).toBeEnabled();
    expect(screen.getByLabelText("Level 3 BB").closest(".level-row")).toHaveAttribute("aria-current", "step");
  });

  it("saves structure changes with UpdateStructure", async () => {
    const user = userEvent.setup();
    const { engine, id } = await runningAtLevel(3);
    renderApp(engine, `/t/${id}/levels`);

    const bigBlind = await screen.findByLabelText("Level 4 BB");
    await user.clear(bigBlind);
    await user.type(bigBlind, "800");
    await user.click(screen.getByRole("button", { name: "Add level" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(async () => {
      const view = await engine.getView(id);
      expect(view.levels).toHaveLength(6);
      expect(view.levels[4].level).toMatchObject({ type: "play", sb: 300, bb: 800 });
      expect(view.history.undo?.kind).toBe("structure_updated");
    });
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
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
    expect(screen.getByLabelText("Level 2 SB")).toHaveValue(null);
  });
});
