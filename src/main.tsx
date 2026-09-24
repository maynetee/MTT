import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./app/App";
import { EngineProvider } from "./app/EngineContext";
import { getEngine, toEngineError } from "./engine";
import { I18nProvider, getI18n, readLanguage } from "./i18n";
import { initTheme } from "./app/theme";
// Bundled locally (OFL): no network request, compatible with a font-src 'self' CSP. The
// optical-size axis gives large numerals (the clock) Inter's display cut.
import "@fontsource-variable/inter/opsz.css";
import "./app/styles.css";

initTheme();
// The page's language from the start, before the engine loads (I18nProvider keeps it after).
document.documentElement.lang = readLanguage().locale;

const root = ReactDOM.createRoot(document.getElementById("root")!);

getEngine().then(
  (engine) =>
    root.render(
      <React.StrictMode>
        <I18nProvider>
          <EngineProvider engine={engine}>
            <HashRouter>
              <App />
            </HashRouter>
          </EngineProvider>
        </I18nProvider>
      </React.StrictMode>
    ),
  (error: unknown) => {
    console.error("The engine could not start", error);
    const i18n = getI18n(readLanguage().locale);
    root.render(<p className="engine-error">{i18n.t("app.engineFailed", { message: i18n.error(toEngineError(error)) })}</p>);
  }
);
