import { useState } from "react";
import type { BalanceStep, Command } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button, ButtonLink } from "../components/Button";
import { Section } from "../components/Card";
import { Callout } from "../components/Callout";
import { Field, Select } from "../components/Field";
import { SeatChanges } from "../components/SeatChanges";
import { BreakTableDialog } from "../components/TableDialogs";
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
    <li className="list-row balance-step">
      <div className="balance-step-text">
        <p>{text}</p>
        {step.waitsForBb && <p className="list-subtitle">{t("moves.waitsForBb")}</p>}
        {step.needsButton.length > 0 && (
          <p className="list-subtitle warning-text">{t("moves.needsButton", { count: step.needsButton.length, tables: list(step.needsButton.map(String)) })}</p>
        )}
      </div>
      {known ? (
        <Button
          size="sm"
          icon="arrowRight"
          className="list-row-action"
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
        </Button>
      ) : (
        <ButtonLink size="sm" className="list-row-action" to="../seating" relative="path">
          {t("moves.goToSeating")}
        </ButtonLink>
      )}
    </li>
  );
}

export default function MovesScreen() {
  const { t } = useI18n();
  const { view, run } = useTournament();
  const [selectedPlayer, setSelectedPlayer] = useState<number | "">("");
  const [selectedSeat, setSelectedSeat] = useState("");
  const [moves, setMoves] = useState<SeatChange[]>([]);
  const [breaking, setBreaking] = useState<number | null>(null);
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
  const breakingPlayers = view.tables.find((table) => table.table === breaking)?.players ?? 0;

  return (
    <div className="stack">
      {moves.length > 0 && <SeatChanges changes={moves} onDismiss={() => setMoves([])} />}
      <div className="moves-layout">
        <Section title={t("moves.suggestions")}>
          {!hasSuggestion && <Callout tone="success">{t("moves.balanced")}</Callout>}
          {suggestions.finalTable !== null && (
            <div className="suggestion">
              <p>{t("moves.finalTable", { count: view.counts.alive, table: suggestions.finalTable })}</p>
              <Button variant="primary" icon="shuffle" onClick={() => void runAndReport({ type: "form_final_table", table: suggestions.finalTable! })}>
                {t("moves.drawFinalTable")}
              </Button>
            </div>
          )}
          {suggestions.breakTable !== null && (
            <div className="suggestion">
              <p>{t("moves.breakTable", { table: suggestions.breakTable })}</p>
              <Button variant="primary" icon="shuffle" onClick={() => setBreaking(suggestions.breakTable)}>
                {t("moves.breakTableAction", { table: suggestions.breakTable })}
              </Button>
            </div>
          )}
          {suggestions.balance.length > 0 && (
            <div className="stack stack--tight">
              <h3>{t("moves.balance")}</h3>
              <ol className="plain-list">
                {suggestions.balance.map((step, index) => (
                  <BalanceStepRow key={`${step.fromTable}-${step.toTable}-${step.player ?? index}`} step={step} onApply={(command) => void run(command)} />
                ))}
              </ol>
            </div>
          )}
        </Section>

        {editable && (
          <Section title={t("moves.manual")} description={t("moves.manualHint")}>
            <Field label={t("common.player")}>
              <Select value={selectedPlayer} onChange={(event) => setSelectedPlayer(event.target.value === "" ? "" : Number(event.target.value))}>
                <option value="">{t("common.selectPlayer")}</option>
                {view.ranking
                  .filter((row) => row.alive)
                  .map((row) => (
                    <option key={row.player} value={row.player}>
                      {row.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t("common.seat")}>
              <Select value={target ? selectedSeat : ""} onChange={(event) => setSelectedSeat(event.target.value)}>
                <option value="">{t("common.selectSeat")}</option>
                {seats.map((seat) => (
                  <option key={seatKey(seat)} value={seatKey(seat)}>
                    {t("common.tableSeat", { table: seat.table, seat: seat.seat })}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <Button variant="primary" icon="arrowRight" onClick={() => void handleMove()} disabled={selectedPlayer === "" || !target}>
                {t("moves.move")}
              </Button>
            </div>
          </Section>
        )}
      </div>
      <BreakTableDialog
        table={breaking}
        players={breakingPlayers}
        onCancel={() => setBreaking(null)}
        onConfirm={(table) => {
          setBreaking(null);
          return runAndReport({ type: "break_table", table });
        }}
      />
    </div>
  );
}
