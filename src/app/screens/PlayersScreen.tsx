import React, { useEffect, useMemo, useRef, useState } from "react";
import { eliminatePlayer, revivePlayerAtSeat, updateItmCount } from "../api";
import type { StateSnapshot } from "../types";

export default function PlayersScreen({ state }: { state: StateSnapshot }) {
  const [search, setSearch] = useState("");
  const [itm, setItm] = useState(state.tournament?.itmCount ?? 0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [revivePlayerId, setRevivePlayerId] = useState<number | "">("");
  const [reviveTableNo, setReviveTableNo] = useState<number>(1);
  const [reviveSeatNo, setReviveSeatNo] = useState<number>(1);

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

  const availableSeats = useMemo(() => {
    return state.seats
      .filter((seat) => seat.playerId === null && !state.tables.find((t) => t.id === seat.tableId)?.isClosed)
      .map((seat) => {
        const tableNo = state.tables.find((t) => t.id === seat.tableId)?.tableNo ?? 0;
        return { tableNo, seatNo: seat.seatNo };
      })
      .sort((a, b) => (a.tableNo === b.tableNo ? a.seatNo - b.seatNo : a.tableNo - b.tableNo));
  }, [state.seats, state.tables]);

  const handleUpdateItm = async () => {
    if (!Number.isFinite(itm)) return;
    await updateItmCount(itm);
  };

  const handleRevive = async () => {
    if (revivePlayerId === "") return;
    await revivePlayerAtSeat(revivePlayerId, reviveTableNo, reviveSeatNo);
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
            <select value={revivePlayerId} onChange={(event) => setRevivePlayerId(Number(event.target.value))}>
              <option value="">Select eliminated player</option>
              {eliminatedPlayers.map((player) => (
                <option key={player.id} value={player.id}>{player.name}</option>
              ))}
            </select>
          </label>
          <label>
            Seat
            <select
              value={`${reviveTableNo}-${reviveSeatNo}`}
              onChange={(event) => {
                const [table, seat] = event.target.value.split("-").map(Number);
                setReviveTableNo(table);
                setReviveSeatNo(seat);
              }}
            >
              {availableSeats.map((seat) => (
                <option key={`${seat.tableNo}-${seat.seatNo}`} value={`${seat.tableNo}-${seat.seatNo}`}>
                  Table {seat.tableNo} Seat {seat.seatNo}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="btn" onClick={handleRevive} disabled={revivePlayerId === ""}>
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
