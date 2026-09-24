import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider, type Locale } from "../../i18n";
import { MoneyInput } from "./MoneyInput";

const EUR = { code: "EUR", exponent: 2 };

function Controlled({ initial, onValue }: { initial: number | null; onValue(value: number | null): void }) {
  const [value, setValue] = useState(initial);
  return (
    <MoneyInput
      aria-label="Buy-in"
      currency={EUR}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

function renderIn(locale: Locale, initial: number | null, onValue = vi.fn()) {
  return render(
    <I18nProvider locale={locale}>
      <Controlled initial={initial} onValue={onValue} />
    </I18nProvider>
  );
}

describe("MoneyInput", () => {
  it("shows cents with the language's decimal separator", () => {
    renderIn("en", 1250);
    expect(screen.getByRole("textbox", { name: "Buy-in" })).toHaveValue("12.50");
  });

  it("takes a dot or a comma in French and hands over cents", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    renderIn("fr", 1250, onValue);
    const input = screen.getByRole("textbox", { name: "Buy-in" });
    expect(input).toHaveValue("12,50");

    await user.clear(input);
    await user.type(input, "7.5");
    expect(input).toHaveValue("7,5");
    expect(onValue).toHaveBeenLastCalledWith(750);

    await user.tab();
    expect(input).toHaveValue("7,50");
  });
});
