import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Engine } from "../../engine/types";
import { Providers, renderApp, withTournament } from "../../test/app";
import { createTestEngine } from "../../test/wasm";
import { DEMO_BANNER_DISMISSED_KEY, DemoBanner } from "./DemoBanner";

const notice = "Browser demo — tournaments are saved in this browser only.";

function show(engine: Engine) {
  return render(
    <Providers engine={engine}>
      <DemoBanner />
    </Providers>
  );
}

describe("DemoBanner", () => {
  it("tells browser visitors where their tournaments are kept and links to the desktop app", () => {
    show(createTestEngine());

    expect(screen.getByRole("note")).toHaveTextContent(notice);
    const link = screen.getByRole("link", { name: "Download the desktop app" });
    expect(link).toHaveAttribute("href", "https://github.com/maynetee/MTT/releases/latest");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("stays hidden once dismissed, across page loads", async () => {
    const user = userEvent.setup();
    const engine = createTestEngine();
    const first = show(engine);

    await user.click(screen.getByRole("button", { name: "Dismiss the demo notice" }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(DEMO_BANNER_DISMISSED_KEY)).not.toBeNull();

    first.unmount();
    show(engine);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("is not shown in the desktop app", () => {
    show({ kind: "tauri" } as Engine);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows above the director's pages but not on the public display", async () => {
    const { engine, id } = await withTournament();
    const list = renderApp(engine, "/");
    expect(await screen.findByText(notice)).toBeInTheDocument();
    list.unmount();

    renderApp(engine, `/display/${id}`);
    expect(await screen.findByText("Test event")).toBeInTheDocument();
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
  });
});
