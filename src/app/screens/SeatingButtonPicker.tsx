import { useId, useState } from "react";
import type { TableView, View } from "../../engine/types";
import { useI18n } from "../../i18n";
import { useToast } from "../components/Toast";
import { useTournament } from "../TournamentContext";

/**
 * Sets a table's button from a row of seats: one click once the high card (or the dealer)
 * says where it is. An empty seat gives a dead button.
 */
export function ButtonSeatPicker({ table, label, onSet }: { table: TableView; label?: string; onSet?(view: View): void }) {
  const { t } = useI18n();
  const { run } = useTournament();
  const toast = useToast();
  const labelId = useId();
  const [busy, setBusy] = useState(false);

  const set = async (seat: number) => {
    if (busy || seat === table.button) return;
    setBusy(true);
    const next = await run({ type: "set_button", table: table.table, seat });
    setBusy(false);
    if (!next) return;
    toast.success(t("seating.buttonSet", { table: table.table, seat }));
    onSet?.(next);
  };

  return (
    <div className="button-picker" role="group" aria-labelledby={labelId}>
      <p id={labelId} className="button-picker-label">
        {label ?? t("seating.buttonAtTable", { table: table.table })}
      </p>
      <div className="button-picker-seats">
        {table.seats.map((seat) => (
          <button
            key={seat.seat}
            type="button"
            className={seat.name ? "seat-chip" : "seat-chip is-empty"}
            aria-label={seat.name ? t("seating.buttonHerePlayer", { seat: seat.seat, name: seat.name }) : t("seating.buttonHereEmpty", { seat: seat.seat })}
            aria-disabled={busy || undefined}
            onClick={() => void set(seat.seat)}
          >
            <span className="seat-chip-no" aria-hidden="true">
              {seat.seat}
            </span>
            <span className="seat-chip-name" aria-hidden="true">
              {seat.name ?? t("seating.empty")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
