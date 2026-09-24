import { useI18n } from "../../i18n";
import { ConfirmDialog } from "./ConfirmDialog";

/** Confirms breaking a table: its players are redrawn elsewhere. */
export function BreakTableDialog({
  table,
  players,
  onCancel,
  onConfirm
}: {
  /** The table to break; the dialog is closed while null. */
  table: number | null;
  players: number;
  onCancel(): void;
  onConfirm(table: number): void | Promise<unknown>;
}) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      open={table !== null}
      tone="danger"
      title={t("seating.breakTitle", { table: table ?? "" })}
      message={t("seating.breakMessage", { count: players })}
      confirmLabel={t("seating.breakConfirm", { table: table ?? "" })}
      onCancel={onCancel}
      onConfirm={() => (table === null ? undefined : onConfirm(table))}
    />
  );
}
