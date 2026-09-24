import { describe, expect, it } from "vitest";
import type { Itm, View } from "../../engine/types";
import { formatMoney, payoutLadder } from "./DisplayModel";

describe("formatMoney", () => {
  const eur = { code: "EUR", exponent: 2 };

  it("drops the cents of a whole amount and keeps them otherwise", () => {
    expect(formatMoney("en", 1_680_000, eur)).toBe("€16,800");
    expect(formatMoney("en", 1_234_550, eur)).toBe("€12,345.50");
  });

  it("follows the currency's minor unit", () => {
    expect(formatMoney("en", 50_000, { code: "JPY", exponent: 0 })).toBe("¥50,000");
  });

  it("falls back to the code for a currency the runtime does not know", () => {
    expect(formatMoney("en", 12_300, { code: "ZZZ", exponent: 2 })).toMatch(/^(ZZZ\s?123|123 ZZZ)$/);
  });
});

/** Just what the ladder reads: payouts, players in play, ITM status. */
function view(payouts: number[], alive: number, itm: Itm): View {
  return { money: { payouts }, counts: { alive }, itm } as unknown as View;
}

const rows = (entries: ReturnType<typeof payoutLadder>) =>
  entries.map((entry) => ("gap" in entry ? `…${entry.from}-${entry.to}` : `${entry.place}${entry.mark ? ` ${entry.mark}` : ""}`));

describe("payoutLadder", () => {
  const twelve = Array.from({ length: 12 }, (_, index) => 1_000 - index * 50);

  it("lists every place when they fit, marking the smallest prize before the money", () => {
    expect(rows(payoutLadder(view([300, 200, 100], 9, { status: "not_yet", toMoney: 6 }), 8))).toEqual(["1", "2", "3 min"]);
    expect(rows(payoutLadder(view([300, 200, 100], 4, { status: "bubble" }), 8))).toEqual(["1", "2", "3 min"]);
  });

  it("marks what the next player out wins once in the money", () => {
    expect(rows(payoutLadder(view([300, 200, 100], 2, { status: "in_money", nextPayout: 200 }), 8))).toEqual(["1", "2 next", "3"]);
    // After a deal there is no next payout to point at.
    expect(rows(payoutLadder(view([300, 200, 100], 2, { status: "in_money" }), 8))).toEqual(["1", "2", "3"]);
  });

  it("keeps the top places and the marked row when the places do not fit", () => {
    expect(rows(payoutLadder(view(twelve, 30, { status: "not_yet", toMoney: 18 }), 8))).toEqual(["1", "2", "3", "4", "5", "6", "…7-11", "12 min"]);
    expect(rows(payoutLadder(view(twelve, 10, { status: "in_money", nextPayout: 550 }), 8))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "…7-9",
      "10 next"
    ]);
    // The marked place among the top rows: no gap needed.
    expect(rows(payoutLadder(view(twelve, 5, { status: "in_money", nextPayout: 800 }), 8))).toEqual(["1", "2", "3", "4", "5 next", "6", "7", "8"]);
  });
});
