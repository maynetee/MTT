import { useEffect, useMemo, useRef, useState } from "react";
import { eliminatePlayer, revivePlayerAtSeat, updateItmCount } from "../api";
import type { StateSnapshot } from "../types";
import { freeSeatsAtOpenTables } from "../utils/seating";

export default function PlayersScreen({ state }: { state: StateSnapshot }) {
  const [search, setSearch] = useState("");
  const [itm, setItm] = useState(state.tournament?.itmCount ?? 0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [revivePlayerId, setRevivePlayerId] = useState<number | "">("");
  // null follows the first free seat, "" is an explicit empty choice.
  const [reviveSeatChoice, setReviveSeatChoice] = useState<number | "" | null>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = [...state.players].sort((a, b) => a.name.localeCompare(b.name));
    if (!term) return list;
    return list.filter((player) => player.name.toLowerCase().includes(term));
  }, [search, state.players]);

  const eliminatedPlayers = useMemo(() => state.players.filter((p) => p.status === "eliminated"), [state.players]);

  const availableSeats = useMemo(() => freeSeatsAtOpenTables(state), [state]);

  // A chosen seat that is no longer free is dropped rather than submitted.
  const reviveSeatId = reviveSeatChoice ?? availableSeats[0]?.seatId ?? "";
  const reviveSeat = availableSeats.find((seat) => seat.seatId === reviveSeatId) ?? null;

  const handleUpdateItm = async () => {
    if (!Number.isFinite(itm)) return;
    await updateItmCount(itm);
  };

  const handleRevive = async () => {
    if (revivePlayerId === "" || !reviveSeat) return;
    await revivePlayerAtSeat(revivePlayerId, reviveSeat.tableNo, reviveSeat.seatNo);
    setRevivePlayerId("");
    setReviveSeatChoice(null);
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Players</h2>
        <div className="inline-form">
          <input
            type="number"
            value={itm}
            onChange={(event) => setItm(Number(event.target.value))}
            className="small-input"
          />
          <button className="btn" onClick={handleUpdateItm}>Update ITM</button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Revive Eliminated Player</h3>
        </div>
        <div className="grid-2">
          <label>
            Player
            <select
              value={revivePlayerId}
              onChange={(event) => setRevivePlayerId(event.target.value === "" ? "" : Number(event.target.value))}
            >
              <option value="">Select eliminated player</option>
              {eliminatedPlayers.map((player) => (
                <option key={player.id} value={player.id}>{player.name}</option>
              ))}
            </select>
          </label>
          <label>
            Seat
            <select
              value={reviveSeat?.seatId ?? ""}
              onChange={(event) => setReviveSeatChoice(event.target.value === "" ? "" : Number(event.target.value))}
            >
              <option value="">Select seat</option>
              {availableSeats.map((seat) => (
                <option key={seat.seatId} value={seat.seatId}>
                  Table {seat.tableNo} Seat {seat.seatNo}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="btn" onClick={handleRevive} disabled={revivePlayerId === "" || !reviveSeat}>
          Revive Player
        </button>
      </div>

      <input
        ref={inputRef}
        placeholder="Search player (Cmd+F)"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <div className="list">
        {filtered.map((player) => (
          <div key={player.id} className="list-row">
            <div>
              <div className="list-title">{player.name}</div>
              <div className="list-subtitle">
                {player.status === "active" ? "Active" : "Eliminated"}
              </div>
            </div>
            {player.status === "active" && (
              <button className="btn" onClick={() => eliminatePlayer(player.id)}>Eliminate</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
