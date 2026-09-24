import { useState } from "react";
import type { TableView } from "../../engine/types";
import { useI18n } from "../../i18n";
import { ConfirmBar } from "../components/ErrorBanner";
import { SeatChanges } from "../components/SeatChanges";
import { useTournament } from "../TournamentContext";
import { seatChanges, type SeatChange } from "../utils/view";

function TableCard({
  table,
  onMoves
}: {
  table: TableView;
  onMoves(changes: SeatChange[]): void;
}) {
  const { t } = useI18n();
  const { view, run } = useTournament();
  const [settingButton, setSettingButton] = useState(false);
  const [confirmBreak, setConfirmBreak] = useState(false);
  const editable = view.phase !== "finished";

  const setButton = async (seat: number) => {
    if (await run({ type: "set_button", table: table.table, seat })) setSettingButton(false);
  };

  const breakTable = async () => {
    setConfirmBreak(false);
    const next = await run({ type: "break_table", table: table.table });
    if (next) onMoves(seatChanges(view, next));
  };

  return (
    <div className="card table-card">
      <div className="table-header">
        <div>
          <h3>{t("seating.tableTitle", { table: table.table })}</h3>
          <span className="pill">{t("seating.players", { count: table.players })}</span>
        </div>
        {editable && (
          <div className="button-row">
            <button className={`btn ${settingButton ? "primary" : ""}`} aria-pressed={settingButton} onClick={() => setSettingButton(!settingButton)}>
              {t("seating.setButton")}
            </button>
            <button className="btn" onClick={() => setConfirmBreak(true)}>
              {t("seating.breakTable")}
            </button>
          </div>
        )}
      </div>
      {confirmBreak && (
        <ConfirmBar
          message={t("seating.confirmBreak", { table: table.table })}
          confirmLabel={t("seating.breakTable")}
          onCancel={() => setConfirmBreak(false)}
          onConfirm={() => void breakTable()}
        />
      )}
      {settingButton && <div className="muted">{t("seating.setButtonHint")}</div>}
      <div className="seat-list">
        {table.seats.map((seat) => {
          const markers = [
            seat.seat === table.button ? t("seating.dealer") : null,
            seat.seat === table.nextSb ? t("seating.smallBlind") : null,
            seat.seat === table.nextBb ? t("seating.bigBlind") : null
          ].filter((marker): marker is string => marker !== null);
          const content = (
            <>
              <span className="seat-label">{t("seating.seatN", { seat: seat.seat })}</span>
              <span className="seat-markers">
                {markers.map((marker) => (
                  <span key={marker} className={`seat-marker ${marker === t("seating.dealer") ? "dealer" : ""}`}>
                    {marker}
                  </span>
                ))}
              </span>
              <span className={seat.name ? "seat-player" : "seat-empty"}>{seat.name ?? t("seating.empty")}</span>
            </>
          );
          return settingButton ? (
            <button
              key={seat.seat}
              className="seat-row seat-button"
              aria-label={t("seating.buttonHere", { seat: seat.seat })}
              onClick={() => void setButton(seat.seat)}
            >
              {content}
            </button>
          ) : (
            <div key={seat.seat} className="seat-row">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SeatingScreen() {
  const { t } = useI18n();
  const { view, run } = useTournament();
  const [moves, setMoves] = useState<SeatChange[]>([]);
  const open = view.tables.filter((table) => table.status === "open");
  const others = view.tables.filter((table) => table.status !== "open");

  return (
    <div className="seating">
      {moves.length > 0 && <SeatChanges changes={moves} onDismiss={() => setMoves([])} />}
      <div className="table-grid">
        {open.map((table) => (
          <TableCard key={table.table} table={table} onMoves={setMoves} />
        ))}
      </div>
      {others.length > 0 && (
        <div className="card">
          <h3>{t("seating.otherTables")}</h3>
          <div className="list">
            {others.map((table) => (
              <div key={table.table} className="list-row">
                <span>
                  {t("seating.tableTitle", { table: table.table })}{" "}
                  <span className="muted">· {table.status === "idle" ? t("seating.idle") : t("seating.closed")}</span>
                </span>
                {view.phase !== "finished" && (
                  <button className="btn" onClick={() => void run({ type: "open_table", table: table.table })}>
                    {t("seating.openTable")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
