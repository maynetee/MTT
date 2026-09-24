import { useState } from "react";
import { useI18n } from "../../i18n";
import { useEngine } from "../EngineContext";

/** localStorage key set once the visitor dismisses the notice. */
export const DEMO_BANNER_DISMISSED_KEY = "mtt:demo-banner-dismissed";
export const DESKTOP_DOWNLOAD_URL = "https://github.com/maynetee/MTT/releases/latest";

// Storage can throw (disabled cookies, some private modes): the notice then shows on each page.
function isDismissed(): boolean {
  try {
    return window.localStorage.getItem(DEMO_BANNER_DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DEMO_BANNER_DISMISSED_KEY, "1");
  } catch {
    // Hidden until the next page load.
  }
}

/**
 * Tells visitors of the browser demo that their tournaments stay in this browser, and where to
 * get the desktop app. Not shown in the desktop app, nor once dismissed.
 */
export function DemoBanner() {
  const { t } = useI18n();
  const engine = useEngine();
  const [dismissed, setDismissed] = useState(isDismissed);
  if (engine.kind !== "wasm" || dismissed) return null;

  const dismiss = () => {
    rememberDismissed();
    setDismissed(true);
  };

  return (
    <div className="warning-banner demo-banner" role="note">
      <span>
        {t("demo.notice")}{" "}
        <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer">
          {t("demo.download")}
        </a>
      </span>
      <button className="btn small" onClick={dismiss} aria-label={t("demo.dismiss")}>
        {t("common.dismiss")}
      </button>
    </div>
  );
}
