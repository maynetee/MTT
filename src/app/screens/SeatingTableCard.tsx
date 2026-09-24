import { useEffect, useId, useRef, useState } from "react";
import type { TableView } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Pill } from "../components/Pill";
import { useTournament } from "../TournamentContext";
import type { TableAttention } from "./MovesPlan";

/** Why the table stands out: final table, next to break, balancing, button to set. */
function AttentionPills({ table, attention, running }: { table: TableView; attention: TableAttention | undefined; running: boolean }) {
  const { t } = useI18n();
  const pills = [];
  if (attention?.finalTable) pills.push(<Pill key="final" tone="accent">{t("seating.finalTableHere")}</Pill>);
  if (attention?.breakNext) pills.push(<Pill key="break" tone="danger">{t("seating.breakNext")}</Pill>);
  if (attention?.outgoing) pills.push(<Pill key="out" tone="accent">{t("moves.outgoing", { count: attention.outgoing })}</Pill>);
  if (attention?.incoming) pills.push(<Pill key="in" tone="accent">{t("moves.incoming", { count: attention.incoming })}</Pill>);
  if (running && table.button === null && table.players >= 2) {
    pills.push(
      <Pill key="button" tone={attention?.needsButton ? "accent" : "muted"} dot={attention?.needsButton}>
        {t("seating.noButton")}
      </Pill>
    );
  }
  if (pills.length === 0) return null;
  return <p className="table-card-pills">{pills}</p>;
}

export function TableCard({
  table,
  attention,
  canBreak,
  onBreak
}: {
  table: TableView;
  attention?: TableAttention;
  /** False for the last open table. */
  canBreak: boolean;
  onBreak(table: number): void;
}) {
  const { t } = useI18n();
  const { view, run } = useTournament();
  const titleId = useId();
  const hintId = useId();
  const [settingButton, setSettingButton] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const editable = view.phase !== "finished";
  const highlighted = Boolean(attention && (attention.finalTable || attention.breakNext || attention.outgoing || attention.incoming));

  // Picking a seat: start on the current button (or the first seat); Esc gives up.
  useEffect(() => {
    if (!settingButton) return;
    const seats = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".seat-button") ?? [])];
    (seats.find((seat) => seat.dataset.button !== undefined) ?? seats[0])?.focus();
  }, [settingButton]);

  const stopSetting = () => {
    setSettingButton(false);
    toggleRef.current?.focus();
  };

  const setButton = async (seat: number) => {
    if (seat === table.button) {
      stopSetting();
      return;
    }
    if (await run({ type: "set_button", table: table.table, seat })) stopSetting();
  };

  const className = ["table-card", settingButton ? "is-setting-button" : "", highlighted ? "needs-attention" : ""].filter(Boolean).join(" ");

  return (
    <article
      className={className}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (settingButton && event.key === "Escape") {
          event.preventDefault();
          stopSetting();
        }
      }}
    >
      <header className="table-card-header">
        <h2 id={titleId} className="table-card-title">
          {t("seating.tableTitle", { table: table.table })}
        </h2>
        <span className="table-card-count">{t("seating.players", { count: table.players })}</span>
      </header>
      <AttentionPills table={table} attention={attention} running={view.phase === "running"} />
      {settingButton && (
        <p id={hintId} className="table-card-hint">
          {t("seating.setButtonHint")}
        </p>
      )}
      <ol ref={listRef} className="seat-list">
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
                  data-button={dealer ? "" : undefined}
                  aria-describedby={hintId}
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
          <Button size="sm" icon="shuffle" variant="ghost" className="button--danger-text" onClick={() => onBreak(table.table)} disabled={!canBreak}>
            {t("seating.breakTable")}
          </Button>
          <Button ref={toggleRef} size="sm" aria-pressed={settingButton} onClick={() => (settingButton ? stopSetting() : setSettingButton(true))}>
            {t("seating.setButton")}
          </Button>
        </footer>
      )}
    </article>
  );
}
