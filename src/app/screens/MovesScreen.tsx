import { useState } from "react";
import { Link } from "react-router-dom";
import type { BalanceStep, Command } from "../../engine/types";
import { useI18n } from "../../i18n";
import { ConfirmBar } from "../components/ErrorBanner";
import { SeatChanges } from "../components/SeatChanges";
import { useTournament } from "../TournamentContext";
import { freeSeats, seatChanges, seatKey, type SeatChange } from "../utils/view";

function BalanceStepRow({ step, onApply }: { step: BalanceStep; onApply(command: Command): void }) {
  const { t, list } = useI18n();
  const { playerName } = useTournament();
  const known = step.player !== null && step.fromSeat !== null && step.toSeat !== null;
  const text = known
    ? t("moves.step", {
        name: playerName(step.player!) ?? `#${step.player}`,
        fromTable: step.fromTable,
        fromSeat: step.fromSeat!,
        toTable: step.toTable,
        toSeat: step.toSeat!
      })
    : t("moves.stepUnknown", { fromTable: step.fromTable, toTable: step.toTable });

  return (
    <div className="list-row balance-step">
      <div>
        <div>{text}</div>
        {step.waitsForBb && <div className="list-subtitle">{t("moves.waitsForBb")}</div>}
        {step.needsButton.length > 0 && (
          <div className="list-subtitle warning-text">
            {t("moves.needsButton", { count: step.needsButton.length, tables: list(step.needsButton.map(String)) })}
          </div>
        )}
      </div>
      {known ? (
        <button
          className="btn"
          onClick={() =>
            onApply({
              type: "move_player",
              player: step.player!,
              to: { table: step.toTable, seat: step.toSeat! },
              reason: "balance"
            })
          }
        >
          {t("moves.apply")}
        </button>
      ) : (
        <Link className="btn" to="../seating" relative="path">
          {t("moves.goToSeating")}
        </Link>
      )}
    </div>
  );
}

export default function MovesScreen() {
  const { t } = useI18n();
  const { view, run } = useTournament();
  const [selectedPlayer, setSelectedPlayer] = useState<number | "">("");
  const [selectedSeat, setSelectedSeat] = useState("");
  const [moves, setMoves] = useState<SeatChange[]>([]);
  const [confirmBreak, setConfirmBreak] = useState(false);
  const { suggestions } = view;
  const seats = freeSeats(view);
  const target = seats.find((seat) => seatKey(seat) === selectedSeat) ?? null;
  const editable = view.phase !== "finished";

  const runAndReport = async (command: Command) => {
    const next = await run(command);
    if (next) setMoves(seatChanges(view, next));
  };

  const handleMove = async () => {
    if (selectedPlayer === "" || !target) return;
    if (await run({ type: "move_player", player: selectedPlayer, to: target })) {
      setSelectedPlayer("");
      setSelectedSeat("");
    }
  };

  const hasSuggestion = suggestions.finalTable !== null || suggestions.breakTable !== null || suggestions.balance.length > 0;

  return (
    <div className="moves">
      {moves.length > 0 && <SeatChanges changes={moves} onDismiss={() => setMoves([])} />}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h2>{t("moves.suggestions")}</h2>
          </div>
          {!hasSuggestion && <div className="muted">{t("moves.balanced")}</div>}
          {suggestions.finalTable !== null && (
            <div className="list-row">
              <span>{t("moves.finalTable", { count: view.counts.alive, table: suggestions.finalTable })}</span>
              <button className="btn primary" onClick={() => void runAndReport({ type: "form_final_table", table: suggestions.finalTable! })}>
                {t("moves.drawFinalTable")}
              </button>
            </div>
          )}
          {suggestions.breakTable !== null && (
            <>
              <div className="list-row">
                <span>{t("moves.breakTable", { table: suggestions.breakTable })}</span>
                <button className="btn primary" onClick={() => setConfirmBreak(true)}>
                  {t("moves.breakTableAction", { table: suggestions.breakTable })}
                </button>
              </div>
              {confirmBreak && (
                <ConfirmBar
                  message={t("seating.confirmBreak", { table: suggestions.breakTable })}
                  confirmLabel={t("moves.breakTableAction", { table: suggestions.breakTable })}
                  onCancel={() => setConfirmBreak(false)}
                  onConfirm={() => {
                    setConfirmBreak(false);
                    void runAndReport({ type: "break_table", table: suggestions.breakTable! });
                  }}
                />
              )}
            </>
          )}
          {suggestions.balance.length > 0 && (
            <>
              <h3>{t("moves.balance")}</h3>
              <div className="list">
                {suggestions.balance.map((step, index) => (
                  <BalanceStepRow key={`${step.fromTable}-${step.toTable}-${step.player ?? index}`} step={step} onApply={(command) => void run(command)} />
                ))}
              </div>
            </>
          )}
        </div>

        {editable && (
          <div className="card">
            <h2>{t("moves.manual")}</h2>
            <div className="grid-2">
              <label>
                {t("common.player")}
                <select
                  value={selectedPlayer}
                  onChange={(event) => setSelectedPlayer(event.target.value === "" ? "" : Number(event.target.value))}
                >
                  <option value="">{t("common.selectPlayer")}</option>
                  {view.ranking
                    .filter((row) => row.alive)
                    .map((row) => (
                      <option key={row.player} value={row.player}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t("common.seat")}
                <select value={target ? selectedSeat : ""} onChange={(event) => setSelectedSeat(event.target.value)}>
                  <option value="">{t("common.selectSeat")}</option>
                  {seats.map((seat) => (
                    <option key={seatKey(seat)} value={seatKey(seat)}>
                      {t("common.tableSeat", { table: seat.table, seat: seat.seat })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="btn primary" onClick={() => void handleMove()} disabled={selectedPlayer === "" || !target}>
              {t("moves.move")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
