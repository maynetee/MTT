import { render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("opens on the setup form when no tournament exists", async () => {
    render(
      <HashRouter>
        <App />
      </HashRouter>
    );
    expect(await screen.findByText("Setup Tournament")).toBeInTheDocument();
    expect(screen.getByText("DEMO")).toBeInTheDocument();
  });
});
