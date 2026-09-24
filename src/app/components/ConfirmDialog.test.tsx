import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";

function renderDialog(props: Partial<ConfirmDialogProps> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <I18nProvider>
      <ConfirmDialog
        open
        title="Break table 2?"
        message="Its players are redrawn."
        confirmLabel="Break table 2"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />
    </I18nProvider>
  );
  return { onConfirm, onCancel, dialog: screen.getByRole("alertdialog", { name: "Break table 2?" }) };
}

describe("ConfirmDialog", () => {
  it("confirms or cancels", async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel, dialog } = renderDialog();
    expect(dialog).toHaveAccessibleDescription("Its players are redrawn.");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "Break table 2" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("starts on Cancel for a destructive action, and Escape cancels", async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm, dialog } = renderDialog({ tone: "danger" });

    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("waits for the name to be typed before a destructive confirm", async () => {
    const user = userEvent.setup();
    const { onConfirm, dialog } = renderDialog({ tone: "danger", confirmText: "Sunday Major", confirmLabel: "Delete tournament" });
    const confirm = within(dialog).getByRole("button", { name: "Delete tournament" });
    const input = within(dialog).getByLabelText("Type “Sunday Major” to confirm");
    expect(input).toHaveFocus();
    expect(confirm).toBeDisabled();

    await user.type(input, "Sunday Majo");
    expect(confirm).toBeDisabled();
    await user.type(input, "r{Enter}");
    expect(confirm).toBeEnabled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows progress while the confirmed action runs", async () => {
    const user = userEvent.setup();
    let finish = () => {};
    const { dialog } = renderDialog({ onConfirm: () => new Promise<void>((resolve) => (finish = resolve)) });
    const confirm = within(dialog).getByRole("button", { name: "Break table 2" });

    await user.click(confirm);
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm).toBeDisabled();
    finish();
    await vi.waitFor(() => expect(confirm).not.toHaveAttribute("aria-busy"));
  });
});
