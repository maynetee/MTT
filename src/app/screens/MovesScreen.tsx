import { useEffect, useMemo, useState } from "react";
import { balanceSuggestions, movePlayer } from "../api";
import type { MoveSuggestion, StateSnapshot } from "../types";

export default function MovesScreen({ state }: { state: StateSnapshot }) {
  const [suggestions, setSuggestions] = useState<MoveSuggestion[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<number | "">("");
  const [selectedSeat, setSelectedSeat] = useState<number | "">("");

  useEffect(() => {
    balanceSuggestions().then(setSuggestions).catch(() => setSuggestions([]));
  }, [state.tables, state.seats, state.players]);

  const availableSeats = useMemo(() => {
    return state.seats
      .filter((seat) => seat.playerId === null && !state.tables.find((t) => t.id === seat.tableId)?.isClosed)
      .sort((a, b) => {
        if (a.tableId === b.tableId) return a.seatNo - b.seatNo;
        return a.tableId - b.tableId;
      });
  }, [state.seats, state.tables]);

  const handleMove = async () => {
    if (selectedPlayer === "" || selectedSeat === "") return;
    await movePlayer(selectedPlayer, selectedSeat);
    setSelectedSeat("");
    setSelectedPlayer("");
  };

  const seatLabel = (seatId: number) => {
    const seat = state.seats.find((s) => s.id === seatId);
    if (!seat) return "";
    const tableNo = state.tables.find((t) => t.id === seat.tableId)?.tableNo ?? 0;
    return `Table ${tableNo} Seat ${seat.seatNo}`;
  };

  const suggestionLabel = (suggestion: MoveSuggestion) => {
    const player = state.players.find((p) => p.id === suggestion.playerId)?.name ?? "Player";
    return `Move ${player} → ${seatLabel(suggestion.toSeatId)}`;
  };

  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-header">
          <h2>Balancing Suggestions</h2>
          <button className="btn" onClick={() => balanceSuggestions().then(setSuggestions)}>Refresh</button>
        </div>
        {suggestions.length === 0 ? (
          <div className="muted">Tables are balanced.</div>
        ) : (
          <div className="list">
            {suggestions.map((suggestion) => (
              <div key={`${suggestion.playerId}-${suggestion.toSeatId}`} className="list-row">
                <span>{suggestionLabel(suggestion)}</span>
                <button className="btn" onClick={() => movePlayer(suggestion.playerId, suggestion.toSeatId)}>Apply</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Manual Move</h2>
        <div className="grid-2">
          <label>
            Player
            <select
              value={selectedPlayer}
              onChange={(event) => setSelectedPlayer(event.target.value === "" ? "" : Number(event.target.value))}
            >
              <option value="">Select player</option>
              {state.players.filter((p) => p.status === "active").map((player) => (
                <option key={player.id} value={player.id}>{player.name}</option>
              ))}
            </select>
          </label>
          <label>
            Seat
            <select
              value={selectedSeat}
              onChange={(event) => setSelectedSeat(event.target.value === "" ? "" : Number(event.target.value))}
            >
              <option value="">Select seat</option>
              {availableSeats.map((seat) => (
                <option key={seat.id} value={seat.id}>{seatLabel(seat.id)}</option>
              ))}
            </select>
          </label>
        </div>
        <button className="btn primary" onClick={handleMove} disabled={selectedPlayer === "" || selectedSeat === ""}>Move</button>
      </div>
    </div>
  );
}
