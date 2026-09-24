import { useI18n } from "../../i18n";
import type { SeatChange } from "../utils/view";

/** The seat changes of a table break or a final table draw, to announce to the players. */
export function SeatChanges({ changes, onDismiss }: { changes: SeatChange[]; onDismiss(): void }) {
  const { t } = useI18n();
  const seat = (ref: SeatChange["from"]) => t("common.tableSeat", { table: ref.table, seat: ref.seat });
  return (
    <div className="card seat-changes" role="status">
      <div className="card-header">
        <h3>{t("seating.moved")}</h3>
        <button className="btn" onClick={onDismiss}>
          {t("common.dismiss")}
        </button>
      </div>
      <div className="list">
        {changes.map((change) => (
          <div key={change.player} className="list-row">
            {t("seating.move", { name: change.name, from: seat(change.from), to: seat(change.to) })}
          </div>
        ))}
      </div>
    </div>
  );
}
