import type { ReactNode } from "react";
import { useI18n } from "../../i18n";

export function ErrorBanner({ message, onDismiss }: { message: ReactNode; onDismiss(): void }) {
  const { t } = useI18n();
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button onClick={onDismiss}>{t("common.dismiss")}</button>
    </div>
  );
}

/** An inline "are you sure?" bar with Cancel and a confirm button. */
export function ConfirmBar({
  message,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  message: ReactNode;
  confirmLabel: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="error-banner" role="alertdialog">
      <span>{message}</span>
      <div className="button-row">
        <button className="btn" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button className="btn primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
