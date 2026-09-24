import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Field } from "./Field";
import { NumberInput } from "./NumberInput";

function Controlled({ initial, onValue = () => {}, ...props }: { initial: number | null; onValue?: (value: number | null) => void; allowDecimal?: boolean; min?: number; max?: number }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <Field label="Big blind">
      <NumberInput
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue(next);
        }}
        {...props}
      />
    </Field>
  );
}

describe("NumberInput", () => {
  it("shows large values in full and is labelled by its field", () => {
    render(<Controlled initial={10_000} />);
    const input = screen.getByRole("spinbutton", { name: "Big blind" });
    expect(input).toHaveValue("10000");
    expect(input).toHaveAttribute("aria-valuenow", "10000");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("can be empty while typing, then takes the new value", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Controlled initial={100} onValue={onValue} />);
    const input = screen.getByRole("spinbutton", { name: "Big blind" });

    await user.clear(input);
    expect(input).toHaveValue("");
    expect(onValue).toHaveBeenLastCalledWith(null);

    await user.type(input, "1000");
    expect(input).toHaveValue("1000");
    expect(onValue).toHaveBeenLastCalledWith(1000);
  });

  it("keeps a decimal point while typing when decimals are allowed", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Controlled initial={null} onValue={onValue} allowDecimal />);
    const input = screen.getByRole("spinbutton", { name: "Big blind" });

    await user.type(input, "12.");
    expect(input).toHaveValue("12.");
    await user.type(input, "5");
    expect(onValue).toHaveBeenLastCalledWith(12.5);
  });

  it("ignores letters and signs", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={null} />);
    const input = screen.getByRole("spinbutton", { name: "Big blind" });

    await user.type(input, "-2e5x0");
    expect(input).toHaveValue("250");
  });

  it("steps with the arrow keys, within bounds", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={2} min={1} max={12} />);
    const input = screen.getByRole("spinbutton", { name: "Big blind" });

    await user.type(input, "{ArrowUp}{ArrowUp}");
    expect(input).toHaveValue("4");
    await user.type(input, "{Shift>}{ArrowUp}{/Shift}");
    expect(input).toHaveValue("12");
    await user.type(input, "{Shift>}{ArrowDown}{/Shift}");
    expect(input).toHaveValue("2");
    await user.type(input, "{ArrowDown}{ArrowDown}");
    expect(input).toHaveValue("1");
  });

  it("follows a value changed elsewhere", () => {
    const { rerender } = render(<NumberInput aria-label="Seats" value={9} onChange={() => {}} />);
    expect(screen.getByRole("spinbutton", { name: "Seats" })).toHaveValue("9");
    rerender(<NumberInput aria-label="Seats" value={6} onChange={() => {}} />);
    expect(screen.getByRole("spinbutton", { name: "Seats" })).toHaveValue("6");
    rerender(<NumberInput aria-label="Seats" value={Number.NaN} onChange={() => {}} />);
    expect(screen.getByRole("spinbutton", { name: "Seats" })).toHaveValue("");
  });
});
