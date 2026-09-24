import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Button } from "./Button";
import { Callout } from "./Callout";

export function ErrorBanner({ message, onDismiss }: { message: ReactNode; onDismiss(): void }) {
  const { t } = useI18n();
  return (
    <Callout
      tone="danger"
      role="alert"
      action={
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t("common.dismiss")}
        </Button>
      }
    >
      {message}
    </Callout>
  );
}
