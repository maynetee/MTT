import { useI18n } from "../../i18n";
import type { SeatChange } from "../utils/view";
import { Button } from "./Button";
import { Section } from "./Card";
import { Table } from "./Table";

/** The seat changes of a table break or a final table draw, to announce to the players. */
export function SeatChanges({ changes, onDismiss }: { changes: SeatChange[]; onDismiss(): void }) {
  const { t } = useI18n();
  const seat = (ref: SeatChange["from"]) => t("common.tableSeat", { table: ref.table, seat: ref.seat });
  return (
    <Section
      role="status"
      className="seat-changes"
      title={t("seating.moved")}
      description={t("seating.movedHint")}
      flush
      actions={
        <Button size="sm" onClick={onDismiss}>
          {t("common.dismiss")}
        </Button>
      }
    >
      <Table caption={t("seating.moved")} density="compact">
        <thead>
          <tr>
            <th scope="col">{t("common.player")}</th>
            <th scope="col">{t("seating.from")}</th>
            <th scope="col">{t("seating.to")}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={change.player}>
              <td className="strong">{change.name}</td>
              <td className="muted">{seat(change.from)}</td>
              <td className="strong seat-changes-to">{seat(change.to)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}
