import type { StateSnapshot } from "../types";

export interface FreeSeat {
  seatId: number;
  tableNo: number;
  seatNo: number;
}

type SeatingState = Pick<StateSnapshot, "tables" | "seats">;

// Empty seats at open tables, sorted by table number then seat number.
export function freeSeatsAtOpenTables(state: SeatingState): FreeSeat[] {
  const openTableNos = new Map(state.tables.filter((table) => !table.isClosed).map((table) => [table.id, table.tableNo]));
  return state.seats
    .filter((seat) => seat.playerId === null && openTableNos.has(seat.tableId))
    .map((seat) => ({ seatId: seat.id, tableNo: openTableNos.get(seat.tableId) ?? 0, seatNo: seat.seatNo }))
    .sort((a, b) => (a.tableNo === b.tableNo ? a.seatNo - b.seatNo : a.tableNo - b.tableNo));
}

export function openSeatsLeft(state: SeatingState): number {
  return freeSeatsAtOpenTables(state).length;
}
