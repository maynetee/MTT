import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import SetupScreen from "./SetupScreen";

describe("SetupScreen", () => {
  it("keeps focus in the level label while typing", async () => {
    const user = userEvent.setup();
    render(<SetupScreen />);

    await user.type(screen.getByDisplayValue("Level 1"), "AB");

    expect(screen.getByDisplayValue("Level 1AB")).toHaveFocus();
  });
});
