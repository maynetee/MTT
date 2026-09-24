import type { Config, RankingRow, View } from "../../engine/types";
import type { PayoutConfig } from "../../bindings/PayoutConfig";
import { shareBps } from "./money";

/** 100 % in basis points. */
export const BPS = 10_000;
/** Most players the core's ICM calculation takes (`ICM_TOO_MANY_PLAYERS` beyond). */
export const MAX_DEAL_PLAYERS = 20;

/** Whether the tournament pays prizes: on unless turned off (`payouts` is only written when false). */
export function paysPrizes(config: Config): boolean {
  return config.payouts !== false;
}

/** Whether the Deal tab is offered: prizes paid, money tracked, and a deal recorded or 2 to 20 players left in play. */
export function dealAvailable(view: View): boolean {
  if (!view.money || !paysPrizes(view.config)) return false;
  if (view.money.deal) return true;
  return view.phase === "running" && view.counts.alive >= 2 && view.counts.alive <= MAX_DEAL_PLAYERS;
}

export type PlacesMode = "fixed" | "percent";
export type SplitMode = "curve" | "custom_bps" | "custom_amounts";

/**
 * The payout settings as the Payouts tab edits them. Numbers are NaN while a field is empty
 * so the core rejects them with a clear message.
 */
export interface PayoutDraft {
  places: PlacesMode;
  fixed: number;
  /** Share of the entries paid, in basis points. */
  percentBps: number;
  split: SplitMode;
  /** First place's share on the curve; null for the default share. */
  firstShareBps: number | null;
  /** Custom share of each place, in basis points. */
  bps: number[];
  /** Custom amount of each place, in minor units. */
  amounts: number[];
  roundingUnit: number;
  minCash: number | null;
}

const DEFAULT_PERCENT_BPS = 1_500;
const DEFAULT_BPS = [5_000, 3_000, 2_000];

export function draftOf(config: Config): PayoutDraft {
  const { placesPaid, amounts } = config.payout;
  return {
    places: placesPaid?.type === "percent" ? "percent" : "fixed",
    fixed: placesPaid?.type === "fixed" ? placesPaid.n : config.placesPaid,
    percentBps: placesPaid?.type === "percent" ? placesPaid.bps : DEFAULT_PERCENT_BPS,
    split: amounts?.type ?? "curve",
    firstShareBps: amounts?.type === "curve" ? (amounts.firstShareBps ?? null) : null,
    bps: amounts?.type === "custom_bps" ? amounts.bps : DEFAULT_BPS,
    amounts: amounts?.type === "custom_amounts" ? amounts.amounts : [],
    roundingUnit: config.money?.roundingUnit ?? 1,
    minCash: config.money?.minCash ?? null
  };
}

/** Fits a number into the core's integer range; NaN (empty) becomes 0, which the core rejects. */
function fit(value: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), max) : 0;
}

/**
 * The configuration with the draft's payout settings. A fixed count goes to
 * `Config.placesPaid` (the field the settings screen shows); a share of the entries to
 * `payout.placesPaid`.
 */
export function applyDraft(config: Config, draft: PayoutDraft): Config {
  const payout: PayoutConfig = {};
  if (draft.places === "percent") payout.placesPaid = { type: "percent", bps: fit(draft.percentBps, 65_535) };
  if (draft.split === "curve" && draft.firstShareBps !== null) payout.amounts = { type: "curve", firstShareBps: fit(draft.firstShareBps, 65_535) };
  if (draft.split === "custom_bps") payout.amounts = { type: "custom_bps", bps: draft.bps.map((bps) => fit(bps, 65_535)) };
  if (draft.split === "custom_amounts") {
    payout.amounts = { type: "custom_amounts", amounts: draft.amounts.map((amount) => fit(amount, Number.MAX_SAFE_INTEGER)) };
  }
  const minCash = draft.minCash === null || Number.isNaN(draft.minCash) ? undefined : fit(draft.minCash, Number.MAX_SAFE_INTEGER);
  return {
    ...config,
    placesPaid: draft.places === "fixed" ? fit(draft.fixed, 65_535) : config.placesPaid,
    payout,
    money: config.money && { ...config.money, roundingUnit: fit(draft.roundingUnit, Number.MAX_SAFE_INTEGER), minCash }
  };
}

/**
 * Custom shares to start from: those of the payouts in force (adding up to 100 %, first place
 * taking the rounding), or 50/30/20 before any entry.
 */
export function sharesOf(payouts: readonly number[], pool: number): number[] {
  if (payouts.length === 0 || pool <= 0) return DEFAULT_BPS;
  const shares = payouts.map((amount) => Math.max(1, shareBps(amount, pool)));
  shares[0] += BPS - shares.reduce((sum, share) => sum + share, 0);
  return shares[0] > 0 ? shares : DEFAULT_BPS;
}

/** First place's share of the pool in the payouts in force, for the curve slider. */
export function firstShareOf(view: View): number | null {
  const money = view.money;
  if (!money || money.payouts.length === 0 || money.effectivePool <= 0) return null;
  return shareBps(money.payouts[0], money.effectivePool);
}

export interface LadderRow {
  place: number;
  amount: number;
  /** Share of the effective pool, in basis points. */
  share: number;
  /** Players who finished at this place (several for a tie), or who hold it by a deal. */
  players: RankingRow[];
  /** Covered by a recorded deal. */
  deal: boolean;
}

/** Place, amount and share of every paid place, with the players who finished there. */
export function ladder(view: View): LadderRow[] {
  const money = view.money;
  if (!money) return [];
  const dealPlaces = money.deal?.amounts.length ?? 0;
  return money.payouts.map((amount, index) => {
    const place = index + 1;
    const players = view.ranking.filter((row) => row.place !== null && row.place <= place && place <= (row.placeTo ?? row.place));
    return { place, amount, share: shareBps(amount, money.effectivePool), players, deal: place <= dealPlaces };
  });
}
