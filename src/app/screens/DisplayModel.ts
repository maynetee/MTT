import type { Currency } from "../../bindings/Currency";
import type { Money } from "../../bindings/Money";
import type { RankingRow, View } from "../../engine/types";
import type { LocalClock } from "../hooks/useClock";

/** What the room should understand at a glance; drives the display's colors and badges. */
export type DisplayState = "setup" | "running" | "paused" | "overtime" | "finished";

export function displayState(view: View, local: LocalClock): DisplayState {
  if (view.phase === "finished") return "finished";
  if (view.phase === "setup") return "setup";
  if (!view.clock.running) return "paused";
  return local.overtimeMs > 0 ? "overtime" : "running";
}

/** An amount for the TV: currency symbol, no decimals when the amount is whole. */
export function formatMoney(locale: string, amount: Money, currency: Currency): string {
  const unit = 10 ** currency.exponent;
  const digits = amount % unit === 0 ? 0 : currency.exponent;
  const options = { minimumFractionDigits: digits, maximumFractionDigits: digits };
  try {
    return new Intl.NumberFormat(locale, { ...options, style: "currency", currency: currency.code }).format(amount / unit);
  } catch {
    // A code the runtime does not know: the number, then the code.
    return `${new Intl.NumberFormat(locale, options).format(amount / unit)} ${currency.code}`;
  }
}

export interface LadderRow {
  place: number;
  amount: Money;
  /** `next`: what the next player out wins; `min`: the first prize to reach (not in the money yet). */
  mark: "next" | "min" | null;
}

/** A place row, or the places left out between the top and the marked row. */
export type LadderEntry = LadderRow | { gap: true; from: number; to: number };

/**
 * The payouts to show, first place first, within `maxRows` rows: every place when they fit;
 * otherwise the top places, a gap, and the row that matters now (the next payout in the money,
 * the smallest prize before).
 */
export function payoutLadder(view: View, maxRows: number): LadderEntry[] {
  const payouts = view.money?.payouts ?? [];
  const { itm } = view;
  const marked =
    itm.status === "in_money"
      ? itm.nextPayout !== undefined && view.counts.alive <= payouts.length
        ? { place: view.counts.alive, mark: "next" as const }
        : null
      : payouts.length > 0
        ? { place: payouts.length, mark: "min" as const }
        : null;
  const row = (index: number): LadderRow => ({
    place: index + 1,
    amount: payouts[index],
    mark: marked?.place === index + 1 ? marked.mark : null
  });
  if (payouts.length <= maxRows) return payouts.map((_, index) => row(index));
  if (!marked || marked.place <= maxRows) return payouts.slice(0, maxRows).map((_, index) => row(index));
  const top = maxRows - 2;
  return [...payouts.slice(0, top).map((_, index) => row(index)), { gap: true, from: top + 1, to: marked.place - 1 }, row(marked.place - 1)];
}

/** The placed players, best first, as the final results list them. */
export function finalPlaces(view: View, count: number): RankingRow[] {
  return view.ranking
    .filter((row) => row.place !== null)
    .sort((a, b) => a.place! - b.place!)
    .slice(0, count);
}
