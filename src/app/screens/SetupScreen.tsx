import React, { useMemo, useState } from "react";
import { createTournament } from "../api";
import type { LevelDraft, TournamentConfig } from "../types";

const defaultLevels: LevelDraft[] = [
  { index: 0, durationSeconds: 20 * 60, smallBlind: 100, bigBlind: 200, ante: 0, isBreak: false, label: "Level 1" },
  { index: 1, durationSeconds: 20 * 60, smallBlind: 150, bigBlind: 300, ante: 0, isBreak: false, label: "Level 2" },
  { index: 2, durationSeconds: 20 * 60, smallBlind: 200, bigBlind: 400, ante: 50, isBreak: false, label: "Level 3" },
  { index: 3, durationSeconds: 20 * 60, smallBlind: 300, bigBlind: 600, ante: 75, isBreak: false, label: "Level 4" },
  { index: 4, durationSeconds: 15 * 60, smallBlind: 0, bigBlind: 0, ante: 0, isBreak: true, label: "Break" },
  { index: 5, durationSeconds: 20 * 60, smallBlind: 400, bigBlind: 800, ante: 100, isBreak: false, label: "Level 5" },
  { index: 6, durationSeconds: 20 * 60, smallBlind: 500, bigBlind: 1000, ante: 100, isBreak: false, label: "Level 6" },
  { index: 7, durationSeconds: 20 * 60, smallBlind: 600, bigBlind: 1200, ante: 200, isBreak: false, label: "Level 7" },
  { index: 8, durationSeconds: 15 * 60, smallBlind: 0, bigBlind: 0, ante: 0, isBreak: true, label: "Break" },
  { index: 9, durationSeconds: 20 * 60, smallBlind: 800, bigBlind: 1600, ante: 200, isBreak: false, label: "Level 8" }
];

export default function SetupScreen() {
  const [name, setName] = useState("MTT");
  const [tablesCount, setTablesCount] = useState(8);
  const [seatsPerTable, setSeatsPerTable] = useState(8);
  const [itmCount, setItmCount] = useState(9);
  const [lateRegEnabled, setLateRegEnabled] = useState(true);
  const [lateRegEndLevel, setLateRegEndLevel] = useState<number | null>(6);
  const [lateRegEndMinutes, setLateRegEndMinutes] = useState<number | null>(90);
  const [levels, setLevels] = useState<LevelDraft[]>(defaultLevels);

  const capacity = useMemo(() => tablesCount * seatsPerTable, [tablesCount, seatsPerTable]);

  const handleCreate = async () => {
    const config: TournamentConfig = {
      name,
      tablesCount,
      seatsPerTable,
      itmCount,
      lateRegEnabled,
      lateRegEndLevel,
      lateRegEndTimeSeconds: lateRegEndMinutes ? lateRegEndMinutes * 60 : null
    };

    const sortedLevels = [...levels].sort((a, b) => a.index - b.index);
    await createTournament(config, sortedLevels);
  };

  const updateLevel = (index: number, updates: Partial<LevelDraft>) => {
    setLevels((prev) =>
      prev.map((level, idx) => (idx === index ? { ...level, ...updates } : level))
    );
  };

  const addLevel = () => {
    const nextIndex = levels.length;
    setLevels((prev) => [
      ...prev,
      {
        index: nextIndex,
        durationSeconds: 20 * 60,
        smallBlind: 0,
        bigBlind: 0,
        ante: 0,
        isBreak: false,
        label: `Level ${nextIndex + 1}`
      }
    ]);
  };

  const removeLevel = (indexToRemove: number) => {
    setLevels((prev) => {
      const filtered = prev.filter((_, idx) => idx !== indexToRemove);
      return filtered.map((level, idx) => ({ ...level, index: idx }));
    });
  };

  return (
    <div className="setup">
      <div className="card">
        <h2>Setup Tournament</h2>
        <div className="grid-2">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            ITM count
            <input type="number" value={itmCount} onChange={(event) => setItmCount(Number(event.target.value))} />
          </label>
          <label>
            Tables
            <input type="number" value={tablesCount} onChange={(event) => setTablesCount(Number(event.target.value))} />
          </label>
          <label>
            Seats per table
            <input type="number" value={seatsPerTable} onChange={(event) => setSeatsPerTable(Number(event.target.value))} />
          </label>
        </div>

        <div className="pill">Capacity: {capacity} seats</div>
      </div>

      <div className="card">
        <h3>Late Registration</h3>
        <label className="toggle">
          <input type="checkbox" checked={lateRegEnabled} onChange={(event) => setLateRegEnabled(event.target.checked)} />
          Enable late registration
        </label>
        <div className="grid-2">
          <label>
            End level index
            <input
              type="number"
              value={lateRegEndLevel ?? ""}
              onChange={(event) => setLateRegEndLevel(event.target.value ? Number(event.target.value) : null)}
              disabled={!lateRegEnabled}
            />
          </label>
          <label>
            End time (minutes)
            <input
              type="number"
              value={lateRegEndMinutes ?? ""}
              onChange={(event) => setLateRegEndMinutes(event.target.value ? Number(event.target.value) : null)}
              disabled={!lateRegEnabled}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Levels & Breaks</h3>
          <button className="btn" onClick={addLevel}>Add level</button>
        </div>
        <div className="levels-header">
          <div>Label</div>
          <div>Mins</div>
          <div>SB</div>
          <div>BB</div>
          <div>Ante</div>
          <div>Break</div>
          <div></div>
        </div>
        <div className="levels">
          {levels.map((level, idx) => (
            <div key={`${level.label}-${idx}`} className="level-row">
              <input
                className="level-label"
                value={level.label}
                onChange={(event) => updateLevel(idx, { label: event.target.value })}
              />

              <input
                type="number"
                value={level.durationSeconds / 60}
                onChange={(event) => updateLevel(idx, { durationSeconds: Number(event.target.value) * 60 })}
              />

              {!level.isBreak ? (
                <>
                  <input
                    type="number"
                    value={level.smallBlind}
                    onChange={(event) => updateLevel(idx, { smallBlind: Number(event.target.value) })}
                  />
                  <input
                    type="number"
                    value={level.bigBlind}
                    onChange={(event) => updateLevel(idx, { bigBlind: Number(event.target.value) })}
                  />
                  <input
                    type="number"
                    value={level.ante}
                    onChange={(event) => updateLevel(idx, { ante: Number(event.target.value) })}
                  />
                </>
              ) : (
                <>
                  <div className="pill muted" style={{ justifyContent: "center" }}>-</div>
                  <div className="pill muted" style={{ justifyContent: "center" }}>-</div>
                  <div className="pill muted" style={{ justifyContent: "center" }}>-</div>
                </>
              )}

              <label className="toggle small">
                <input
                  type="checkbox"
                  checked={level.isBreak}
                  onChange={(event) => updateLevel(idx, { isBreak: event.target.checked })}
                />
              </label>
              <button
                className="btn small"
                style={{ color: "#ef4444", border: "none", background: "transparent", fontSize: "18px" }}
                onClick={() => removeLevel(idx)}
                title="Remove level"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="actions">
        <button className="btn primary" onClick={handleCreate}>Create Tournament</button>
      </div>
    </div>
  );
}
