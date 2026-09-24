import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n";
import { useEngine } from "../EngineContext";
import { DemoBanner } from "./DemoBanner";

/** Page frame: brand, optional header content and actions, then the page. */
export function AppShell({
  title,
  center,
  actions,
  status,
  children
}: {
  title?: ReactNode;
  center?: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const engine = useEngine();
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <Link to="/" className="brand-link">
            <span className="brand-dot" />
            <div>
              <div className="brand-title">{t("app.brand")}</div>
              <div className="brand-subtitle">{t("app.tagline")}</div>
            </div>
          </Link>
          {title}
        </div>
        {center}
        <div className="button-row">
          {actions}
          {engine.kind === "wasm" && (
            <div className="status-pill warning" title={t("app.demoHint")}>
              {t("app.demo")}
            </div>
          )}
          {status}
        </div>
      </header>
      <DemoBanner />
      {children}
    </div>
  );
}
