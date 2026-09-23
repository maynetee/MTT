import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "./App";

function renderApp() {
  return render(
    <HashRouter>
      <App />
    </HashRouter>
  );
}

describe("App", () => {
  it("opens on the setup form when no tournament exists", async () => {
    renderApp();
    expect(await screen.findByText("Setup Tournament")).toBeInTheDocument();
    expect(screen.getByText("DEMO")).toBeInTheDocument();
  });

  it("ignores the undo shortcut while typing in a field", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole("button", { name: "Create Tournament" }));
    const nameInput = await screen.findByPlaceholderText("Player name");
    await user.type(nameInput, "Alice{Enter}");
    const playerRow = { selector: ".list-row span" };
    expect(await screen.findByText("Alice", playerRow)).toBeInTheDocument();

    await user.type(nameInput, "Bo");
    await user.keyboard("{Meta>}z{/Meta}");
    expect(screen.getByText("Alice", playerRow)).toBeInTheDocument();

    await user.click(document.body);
    expect(document.body).toHaveFocus();
    await user.keyboard("{Meta>}z{/Meta}");
    await waitFor(() => expect(screen.queryByText("Alice", playerRow)).not.toBeInTheDocument());
  });
});
