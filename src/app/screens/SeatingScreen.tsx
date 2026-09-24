import { useId, useState } from "react";
import type { TableView } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Pill } from "../components/Pill";
import { SeatChanges } from "../components/SeatChanges";
import { BreakTableDialog } from "../components/TableDialogs";
import { useTournament } from "../TournamentContext";
import { seatChanges, type SeatChange } from "../utils/view";

function TableCard({ table, onBreak }: { table: TableView; onBreak(table: TableView): void }) {
  const { t } = useI18n();
  const { view, run } = useTournament();
  const titleId = useId();
  const [settingButton, setSettingButton] = useState(false);
  const editable = view.phase !== "finished";

  const setButton = async (seat: number) => {
    if (await run({ type: "set_button", table: table.table, seat })) setSettingButton(false);
  };

  return (
    <article className={settingButton ? "table-card is-setting-button" : "table-card"} aria-labelledby={titleId}>
      <header className="table-card-header">
        <h2 id={titleId} className="table-card-title">
          {t("seating.tableTitle", { table: table.table })}
        </h2>
        <span className="table-card-count">{t("seating.players", { count: table.players })}</span>
      </header>
      {settingButton && <p className="table-card-hint">{t("seating.setButtonHint")}</p>}
      <ol className="seat-list">
        {table.seats.map((seat) => {
          const dealer = seat.seat === table.button;
          const blind = seat.seat === table.nextSb ? t("seating.smallBlind") : seat.seat === table.nextBb ? t("seating.bigBlind") : null;
          const content = (
            <>
              <span className="seat-no">
                <span aria-hidden="true">{seat.seat}</span>
                <span className="visually-hidden">{t("seating.seatN", { seat: seat.seat })}</span>
              </span>
              <span className={seat.name ? "seat-player" : "seat-empty"}>{seat.name ?? t("seating.empty")}</span>
              <span className="seat-markers">
                {blind && <span className="seat-blind">{blind}</span>}
                {dealer && (
                  <span className="dealer-puck" title={t("seating.dealerName")}>
                    {t("seating.dealer")}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={seat.seat} className={["seat-row", seat.name ? "" : "is-empty", dealer ? "has-button" : ""].filter(Boolean).join(" ")}>
              {settingButton ? (
                <button
                  type="button"
                  className="seat-button"
                  aria-label={t("seating.buttonHere", { seat: seat.seat })}
                  onClick={() => void setButton(seat.seat)}
                >
                  {content}
                </button>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ol>
      {editable && (
        <footer className="table-card-footer">
          <Button size="sm" icon="shuffle" variant="ghost" className="button--danger-text" onClick={() => onBreak(table)}>
            {t("seating.breakTable")}
          </Button>
          <Button size="sm" aria-pressed={settingButton} onClick={() => setSettingButton(!settingButton)}>
            {t("seating.setButton")}
          </Button>
        </footer>
      )}
    </article>
  );
}

export default function SeatingScreen() {
  const { t } = useI18n();
  const { view, run } = useTournament();
  const [moves, setMoves] = useState<SeatChange[]>([]);
  const [breaking, setBreaking] = useState<TableView | null>(null);
  const open = view.tables.filter((table) => table.status === "open");
  const others = view.tables.filter((table) => table.status !== "open");

  const breakTable = async (table: number) => {
    setBreaking(null);
    const next = await run({ type: "break_table", table });
    if (next) setMoves(seatChanges(view, next));
  };

  return (
    <div className="stack">
      {moves.length > 0 && <SeatChanges changes={moves} onDismiss={() => setMoves([])} />}
      {open.length === 0 ? (
        <div className="card">
          <EmptyState icon="info" title={t("seating.noTable")} />
        </div>
      ) : (
        <div className="table-grid">
          {open.map((table) => (
            <TableCard key={table.table} table={table} onBreak={setBreaking} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <Section title={t("seating.otherTables")}>
          <ul className="plain-list">
            {others.map((table) => (
              <li key={table.table} className="list-row">
                <span className="strong">{t("seating.tableTitle", { table: table.table })}</span>
                <Pill tone="muted">{table.status === "idle" ? t("seating.idle") : t("seating.closed")}</Pill>
                {view.phase !== "finished" && (
                  <Button size="sm" className="list-row-action" onClick={() => void run({ type: "open_table", table: table.table })}>
                    {t("seating.openTable")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <BreakTableDialog
        table={breaking?.table ?? null}
        players={breaking?.players ?? 0}
        onCancel={() => setBreaking(null)}
        onConfirm={(table) => breakTable(table)}
      />
    </div>
  );
}
