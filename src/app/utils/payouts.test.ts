import { describe, expect, it } from "vitest";
import { tournamentInput } from "../../test/wasm";
import { applyDraft, draftOf, sharesOf } from "./payouts";

const money = { currency: { code: "EUR", exponent: 2 }, buyIn: { prize: 10_000, fee: 0 }, roundingUnit: 100 };

describe("payout drafts", () => {
  it("round-trips every payout setting through the draft", () => {
    const configs = [
      tournamentInput({ placesPaid: 7, money }).config,
      tournamentInput({ money, payout: { placesPaid: { type: "percent", bps: 1_250 }, amounts: { type: "curve", firstShareBps: 3_500 } } }).config,
      tournamentInput({ money: { ...money, minCash: 2_000 }, payout: { amounts: { type: "custom_bps", bps: [6_000, 4_000] } } }).config,
      tournamentInput({ money, payout: { amounts: { type: "custom_amounts", amounts: [50_000, 20_000] } } }).config
    ];
    for (const config of configs) expect(applyDraft(config, draftOf(config))).toEqual(config);
  });

  it("writes a fixed count to the places paid the settings show", () => {
    const config = tournamentInput({ money, payout: { placesPaid: { type: "percent", bps: 1_000 } } }).config;
    const next = applyDraft(config, { ...draftOf(config), places: "fixed", fixed: 12 });
    expect(next.placesPaid).toBe(12);
    expect(next.payout).toEqual({});
  });

  it("turns empty fields into values the core rejects", () => {
    const config = tournamentInput({ money }).config;
    const next = applyDraft(config, { ...draftOf(config), fixed: Number.NaN, roundingUnit: Number.NaN, minCash: null });
    expect(next.placesPaid).toBe(0);
    expect(next.money).toEqual({ ...money, roundingUnit: 0, minCash: undefined });
  });

  it("starts custom shares from the payouts in force, adding up to 100%", () => {
    expect(sharesOf([50_100, 29_000, 20_900], 100_000)).toEqual([5_010, 2_900, 2_090]);
    expect(sharesOf([33_334, 33_333, 33_333], 100_000)).toEqual([3_334, 3_333, 3_333]);
    expect(sharesOf([], 0)).toEqual([5_000, 3_000, 2_000]);
  });
});
