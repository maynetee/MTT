import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { MAX_VISIBLE_TOASTS, TOAST_DURATION_MS, TOAST_LONG_DURATION_MS, ToastProvider, useToast, type Toaster } from "./Toast";

let toaster: Toaster;

function Capture() {
  toaster = useToast();
  return null;
}

function renderToasts() {
  render(
    <I18nProvider>
      <ToastProvider>
        <Capture />
      </ToastProvider>
    </I18nProvider>
  );
}

describe("Toast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces toasts in a polite live region, errors as alerts", () => {
    renderToasts();
    act(() => {
      toaster.show({ message: "Settings saved" });
      toaster.error("Seat 7 at table 2 is taken.");
    });

    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region.querySelector("[aria-live='polite']")).toHaveTextContent("Settings saved");
    expect(screen.getByRole("alert")).toHaveTextContent("Seat 7 at table 2 is taken.");
  });

  it("runs the action once and goes away", () => {
    renderToasts();
    const undo = vi.fn();
    act(() => {
      toaster.show({ message: "Ann eliminated", action: { label: "Undo", onAction: undo } });
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Ann eliminated")).not.toBeInTheDocument();
  });

  it("dismisses itself after a while, later when it has an action", () => {
    vi.useFakeTimers();
    renderToasts();
    act(() => {
      toaster.success("Settings saved");
      toaster.show({ message: "Ann eliminated", action: { label: "Undo", onAction: () => {} } });
    });

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(screen.getByText("Settings saved")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Settings saved")).not.toBeInTheDocument();
    expect(screen.getByText("Ann eliminated")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(TOAST_LONG_DURATION_MS - TOAST_DURATION_MS));
    expect(screen.queryByText("Ann eliminated")).not.toBeInTheDocument();
  });

  it("pauses while hovered", () => {
    vi.useFakeTimers();
    renderToasts();
    act(() => {
      toaster.show({ message: "Registration closed" });
    });
    const toast = screen.getByText("Registration closed").closest("li")!;

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1_000));
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 3));
    expect(screen.getByText("Registration closed")).toBeInTheDocument();

    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByText("Registration closed")).not.toBeInTheDocument();
  });

  it("queues toasts beyond the visible limit", () => {
    vi.useFakeTimers();
    renderToasts();
    act(() => {
      for (let i = 1; i <= MAX_VISIBLE_TOASTS + 1; i++) toaster.show({ message: `Toast ${i}`, duration: null });
    });
    expect(screen.queryByText(`Toast ${MAX_VISIBLE_TOASTS + 1}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss notification" })[0]);
    expect(screen.queryByText("Toast 1")).not.toBeInTheDocument();
    expect(screen.getByText(`Toast ${MAX_VISIBLE_TOASTS + 1}`)).toBeInTheDocument();
  });
});
