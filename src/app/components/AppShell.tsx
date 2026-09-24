import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n";
import { useEngine } from "../EngineContext";
import { BrandMark } from "./BrandMark";
import { DemoBanner } from "./DemoBanner";
import { Pill } from "./Pill";
import { ThemeSwitch } from "./ThemeSwitch";

/**
 * Page frame. A sticky header in three columns (what this page is about, the live clock
 * centered, then history and status), optional navigation under it, then the page.
 */
export function AppShell({
  title,
  center,
  actions,
  nav,
  children
}: {
  /** Replaces the product name next to the brand mark. */
  title?: ReactNode;
  center?: ReactNode;
  actions?: ReactNode;
  nav?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const engine = useEngine();
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-bar">
          <div className="app-header-start">
            <Link to="/" className="brand" aria-label={t("app.home")}>
              <BrandMark />
            </Link>
            {title ?? (
              <span className="brand-name">
                {t("app.brand")} <span className="brand-tagline">{t("app.tagline")}</span>
              </span>
            )}
          </div>
          <div className="app-header-center">{center}</div>
          <div className="app-header-end">
            {actions}
            {engine.kind === "wasm" && (
              <Pill tone="accent" title={t("app.demoHint")}>
                {t("app.demo")}
              </Pill>
            )}
            <ThemeSwitch />
          </div>
        </div>
        {nav && <div className="app-header-nav">{nav}</div>}
      </header>
      <main className="page">
        <DemoBanner />
        {children}
      </main>
    </div>
  );
}

/** The page's place in the app: a link back to the list above its name. */
export function PageTitle({ name }: { name: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="page-title">
      <Link to="/" className="page-title-back">
        {t("app.allTournaments")}
      </Link>
      <h1 className="page-title-name">{name}</h1>
    </div>
  );
}
