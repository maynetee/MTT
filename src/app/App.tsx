import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import ClockScreen from "./screens/ClockScreen";
import { DirectorRoute } from "./screens/DirectorShell";
import { DisplayPreview, DisplayRoute } from "./screens/DisplayScreen";
import ExportsScreen from "./screens/ExportsScreen";
import LevelsScreen from "./screens/LevelsScreen";
import MovesScreen from "./screens/MovesScreen";
import PayoutsScreen from "./screens/PayoutsScreen";
import PlayersScreen from "./screens/PlayersScreen";
import RegistrationScreen from "./screens/RegistrationScreen";
import SeatingScreen from "./screens/SeatingScreen";
import SettingsScreen from "./screens/SettingsScreen";
import SetupScreen from "./screens/SetupScreen";
import TournamentListScreen from "./screens/TournamentListScreen";

/** A new screen starts at its top, not at the scroll position of the previous one. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    (document.scrollingElement ?? document.documentElement).scrollTop = 0;
  }, [pathname]);
  return null;
}

/**
 * Routes (hash based): `/` the tournament list, `/new` a new tournament, `/t/:id/<tab>` the
 * director's tabs, `/display/:id` the public display window. Toasts outlive the screen that
 * raised them (an elimination's Undo stays offered after switching tabs).
 */
export default function App() {
  return (
    <ToastProvider>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<TournamentListScreen />} />
        <Route path="/new" element={<SetupScreen />} />
        <Route path="/display/:id" element={<DisplayRoute />} />
        <Route path="/t/:id" element={<DirectorRoute />}>
          <Route index element={<Navigate to="registration" replace />} />
          <Route path="levels" element={<LevelsScreen />} />
          <Route path="registration" element={<RegistrationScreen />} />
          <Route path="seating" element={<SeatingScreen />} />
          <Route path="players" element={<PlayersScreen />} />
          <Route path="moves" element={<MovesScreen />} />
          <Route path="clock" element={<ClockScreen />} />
          <Route path="payouts" element={<PayoutsScreen />} />
          <Route path="display" element={<DisplayPreview />} />
          <Route path="exports" element={<ExportsScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="registration" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
