import { render } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import App from "../app/App";
import { createTournamentLocal } from "../app/demoStore";

export function createDemoTournament(tablesCount: number, seatsPerTable: number) {
  createTournamentLocal(
    {
      name: "Test",
      tablesCount,
      seatsPerTable,
      itmCount: 1,
      lateRegEnabled: false,
      lateRegEndLevel: null,
      lateRegEndTimeSeconds: null
    },
    []
  );
}

export function renderApp(path: string) {
  window.location.hash = `#${path}`;
  return render(
    <HashRouter>
      <App />
    </HashRouter>
  );
}
