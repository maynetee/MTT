import { describe, expect, it } from "vitest";
import { moneyStatus } from "./tournament";

describe("moneyStatus", () => {
  it("counts the eliminations left before every remaining player is paid", () => {
    expect(moneyStatus(20, 9)).toEqual({ kind: "away", text: "11 eliminations to the money" });
    expect(moneyStatus(11, 9)).toEqual({ kind: "away", text: "2 eliminations to the money" });
  });

  it("announces the bubble when one elimination is left", () => {
    expect(moneyStatus(10, 9)).toEqual({ kind: "bubble", text: "Bubble!" });
  });

  it("reports the money once the remaining players are all paid", () => {
    expect(moneyStatus(9, 9)).toEqual({ kind: "itm", text: "In the money" });
    expect(moneyStatus(3, 9)).toEqual({ kind: "itm", text: "In the money" });
  });
});
