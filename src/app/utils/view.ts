import type { SeatRef, View } from "../../engine/types";

/** Empty seats at open tables, by table then seat. */
export function freeSeatsAtOpenTables(view: View): SeatRef[] {
  return view.tables
    .filter((table) => table.status === "open")
    .flatMap((table) => table.seats.filter((seat) => seat.player === null).map((seat) => ({ table: table.table, seat: seat.seat })));
}

/** Empty seats a player can be moved to: open tables, then tables not opened yet. */
export function freeSeats(view: View): SeatRef[] {
  const open = freeSeatsAtOpenTables(view);
  const idle = view.tables
    .filter((table) => table.status === "idle")
    .flatMap((table) => table.seats.map((seat) => ({ table: table.table, seat: seat.seat })));
  return [...open, ...idle];
}

/** Seats still available for registration: every empty seat at a table that is not closed. */
export function seatsLeft(view: View): number {
  return view.tables
    .filter((table) => table.status !== "closed")
    .reduce((sum, table) => sum + table.seats.filter((seat) => seat.player === null).length, 0);
}

export function playerNames(view: View): (player: number) => string | undefined {
  const names = new Map(view.ranking.map((row) => [row.player, row.name]));
  return (player) => names.get(player);
}

export const seatKey = (seat: SeatRef) => `${seat.table}:${seat.seat}`;

export interface SeatChange {
  player: number;
  name: string;
  from: SeatRef;
  to: SeatRef;
}

/** Players who changed seats between two views. */
export function seatChanges(before: View, after: View): SeatChange[] {
  const previous = new Map(before.ranking.filter((row) => row.seat).map((row) => [row.player, row.seat!]));
  return after.ranking
    .filter((row) => row.seat && previous.has(row.player) && seatKey(previous.get(row.player)!) !== seatKey(row.seat))
    .map((row) => ({ player: row.player, name: row.name, from: previous.get(row.player)!, to: row.seat! }))
    .sort((a, b) => a.to.table - b.to.table || a.to.seat - b.to.seat);
}
