import { useMemo } from "react";
import type { StateSnapshot } from "../types";
import { exportCSV, exportPDF } from "../utils/exports";
import { computeRanking, formatPlace, rankingStatusLabel } from "../utils/ranking";

export default function ExportsScreen({ state }: { state: StateSnapshot }) {
  const tournamentStatus = state.tournament?.status;
  const entries = useMemo(() => computeRanking(state.players, tournamentStatus), [state.players, tournamentStatus]);
  const tournamentName = state.tournament?.name ?? "MTT";
  const finished = tournamentStatus === "finished";

  return (
    <div className="card">
      <div className="card-header">
        <h2>Exports</h2>
        <div className="button-row">
          <button className="btn primary" onClick={() => void exportCSV(entries, tournamentName)}>
            Export CSV
          </button>
          <button className="btn" onClick={() => void exportPDF(entries, { tournamentName, finished })}>
            Export PDF
          </button>
        </div>
      </div>

      <div className="list">
        {entries.map((entry) => (
          <div key={entry.playerId} className="list-row">
            <span className="pill">{formatPlace(entry.place)}</span>
            <span>{entry.playerName}</span>
            <span className="muted">{rankingStatusLabel(entry)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
