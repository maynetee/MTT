import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { Modal } from "./Modal";

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <I18nProvider>
      <button onClick={() => setOpen(true)}>Open</button>
      <button>Outside</button>
      <Modal
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Seat changes"
        description="Announce them to the players."
        footer={<button onClick={() => setOpen(false)}>Done</button>}
      >
        <input aria-label="First field" />
        <input aria-label="Second field" />
      </Modal>
    </I18nProvider>
  );
}

describe("Modal", () => {
  it("is a labelled modal dialog that focuses its content", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    const dialog = screen.getByRole("dialog", { name: "Seat changes" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Announce them to the players.");
    expect(screen.getByLabelText("First field")).toHaveFocus();
  });

  it("keeps focus inside with Tab and Shift+Tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    await user.tab();
    expect(screen.getByLabelText("Second field")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    // Past the last element, back to the first (the close button).
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Outside", hidden: true })).not.toHaveFocus();
  });

  it("closes on Escape and gives focus back to the opener", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes with the close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
