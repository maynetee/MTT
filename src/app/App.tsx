import { useEffect, useState } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import { isTauriAvailable } from "./api";
import { useTournament } from "./hooks/useTournament";
import { resetTournament, undoLastEvent, startClock, pauseClock } from "./api";
import SetupScreen from "./screens/SetupScreen";
import RegistrationScreen from "./screens/RegistrationScreen";
import SeatingScreen from "./screens/SeatingScreen";
import PlayersScreen from "./screens/PlayersScreen";
import MovesScreen from "./screens/MovesScreen";
import ClockScreen from "./screens/ClockScreen";
import LevelsScreen from "./screens/LevelsScreen";
import DisplayScreen from "./screens/DisplayScreen";
import ExportsScreen from "./screens/ExportsScreen";

const tabs = [
  { label: "Levels", path: "/levels" },
  { label: "Registration", path: "/" },
  { label: "Seating", path: "/seating" },
  { label: "Players", path: "/players" },
  { label: "Moves", path: "/moves" },
  { label: "Clock", path: "/clock" },
  { label: "Display", path: "/display-preview" },
  { label: "Exports", path: "/exports" }
];

export default function App() {
  const { state, error, setError } = useTournament();
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLastEvent();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <Routes>
      <Route
        path="/display"
        element={<DisplayScreen state={state} />}
      />
      <Route
        path="*"
        element={
          <div className="app-shell">
            <header className="app-header">
              <div className="brand">
                <span className="brand-dot" />
                <div>
                  <div className="brand-title">MTT</div>
                  <div className="brand-subtitle">Tournament Director</div>
                </div>
              </div>

              {state.tournament && (
                <div style={{ display: "flex", gap: "12px" }}>
                  <button
                    className="btn"
                    style={{
                      minWidth: "100px",
                      background: state.tournament.clockState === "running" ? "#fef3c7" : "#dcfce7",
                      color: state.tournament.clockState === "running" ? "#92400e" : "#166534",
                      border: "1px solid currentColor"
                    }}
                    onClick={() => state.tournament?.clockState === "running" ? pauseClock() : startClock()}
                  >
                    {state.tournament.clockState === "running" ? "Pause" : "Start"}
                  </button>
                </div>
              )}

              <div className="button-row">
                {state.tournament && (
                  <>
                    <button className="btn" onClick={() => undoLastEvent()}>
                      Undo
                    </button>
                    <button className="btn" onClick={() => setConfirmReset(true)}>
                      Reset
                    </button>
                  </>
                )}
                {!isTauriAvailable() && <div className="status-pill warning">DEMO</div>}
                <div className="status-pill">
                  {state.tournament ? state.tournament.status.toUpperCase() : "SETUP"}
                </div>
              </div>
            </header>

            {error && (
              <div className="error-banner">
                <span>{error}</span>
                <button onClick={() => setError(null)}>Dismiss</button>
              </div>
            )}

            {confirmReset && (
              <div className="error-banner">
                <span>Reset tournament? This clears players, seats, and events.</span>
                <div className="button-row">
                  <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setConfirmReset(false);
                      resetTournament();
                    }}
                  >
                    Confirm Reset
                  </button>
                </div>
              </div>
            )}

            {!state.tournament ? (
              <div className="page">
                <SetupScreen />
              </div>
            ) : (
              <>
                <nav className="tabs">
                  {tabs.map((tab) => (
                    <NavLink key={tab.path} to={tab.path} className={({ isActive }) => (isActive ? "tab active" : "tab")}>
                      {tab.label}
                    </NavLink>
                  ))}
                </nav>
                <main className="page">
                  <Routes>
                    <Route path="/levels" element={<LevelsScreen state={state} />} />
                    <Route path="/" element={<RegistrationScreen state={state} />} />
                    <Route path="/seating" element={<SeatingScreen state={state} />} />
                    <Route path="/players" element={<PlayersScreen state={state} />} />
                    <Route path="/moves" element={<MovesScreen state={state} />} />
                    <Route path="/clock" element={<ClockScreen state={state} />} />
                    <Route path="/display-preview" element={<DisplayScreen state={state} preview />} />
                    <Route path="/exports" element={<ExportsScreen state={state} />} />
                  </Routes>
                </main>
              </>
            )}
          </div>
        }
      />
    </Routes>
  );
}
