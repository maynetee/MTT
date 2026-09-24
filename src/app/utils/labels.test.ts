import { describe, expect, it } from "vitest";
import { i18n } from "../../i18n";
import { formatPlace } from "./labels";

describe("formatPlace", () => {
  it("numbers a place, a tie, or nothing while in play", () => {
    expect(formatPlace(i18n, { place: 3, placeTo: null })).toBe("#3");
    expect(formatPlace(i18n, { place: 3, placeTo: 4 })).toBe("#3–4");
    expect(formatPlace(i18n, { place: null, placeTo: null })).toBe("—");
  });
});
