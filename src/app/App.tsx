import { Navigate, Route, Routes } from "react-router-dom";
import ClockScreen from "./screens/ClockScreen";
import { DirectorRoute } from "./screens/DirectorShell";
import { DisplayPreview, DisplayRoute } from "./screens/DisplayScreen";
import ExportsScreen from "./screens/ExportsScreen";
import LevelsScreen from "./screens/LevelsScreen";
import MovesScreen from "./screens/MovesScreen";
import PlayersScreen from "./screens/PlayersScreen";
import RegistrationScreen from "./screens/RegistrationScreen";
import SeatingScreen from "./screens/SeatingScreen";
import SettingsScreen from "./screens/SettingsScreen";
import SetupScreen from "./screens/SetupScreen";
import TournamentListScreen from "./screens/TournamentListScreen";

/**
 * Routes (hash based): `/` the tournament list, `/new` a new tournament, `/t/:id/<tab>` the
 * director's tabs, `/display/:id` the public display window.
 */
export default function App() {
  return (
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
        <Route path="display" element={<DisplayPreview />} />
        <Route path="exports" element={<ExportsScreen />} />
        <Route path="settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="registration" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
