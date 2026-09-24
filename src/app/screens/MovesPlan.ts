import type { BalanceStep, TableView, View } from "../../engine/types";

/** One thing the floor has to do, with the numbers that explain why. */
export type TodoItem =
  | { kind: "finalTable"; table: number; alive: number; size: number }
  | { kind: "breakTable"; table: number; players: number; alive: number; remaining: number; seats: number }
  | { kind: "button"; table: number }
  | { kind: "balance"; step: BalanceStep; fromCount: number; toCount: number; trigger: number };

export const openTables = (view: View): TableView[] => view.tables.filter((table) => table.status === "open");

export function finalTableSize(view: View): number {
  return view.config.finalTableSize ?? view.config.seatsPerTable;
}

/**
 * The last open table while play runs without a known button: its blinds are unknown until the
 * director sets it (after the final table draw, the high card takes it).
 */
export function tableWithoutButton(view: View): TableView | null {
  if (view.phase !== "running") return null;
  const open = openTables(view);
  if (open.length !== 1) return null;
  const [table] = open;
  return table.button === null && table.players >= 2 ? table : null;
}

/**
 * What to do now, highest priority first: the core suggests one kind at a time (final table,
 * then a table break, then balancing moves), and the last table needs a button to know its blinds.
 */
export function todoList(view: View): TodoItem[] {
  const { suggestions } = view;
  const alive = view.counts.alive;
  if (suggestions.finalTable !== null) {
    return [{ kind: "finalTable", table: suggestions.finalTable, alive, size: finalTableSize(view) }];
  }
  const items: TodoItem[] = [];
  const last = tableWithoutButton(view);
  if (last) items.push({ kind: "button", table: last.table });
  if (suggestions.breakTable !== null) {
    const table = view.tables.find((candidate) => candidate.table === suggestions.breakTable);
    items.push({
      kind: "breakTable",
      table: suggestions.breakTable,
      players: table?.players ?? 0,
      alive,
      remaining: openTables(view).length - 1,
      seats: view.config.seatsPerTable
    });
  }
  // Each step is planned after the previous ones: replay them to explain each with its counts.
  const counts = new Map(openTables(view).map((table) => [table.table, table.players]));
  for (const step of suggestions.balance) {
    const fromCount = counts.get(step.fromTable) ?? 0;
    const toCount = counts.get(step.toTable) ?? 0;
    counts.set(step.fromTable, fromCount - 1);
    counts.set(step.toTable, toCount + 1);
    items.push({ kind: "balance", step, fromCount, toCount, trigger: view.config.balanceTrigger });
  }
  return items;
}

/** A balancing step whose player and seats are all known. */
export function isResolved(step: BalanceStep): step is BalanceStep & { player: number; fromSeat: number; toSeat: number } {
  return step.player !== null && step.fromSeat !== null && step.toSeat !== null;
}

/** Why a table card stands out on the seating screen. */
export interface TableAttention {
  /** Players the balancing plan takes from this table. */
  outgoing: number;
  /** Players the balancing plan brings to this table. */
  incoming: number;
  breakNext: boolean;
  finalTable: boolean;
  /** The plan (or the next hand's blinds) waits for this table's button. */
  needsButton: boolean;
}

export function tableAttention(view: View): Map<number, TableAttention> {
  const attention = new Map<number, TableAttention>();
  const entry = (table: number) => {
    let found = attention.get(table);
    if (!found) {
      found = { outgoing: 0, incoming: 0, breakNext: false, finalTable: false, needsButton: false };
      attention.set(table, found);
    }
    return found;
  };
  const { suggestions } = view;
  if (suggestions.finalTable !== null) entry(suggestions.finalTable).finalTable = true;
  if (suggestions.breakTable !== null) entry(suggestions.breakTable).breakNext = true;
  for (const step of suggestions.balance) {
    entry(step.fromTable).outgoing += 1;
    entry(step.toTable).incoming += 1;
    for (const table of step.needsButton) entry(table).needsButton = true;
  }
  const last = tableWithoutButton(view);
  if (last) entry(last.table).needsButton = true;
  return attention;
}
