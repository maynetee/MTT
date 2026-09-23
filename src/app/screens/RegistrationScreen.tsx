import { useMemo, useState } from "react";
import { registerPlayer, registerPlayerAtSeat } from "../api";
import type { StateSnapshot } from "../types";

function lateRegOpen(state: StateSnapshot) {
  const tournament = state.tournament;
  if (!tournament) return false;
  if (tournament.status === "setup") return true;
  if (!tournament.lateRegEnabled) return false;
  if (tournament.lateRegEndLevel !== null && tournament.currentLevelIndex > tournament.lateRegEndLevel) {
    return false;
  }
  if (tournament.lateRegEndTimeSeconds !== null) {
    const past = state.levels
      .filter((level) => level.index < tournament.currentLevelIndex)
      .reduce((acc, level) => acc + level.durationSeconds, 0);
    const currentDuration = state.levels.find((level) => level.index === tournament.currentLevelIndex)?.durationSeconds ?? 0;
    const elapsedCurrent = Math.max(0, currentDuration - tournament.clockRemainingSeconds);
    if (past + elapsedCurrent > tournament.lateRegEndTimeSeconds) return false;
  }
  return true;
}

export default function RegistrationScreen({ state }: { state: StateSnapshot }) {
  const [name, setName] = useState("");
  const [strategy, setStrategy] = useState<"random" | "balanced">("balanced");
  const [feedback, setFeedback] = useState<{ tableNo: number; seatNo: number; playerName: string } | null>(null);
  const [forceSeat, setForceSeat] = useState(false);
  const [tableNo, setTableNo] = useState(2);
  const [seatNo, setSeatNo] = useState(1);
  const lateRegStatus = lateRegOpen(state);

  const tournament = state.tournament;
  const capacity = useMemo(() => {
    if (!tournament) return 0;
    return tournament.tablesCount * tournament.seatsPerTable;
  }, [tournament]);

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const seat = forceSeat
        ? await registerPlayerAtSeat(trimmed, tableNo, seatNo)
        : await registerPlayer(trimmed, strategy);
      const table = state.tables.find(t => t.id === seat.tableId);
      if (table) {
        setFeedback({ tableNo: table.tableNo, seatNo: seat.seatNo, playerName: trimmed });
      }
      setName("");
    } catch (err) {
      console.error(err);
    }
  };

  const remainingSeats = Math.max(0, capacity - state.players.length);

  return (
    <div className="grid-2">
      <div className="card">
        <h2>Register Player</h2>

        {feedback && (
          <div className="feedback-box">
            <div className="feedback-title">✅ Registered</div>
            <div className="feedback-player">{feedback.playerName}</div>
            <div className="feedback-seat">Table {feedback.tableNo} — Seat {feedback.seatNo}</div>
            <button className="btn small" onClick={() => setFeedback(null)}>Dismiss</button>
          </div>
        )}

        <input
          placeholder="Player name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (feedback) setFeedback(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleAdd();
            }
          }}
          autoFocus
        />
        <div className="radio-group">
          <label>
            <input
              type="radio"
              value="balanced"
              checked={strategy === "balanced"}
              onChange={() => setStrategy("balanced")}
            />
            Random (Balanced)
          </label>
          <label>
            <input
              type="radio"
              value="random"
              checked={strategy === "random"}
              onChange={() => setStrategy("random")}
            />
            Random
          </label>
        </div>
        <div className="card">
          <div className="card-header">
            <h3>Force Seat (Override Late Reg)</h3>
            <label className="toggle">
              <input type="checkbox" checked={forceSeat} onChange={(event) => setForceSeat(event.target.checked)} />
              Enabled
            </label>
          </div>
          <div className="grid-2">
            <label>
              Table
              <input
                type="number"
                min={1}
                value={tableNo}
                onChange={(event) => setTableNo(Number(event.target.value))}
                disabled={!forceSeat}
              />
            </label>
            <label>
              Seat
              <input
                type="number"
                min={1}
                value={seatNo}
                onChange={(event) => setSeatNo(Number(event.target.value))}
                disabled={!forceSeat}
              />
            </label>
          </div>
          <div className="muted">Bypasses late registration and assigns directly if the seat is free.</div>
        </div>
        <button className="btn primary" onClick={handleAdd}>Register</button>
      </div>

      <div className="card">
        <h3>Capacity</h3>
        <div className="stats-grid">
          <div>
            <div className="stat-value">{state.players.length}</div>
            <div className="stat-label">Registered</div>
          </div>
          <div>
            <div className="stat-value">{remainingSeats}</div>
            <div className="stat-label">Seats left</div>
          </div>
          <div>
            <div className={`pill ${lateRegStatus ? "" : "muted"}`}>
              Late reg {lateRegStatus ? "OPEN" : "CLOSED"}
            </div>
          </div>
        </div>
        <h4>Active Players</h4>
        <div className="list">
          {state.players.filter((p) => p.status === "active").map((player) => (
            <div key={player.id} className="list-row">
              <span>{player.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
