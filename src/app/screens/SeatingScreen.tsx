import { closeTable } from "../api";
import type { StateSnapshot } from "../types";

function tableStatus(state: StateSnapshot, tableId: number) {
  const table = state.tables.find((t) => t.id === tableId);
  if (!table || table.isClosed) return "Closed";
  const counts = state.tables
    .filter((t) => !t.isClosed)
    .map((t) => state.seats.filter((s) => s.tableId === t.id && s.playerId).length);
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);
  if (maxCount - minCount <= 1) return "Balanced";
  const tableCount = state.seats.filter((s) => s.tableId === tableId && s.playerId).length;
  return tableCount === minCount || tableCount === maxCount ? "Unbalanced" : "Balanced";
}

export default function SeatingScreen({ state }: { state: StateSnapshot }) {
  return (
    <div className="table-grid">
      {state.tables.map((table) => (
        <div key={table.id} className="card table-card">
          <div className="table-header">
            <div>
              <h3>Table {table.tableNo}</h3>
              <span className={`pill ${table.isClosed ? "muted" : ""}`}>
                {tableStatus(state, table.id)}
              </span>
            </div>
            {!table.isClosed && (
              <button className="btn" onClick={() => closeTable(table.id)}>Close</button>
            )}
          </div>
          <div className="seat-list">
            {state.seats
              .filter((seat) => seat.tableId === table.id)
              .sort((a, b) => a.seatNo - b.seatNo)
              .map((seat) => {
                const player = state.players.find((p) => p.id === seat.playerId);
                return (
                  <div key={seat.id} className="seat-row">
                    <span className="seat-label">Seat {seat.seatNo}</span>
                    <span className={player ? "seat-player" : "seat-empty"}>
                      {player ? player.name : "Empty"}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
