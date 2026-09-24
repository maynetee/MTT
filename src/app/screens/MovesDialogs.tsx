import { useI18n } from "../../i18n";
import { Callout } from "../components/Callout";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useTournament } from "../TournamentContext";
import { openTables } from "./MovesPlan";

/**
 * Confirms breaking a table. The seats are drawn by the core when the break is applied, so the
 * dialog shows who moves and where seats are free; the list to announce comes right after.
 */
export function BreakTableDialog({
  table,
  onCancel,
  onConfirm
}: {
  /** The table to break; the dialog is closed while null. */
  table: number | null;
  onCancel(): void;
  onConfirm(table: number): void | Promise<unknown>;
}) {
  const { t } = useI18n();
  const { view } = useTournament();
  const broken = view.tables.find((candidate) => candidate.table === table);
  const seated = broken?.seats.filter((seat) => seat.player !== null) ?? [];
  const free = openTables(view)
    .filter((other) => other.table !== table)
    .map((other) => ({ table: other.table, free: other.seats.filter((seat) => seat.player === null).length }))
    .filter((other) => other.free > 0);
  const available = free.reduce((sum, other) => sum + other.free, 0);

  return (
    <ConfirmDialog
      open={table !== null}
      tone="danger"
      size="md"
      title={t("seating.breakTitle", { table: table ?? "" })}
      message={t("seating.breakMessage", { count: seated.length })}
      confirmLabel={t("seating.breakConfirm", { table: table ?? "" })}
      onCancel={onCancel}
      onConfirm={() => (table === null ? undefined : onConfirm(table))}
    >
      {seated.length > 0 && (
        <div className="break-preview">
          <div className="break-preview-group">
            <h3 className="break-preview-title">{t("moves.preview.players", { count: seated.length })}</h3>
            <ul className="break-preview-list">
              {seated.map((seat) => (
                <li key={seat.seat}>
                  <span className="break-preview-seat">{t("moves.preview.seat", { seat: seat.seat })}</span>
                  <span className="break-preview-name">{seat.name}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="break-preview-group">
            <h3 className="break-preview-title">{t("moves.preview.freeSeats")}</h3>
            {free.length === 0 ? (
              <p className="muted">{t("common.none")}</p>
            ) : (
              <ul className="break-preview-list">
                {free.map((other) => (
                  <li key={other.table}>
                    <span className="break-preview-name">{t("seating.tableTitle", { table: other.table })}</span>
                    <span className="break-preview-seat">{t("moves.preview.free", { count: other.free })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {available < seated.length ? (
            <Callout tone="danger" className="break-preview-note">
              {t("moves.preview.notEnough", { needed: seated.length, available })}
            </Callout>
          ) : (
            <p className="break-preview-note muted">{t("moves.preview.drawn")}</p>
          )}
        </div>
      )}
    </ConfirmDialog>
  );
}

/** Confirms the final table draw: everyone left is redrawn at one table. */
export function FinalTableDialog({
  table,
  onCancel,
  onConfirm
}: {
  table: number | null;
  onCancel(): void;
  onConfirm(table: number): void | Promise<unknown>;
}) {
  const { t } = useI18n();
  const { view } = useTournament();
  return (
    <ConfirmDialog
      open={table !== null}
      title={t("moves.finalTitle")}
      message={t("moves.finalMessage", { count: view.counts.alive, table: table ?? "" })}
      confirmLabel={t("moves.drawFinalTable")}
      onCancel={onCancel}
      onConfirm={() => (table === null ? undefined : onConfirm(table))}
    >
      <p className="muted">{t("moves.finalNext")}</p>
    </ConfirmDialog>
  );
}
