import { useMemo } from "react";
import type { Player, RankingEntry, StateSnapshot } from "../types";
import { exportCSV, exportPDF } from "../utils/exports";

function sortEliminated(players: Player[]) {
  return [...players]
    .filter((p) => p.status === "eliminated")
    .sort((a, b) => (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0));
}

function computeRanking(state: StateSnapshot): RankingEntry[] {
  const active = state.players.filter((p) => p.status === "active");
  const eliminated = sortEliminated(state.players);
  const entries: RankingEntry[] = [];
  let place = 1;

  if (active.length === 1) {
    const winner = active[0];
    entries.push({ place, playerName: winner.name, status: winner.status, eliminatedAt: winner.eliminatedAt });
    place += 1;
  }

  for (const player of eliminated) {
    entries.push({ place, playerName: player.name, status: player.status, eliminatedAt: player.eliminatedAt });
    place += 1;
  }

  if (active.length > 1) {
    for (const player of active) {
      entries.push({ place, playerName: player.name, status: player.status, eliminatedAt: null });
      place += 1;
    }
  }

  return entries;
}

export default function ExportsScreen({ state }: { state: StateSnapshot }) {
  const entries = useMemo(() => computeRanking(state), [state]);

  return (
    <div className="card">
      <div className="card-header">
        <h2>Exports</h2>
        <div className="button-row">
          <button className="btn primary" onClick={() => exportCSV(entries, state.tournament?.name ?? "MTT")}>Export CSV</button>
          <button className="btn" onClick={() => exportPDF(entries, state.tournament?.name ?? "MTT")}>Export PDF</button>
        </div>
      </div>

      <div className="list">
        {entries.map((entry) => (
          <div key={`${entry.place}-${entry.playerName}`} className="list-row">
            <span className="pill">#{entry.place}</span>
            <span>{entry.playerName}</span>
            <span className="muted">{entry.status === "eliminated" ? "Eliminated" : "Active"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
